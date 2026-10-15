-- 0015 · Registro de rostro desde la app (HUE-17) y agente puente con varios lectores.
alter table device_commands drop constraint if exists device_commands_kind_check;
alter table device_commands add constraint device_commands_kind_check check (kind in
  ('ping','sync_time','upsert_person','enroll_fingerprint','enroll_face','delete_person','backfill_events','configure_listener','list_persons'));

-- Cuándo quedó registrado el rostro de la persona en ese lector (la foto vive solo en el lector).
alter table enrollments add column if not exists face_enrolled_at timestamptz;
