-- 0001 · Base: extensiones, rol de aplicación, clínica, sedes, usuarios y autenticación
create extension if not exists btree_gist;
create extension if not exists unaccent;

-- Rol sin login con el que corre TODA consulta hecha a nombre de un usuario.
-- Las políticas RLS se escriben para este rol; el dueño de las tablas (el rol de
-- conexión) solo se usa para autenticación, webhooks y tareas del sistema.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'nce_app') then
    create role nce_app nologin;
  end if;
  if current_setting('server_version_num')::int >= 160000 then
    execute format('grant nce_app to %I with set true, inherit false', current_user);
  else
    execute format('grant nce_app to %I', current_user);
  end if;
end $$;

-- Supabase expone el esquema public por PostgREST a anon/authenticated.
-- Esta app no usa PostgREST: se cierran esos accesos si los roles existen.
do $$
declare r text;
begin
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
      execute format('alter default privileges in schema public revoke all on functions from %I', r);
    end if;
  end loop;
end $$;

-- ---------- utilidades ----------
-- unaccent puede vivir en otro esquema (en Supabase, "extensions"): se liga por nombre completo.
do $$
declare sch text;
begin
  select n.nspname into sch from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'unaccent';
  execute format(
    'create or replace function public.f_unaccent(text) returns text language sql immutable parallel safe as %L',
    format('select %I.unaccent(%L::regdictionary, $1)', sch, sch || '.unaccent'));
end $$;

-- Texto normalizado para búsquedas: sin acentos y en minúsculas.
create or replace function norm(text) returns text
language sql immutable parallel safe as $$ select lower(f_unaccent(coalesce($1, ''))) $$;

-- Fecha local de la clínica (America/Mexico_City) de un instante.
create or replace function mx_date(timestamptz) returns date
language sql immutable parallel safe as $$ select ($1 at time zone 'America/Mexico_City')::date $$;

create or replace function mx_today() returns date
language sql stable as $$ select (now() at time zone 'America/Mexico_City')::date $$;

-- Identidad de la petición: la fija la app al abrir cada transacción.
create or replace function app_uid() returns uuid
language sql stable as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create or replace function app_role() returns text
language sql stable as $$ select nullif(current_setting('app.user_role', true), '') $$;

create or replace function is_owner() returns boolean
language sql stable as $$ select app_role() = 'owner' $$;

create or replace function touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

-- ---------- clínica y sedes ----------
create table clinic (
  id            boolean primary key default true check (id),  -- una sola fila
  name          text not null,
  legal_name    text,
  tagline       text,
  phone         text,
  email         text,
  logo_path     text,
  settings      jsonb not null default '{}'::jsonb,
  privacy_notice        text not null default '',
  privacy_notice_short  text not null default '',
  consent_template      text not null default '',
  biometric_consent     text not null default '',
  rx_footer             text not null default '',
  updated_at    timestamptz not null default now()
);

-- Parámetros con su valor por defecto (CFG-06).
create or replace function clinic_setting(key text, fallback text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select settings ->> key from clinic), fallback)
$$;

create table locations (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z]{2,5}$'),
  name        text not null unique,
  street      text not null default '',
  neighborhood text not null default '',
  city        text not null default '',
  state       text not null default 'Veracruz',
  zip         text not null default '',
  phone       text not null default '',
  hours       text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- usuarios ----------
create sequence employee_no_seq start 1001;

create table users (
  id            uuid primary key default gen_random_uuid(),
  username      text not null,
  email         text not null,
  password_hash text,
  role          text not null check (role in ('owner','therapist')),
  full_name     text not null,
  title         text not null default '',          -- Dra., L.F.T., etc.
  specialty     text not null default '',
  location_id   uuid references locations(id),
  phone         text not null default '',
  license_number      text,                        -- cédula profesional
  license_institution text,                        -- institución que expidió el título
  specialty_license   text,                        -- cédula de especialidad (opcional)
  is_physician  boolean not null default false,    -- lo marca el dueño: habilita receta médica
  active        boolean not null default true,
  must_change_password boolean not null default false,
  failed_attempts int not null default 0,
  locked_until  timestamptz,
  last_login_at timestamptz,
  hik_employee_no text not null unique default ('S' || nextval('employee_no_seq')),
  fingerprint_enrolled_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deactivated_at timestamptz
);
create unique index users_username_key on users (lower(username));
create unique index users_email_key on users (lower(email));

-- Nombre para mostrar: "L.F.T. Karla Ocampo".
create or replace function user_display(u users) returns text
language sql immutable as $$ select trim(u.title || ' ' || u.full_name) $$;

create table sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  user_agent   text,
  ip           text,
  method       text not null default 'password'
);
create index sessions_user_idx on sessions (user_id);

create table auth_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  kind       text not null check (kind in ('invite','reset')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create table passkeys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  credential_id text not null unique,
  public_key    bytea not null,
  counter       bigint not null default 0,
  transports    text[] not null default '{}',
  name          text not null default 'Dispositivo',
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create table webauthn_challenges (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references users(id) on delete cascade,
  challenge  text not null,
  kind       text not null check (kind in ('register','login')),
  expires_at timestamptz not null default now() + interval '5 minutes'
);

create table email_outbox (
  id         uuid primary key default gen_random_uuid(),
  to_email   text not null,
  subject    text not null,
  body_text  text not null,
  status     text not null default 'pending' check (status in ('pending','sent','logged','error')),
  error      text,
  created_at timestamptz not null default now()
);

create trigger clinic_touch before update on clinic for each row execute function touch_updated_at();
create trigger locations_touch before update on locations for each row execute function touch_updated_at();
create trigger users_touch before update on users for each row execute function touch_updated_at();
