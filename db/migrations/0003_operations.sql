-- 0003 · Operación: agenda, recetas e indicaciones, mensualidades, lectores y asistencia

-- ---------- agenda ----------
create table appointments (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references patients(id) on delete cascade,
  therapist_id  uuid not null references users(id),
  location_id   uuid not null references locations(id),
  starts_at     timestamptz not null,
  duration_min  int not null check (duration_min between 5 and 480),
  ends_at       timestamptz not null,
  type_name     text not null,
  notes         text not null default '',
  status        text not null default 'scheduled' check (status in ('scheduled','attended','no_show','cancelled')),
  cancel_reason text,
  cancelled_at  timestamptz,
  attended_at   timestamptz,
  series_id     uuid,
  created_by    uuid references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- AGE-01: ni el fisioterapeuta ni el paciente pueden tener dos citas vivas empalmadas.
  constraint appointments_no_therapist_overlap exclude using gist
    (therapist_id with =, tstzrange(starts_at, ends_at) with &&) where (status <> 'cancelled'),
  constraint appointments_no_patient_overlap exclude using gist
    (patient_id with =, tstzrange(starts_at, ends_at) with &&) where (status <> 'cancelled')
);
create index appointments_day_idx on appointments (mx_date(starts_at), therapist_id);
create index appointments_patient_idx on appointments (patient_id, starts_at desc);

create or replace function appointments_set_end() returns trigger
language plpgsql as $$
begin
  new.ends_at := new.starts_at + make_interval(mins => new.duration_min);
  new.updated_at := now();
  return new;
end $$;
create trigger appointments_end before insert or update on appointments
  for each row execute function appointments_set_end();

alter table evolution_notes
  add constraint evolution_notes_appointment_fk foreign key (appointment_id) references appointments(id) on delete set null;

-- Horario laboral por fisioterapeuta (0 = domingo … 6 = sábado) y bloqueos (AGE-07).
create table therapist_hours (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  weekday    int not null check (weekday between 0 and 6),
  start_time time not null,
  end_time   time not null check (end_time > start_time),
  unique (user_id, weekday, start_time)
);

create table time_blocks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null check (ends_at > starts_at),
  reason     text not null default '',
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index time_blocks_user_idx on time_blocks (user_id, starts_at);

-- Devuelve null si el horario es válido, o el motivo en español si no lo es.
create or replace function appointment_slot_problem(p_therapist uuid, p_starts timestamptz, p_duration int)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  local_start timestamp := p_starts at time zone 'America/Mexico_City';
  local_end   timestamp := local_start + make_interval(mins => p_duration);
  ends        timestamptz := p_starts + make_interval(mins => p_duration);
  blk time_blocks;
begin
  if exists (select 1 from therapist_hours where user_id = p_therapist) then
    if local_start::date <> local_end::date or not exists (
      select 1 from therapist_hours h
      where h.user_id = p_therapist and h.weekday = extract(dow from local_start)::int
        and h.start_time <= local_start::time and h.end_time >= local_end::time
    ) then
      return 'La cita queda fuera del horario laboral del fisioterapeuta.';
    end if;
  end if;
  select * into blk from time_blocks b
   where b.user_id = p_therapist and tstzrange(b.starts_at, b.ends_at) && tstzrange(p_starts, ends) limit 1;
  if blk.id is not null then
    return 'El fisioterapeuta tiene un bloqueo en ese horario' ||
           case when blk.reason <> '' then ' (' || blk.reason || ').' else '.' end;
  end if;
  return null;
end $$;

-- ---------- recetas médicas e indicaciones fisioterapéuticas ----------
create table controlled_substances (
  name text primary key   -- en minúsculas y sin acentos
);

create table folio_counters (
  location_id uuid not null references locations(id),
  kind        text not null,
  last_number int not null default 0,
  primary key (location_id, kind)
);

create sequence receipt_seq start 1;

create table documents (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('prescription','indications')),
  folio_number int not null,
  folio        text not null unique,
  location_id  uuid not null references locations(id),
  patient_id   uuid not null references patients(id) on delete cascade,
  issuer_id    uuid not null references users(id),
  -- Copia de los datos legales al momento de emitir: el documento no cambia aunque cambie el perfil.
  issuer_name         text not null,
  issuer_title        text not null default '',
  issuer_specialty    text not null default '',
  issuer_license      text,
  issuer_institution  text,
  issuer_specialty_license text,
  clinic_name         text not null,
  location_name       text not null,
  location_address    text not null,
  location_phone      text not null default '',
  patient_name        text not null,
  patient_age         int not null,
  patient_sex         text,
  diagnosis           text not null default '',
  general_indications text not null default '',
  footer              text not null default '',
  status       text not null default 'issued' check (status in ('issued','cancelled')),
  cancel_reason text,
  cancelled_by  uuid references users(id),
  cancelled_at  timestamptz,
  duplicated_from uuid references documents(id),
  issued_at    timestamptz not null default now(),
  content_hash text not null default ''
);
create index documents_patient_idx on documents (patient_id, issued_at desc);
create index documents_issuer_idx on documents (issuer_id, issued_at desc);

