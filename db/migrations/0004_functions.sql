-- 0004 · Lógica transversal: asistencia, vistas de consulta

-- Vista de cobranza por paciente: plan vigente y estado calculado.
create view patient_billing with (security_invoker = true) as
select p.id as patient_id,
       m.id as membership_id,
       pl.id as plan_id,
       pl.name as plan_name,
       pl.kind as plan_kind,
       pl.price_cents,
       pl.period_days,
       pl.sessions_count,
       m.started_on,
       m.next_due_date,
       m.sessions_remaining,
       m.status as membership_status,
       membership_state(m.status, pl.kind, m.next_due_date, m.sessions_remaining) as state
from patients p
left join memberships m on m.patient_id = p.id and m.status <> 'ended'
left join membership_plans pl on pl.id = m.plan_id;

-- Registra una asistencia venga de donde venga (lector, puente, manual, simulador).
-- Idempotente por dedupe_key (HUE-04). Efectos:
--   · resuelve a la persona por su número en el lector
--   · personal: alterna entrada/salida en el día (HUE-09)
--   · paciente: marca su cita cercana como "asistió" (AGE-05)
--   · paquete de sesiones: descuenta una por día de asistencia (PAG-07)
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
  v_count int; v_appt uuid; v_consumed boolean := false;
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
       and e.occurred_at between p_occurred_at - interval '60 seconds' and p_occurred_at + interval '60 seconds'
     order by e.occurred_at desc limit 1;
    if ev.id is not null then return ev; end if;
  end if;

  if v_type = 'staff' and clinic_setting('staff_alternate_in_out', 'true')::boolean then
    select count(*) into v_count from attendance_events e
     where e.user_id = usr.id and mx_date(e.occurred_at) = v_day and e.occurred_at < p_occurred_at;
    v_dir := case when v_count % 2 = 0 then 'in' else 'out' end;
  elsif v_type = 'patient' and clinic_setting('patient_alternate_in_out', 'false')::boolean then
    select count(*) into v_count from attendance_events e
     where e.patient_id = pat.id and mx_date(e.occurred_at) = v_day and e.occurred_at < p_occurred_at;
    v_dir := case when v_count % 2 = 0 then 'in' else 'out' end;
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
                        where e.patient_id = pat.id and mx_date(e.occurred_at) = v_day and e.session_consumed) then
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

-- Tarea diaria (PAG-03 / AGE-05): cierra lo que el día dejó abierto.
create or replace function daily_housekeeping() returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_noshow int; n_sessions int; n_tokens int;
begin
  update appointments set status = 'no_show'
   where status = 'scheduled' and mx_date(starts_at) < mx_today();
  get diagnostics n_noshow = row_count;
  delete from sessions where expires_at < now() - interval '7 days' or revoked_at < now() - interval '7 days';
  get diagnostics n_sessions = row_count;
  delete from auth_tokens where expires_at < now() - interval '30 days';
  get diagnostics n_tokens = row_count;
  delete from webauthn_challenges where expires_at < now();
  update device_commands set status = 'error', error = 'Sin respuesta del agente puente', finished_at = now()
   where status in ('pending','running') and created_at < now() - interval '1 day';
  return jsonb_build_object('no_show', n_noshow, 'sessions_purged', n_sessions, 'tokens_purged', n_tokens);
end $$;
