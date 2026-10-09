// AUTH-10 · Rol "Recepción" a nivel base: las políticas RLS y el trigger de pacientes, sin pasar por la API.
import { beforeAll, describe, expect, it } from 'vitest';
import { fixtures, sqlAs, sqlSystem, type Fixtures } from '../helpers';

let fx: Fixtures;
const count = (as: Fixtures['owner'], table: string) =>
  sqlAs(as, async (tx) => (await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from ${table}`))[0].n);

beforeAll(async () => {
  fx = await fixtures();
  // Expediente clínico de Ana, escrito por su fisioterapeuta.
  await sqlAs(fx.therapistA, async (tx) => {
    await tx`insert into clinical_profiles (patient_id, diagnosis, created_by, created_by_name) values (${fx.patientA1}, 'Lumbalgia', ${fx.therapistA.id}, 'Karla')`;
    await tx`insert into exercises (patient_id, name, created_by) values (${fx.patientA1}, 'Bird dog', ${fx.therapistA.id})`;
    await tx`insert into evolution_notes (patient_id, body, author_id, author_name, signature_hash) values (${fx.patientA1}, 'Nota', ${fx.therapistA.id}, '', '')`;
    const [d] = await tx<{ id: string }[]>`insert into documents (kind, patient_id) values ('indications', ${fx.patientA1}) returning id`;
    await tx`insert into document_items (document_id, kind, name) values (${d.id}, 'exercise', 'Puente')`;
  });
  await sqlSystem(async (tx) => {
    await tx`insert into studies (patient_id, type_name, title, file_name, storage_path, mime, size_bytes, status)
             values (${fx.patientA1}, 'Resonancia', 'RM', 'rm.pdf', 'patients/a/b/rm.pdf', 'application/pdf', 10, 'ready')`;
    await tx`insert into time_blocks (user_id, starts_at, ends_at) values (${fx.therapistB.id}, now() + interval '5 days', now() + interval '6 days')`;
    await tx`insert into arco_requests (requester_name, contact, kind) values ('Alguien', 'a@b.mx', 'acceso')`;
    await tx`insert into patient_tax_profiles (patient_id, legal_name, tax_id, tax_system, zip) values (${fx.patientA1}, 'ANA PRUEBA', 'XAXX010101000', '616', '94500')`;
  });
});

describe('AUTH-10 · rol y funciones auxiliares', () => {
  it('users.role admite reception y sigue rechazando roles desconocidos', async () => {
    const [u] = await sqlSystem((tx) => tx`select role from users where id = ${fx.reception.id}`);
    expect(u.role).toBe('reception');
    await expect(sqlSystem((tx) => tx`insert into users (username, email, role, full_name) values ('x9', 'x9@a.mx', 'admin', 'X')`)).rejects.toThrow(/users_role_check/);
  });

  it('is_reception() e is_front_desk() por rol; can_access_patient() no cambia para recepción', async () => {
    const flags = (as: Fixtures['owner']) => sqlAs(as, async (tx) =>
      (await tx<{ r: boolean; f: boolean; o: boolean; c: boolean }[]>`
        select public.is_reception() as r, public.is_front_desk() as f, public.is_owner() as o, public.can_access_patient(${fx.patientA1}) as c`)[0]);
    expect(await flags(fx.reception)).toEqual({ r: true, f: true, o: false, c: false });
    expect(await flags(fx.owner)).toEqual({ r: false, f: true, o: true, c: true });
    expect(await flags(fx.therapistA)).toEqual({ r: false, f: false, o: false, c: true });
    expect(await flags(fx.therapistB)).toEqual({ r: false, f: false, o: false, c: false });
  });
});

describe('AUTH-10 · RLS: lo clínico y lo del dueño no existe para recepción', () => {
  it.each([
    'clinical_profiles', 'evolution_notes', 'exercises', 'studies', 'documents', 'document_items', 'patient_assignments',
    'audit_log', 'arco_requests', 'patient_tax_profiles', 'invoices', 'invoice_payments', 'devices',
  ])('%s: sin filas', async (table) => {
    expect(await count(fx.reception, table)).toBe(0);
  });

  it('las mismas tablas sí tienen filas para el dueño (la prueba no pasa en vacío)', async () => {
    for (const t of ['clinical_profiles', 'evolution_notes', 'exercises', 'studies', 'documents', 'document_items', 'patient_assignments', 'arco_requests', 'patient_tax_profiles']) {
      expect(await count(fx.owner, t)).toBeGreaterThan(0);
    }
  });

  it('tampoco puede escribir en ellas', async () => {
    const r = fx.reception;
    const denied = /row-level security|permission denied/;
    await expect(sqlAs(r, (tx) => tx`insert into clinical_profiles (patient_id, diagnosis) values (${fx.patientA1}, 'x')`)).rejects.toThrow(denied);
    await expect(sqlAs(r, (tx) => tx`insert into evolution_notes (patient_id, body, author_id, author_name, signature_hash) values (${fx.patientA1}, 'x', ${r.id}, '', '')`)).rejects.toThrow(denied);
    await expect(sqlAs(r, (tx) => tx`insert into exercises (patient_id, name) values (${fx.patientA1}, 'x')`)).rejects.toThrow(denied);
    await expect(sqlAs(r, (tx) => tx`insert into studies (patient_id, type_name, title, file_name, storage_path, mime, size_bytes) values (${fx.patientA1}, 'Otro', 't', 'f', 'p/q', 'application/pdf', 1)`)).rejects.toThrow(denied);
    await expect(sqlAs(r, (tx) => tx`insert into documents (kind, patient_id) values ('indications', ${fx.patientA1})`)).rejects.toThrow(/row-level security|permission denied|cédula/);
    await expect(sqlAs(r, (tx) => tx`insert into time_blocks (user_id, starts_at, ends_at) values (${fx.therapistB.id}, now(), now() + interval '1 hour')`)).rejects.toThrow(denied);
    await expect(sqlAs(r, (tx) => tx`insert into therapist_hours (user_id, weekday, start_time, end_time) values (${fx.therapistB.id}, 1, '08:00', '12:00')`)).rejects.toThrow(denied);
    await expect(sqlAs(r, (tx) => tx`update clinic set name = 'Otra'`)).resolves.toHaveLength(0);
    const [c] = await sqlSystem((tx) => tx`select name from clinic`);
    expect(c.name).toBe('Nicolas Center Elite');
  });
});

describe('AUTH-10 · RLS: lo administrativo de todos los pacientes', () => {
  it('lee a todos los pacientes, su cobranza, citas, bloqueos y asistencias', async () => {
    expect(await count(fx.reception, 'patients')).toBe(3);
    expect(await count(fx.reception, 'patient_billing')).toBe(3);
    expect(await count(fx.reception, 'memberships')).toBe(3);
    expect(await count(fx.reception, 'time_blocks')).toBe(1);
    expect(await count(fx.therapistA, 'time_blocks')).toBe(0);
  });

  it('pacientes: inserta y edita datos generales; el trigger impide reasignar, dar de baja y tocar lo clínico', async () => {
    const r = fx.reception;
    const [p] = await sqlAs(r, (tx) => tx<{ id: string }[]>`
      insert into patients (full_name, sex, birth_date, location_id, therapist_id, created_by)
      values ('Nueva Desde Mostrador', 'F', '1991-01-01', ${fx.orizaba}, ${fx.therapistB.id}, ${r.id}) returning id`);
    expect(p.id).toBeTruthy();
    await expect(sqlAs(r, (tx) => tx`
      insert into patients (full_name, sex, birth_date, location_id, therapist_id, reason)
      values ('Con Motivo', 'F', '1991-01-01', ${fx.orizaba}, ${fx.therapistB.id}, 'Dolor')`)).rejects.toThrow(/motivo de consulta/);
    await expect(sqlAs(r, (tx) => tx`
      insert into patients (full_name, sex, birth_date, location_id, therapist_id, status)
      values ('Inactiva', 'F', '1991-01-01', ${fx.orizaba}, ${fx.therapistB.id}, 'inactive')`)).rejects.toThrow(/pacientes activos/);

    await sqlAs(r, (tx) => tx`update patients set phone = '271 999 0000', address = 'Calle 1', location_id = ${fx.cordoba} where id = ${fx.patientB1}`);
    await expect(sqlAs(r, (tx) => tx`update patients set therapist_id = ${fx.therapistA.id} where id = ${fx.patientB1}`)).rejects.toThrow(/reasignar/);
    await expect(sqlAs(r, (tx) => tx`update patients set status = 'inactive', deactivated_at = now() where id = ${fx.patientB1}`)).rejects.toThrow(/dar de baja/);
    await expect(sqlAs(r, (tx) => tx`update patients set reason = 'otro' where id = ${fx.patientB1}`)).rejects.toThrow(/información clínica/);
    await expect(sqlAs(r, (tx) => tx`update patients set tags = '{Deportista}' where id = ${fx.patientB1}`)).rejects.toThrow(/información clínica/);
    const [row] = await sqlSystem((tx) => tx`select phone, therapist_id, status, reason, tags from patients where id = ${fx.patientB1}`);
    expect(row).toEqual({ phone: '271 999 0000', therapist_id: fx.therapistB.id, status: 'active', reason: 'Motivo de prueba', tags: [] });

    // El trigger no estorba a los demás roles: el dueño reasigna y el fisioterapeuta edita el motivo.
    await sqlAs(fx.therapistB, (tx) => tx`update patients set reason = 'Motivo actualizado' where id = ${fx.patientB1}`);
    await sqlAs(fx.owner, (tx) => tx`update patients set therapist_id = ${fx.therapistA.id} where id = ${p.id}`);
  });

  it('citas de cualquier fisioterapeuta: inserta y actualiza', async () => {
    const [a] = await sqlAs(fx.reception, (tx) => tx<{ id: string }[]>`
      insert into appointments (patient_id, therapist_id, location_id, starts_at, duration_min, ends_at, type_name)
      values (${fx.patientB1}, ${fx.therapistB.id}, ${fx.orizaba}, '2031-03-03T16:00:00Z', 50, now(), 'Fisioterapia') returning id`);
    const upd = await sqlAs(fx.reception, (tx) => tx`update appointments set status = 'cancelled', cancel_reason = 'Aviso' where id = ${a.id} returning id`);
    expect(upd).toHaveLength(1);
    // Un fisioterapeuta sigue sin poder agendar a nombre de otro.
    await expect(sqlAs(fx.therapistA, (tx) => tx`
      insert into appointments (patient_id, therapist_id, location_id, starts_at, duration_min, ends_at, type_name)
      values (${fx.patientA1}, ${fx.therapistB.id}, ${fx.orizaba}, '2031-03-04T16:00:00Z', 50, now(), 'Fisioterapia')`)).rejects.toThrow(/row-level security/);
  });

  it('pagos: registra y lee, pero no puede anular (sin política de UPDATE)', async () => {
    const r = fx.reception;
    const [m] = await sqlSystem((tx) => tx<{ id: string }[]>`select id from memberships where patient_id = ${fx.patientB1}`);
    const [pay] = await sqlAs(r, (tx) => tx<{ id: string }[]>`
      insert into payments (patient_id, membership_id, plan_name, plan_kind, amount_cents, method, prev_due_date, new_due_date, recorded_by)
      values (${fx.patientB1}, ${m.id}, 'Plan Senior', 'monthly', 120000, 'cash', mx_today(), mx_today() + 30, ${r.id}) returning id`);
    await sqlAs(r, (tx) => tx`update memberships set next_due_date = mx_today() + 30 where id = ${m.id}`);
    expect(await count(r, 'payments')).toBe(1);
    expect(await count(fx.therapistB, 'payments')).toBe(0);

    const voided = await sqlAs(r, (tx) => tx`update payments set voided_at = now(), voided_by = ${r.id}, void_reason = 'x' where id = ${pay.id} returning id`);
    expect(voided).toHaveLength(0);
    await expect(sqlAs(r, (tx) => tx`
      insert into payments (patient_id, membership_id, plan_name, plan_kind, amount_cents, method, prev_due_date, new_due_date, voided_at)
      values (${fx.patientB1}, ${m.id}, 'Plan Senior', 'monthly', 1, 'cash', mx_today(), mx_today(), now())`)).rejects.toThrow(/row-level security/);
    const [row] = await sqlSystem((tx) => tx`select voided_at from payments where id = ${pay.id}`);
    expect(row.voided_at).toBeNull();
    // El dueño sí anula.
    expect(await sqlAs(fx.owner, (tx) => tx`update payments set voided_at = now(), voided_by = ${fx.owner.id}, void_reason = 'Duplicado' where id = ${pay.id} returning id`)).toHaveLength(1);
  });

  it('links de pago: crea y cancela, pero no los marca como reembolsados', async () => {
    const r = fx.reception;
    const [m] = await sqlSystem((tx) => tx<{ id: string }[]>`select id from memberships where patient_id = ${fx.patientA1}`);
    const [k] = await sqlAs(r, (tx) => tx<{ id: string }[]>`
      insert into payment_links (patient_id, membership_id, plan_name, concept, amount_cents, expires_at, created_by)
      values (${fx.patientA1}, ${m.id}, 'Mensual Elite', 'Mensual Elite', 240000, now() + interval '1 day', ${r.id}) returning id`);
    expect(await sqlAs(r, (tx) => tx`update payment_links set status = 'cancelled' where id = ${k.id} returning id`)).toHaveLength(1);
    await expect(sqlAs(r, (tx) => tx`update payment_links set status = 'refunded', refund_id = 're_1' where id = ${k.id}`)).rejects.toThrow(/row-level security/);
    expect(await count(fx.therapistA, 'payment_links')).toBe(0);
  });

  it('consentimientos del alta: firma y lee; asistencias: lee las de todas las sedes', async () => {
    const r = fx.reception;
    await sqlAs(r, (tx) => tx`
      insert into consents (patient_id, kind, body_snapshot, signer_name, signature_png, recorded_by)
      values (${fx.patientB1}, 'privacy', 'Texto', 'Carmen Prueba', 'data:image/png;base64,AAAA', ${r.id})`);
    expect(await count(r, 'consents')).toBe(1);
    await sqlSystem((tx) => tx`select register_attendance(null, null, now(), 'manual', 'recepcion-db-1', 'manual', ${fx.patientB1}, null, ${fx.orizaba}, 'Prueba', ${r.id})`);
    expect(await count(r, 'attendance_events')).toBe(1);
    // attendance_events no admite escritura directa de nadie: solo register_attendance como sistema.
    await expect(sqlAs(r, (tx) => tx`delete from attendance_events`)).rejects.toThrow(/permission denied/);
  });
});