create table document_items (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references documents(id) on delete cascade,
  position     int not null default 0,
  kind         text not null check (kind in ('medication','exercise','physical_agent','home_care')),
  name         text not null check (length(trim(name)) > 0),  -- medicamento: denominación genérica
  presentation text not null default '',
  dose         text not null default '',
  route        text not null default '',
  frequency    text not null default '',
  duration     text not null default '',
  instructions text not null default ''
);
create index document_items_doc_idx on document_items (document_id, position);

-- Siguiente folio consecutivo por sede y tipo. El bloqueo de fila evita repetidos y saltos (REC-05).
create or replace function next_folio(p_location uuid, p_kind text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into folio_counters (location_id, kind, last_number) values (p_location, p_kind, 1)
  on conflict (location_id, kind) do update set last_number = folio_counters.last_number + 1
  returning last_number into n;
  return n;
end $$;

-- Al emitir: fija emisor = usuario actual, copia datos legales, asigna folio y valida la
-- facultad de prescribir (art. 28 Bis LGS): receta médica solo por médico con cédula (REC-02, REC-04).
create or replace function documents_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare u users; l locations; p patients; c clinic; code text;
begin
  select * into u from users where id = app_uid() and active;
  if u.id is null then
    raise exception 'Solo un usuario activo puede emitir documentos.' using errcode = '42501';
  end if;
  if new.kind = 'prescription' and not (u.is_physician and coalesce(trim(u.license_number), '') <> '') then
    raise exception 'Solo un médico con cédula profesional registrada puede emitir recetas médicas (art. 28 Bis de la Ley General de Salud).'
      using errcode = '42501';
  end if;
  if new.kind = 'indications' and coalesce(trim(u.license_number), '') = '' then
    raise exception 'Registra tu cédula profesional en "Mi perfil" antes de emitir indicaciones.' using errcode = 'P0001';
  end if;
  select * into p from patients where id = new.patient_id;
  select * into l from locations where id = coalesce(new.location_id, u.location_id, p.location_id);
  select * into c from clinic;
  new.location_id := l.id;
  new.issuer_id := u.id;
  new.issuer_name := u.full_name;
  new.issuer_title := u.title;
  new.issuer_specialty := u.specialty;
  new.issuer_license := u.license_number;
  new.issuer_institution := u.license_institution;
  new.issuer_specialty_license := u.specialty_license;
  new.clinic_name := c.name;
  new.location_name := l.name;
  new.location_address := trim(both ', ' from concat_ws(', ', nullif(l.street, ''), nullif(l.neighborhood, ''),
                          nullif(trim(l.zip || ' ' || l.city), ''), nullif(l.state, '')));
  new.location_phone := l.phone;
  new.patient_name := p.full_name;
  new.patient_age := age_years(p.birth_date);
  new.patient_sex := p.sex;
  new.footer := c.rx_footer;
  new.status := 'issued';
  new.issued_at := now();
  new.folio_number := next_folio(l.id, new.kind);
  code := case new.kind when 'prescription' then 'RX' else 'IND' end;
  new.folio := l.code || '-' || code || '-' || lpad(new.folio_number::text, 6, '0');
  return new;
end $$;
create trigger documents_issue before insert on documents for each row execute function documents_before_insert();

-- Un documento emitido solo puede cancelarse; su contenido no cambia (REC-05).
create or replace function documents_guard_update() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - array['status','cancel_reason','cancelled_by','cancelled_at','content_hash'])
     is distinct from (to_jsonb(old) - array['status','cancel_reason','cancelled_by','cancelled_at','content_hash']) then
    raise exception 'Un documento emitido no puede modificarse; cancélalo y emite uno nuevo.' using errcode = 'P0001';
  end if;
  if old.status = 'cancelled' then
    raise exception 'El documento ya está cancelado.' using errcode = 'P0001';
  end if;
  if old.content_hash <> '' and new.content_hash is distinct from old.content_hash then
    raise exception 'La huella de contenido no puede cambiar.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger documents_guard before update on documents for each row execute function documents_guard_update();
