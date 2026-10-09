-- 0005 · Bitácora de auditoría por triggers y seguridad por fila (RLS)

-- ---------- auditoría (DB-10) ----------
create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  secret text[] := array['password_hash','password_enc','webhook_token_hash','webhook_token_enc',
                         'bridge_token_hash','bridge_token_enc','signature_png','search','body_snapshot'];
  j_old jsonb; j_new jsonb; pid uuid; rid text; actor uuid := app_uid(); aname text;
begin
  if tg_op <> 'INSERT' then j_old := to_jsonb(old) - secret; end if;
  if tg_op <> 'DELETE' then j_new := to_jsonb(new) - secret; end if;
  if tg_op = 'UPDATE' and j_old = j_new then return new; end if;
  rid := coalesce(j_new ->> 'id', j_old ->> 'id');
  if tg_table_name = 'patients' then pid := rid::uuid;
  else pid := nullif(coalesce(j_new ->> 'patient_id', j_old ->> 'patient_id'), '')::uuid;
  end if;
  select user_display(u) into aname from users u where u.id = actor;
  insert into audit_log (actor_id, actor_name, action, table_name, row_id, patient_id, before, after)
  values (actor, coalesce(aname, 'Sistema'), lower(tg_op), tg_table_name, rid, pid, j_old, j_new);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['clinic','locations','users','patients','clinical_profiles','exercises','evolution_notes',
    'consents','studies','appointments','documents','membership_plans','memberships','payments','devices',
    'therapist_hours','time_blocks','session_types','study_types','patient_tags','arco_requests'] loop
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row()',
                   t || '_audit', t);
  end loop;
end $$;
-- Asistencias: solo se auditan las capturadas a mano.
create trigger attendance_events_audit after insert on attendance_events
  for each row when (new.source = 'manual') execute function audit_row();

create trigger audit_log_immutable before update or delete on audit_log
  for each row execute function forbid_update();

-- Registro explícito desde la app (accesos al expediente, inicios de sesión, exportaciones).
create or replace function log_event(p_action text, p_summary text, p_patient uuid default null,
                                     p_table text default '', p_row text default null)
returns void language plpgsql security definer set search_path = public as $$
declare aname text;
begin
  select user_display(u) into aname from users u where u.id = app_uid();
  insert into audit_log (actor_id, actor_name, action, table_name, row_id, patient_id, summary)
  values (app_uid(), coalesce(aname, 'Sistema'), p_action, p_table, p_row, p_patient, p_summary);
end $$;

-- ---------- RLS: ninguna tabla queda sin política (AUTH-05) ----------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t.tablename);
    execute format('revoke all on %I from public', t.tablename);
  end loop;
end $$;

grant usage on schema public to nce_app;
grant usage on all sequences in schema public to nce_app;

-- Tablas internas (sessions, auth_tokens, passkeys, webauthn_challenges, email_outbox,
-- folio_counters, device_commands): sin permisos ni políticas para nce_app. Solo el sistema.

-- clínica, sedes, catálogos: todos leen; solo el dueño escribe.
grant select, update on clinic to nce_app;
create policy clinic_read on clinic for select to nce_app using (true);
create policy clinic_write on clinic for update to nce_app using (is_owner()) with check (is_owner());

do $$
declare t text;
begin
  foreach t in array array['locations','session_types','study_types','patient_tags','membership_plans','controlled_substances'] loop
    execute format('grant select, insert, update, delete on %I to nce_app', t);
    execute format('create policy %I on %I for select to nce_app using (true)', t || '_read', t);
    execute format('create policy %I on %I for insert to nce_app with check (is_owner())', t || '_ins', t);
    execute format('create policy %I on %I for update to nce_app using (is_owner()) with check (is_owner())', t || '_upd', t);
    execute format('create policy %I on %I for delete to nce_app using (is_owner())', t || '_del', t);
  end loop;
end $$;

-- usuarios: columnas no sensibles visibles a todos (se necesitan nombres en toda la app);
-- los secretos jamás; la escritura se hace solo por rutas del sistema con validación propia.
grant select (id, username, email, role, full_name, title, specialty, location_id, phone, license_number,
              license_institution, specialty_license, is_physician, active, must_change_password, last_login_at,
              hik_employee_no, fingerprint_enrolled_at, created_at, updated_at, deactivated_at) on users to nce_app;
create policy users_read on users for select to nce_app using (true);

-- pacientes
grant select, insert, update on patients to nce_app;
create policy patients_read on patients for select to nce_app
  using (is_owner() or therapist_id = app_uid());
create policy patients_ins on patients for insert to nce_app
  with check (is_owner() or therapist_id = app_uid());
create policy patients_upd on patients for update to nce_app
  using (is_owner() or therapist_id = app_uid())
  with check (is_owner() or therapist_id = app_uid());   -- un fisioterapeuta no puede reasignar a otro

grant select on patient_assignments to nce_app;
create policy patient_assignments_read on patient_assignments for select to nce_app using (can_access_patient(patient_id));

