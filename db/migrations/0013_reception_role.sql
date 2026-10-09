-- 0013 · AUTH-10 · Rol "Recepción" (reception)
-- Recepción opera lo administrativo de TODOS los pacientes de TODAS las sedes (alta, datos de contacto, agenda,
-- mensualidades, asistencia) y nunca lee información clínica (NOM-004-SSA3-2012: el expediente clínico solo lo
-- consulta el personal de salud). Por eso:
--   · can_access_patient() NO cambia: sigue protegiendo perfil clínico, notas, estudios, ejercicios y documentos.
--   · Las políticas de recepción son NUEVAS y se suman (permisivas) a las existentes; ninguna política previa se toca.
--   · Nombres completos (public.…): Postgres 17 y pg_restore evalúan con un search_path restringido.

-- ---------- rol ----------
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check check (role in ('owner','therapist','reception'));

create or replace function public.is_reception() returns boolean
language sql stable as $$ select public.app_role() = 'reception' $$;

-- Mostrador: dueño o recepción.
create or replace function public.is_front_desk() returns boolean
language sql stable as $$ select public.app_role() in ('owner', 'reception') $$;

grant execute on function public.is_reception() to nce_app;
grant execute on function public.is_front_desk() to nce_app;

-- ---------- pacientes: ficha general de todos, sin lo clínico ----------
create policy patients_reception_read on public.patients for select to nce_app using (public.is_reception());
create policy patients_reception_ins on public.patients for insert to nce_app with check (public.is_reception());
create policy patients_reception_upd on public.patients for update to nce_app
  using (public.is_reception()) with check (public.is_reception());

-- La política decide QUÉ filas; este trigger decide QUÉ columnas. Recepción no reasigna fisioterapeuta, no da
-- de baja ni reactiva, y no captura motivo de consulta ni etiquetas (clasificación clínica del paciente).
-- Aplica también a las transacciones de sistema abiertas a nombre de un usuario de recepción.
create or replace function public.patients_reception_guard() returns trigger
language plpgsql as $$
begin
  if not coalesce(public.is_reception(), false) then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'active' or new.deactivated_at is not null then
      raise exception 'Recepción solo puede dar de alta pacientes activos.' using errcode = '42501';
    end if;
    if new.reason <> '' or cardinality(new.tags) > 0 then
      raise exception 'El motivo de consulta y las etiquetas los captura el fisioterapeuta.' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.therapist_id is distinct from old.therapist_id then
    raise exception 'Solo el dueño puede reasignar al fisioterapeuta de un paciente.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status or new.deactivated_at is distinct from old.deactivated_at
     or new.deactivation_reason is distinct from old.deactivation_reason then
    raise exception 'Solo el dueño puede dar de baja o reactivar a un paciente.' using errcode = '42501';
  end if;
  if new.reason is distinct from old.reason or new.tags is distinct from old.tags then
    raise exception 'Recepción no puede modificar la información clínica del paciente.' using errcode = '42501';
  end if;
  if new.record_number is distinct from old.record_number or new.hik_employee_no is distinct from old.hik_employee_no
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'Ese dato del expediente no se puede modificar.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger patients_reception_guard before insert or update on public.patients
  for each row execute function public.patients_reception_guard();

-- Firmas del alta: aviso de privacidad, consentimiento informado y consentimiento de huella.
create policy consents_reception_read on public.consents for select to nce_app using (public.is_reception());
create policy consents_reception_ins on public.consents for insert to nce_app with check (public.is_reception());

-- ---------- agenda: citas de todos los fisioterapeutas; horarios y bloqueos solo lectura ----------
create policy appointments_reception_read on public.appointments for select to nce_app using (public.is_reception());
create policy appointments_reception_ins on public.appointments for insert to nce_app with check (public.is_reception());
create policy appointments_reception_upd on public.appointments for update to nce_app
  using (public.is_reception()) with check (public.is_reception());
-- therapist_hours ya es de lectura general; los bloqueos no lo eran.
create policy time_blocks_reception_read on public.time_blocks for select to nce_app using (public.is_reception());

-- ---------- mensualidades: plan, pagos y links; anular y facturar siguen siendo del dueño ----------
create policy memberships_reception_read on public.memberships for select to nce_app using (public.is_reception());
create policy memberships_reception_ins on public.memberships for insert to nce_app with check (public.is_reception());
create policy memberships_reception_upd on public.memberships for update to nce_app
  using (public.is_reception()) with check (public.is_reception());

-- Pagos: lee y registra. Sin política de UPDATE: no puede anular (ni registrar un pago ya anulado).
create policy payments_reception_read on public.payments for select to nce_app using (public.is_reception());
create policy payments_reception_ins on public.payments for insert to nce_app
  with check (public.is_reception() and voided_at is null and voided_by is null and void_reason is null);

create policy payment_links_reception_read on public.payment_links for select to nce_app using (public.is_reception());
create policy payment_links_reception_ins on public.payment_links for insert to nce_app
  with check (public.is_reception() and refund_id is null);
-- Actualiza el link (URL de Stripe, cancelar, sincronizar) pero no lo marca como reembolsado.
create policy payment_links_reception_upd on public.payment_links for update to nce_app
  using (public.is_reception()) with check (public.is_reception() and refund_id is null and status <> 'refunded');

-- ---------- huella: asistencias de todas las sedes y estado de huella de los pacientes ----------
create policy attendance_reception_read on public.attendance_events for select to nce_app using (public.is_reception());
create policy enrollments_reception_read on public.enrollments for select to nce_app
  using (public.is_reception() and patient_id is not null);
-- device_commands y devices siguen sin acceso para nce_app: la app los toca como sistema tras validar el permiso.

-- La vista patient_billing es security_invoker: con las políticas de patients y memberships, recepción ya la lee.
-- Catálogos (sedes, planes, tipos de sesión) y users ya son de lectura general.
-- Sin políticas de recepción (inaccesibles): clinical_profiles, evolution_notes, exercises, studies, documents,
-- document_items, patient_assignments, patient_tax_profiles, invoices, invoice_payments, audit_log, arco_requests.