create trigger document_items_immutable before update on document_items for each row execute function forbid_update();

create or replace function document_items_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare d documents;
begin
  select * into d from documents where id = new.document_id;
  if d.content_hash <> '' then
    raise exception 'No se pueden agregar renglones a un documento ya emitido.' using errcode = 'P0001';
  end if;
  if d.kind = 'prescription' and new.kind <> 'medication' then
    raise exception 'Una receta médica solo admite renglones de medicamento.' using errcode = 'P0001';
  end if;
  if d.kind = 'indications' and new.kind = 'medication' then
    raise exception 'Las indicaciones fisioterapéuticas no pueden incluir medicamentos.' using errcode = '42501';
  end if;
  -- REC-06: los medicamentos controlados requieren recetario especial con código de barras.
  if new.kind = 'medication' and exists (
      select 1 from controlled_substances cs where norm(new.name) like '%' || cs.name || '%') then
    raise exception 'Este medicamento es controlado y requiere recetario especial; no puede emitirse desde el sistema.'
      using errcode = 'P0001', hint = 'controlled';
  end if;
  return new;
end $$;
create trigger document_items_check before insert on document_items for each row execute function document_items_guard();
create trigger documents_retention before delete on documents for each row execute function enforce_retention();

-- ---------- mensualidades ----------
create table membership_plans (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(trim(name)) > 0),
  kind        text not null check (kind in ('monthly','package','single')),
  price_cents int not null check (price_cents >= 0),
  period_days int not null default 30 check (period_days between 1 and 366),
  sessions_count int check (sessions_count is null or sessions_count > 0),
  position    int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (kind <> 'package' or sessions_count is not null)
);
create trigger membership_plans_touch before update on membership_plans for each row execute function touch_updated_at();

create table memberships (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references patients(id) on delete cascade,
  plan_id       uuid not null references membership_plans(id),
  started_on    date not null default mx_today(),
  next_due_date date not null,
  sessions_remaining int,
  status        text not null default 'active' check (status in ('active','paused','ended')),
  paused_on     date,
  ended_on      date,
  created_by    uuid references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- Un paciente tiene una sola membresía vigente a la vez (PAG-02).
create unique index memberships_one_current on memberships (patient_id) where status <> 'ended';
create trigger memberships_touch before update on memberships for each row execute function touch_updated_at();

create table payments (
  id            uuid primary key default gen_random_uuid(),
  receipt_number text not null unique default ('R-' || lpad(nextval('receipt_seq')::text, 6, '0')),
  patient_id    uuid not null references patients(id) on delete cascade,
  membership_id uuid not null references memberships(id),
  plan_name     text not null,            -- copia: cambiar el plan no altera pagos pasados (PAG-11)
  plan_kind     text not null,
  amount_cents  int not null check (amount_cents >= 0),
  method        text not null check (method in ('cash','transfer','card')),
  paid_on       date not null default mx_today(),
  reference     text not null default '',
  note          text not null default '',
  -- Estado de la membresía antes y después: permite revertir al anular (PAG-05).
  prev_due_date date not null,
  new_due_date  date not null,
  prev_sessions int,
  new_sessions  int,
  recorded_by   uuid references users(id),
  recorded_by_name text not null default '',
  created_at    timestamptz not null default now(),
  voided_at     timestamptz,
  voided_by     uuid references users(id),
  void_reason   text
);
create index payments_patient_idx on payments (patient_id, paid_on desc);
create index payments_paid_idx on payments (paid_on);

create or replace function payments_guard_update() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - array['voided_at','voided_by','void_reason'])
     is distinct from (to_jsonb(old) - array['voided_at','voided_by','void_reason']) then
    raise exception 'Un pago registrado no puede modificarse; anúlalo y regístralo de nuevo.' using errcode = 'P0001';
  end if;
  if old.voided_at is not null then
    raise exception 'El pago ya está anulado.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger payments_guard before update on payments for each row execute function payments_guard_update();

-- Estado de pago calculado, nunca capturado a mano (PAG-03):
--   pagado · por_vencer (faltan N días o menos) · vencido · pausado · sin_plan
create or replace function membership_state(p_status text, p_kind text, p_due date, p_sessions int)
returns text language sql stable as $$
  select case
    when p_status is null or p_status = 'ended' then 'sin_plan'
    when p_status = 'paused' then 'pausado'
    when p_kind = 'package' and coalesce(p_sessions, 0) <= 0 then 'vencido'
    when p_due < mx_today() then 'vencido'
    when p_due <= mx_today() + clinic_setting('due_soon_days', '7')::int then 'por_vencer'
    when p_kind = 'package' and p_sessions <= 2 then 'por_vencer'
    else 'pagado'
  end
