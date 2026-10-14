-- 0014 · Registro de tareas programadas internas (servidor siempre encendido: Railway, VPS).
-- Evita que la tarea diaria corra dos veces el mismo día aunque haya reinicios o más de una instancia.
create table if not exists public.job_runs (
  name      text primary key,
  last_day  date not null,
  last_at   timestamptz not null default now(),
  result    jsonb
);
alter table public.job_runs enable row level security;
revoke all on public.job_runs from public;
-- Solo el sistema la usa (sin políticas para nce_app).
