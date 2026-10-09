-- 0011 · Lector real: listar personas del lector y vincularlas; avance de órdenes largas.
alter table device_commands drop constraint if exists device_commands_kind_check;
alter table device_commands add constraint device_commands_kind_check check (kind in
  ('ping','sync_time','upsert_person','enroll_fingerprint','delete_person','backfill_events','configure_listener','list_persons'));
