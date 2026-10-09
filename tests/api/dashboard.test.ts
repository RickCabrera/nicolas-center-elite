// QA-02 · Integración de la API probada como dueño y como fisioterapeuta.
import { beforeAll, describe, expect, it } from 'vitest';
import { GET as DASHBOARD } from '@/app/api/dashboard/route';
import { hashPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { addDays, localToInstant, longDate, todayIso } from '@/lib/dates';
import { call, sqlAs, sqlSystem, TEST_PASSWORD, type Fixtures, type TestUser } from '../helpers';

/**
 * Mismos datos que `fixtures()` de tests/helpers.ts. Se arman aquí porque `resetData()` del helper hace
 * `set local session_replication_role = replica`, que exige superusuario: con el rol `nce_admin` de la
 * base local la transacción completa falla. TRUNCATE no dispara triggers por fila, así que no hace falta.
 */
async function fixtures(): Promise<Fixtures> {
  const hash = await hashPassword(TEST_PASSWORD);
  return sqlSystem(async (tx) => {
    await tx.unsafe(`truncate audit_log, attendance_events, enrollments, device_commands, devices, payments, memberships,
      document_items, documents, folio_counters, time_blocks, therapist_hours, appointments, studies, consents,
      evolution_notes, exercises, clinical_profiles, patient_assignments, patients, email_outbox,
      webauthn_challenges, passkeys, auth_tokens, sessions, users, arco_requests restart identity cascade`);
    const locs = await tx<{ id: string; code: string }[]>`select id, code from locations`;
    const cordoba = locs.find((l) => l.code === 'COR')!.id;
    const orizaba = locs.find((l) => l.code === 'ORI')!.id;
    const planRows = await tx<{ id: string; name: string }[]>`select id, name from membership_plans`;
    const plans = Object.fromEntries(planRows.map((p) => [p.name, p.id]));
    const makeUser = async (u: { username: string; role: 'owner' | 'therapist'; full_name: string; title?: string; location_id?: string; license?: string; physician?: boolean; specialty?: string }): Promise<TestUser> => {
      const [row] = await tx<{ id: string }[]>`
        insert into users (username, email, password_hash, role, full_name, title, specialty, location_id, license_number, license_institution, is_physician)
        values (${u.username}, ${u.username + '@prueba.mx'}, ${hash}, ${u.role}, ${u.full_name}, ${u.title ?? ''}, ${u.specialty ?? ''}, ${u.location_id ?? null},
                ${u.license ?? null}, ${u.license ? 'Universidad Veracruzana' : null}, ${u.physician ?? false})
        returning id`;
      const { token } = await createSession(tx, row.id, { method: 'password' });
      return { id: row.id, role: u.role, username: u.username, token, location_id: u.location_id ?? null };
    };
    const owner = await makeUser({ username: 'dueno', role: 'owner', full_name: 'Nicolas Herrera' });
    const therapistA = await makeUser({ username: 'karla', role: 'therapist', full_name: 'Karla Ocampo', title: 'L.F.T.', location_id: cordoba, license: '11223344', specialty: 'Pediatría' });
    const therapistB = await makeUser({ username: 'diego', role: 'therapist', full_name: 'Diego Salinas', title: 'L.F.T.', location_id: orizaba, license: '55667788', specialty: 'Columna' });
    const physician = await makeUser({ username: 'mariana', role: 'therapist', full_name: 'Mariana Reyes', title: 'Dra.', location_id: cordoba, license: '99887766', physician: true, specialty: 'Medicina de rehabilitación' });
    await tx`select set_config('app.user_id', ${owner.id}, true), set_config('app.user_role', 'owner', true)`;
    const patient = async (p: { name: string; birth: string; ther: string; loc: string; guardian?: string; plan: string; due: number; sessions?: number }) => {
      const [row] = await tx<{ id: string }[]>`
        insert into patients (full_name, sex, birth_date, phone, location_id, therapist_id, guardian_name, guardian_relationship, reason, created_by)
        values (${p.name}, 'F', ${p.birth}, '271 000 0000', ${p.loc}, ${p.ther}, ${p.guardian ?? ''}, ${p.guardian ? 'Madre' : ''}, 'Motivo de prueba', ${owner.id})
        returning id`;
      await tx`insert into memberships (patient_id, plan_id, next_due_date, sessions_remaining)
               values (${row.id}, ${plans[p.plan]}, mx_today() + ${p.due}::int, ${p.sessions ?? null})`;
      return row.id;
    };
    const patientA1 = await patient({ name: 'Ana Prueba Uno', birth: '1990-05-10', ther: therapistA.id, loc: cordoba, plan: 'Mensual Elite', due: 20 });
    const patientA2 = await patient({ name: 'Beto Prueba Dos', birth: '2016-03-14', ther: therapistA.id, loc: cordoba, guardian: 'Lucía Prueba', plan: 'Paquete 10 sesiones', due: 40, sessions: 10 });
    const patientB1 = await patient({ name: 'Carmen Prueba Tres', birth: '1955-01-30', ther: therapistB.id, loc: orizaba, plan: 'Plan Senior', due: -5 });
    return { owner, therapistA, therapistB, physician, cordoba, orizaba, plans, patientA1, patientA2, patientB1 };
  });
}

let fx: Fixtures;
const today = todayIso();
const dash = (as: TestUser, qs = '') => call(DASHBOARD, { as, url: `/api/dashboard${qs}` });

/** Los mismos números, contados directo en la base bajo la identidad del usuario (RLS). */
const direct = (u: TestUser, loc: string | null = null, attLoc: string | null = loc) =>
  sqlAs(u, async (tx) => {
    const [r] = await tx<{ patients_active: number; appointments_today: number; due: number; attendance_today: number }[]>`
      select (select count(*)::int from patients where status = 'active' and (${loc}::uuid is null or location_id = ${loc})) as patients_active,
             (select count(*)::int from appointments where status <> 'cancelled' and mx_date(starts_at) = mx_today()
                and (${loc}::uuid is null or location_id = ${loc})) as appointments_today,
             (select count(*)::int from patient_billing b join patients p on p.id = b.patient_id
               where p.status = 'active' and b.state in ('por_vencer', 'vencido') and (${loc}::uuid is null or p.location_id = ${loc})) as due,
             (select count(*)::int from attendance_events where mx_date(occurred_at) = mx_today() and person_type <> 'unknown'
                and (${attLoc}::uuid is null or location_id = ${attLoc})) as attendance_today`;
    return r;
  });

beforeAll(async () => {
  fx = await fixtures();
  await sqlSystem(async (tx) => {
    const ins = (patient: string, therapist: string, loc: string, date: string, time: string, status = 'scheduled') => tx`
      insert into appointments (patient_id, therapist_id, location_id, starts_at, duration_min, type_name, status)
      values (${patient}, ${therapist}, ${loc}, ${localToInstant(date, time)}, 50, 'Fisioterapia', ${status})`;
    await ins(fx.patientA1, fx.therapistA.id, fx.cordoba, today, '09:00');
    await ins(fx.patientA2, fx.therapistA.id, fx.cordoba, today, '10:00', 'attended');
    await ins(fx.patientA2, fx.therapistA.id, fx.cordoba, today, '12:00', 'cancelled');     // no cuenta
    await ins(fx.patientB1, fx.therapistB.id, fx.orizaba, today, '11:00');
    await ins(fx.patientA1, fx.therapistA.id, fx.cordoba, addDays(today, 1), '09:00');      // mañana: no cuenta
    await ins(fx.patientB1, fx.therapistB.id, fx.orizaba, addDays(today, -1), '11:00', 'no_show'); // ayer: no cuenta
    // A1 queda por vencer (3 días); B1 ya está vencida; A2 al corriente.
    await tx`update memberships set next_due_date = mx_today() + 3 where patient_id = ${fx.patientA1}`;
    // Un paciente inactivo con adeudo no cuenta en nada.
    const [x] = await tx<{ id: string }[]>`
      insert into patients (full_name, birth_date, location_id, therapist_id, status)
      values ('Dora Inactiva', '1980-01-01', ${fx.orizaba}, ${fx.therapistB.id}, 'inactive') returning id`;
    await tx`insert into memberships (patient_id, plan_id, next_due_date) values (${x.id}, ${fx.plans['Mensual Elite']}, mx_today() - 30)`;
    // Asistencias de hoy: dos pacientes y una fisioterapeuta en Córdoba, un fisioterapeuta en Orizaba,
    // una lectura desconocida (no cuenta) y una de ayer (no cuenta).
    const att = (key: string, time: string, o: { patient?: string; user?: string; loc: string; date?: string }) => tx`
      select register_attendance(null, null, ${localToInstant(o.date ?? today, time)}, 'manual', ${key}, '',
                                 ${o.patient ?? null}, ${o.user ?? null}, ${o.loc})`;
    await att('k1', '07:50', { user: fx.therapistA.id, loc: fx.cordoba });
    await att('k2', '08:55', { patient: fx.patientA1, loc: fx.cordoba });
    await att('k3', '09:58', { patient: fx.patientA2, loc: fx.cordoba });
    await att('k4', '08:00', { user: fx.therapistB.id, loc: fx.orizaba });
    await att('k5', '10:30', { loc: fx.cordoba });
    await att('k6', '10:00', { patient: fx.patientB1, loc: fx.orizaba, date: addDays(today, -1) });
  });
});

describe('DASH-01 · panel del dueño', () => {
  it('requiere sesión', async () => {
    expect((await call(DASHBOARD, { url: '/api/dashboard' })).status).toBe(401);
  });

  it('los indicadores coinciden con consultas directas (ambas sedes)', async () => {
    const r = await dash(fx.owner);
    expect(r.status).toBe(200);
    expect(r.data.stats).toEqual(await direct(fx.owner));
    expect(r.data.stats).toEqual({ patients_active: 3, appointments_today: 3, due: 2, attendance_today: 4 });
    expect(r.data).toMatchObject({ today, date_label: longDate(today), location_id: null, location_name: null });
  });

  it('citas de hoy en orden, sin canceladas, con nombre corto del fisioterapeuta', async () => {
    const r = await dash(fx.owner);
    expect(r.data.today_appointments.map((a: { time: string; patient_name: string; therapist_name: string; status: string }) =>
      [a.time, a.patient_name, a.therapist_name, a.status])).toEqual([
      ['09:00', 'Ana Prueba Uno', 'Karla', 'attended'],     // la marcó la asistencia por huella de las 08:55
      ['10:00', 'Beto Prueba Dos', 'Karla', 'attended'],
      ['11:00', 'Carmen Prueba Tres', 'Diego', 'scheduled'],
    ]);
    expect(r.data.today_appointments[0]).toMatchObject({ type_name: 'Fisioterapia', patient_id: fx.patientA1 });
  });

  it('asistencias recientes: últimas primero, con rol, sede y dirección', async () => {
    const r = await dash(fx.owner);
    expect(r.data.recent_attendance.map((e: { time: string; person_name: string; role_label: string; location_name: string; direction: string }) =>
      [e.time, e.person_name, e.role_label, e.location_name, e.direction])).toEqual([
      ['09:58', 'Beto Prueba Dos', 'Paciente', 'Córdoba', 'in'],
      ['08:55', 'Ana Prueba Uno', 'Paciente', 'Córdoba', 'in'],
      ['08:00', 'L.F.T. Diego Salinas', 'Fisioterapeuta', 'Orizaba', 'in'],
      ['07:50', 'L.F.T. Karla Ocampo', 'Fisioterapeuta', 'Córdoba', 'in'],
    ]);
  });

  it('mensualidades por atender: vencidas primero, solo pacientes activos', async () => {
    const r = await dash(fx.owner);
    expect(r.data.due_payments.map((p: { full_name: string; state: string; plan_name: string }) => [p.full_name, p.state, p.plan_name])).toEqual([
      ['Carmen Prueba Tres', 'vencido', 'Plan Senior'],
      ['Ana Prueba Uno', 'por_vencer', 'Mensual Elite'],
    ]);
    expect(r.data.due_payments[1]).toMatchObject({ patient_id: fx.patientA1, next_due_date: addDays(today, 3) });
    const states = await sqlAs(fx.owner, (tx) => tx<{ patient_id: string; state: string }[]>`
      select b.patient_id, b.state from patient_billing b join patients p on p.id = b.patient_id
      where p.status = 'active' and b.state in ('por_vencer', 'vencido')`);
    expect(r.data.due_payments.map((p: { patient_id: string }) => p.patient_id).sort()).toEqual(states.map((s) => s.patient_id).sort());
  });

  it('DASH-03 · el filtro por sede recorta todo', async () => {
    const c = await dash(fx.owner, `?location_id=${fx.cordoba}`);
    expect(c.data.stats).toEqual(await direct(fx.owner, fx.cordoba));
    expect(c.data.stats).toEqual({ patients_active: 2, appointments_today: 2, due: 1, attendance_today: 3 });
    expect(c.data.location_name).toBe('Córdoba');
    expect(c.data.today_appointments).toHaveLength(2);
    expect(c.data.recent_attendance.every((e: { location_name: string }) => e.location_name === 'Córdoba')).toBe(true);
    expect(c.data.due_payments.map((p: { full_name: string }) => p.full_name)).toEqual(['Ana Prueba Uno']);

    const o = await dash(fx.owner, `?location_id=${fx.orizaba}`);
    expect(o.data.stats).toEqual(await direct(fx.owner, fx.orizaba));
    expect(o.data.stats).toEqual({ patients_active: 1, appointments_today: 1, due: 1, attendance_today: 1 });
    expect(o.data.due_payments.map((p: { full_name: string }) => p.full_name)).toEqual(['Carmen Prueba Tres']);

    expect((await dash(fx.owner, '?location_id=nada')).status).toBe(400);
    expect((await dash(fx.owner, '?location_id=00000000-0000-4000-8000-000000000000')).status).toBe(400);
    expect((await dash(fx.owner, '?location_id=')).data.stats.patients_active).toBe(3);
  });
});

describe('DASH-02 · panel del fisioterapeuta', () => {
  it('solo cuenta lo suyo; las asistencias son las de su sede', async () => {
    const a = await dash(fx.therapistA);
    expect(a.status).toBe(200);
    expect(a.data.stats).toEqual(await direct(fx.therapistA, null, fx.cordoba));
    expect(a.data.stats).toEqual({ patients_active: 2, appointments_today: 2, due: 1, attendance_today: 3 });
    expect(a.data).toMatchObject({ location_id: fx.cordoba, location_name: 'Córdoba' });
    expect(a.data.today_appointments.map((x: { patient_name: string }) => x.patient_name)).toEqual(['Ana Prueba Uno', 'Beto Prueba Dos']);
    expect(a.data.recent_attendance.every((e: { location_name: string }) => e.location_name === 'Córdoba')).toBe(true);

    const b = await dash(fx.therapistB);
    expect(b.data.stats).toEqual(await direct(fx.therapistB, null, fx.orizaba));
    expect(b.data.stats).toEqual({ patients_active: 1, appointments_today: 1, due: 1, attendance_today: 1 });
    expect(b.data.today_appointments.map((x: { patient_name: string }) => x.patient_name)).toEqual(['Carmen Prueba Tres']);
  });

  it('no recibe el detalle de mensualidades ni nombres de pacientes ajenos', async () => {
    const a = await dash(fx.therapistA);
    expect(a.data).not.toHaveProperty('due_payments');
    expect(JSON.stringify(a.data)).not.toContain('Carmen Prueba Tres');
    const m = await dash(fx.physician);
    expect(m.data.stats).toMatchObject({ patients_active: 0, appointments_today: 0, due: 0 });
    expect(m.data).not.toHaveProperty('due_payments');
    expect(m.data.today_appointments).toEqual([]);
  });

  it('ignora el filtro de sede: no puede asomarse a la otra', async () => {
    const r = await dash(fx.therapistA, `?location_id=${fx.orizaba}`);
    expect(r.data.stats).toEqual({ patients_active: 2, appointments_today: 2, due: 1, attendance_today: 3 });
    expect(r.data.location_name).toBe('Córdoba');
    expect(JSON.stringify(r.data)).not.toContain('Diego');
  });
});