-- tablas que cuelgan del paciente
do $$
declare t text;
begin
  foreach t in array array['clinical_profiles','evolution_notes','consents'] loop
    execute format('grant select, insert on %I to nce_app', t);
    execute format('create policy %I on %I for select to nce_app using (can_access_patient(patient_id))', t || '_read', t);
    execute format('create policy %I on %I for insert to nce_app with check (can_access_patient(patient_id))', t || '_ins', t);
  end loop;
  foreach t in array array['exercises','studies'] loop
    execute format('grant select, insert, update on %I to nce_app', t);
    execute format('create policy %I on %I for select to nce_app using (can_access_patient(patient_id))', t || '_read', t);
    execute format('create policy %I on %I for insert to nce_app with check (can_access_patient(patient_id))', t || '_ins', t);
    execute format('create policy %I on %I for update to nce_app using (can_access_patient(patient_id)) with check (can_access_patient(patient_id))', t || '_upd', t);
  end loop;
end $$;

-- agenda: el fisioterapeuta solo ve y agenda sus propias citas con sus propios pacientes
grant select, insert, update on appointments to nce_app;
create policy appointments_read on appointments for select to nce_app
  using (is_owner() or therapist_id = app_uid());
create policy appointments_ins on appointments for insert to nce_app
  with check (is_owner() or (therapist_id = app_uid() and can_access_patient(patient_id)));
create policy appointments_upd on appointments for update to nce_app
  using (is_owner() or therapist_id = app_uid())
  with check (is_owner() or (therapist_id = app_uid() and can_access_patient(patient_id)));

grant select, insert, update, delete on therapist_hours, time_blocks to nce_app;
create policy therapist_hours_read on therapist_hours for select to nce_app using (true);
create policy therapist_hours_write on therapist_hours for all to nce_app
  using (is_owner() or user_id = app_uid()) with check (is_owner() or user_id = app_uid());
create policy time_blocks_read on time_blocks for select to nce_app using (is_owner() or user_id = app_uid());
create policy time_blocks_write on time_blocks for all to nce_app
  using (is_owner() or user_id = app_uid()) with check (is_owner() or user_id = app_uid());

-- recetas e indicaciones: las ve el dueño, quien las emitió y el fisioterapeuta del paciente
grant select, insert, update on documents to nce_app;
grant select, insert on document_items to nce_app;
create policy documents_read on documents for select to nce_app
  using (is_owner() or issuer_id = app_uid() or can_access_patient(patient_id));
create policy documents_ins on documents for insert to nce_app
  with check (can_access_patient(patient_id));
create policy documents_upd on documents for update to nce_app
  using (is_owner() or issuer_id = app_uid()) with check (is_owner() or issuer_id = app_uid());
create policy document_items_read on document_items for select to nce_app
  using (exists (select 1 from documents d where d.id = document_id));
create policy document_items_ins on document_items for insert to nce_app
  with check (exists (select 1 from documents d where d.id = document_id and d.issuer_id = app_uid()));

-- mensualidades: el fisioterapeuta solo ve el estado de sus pacientes; los pagos son del dueño
grant select, insert, update on memberships to nce_app;
create policy memberships_read on memberships for select to nce_app using (can_access_patient(patient_id));
create policy memberships_ins on memberships for insert to nce_app with check (can_access_patient(patient_id));
create policy memberships_upd on memberships for update to nce_app using (is_owner()) with check (is_owner());
grant select, insert, update on payments to nce_app;
create policy payments_all on payments for all to nce_app using (is_owner()) with check (is_owner());
grant select on patient_billing to nce_app;

-- lectores y asistencia
grant select, insert, update on devices to nce_app;
create policy devices_owner on devices for all to nce_app using (is_owner()) with check (is_owner());
grant select, insert, update on enrollments to nce_app;
create policy enrollments_read on enrollments for select to nce_app
  using (is_owner() or (patient_id is not null and can_access_patient(patient_id)) or user_id = app_uid());
create policy enrollments_write on enrollments for all to nce_app using (is_owner()) with check (is_owner());
grant select on attendance_events to nce_app;
create policy attendance_read on attendance_events for select to nce_app
  using (is_owner()
         or location_id = (select u.location_id from users u where u.id = app_uid())
         or (patient_id is not null and can_access_patient(patient_id)));

-- bitácora y ARCO: solo el dueño
grant select on audit_log to nce_app;
create policy audit_log_owner on audit_log for select to nce_app using (is_owner());
grant select, update on arco_requests to nce_app;
create policy arco_owner on arco_requests for all to nce_app using (is_owner()) with check (is_owner());

grant execute on all functions in schema public to nce_app;
revoke execute on function register_attendance(uuid, text, timestamptz, text, text, text, uuid, uuid, uuid, text, uuid) from public, nce_app;
revoke execute on function daily_housekeeping() from public, nce_app;
revoke execute on function next_folio(uuid, text) from public, nce_app;
