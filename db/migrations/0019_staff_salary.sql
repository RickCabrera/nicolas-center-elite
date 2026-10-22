-- 0019 · Sueldo del equipo (EQ-08): el dueño registra el sueldo de cada fisioterapeuta y de recepción.
-- Solo es un registro de referencia para el dueño; no genera pagos ni nómina.
--   salary_cents  · monto en centavos MXN (como el resto del dinero del sistema); null = sin capturar
--   salary_period · periodicidad del monto: semanal, quincenal o mensual
-- Privacidad: NO se agrega al `grant select (...) on users to nce_app` de 0005, así que fisioterapeutas y
-- recepción no pueden leerlo con su sesión. Solo las rutas del dueño lo leen y escriben (transacción de sistema).
-- La auditoría por trigger de `users` ya registra cada cambio.
alter table public.users
  add column if not exists salary_cents int check (salary_cents is null or salary_cents >= 0),
  add column if not exists salary_period text not null default 'monthly'
    check (salary_period in ('weekly', 'biweekly', 'monthly'));
