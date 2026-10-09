-- Postgres 17: norm() debe llamar a public.f_unaccent con esquema antes de usarse en columnas generadas
-- e índices (bases donde 0001 se aplicó con la versión anterior de norm).
do $$
declare sch text;
begin
  select n.nspname into sch from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'unaccent';
  execute format(
    'create or replace function public.f_unaccent(text) returns text language sql immutable parallel safe security definer as %L',
    format('select %I.unaccent(%L::regdictionary, $1)', sch, sch || '.unaccent'));
end $$;
create or replace function public.norm(text) returns text
language sql immutable parallel safe as $$ select lower(public.f_unaccent(coalesce($1, ''))) $$;

-- El rol de la app necesita usar el esquema donde viven las extensiones (en Supabase, "extensions").
do $$
declare sch text;
begin
  for sch in select distinct n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace
             where e.extname in ('unaccent','btree_gist','pgcrypto') and n.nspname not in ('public','pg_catalog') loop
    execute format('grant usage on schema %I to nce_app', sch);
  end loop;
end $$;

-- 0002 · Núcleo clínico: pacientes, expediente, estudios y catálogos
create sequence patient_record_seq start 1;

create table patient_tags (
  name text primary key,
  position int not null default 0,
  active boolean not null default true
);

create table study_types (
  name text primary key,
  position int not null default 0,
  active boolean not null default true
);

create table session_types (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique,
  default_duration_min int not null default 50 check (default_duration_min between 5 and 480),
  position int not null default 0,
  active boolean not null default true
);

create table patients (
  id             uuid primary key default gen_random_uuid(),
  record_number  text not null unique default ('NCE-' || lpad(nextval('patient_record_seq')::text, 6, '0')),
  full_name      text not null check (length(trim(full_name)) >= 2),
  sex            text check (sex in ('F','M','X')),
  birth_date     date not null check (birth_date <= current_date + 1),
  curp           text check (curp is null or curp ~ '^[A-Z0-9]{18}$'),
  address        text not null default '',
  phone          text not null default '',
  email          text not null default '',
  emergency_name  text not null default '',
  emergency_phone text not null default '',
  guardian_name   text not null default '',
  guardian_relationship text not null default '',
  guardian_phone  text not null default '',
  location_id    uuid not null references locations(id),
  therapist_id   uuid not null references users(id),
  tags           text[] not null default '{}',
  reason         text not null default '',           -- motivo de consulta
  status         text not null default 'active' check (status in ('active','inactive')),
  deactivated_at timestamptz,
  deactivation_reason text,
  hik_employee_no text not null unique default ('P' || nextval('employee_no_seq')),
  fingerprint_enrolled_at timestamptz,
  created_by     uuid references users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  search         text generated always as (norm(full_name || ' ' || reason || ' ' || record_number)) stored
);
create index patients_therapist_idx on patients (therapist_id) where status = 'active';
create index patients_location_idx on patients (location_id);
create index patients_name_idx on patients (norm(full_name));
create trigger patients_touch before update on patients for each row execute function touch_updated_at();

-- Edad en años cumplidos a la fecha local de la clínica.
create or replace function age_years(birth date) returns int
language sql stable as $$ select extract(year from age(mx_today(), birth))::int $$;

-- Un menor de edad no puede registrarse sin tutor (PAC-03).
create or replace function patients_guardian_check() returns trigger
language plpgsql as $$
begin
  if age_years(new.birth_date) < 18 and length(trim(new.guardian_name)) = 0 then
    raise exception 'Un paciente menor de edad requiere nombre del padre, madre o tutor.'
      using errcode = 'P0001', hint = 'guardian_name';
  end if;
  return new;
end $$;
create trigger patients_guardian before insert or update of birth_date, guardian_name on patients
  for each row execute function patients_guardian_check();

-- Historial de asignación de fisioterapeuta (PAC-04).
create table patient_assignments (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references patients(id) on delete cascade,
  therapist_id uuid not null references users(id),
  from_at      timestamptz not null default now(),
  to_at        timestamptz,
  changed_by   uuid references users(id)
);
create index patient_assignments_patient_idx on patient_assignments (patient_id, from_at desc);

create or replace function patients_track_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into patient_assignments (patient_id, therapist_id, changed_by)
    values (new.id, new.therapist_id, app_uid());
  elsif new.therapist_id is distinct from old.therapist_id then
    update patient_assignments set to_at = now() where patient_id = new.id and to_at is null;
    insert into patient_assignments (patient_id, therapist_id, changed_by)
    values (new.id, new.therapist_id, app_uid());
  end if;
  return new;
end $$;
create trigger patients_assignment after insert or update of therapist_id on patients
  for each row execute function patients_track_assignment();

