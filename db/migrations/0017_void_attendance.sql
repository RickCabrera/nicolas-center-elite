-- 0017 · Anular una lectura de asistencia (HUE-18): la lectura no se borra, queda tachada con motivo y autor.
-- Una lectura anulada no cuenta para horas, sesiones, citas ni para decidir entrada/salida.
alter table attendance_events
  add column if not exists voided_at   timestamptz,
  add column if not exists voided_by   uuid references users(id),
  add column if not exists void_reason text;
create index if not exists attendance_events_active_idx on attendance_events (occurred_at) where voided_at is null;

create or replace function register_attendance(
  p_device_id   uuid,
  p_employee_no text,
  p_occurred_at timestamptz,
  p_source      text,
  p_dedupe_key  text,
  p_verify_mode text default '',
  p_patient_id  uuid default null,
  p_user_id     uuid default null,
  p_location_id uuid default null,
  p_manual_reason text default null,
  p_recorded_by uuid default null
) returns attendance_events
language plpgsql security definer set search_path = public as $$
declare
  ev attendance_events;
  pat patients; usr users; dev devices;
  v_type text := 'unknown'; v_name text := ''; v_loc uuid; v_dir text := 'in';
  v_day date := mx_date(p_occurred_at);
  v_last text; v_appt uuid; v_consumed boolean := false;
  v_tol int := clinic_setting('attendance_tolerance_min', '90')::int;
  mem memberships; plan membership_plans;
begin
  select * into ev from attendance_events where dedupe_key = p_dedupe_key;
  if ev.id is not null then return ev; end if;

  if p_device_id is not null then select * into dev from devices where id = p_device_id; end if;

  if p_patient_id is not null then
    select * into pat from patients where id = p_patient_id;
  elsif p_user_id is not null then
    select * into usr from users where id = p_user_id;
  elsif p_employee_no is not null and p_employee_no <> '' then
    select * into pat from patients where hik_employee_no = p_employee_no;
    if pat.id is null then select * into usr from users where hik_employee_no = p_employee_no; end if;
  end if;

  if pat.id is not null then
    v_type := 'patient'; v_name := pat.full_name;
  elsif usr.id is not null then
    v_type := 'staff'; v_name := user_display(usr);
  end if;

  v_loc := coalesce(p_location_id, dev.location_id, pat.location_id, usr.location_id,
                    (select id from locations where active order by name limit 1));

  -- Rebote: la misma persona en menos de 60 s cuenta como una sola lectura.
  if v_type <> 'unknown' then
    select * into ev from attendance_events e
     where ((v_type = 'patient' and e.patient_id = pat.id) or (v_type = 'staff' and e.user_id = usr.id))
       and e.voided_at is null
       and e.occurred_at between p_occurred_at - interval '60 seconds' and p_occurred_at + interval '60 seconds'
     order by e.occurred_at desc limit 1;
    if ev.id is not null then return ev; end if;
  end if;

  -- Entrada o salida: lo contrario de la ÚLTIMA lectura de la persona en el día. Así la regla se cura sola
  -- aunque a media jornada se cambie el parámetro o se capture un registro manual (contar par/impar no).
  if v_type = 'staff' and clinic_setting('staff_alternate_in_out', 'true')::boolean then
    select e.direction into v_last from attendance_events e
     where e.user_id = usr.id and e.voided_at is null and mx_date(e.occurred_at) = v_day and e.occurred_at < p_occurred_at
     order by e.occurred_at desc limit 1;
    v_dir := case when v_last = 'in' then 'out' else 'in' end;
  elsif v_type = 'patient' and clinic_setting('patient_alternate_in_out', 'false')::boolean then
    select e.direction into v_last from attendance_events e
     where e.patient_id = pat.id and e.voided_at is null and mx_date(e.occurred_at) = v_day and e.occurred_at < p_occurred_at
     order by e.occurred_at desc limit 1;
    v_dir := case when v_last = 'in' then 'out' else 'in' end;
  end if;

  if v_type = 'patient' and v_dir = 'in' then
    select a.id into v_appt from appointments a
     where a.patient_id = pat.id and a.status = 'scheduled'
       and a.starts_at between p_occurred_at - make_interval(mins => v_tol) and p_occurred_at + make_interval(mins => v_tol)
     order by abs(extract(epoch from (a.starts_at - p_occurred_at))) limit 1;
    if v_appt is not null then
      update appointments set status = 'attended', attended_at = p_occurred_at where id = v_appt;
    end if;

    if clinic_setting('package_consume_on_attendance', 'true')::boolean
       and not exists (select 1 from attendance_events e
                        where e.patient_id = pat.id and e.voided_at is null and mx_date(e.occurred_at) = v_day and e.session_consumed) then
      select * into mem from memberships where patient_id = pat.id and status = 'active';
      if mem.id is not null then
        select * into plan from membership_plans where id = mem.plan_id;
        if plan.kind = 'package' and coalesce(mem.sessions_remaining, 0) > 0 then
          update memberships set sessions_remaining = sessions_remaining - 1 where id = mem.id;
          v_consumed := true;
        end if;
      end if;
    end if;
  end if;

  insert into attendance_events (device_id, location_id, person_type, patient_id, user_id, employee_no, person_name,
                                 occurred_at, direction, source, verify_mode, dedupe_key, manual_reason, recorded_by,
                                 appointment_id, session_consumed)
  values (p_device_id, v_loc, v_type, pat.id, usr.id, nullif(p_employee_no, ''), v_name,
          p_occurred_at, v_dir, p_source, coalesce(p_verify_mode, ''), p_dedupe_key, p_manual_reason, p_recorded_by,
          v_appt, v_consumed)
  on conflict (dedupe_key) do nothing
  returning * into ev;

  if ev.id is null then
    select * into ev from attendance_events where dedupe_key = p_dedupe_key;
  elsif p_device_id is not null then
    update devices set last_event_at = greatest(coalesce(last_event_at, p_occurred_at), p_occurred_at) where id = p_device_id;
  end if;
  return ev;