$$;

-- ---------- lectores de huella y asistencia ----------
create table devices (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  location_id  uuid not null references locations(id),
  model        text not null default '',
  serial       text not null default '',
  firmware     text not null default '',
  host         text not null default '',       -- IP o nombre en la red local de la clínica
  port         int not null default 80,
  use_https    boolean not null default false,
  username     text not null default 'admin',
  password_enc text,                           -- cifrado por la app (AES-256-GCM)
  webhook_token_hash text not null unique,
  webhook_token_enc  text not null,
  bridge_token_hash  text not null unique,
  bridge_token_enc   text not null,
  active       boolean not null default true,
  last_event_at     timestamptz,
  last_webhook_at   timestamptz,
  bridge_seen_at    timestamptz,
  bridge_version    text,
  device_reachable  boolean,
  device_checked_at timestamptz,
  last_sync_at      timestamptz,
  last_error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger devices_touch before update on devices for each row execute function touch_updated_at();

-- Cola de órdenes nube -> agente puente (HUE-06).
create table device_commands (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null references devices(id) on delete cascade,
  kind        text not null check (kind in
    ('ping','sync_time','upsert_person','enroll_fingerprint','delete_person','backfill_events','configure_listener')),
  payload     jsonb not null default '{}'::jsonb,
  status      text not null default 'pending' check (status in ('pending','running','done','error','cancelled')),
  result      jsonb,
  error       text,
  person_type text check (person_type in ('patient','staff')),
  patient_id  uuid references patients(id) on delete cascade,
  user_id     uuid references users(id) on delete cascade,
  created_by  uuid references users(id),
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz
);
create index device_commands_queue_idx on device_commands (device_id, created_at) where status in ('pending','running');

-- Qué personas están dadas de alta en qué lector. Solo el número de persona: la huella
-- jamás sale del lector (HUE-16).
create table enrollments (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null references devices(id) on delete cascade,
  person_type text not null check (person_type in ('patient','staff')),
  patient_id  uuid references patients(id) on delete cascade,
  user_id     uuid references users(id) on delete cascade,
  employee_no text not null,
  status      text not null default 'pending' check (status in ('pending','enrolled','failed','removed')),
  enrolled_at timestamptz,
  removed_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (device_id, employee_no),
  check ((person_type = 'patient') = (patient_id is not null)),
  check ((person_type = 'staff') = (user_id is not null))
);

create table attendance_events (
  id           uuid primary key default gen_random_uuid(),
  device_id    uuid references devices(id) on delete set null,
  location_id  uuid not null references locations(id),
  person_type  text not null check (person_type in ('patient','staff','unknown')),
  patient_id   uuid references patients(id) on delete cascade,
  user_id      uuid references users(id),
  employee_no  text,
  person_name  text not null default '',
  occurred_at  timestamptz not null,
  direction    text not null default 'in' check (direction in ('in','out')),
  source       text not null check (source in ('device','bridge','manual','simulator')),
  verify_mode  text not null default '',
  dedupe_key   text not null unique,
  manual_reason text,
  recorded_by  uuid references users(id),
  appointment_id uuid references appointments(id) on delete set null,
  session_consumed boolean not null default false,
  created_at   timestamptz not null default now()
);
create index attendance_day_idx on attendance_events (mx_date(occurred_at), location_id);
create index attendance_patient_idx on attendance_events (patient_id, occurred_at desc);
create index attendance_user_idx on attendance_events (user_id, occurred_at desc);

-- ---------- bitácora y solicitudes ARCO ----------
create table audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor_id   uuid,
  actor_name text not null default 'Sistema',
  action     text not null,          -- insert | update | delete | view | login | export ...
  table_name text not null default '',
  row_id     text,
  patient_id uuid,
  summary    text not null default '',
  before     jsonb,
  after      jsonb
);
create index audit_log_at_idx on audit_log (at desc);
create index audit_log_patient_idx on audit_log (patient_id, at desc);
create index audit_log_actor_idx on audit_log (actor_id, at desc);

create table arco_requests (
  id          uuid primary key default gen_random_uuid(),
  requester_name text not null,
  contact     text not null,
  kind        text not null check (kind in ('acceso','rectificacion','cancelacion','oposicion')),
  details     text not null default '',
  status      text not null default 'recibida' check (status in ('recibida','en_proceso','resuelta','rechazada')),
  resolution  text not null default '',
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