-- ¿El usuario actual puede ver a este paciente? Base de casi todas las políticas.
create or replace function can_access_patient(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app_role() = 'owner'
      or exists (select 1 from patients p where p.id = pid and p.therapist_id = app_uid())
$$;

-- Perfil clínico versionado: cada guardado es una versión nueva (EXP-02).
create table clinical_profiles (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references patients(id) on delete cascade,
  version     int not null,
  background  text not null default '',   -- antecedentes
  condition   text not null default '',   -- padecimiento actual
  examination text not null default '',   -- exploración física
  diagnosis   text not null default '',
  treatment_plan text not null default '',
  created_by  uuid references users(id),
  created_by_name text not null default '',
  created_at  timestamptz not null default now(),
  unique (patient_id, version)
);

create or replace function clinical_profiles_version() returns trigger
language plpgsql as $$
begin
  select coalesce(max(version), 0) + 1 into new.version from clinical_profiles where patient_id = new.patient_id;
  return new;
end $$;
create trigger clinical_profiles_set_version before insert on clinical_profiles
  for each row execute function clinical_profiles_version();

create table exercises (
  id         uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  dosage     text not null default '',
  position   int not null default 0,
  active     boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index exercises_patient_idx on exercises (patient_id, position) where active;
create trigger exercises_touch before update on exercises for each row execute function touch_updated_at();

-- Notas de evolución: inmutables, firmadas; las correcciones son adendas (EXP-04).
create table evolution_notes (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references patients(id) on delete cascade,
  appointment_id uuid,
  addendum_of   uuid references evolution_notes(id),
  body          text not null check (length(trim(body)) > 0),
  pain_level    int check (pain_level between 0 and 10),
  range_of_motion text not null default '',
  noted_at      timestamptz not null default now(),
  author_id     uuid not null references users(id),
  author_name   text not null,
  author_license text,
  signature_hash text not null,
  created_at    timestamptz not null default now()
);
create index evolution_notes_patient_idx on evolution_notes (patient_id, noted_at desc);

-- La firma electrónica se calcula en la base: autor, instante y contenido.
create or replace function evolution_notes_sign() returns trigger
language plpgsql security definer set search_path = public as $$
declare u users;
begin
  select * into u from users where id = app_uid();
  if u.id is null then
    raise exception 'Solo un usuario autenticado puede firmar una nota.' using errcode = '42501';
  end if;
  new.author_id := u.id;
  new.author_name := user_display(u);
  new.author_license := u.license_number;
  new.created_at := now();
  if new.noted_at is null then new.noted_at := now(); end if;
  new.signature_hash := encode(sha256(convert_to(
    new.patient_id::text || '|' || u.id::text || '|' || new.noted_at::text || '|' || new.body || '|' ||
    coalesce(new.pain_level::text, '') || '|' || new.range_of_motion, 'UTF8')), 'hex');
  return new;
end $$;
create trigger evolution_notes_sign_trg before insert on evolution_notes
  for each row execute function evolution_notes_sign();

create or replace function forbid_update() returns trigger
language plpgsql as $$
begin
  raise exception 'Este registro es inmutable: no se puede modificar (%).', tg_table_name using errcode = 'P0001';
end $$;
create trigger evolution_notes_immutable before update on evolution_notes
  for each row execute function forbid_update();

-- Consentimientos y aviso de privacidad firmados (PAC-08, EXP-10).
create table consents (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references patients(id) on delete cascade,
  kind        text not null check (kind in ('privacy','informed','biometric')),
  body_snapshot text not null,
  signer_name text not null check (length(trim(signer_name)) > 1),
  signer_relationship text not null default 'Paciente',
  signature_png text not null,            -- data URL de la firma trazada en pantalla
  signed_at   timestamptz not null default now(),
  recorded_by uuid references users(id),
  recorded_by_name text not null default ''
);
create index consents_patient_idx on consents (patient_id, kind, signed_at desc);
create trigger consents_immutable before update on consents for each row execute function forbid_update();

-- Estudios: metadatos del archivo guardado en el almacenamiento privado (EST).
create table studies (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references patients(id) on delete cascade,
  type_name   text not null,
  title       text not null,
  file_name   text not null,
  storage_path text not null unique,
  thumb_path  text,
  mime        text not null,
  size_bytes  bigint not null check (size_bytes >= 0),
  study_date  date not null default mx_today(),
  status      text not null default 'pending' check (status in ('pending','ready')),
  uploaded_by uuid references users(id),
  uploaded_by_name text not null default '',
  created_at  timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references users(id),
  archive_reason text
);
create index studies_patient_idx on studies (patient_id, study_date desc);

-- Fecha del último acto registrado del paciente: base de la regla de conservación.
create or replace function patient_last_act(pid uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select greatest(
    (select created_at from patients where id = pid),
    (select max(noted_at) from evolution_notes where patient_id = pid),
    (select max(created_at) from clinical_profiles where patient_id = pid),
    (select max(created_at) from studies where patient_id = pid),
    (select max(signed_at) from consents where patient_id = pid)
  )
$$;

-- NOM-004: el expediente se conserva mínimo 5 años desde el último acto (EXP-09).
-- Aplica a cualquier rol, incluido el dueño y el propietario de las tablas.
create or replace function enforce_retention() returns trigger
language plpgsql as $$
declare pid uuid; last_act timestamptz;
begin
  if tg_table_name = 'patients' then pid := old.id; else pid := old.patient_id; end if;
  last_act := patient_last_act(pid);
  if last_act is not null and last_act > now() - interval '5 years' then
    raise exception 'El expediente clínico debe conservarse al menos 5 años desde el último acto (NOM-004-SSA3-2012). No se puede eliminar.'
      using errcode = 'P0001';
  end if;
  return old;
end $$;
create trigger patients_retention before delete on patients for each row execute function enforce_retention();
create trigger clinical_profiles_retention before delete on clinical_profiles for each row execute function enforce_retention();
create trigger evolution_notes_retention before delete on evolution_notes for each row execute function enforce_retention();
create trigger consents_retention before delete on consents for each row execute function enforce_retention();
create trigger studies_retention before delete on studies for each row execute function enforce_retention();