end $$;

-- Anula la lectura: devuelve la sesión del paquete si la había consumido y regresa la cita a "programada".
create or replace function void_attendance(p_id uuid, p_actor uuid, p_reason text) returns attendance_events
language plpgsql security definer set search_path = public as $$
declare ev attendance_events; aname text; mem memberships;
begin
  select * into ev from attendance_events where id = p_id for update;
  if ev.id is null then raise exception 'attendance_not_found' using errcode = 'P0002'; end if;
  if ev.voided_at is not null then return ev; end if;

  if ev.session_consumed and ev.patient_id is not null then
    select * into mem from memberships where patient_id = ev.patient_id and status = 'active';
    if mem.id is not null and mem.sessions_remaining is not null then
      update memberships set sessions_remaining = sessions_remaining + 1 where id = mem.id;
    end if;
  end if;
  if ev.appointment_id is not null then
    update appointments set status = 'scheduled', attended_at = null
     where id = ev.appointment_id and status = 'attended' and attended_at = ev.occurred_at;
  end if;

  update attendance_events
     set voided_at = now(), voided_by = p_actor, void_reason = left(trim(p_reason), 300), session_consumed = false
   where id = p_id returning * into ev;

  select user_display(u) into aname from users u where u.id = p_actor;
  insert into audit_log (actor_id, actor_name, action, table_name, row_id, patient_id, summary)
  values (p_actor, coalesce(aname, 'Sistema'), 'update', 'attendance_events', p_id::text, ev.patient_id,
          format('Anuló la asistencia de %s (%s %s): %s', coalesce(nullif(ev.person_name, ''), 'persona no reconocida'),
                 to_char(ev.occurred_at at time zone 'America/Mexico_City', 'DD/MM/YYYY HH24:MI'),
                 case ev.direction when 'in' then 'entrada' else 'salida' end, left(trim(p_reason), 300)));
  return ev;
end $$;
revoke execute on function void_attendance(uuid, uuid, text) from public, nce_app;
