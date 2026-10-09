// QA-02 · Integración de la API probada como dueño y como fisioterapeuta.
import { beforeAll, describe, expect, it } from 'vitest';
import { GET as USERS, POST as CREATE } from '@/app/api/users/route';
import { GET as DETAIL, PATCH as EDIT } from '@/app/api/users/[id]/route';
import { POST as INVITE } from '@/app/api/users/[id]/invite/route';
import { POST as DEACTIVATE } from '@/app/api/users/[id]/deactivate/route';
import { POST as REACTIVATE } from '@/app/api/users/[id]/reactivate/route';
import { GET as WORKLOAD } from '@/app/api/users/workload/route';
import { GET as PROFILE, PATCH as PROFILE_EDIT } from '@/app/api/profile/route';
import { GET as SESSIONS, POST as SESSIONS_REVOKE } from '@/app/api/profile/sessions/route';
import { POST as RESET } from '@/app/api/auth/reset/route';
import { POST as LOGIN } from '@/app/api/auth/login/route';
import { createSession } from '@/lib/auth/session';
import { addDays, localToInstant, todayIso } from '@/lib/dates';
import { describeDevice, weekRange } from '@/modules/team/server';
import { hashPassword } from '@/lib/auth/password';
import { call, resetData, sqlAs, sqlSystem, TEST_PASSWORD, type CoreFixtures as Fixtures, type TestUser } from '../helpers';

/**
 * Mismos datos que `fixtures()` de tests/helpers.ts. Se arman aquí porque `resetData()` del helper hace
 * `set local session_replication_role = replica`, que exige superusuario: con el rol `nce_admin` de la
 * base local la transacción completa falla. TRUNCATE no dispara triggers por fila, así que no hace falta.
 */
async function fixtures(): Promise<Fixtures> {
  // Parte de los datos base: otra prueba pudo renombrar un plan o cambiar el domicilio de una sede,
  // y el orden en que corren los archivos no está garantizado.
  await resetData();
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
let noteId = '';
const tomorrow = addDays(todayIso(), 1);
const appt = { a1: '', a2: '', b1: '', mine: '' };

const newTherapist = (over: Record<string, unknown> = {}) => ({
  full_name: 'Andrea  Pineda Ruiz', title: 'L.F.T.', username: 'a.pineda', email: 'Andrea.Pineda@prueba.mx',
  specialty: 'Deportiva', location_id: fx.orizaba, phone: '272 111 2233', license_number: '12345678',
  license_institution: 'UV', is_physician: false, ...over,
});

beforeAll(async () => {
  fx = await fixtures();
  // Una nota firmada por A (para comprobar que sobrevive a su baja) y citas futuras.
  const [n] = await sqlAs(fx.therapistA, (tx) => tx<{ id: string }[]>`
    insert into evolution_notes (patient_id, body) values (${fx.patientA1}, 'Evolución favorable, sin dolor.') returning id`);
  noteId = n.id;
  await sqlSystem(async (tx) => {
    const ins = async (patient: string, therapist: string, loc: string, time: string, date = tomorrow) => {
      const [r] = await tx<{ id: string }[]>`
        insert into appointments (patient_id, therapist_id, location_id, starts_at, duration_min, type_name)
        values (${patient}, ${therapist}, ${loc}, ${localToInstant(date, time)}, 50, 'Fisioterapia') returning id`;
      return r.id;
    };
    appt.a1 = await ins(fx.patientA1, fx.therapistA.id, fx.cordoba, '10:00');   // libre para B → se mueve
    appt.a2 = await ins(fx.patientA2, fx.therapistA.id, fx.cordoba, '11:00');   // se empalma con la de B → se cancela
    appt.b1 = await ins(fx.patientB1, fx.therapistB.id, fx.orizaba, '11:20');
    // Semana actual: una cita de hoy, una cancelada (no cuenta) y una asistencia de A.
    appt.mine = await ins(fx.patientA1, fx.therapistA.id, fx.cordoba, '08:00', todayIso());
    // Ya atendida: así la prueba no depende de la hora a la que corre (antes de las 8:00 seguiría siendo futura).
    await tx`update appointments set status = 'attended' where id = ${appt.mine}`;
    const [c] = await tx<{ id: string }[]>`
      insert into appointments (patient_id, therapist_id, location_id, starts_at, duration_min, type_name, status, cancel_reason)
      values (${fx.patientA2}, ${fx.therapistA.id}, ${fx.cordoba}, ${localToInstant(todayIso(), '09:00')}, 50, 'Fisioterapia', 'cancelled', 'x') returning id`;
    expect(c.id).toBeTruthy();
    await tx`select register_attendance(null, null, ${localToInstant(todayIso(), '07:55')}, 'manual', 'staff-a-1', '', null, ${fx.therapistA.id}, ${fx.cordoba})`;
  });
});

describe('permisos · todo /api/users es solo del dueño', () => {
  it('un fisioterapeuta recibe 403 en cada ruta', async () => {
    const as = fx.therapistA;
    const id = { id: fx.therapistB.id };
    const results = await Promise.all([
      call(USERS, { as, url: '/api/users' }),
      call(CREATE, { as, url: '/api/users', body: newTherapist() }),
      call(DETAIL, { as, params: id }),
      call(EDIT, { as, params: id, method: 'PATCH', body: { specialty: 'x' } }),
      call(INVITE, { as, params: id, body: {} }),
      call(DEACTIVATE, { as, params: id, body: { reassign_to: fx.therapistA.id } }),
      call(REACTIVATE, { as, params: id, body: {} }),
      call(WORKLOAD, { as, url: '/api/users/workload' }),
    ]);
    expect(results.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403, 403, 403]);
    const [{ n }] = await sqlSystem((tx) => tx<{ n: number }[]>`select count(*)::int as n from users`);
    expect(n).toBe(4);
  });

  it('sin sesión responde 401', async () => {
    expect((await call(USERS, { url: '/api/users' })).status).toBe(401);
    expect((await call(WORKLOAD, { url: '/api/users/workload' })).status).toBe(401);
  });
});

describe('EQ-01 / EQ-05 · lista y carga de trabajo', () => {
  it('la lista simple incluye al dueño y nunca expone la contraseña', async () => {
    const r = await call(USERS, { as: fx.owner, url: '/api/users' });
    expect(r.status).toBe(200);
    expect(r.data).toHaveLength(4);
    expect(r.data[0].role).toBe('owner');
    expect(JSON.stringify(r.data)).not.toMatch(/password|scrypt/);
  });

  it('la carga coincide con conteos directos', async () => {
    const r = await call(WORKLOAD, { as: fx.owner, url: '/api/users/workload' });
    expect(r.status).toBe(200);
    const wk = weekRange(todayIso());
    expect(r.data).toMatchObject({ today: todayIso(), week_from: wk.from, week_to: wk.to });
    expect(r.data.items.map((i: { username: string }) => i.username).sort()).toEqual(['diego', 'karla', 'mariana']);
    expect(JSON.stringify(r.data)).not.toMatch(/password_hash|scrypt/);

    for (const t of [fx.therapistA, fx.therapistB, fx.physician]) {
      const row = r.data.items.find((i: { id: string }) => i.id === t.id);
      const [d] = await sqlSystem((tx) => tx`
        select (select count(*)::int from patients where therapist_id = ${t.id} and status = 'active') as patients_active,
               (select count(*)::int from appointments where therapist_id = ${t.id} and status <> 'cancelled'
                  and mx_date(starts_at) = mx_today()) as appointments_today,
               (select count(*)::int from appointments where therapist_id = ${t.id} and status <> 'cancelled'
                  and mx_date(starts_at) between ${wk.from}::date and ${wk.to}::date) as appointments_week,
               (select count(*)::int from evolution_notes where author_id = ${t.id}
                  and mx_date(noted_at) between ${wk.from}::date and ${wk.to}::date) as notes_week`);
      expect(row).toMatchObject(d);
    }
    const a = r.data.items.find((i: { id: string }) => i.id === fx.therapistA.id);
    expect(a).toMatchObject({
      display_name: 'L.F.T. Karla Ocampo', location_name: 'Córdoba', patients_active: 2, appointments_today: 1,
      notes_week: 1, attendance_days_week: 1, is_physician: false, active: true, invited_pending: false,
    });
    expect(a.appointments_week).toBeGreaterThanOrEqual(1);
    const m = r.data.items.find((i: { id: string }) => i.id === fx.physician.id);
    expect(m).toMatchObject({ is_physician: true, patients_active: 0, appointments_today: 0, appointments_week: 0 });
  });

  it('week_of mueve la semana; una fecha mal escrita es 400', async () => {
    const r = await call(WORKLOAD, { as: fx.owner, url: '/api/users/workload?week_of=2026-01-01' });
    expect(r.data).toMatchObject({ week_from: '2025-12-29', week_to: '2026-01-04' });
    expect(r.data.items.find((i: { id: string }) => i.id === fx.therapistA.id)).toMatchObject({ appointments_week: 0, notes_week: 0, appointments_today: 1 });
    expect((await call(WORKLOAD, { as: fx.owner, url: '/api/users/workload?week_of=ayer' })).status).toBe(400);
  });
});

describe('EQ-02 · alta con invitación', () => {
  let created = '';
  let link = '';

  it('valida usuario, correo y sede', async () => {
    const r = await call(CREATE, { as: fx.owner, body: newTherapist({ username: 'A B', email: 'no-es-correo', location_id: 'x' }) });
    expect(r.status).toBe(400);
    expect(Object.keys(r.error!.fields!)).toEqual(expect.arrayContaining(['username', 'email', 'location_id']));
  });

  it('un médico sin cédula no se puede crear: 400 en el campo', async () => {
    const r = await call(CREATE, { as: fx.owner, body: newTherapist({ is_physician: true, license_number: '' }) });
    expect(r.status).toBe(400);
    expect(r.error!.fields).toHaveProperty('license_number');
    expect(r.error!.message).toMatch(/28 Bis/);
  });

  it('crea al fisioterapeuta sin contraseña, con token de invitación y correo en la bandeja', async () => {
    const r = await call(CREATE, { as: fx.owner, body: newTherapist() });
    expect(r.status).toBe(200);
    expect(r.data.user).toMatchObject({
      username: 'a.pineda', email: 'andrea.pineda@prueba.mx', role: 'therapist', full_name: 'Andrea Pineda Ruiz',
      display_name: 'L.F.T. Andrea Pineda Ruiz', location_name: 'Orizaba', has_password: false, invited_pending: true, active: true,
    });
    expect(r.data.user).not.toHaveProperty('password_hash');
    expect(r.data.email_status).toBe('logged');
    expect(r.data.invite_link).toMatch(/^http:\/\/localhost:3000\/invitacion\?token=.{20,}$/);
    created = r.data.user.id;
    link = r.data.invite_link;

    const [u] = await sqlSystem((tx) => tx`select password_hash, role from users where id = ${created}`);
    expect(u).toEqual({ password_hash: null, role: 'therapist' });
    const tokens = await sqlSystem((tx) => tx`select kind from auth_tokens where user_id = ${created} and used_at is null and expires_at > now()`);
    expect(tokens).toEqual([{ kind: 'invite' }]);
    const mails = await sqlSystem((tx) => tx<{ body_text: string }[]>`select body_text from email_outbox where to_email = 'andrea.pineda@prueba.mx'`);
    expect(mails).toHaveLength(1);
    expect(mails[0].body_text).toContain(link);

    const w = await call(WORKLOAD, { as: fx.owner, url: '/api/users/workload' });
    expect(w.data.items.find((i: { id: string }) => i.id === created)).toMatchObject({ invited_pending: true, patients_active: 0 });
  });

  it('no deja crear un rol distinto aunque el cliente lo mande', async () => {
    const r = await call(CREATE, { as: fx.owner, body: newTherapist({ username: 'otro.dueno', email: 'otro@prueba.mx', role: 'owner' }) });
    expect(r.status).toBe(200);
    expect(r.data.user.role).toBe('therapist');
  });

  it('usuario o correo duplicado → 409 con el campo', async () => {
    const u = await call(CREATE, { as: fx.owner, body: newTherapist({ email: 'nueva@prueba.mx', username: 'A.Pineda' }) });
    expect(u.status).toBe(409);
    expect(u.error!.fields).toHaveProperty('username');
    const e = await call(CREATE, { as: fx.owner, body: newTherapist({ username: 'andrea2', email: 'ANDREA.pineda@prueba.mx' }) });
    expect(e.status).toBe(409);
    expect(e.error!.fields).toHaveProperty('email');
    expect(e.error!.message).toMatch(/correo/);
  });

  it('reenviar genera un enlace nuevo e invalida el anterior', async () => {
    const r = await call(INVITE, { as: fx.owner, params: { id: created }, body: {} });
    expect(r.status).toBe(200);
    expect(r.data.kind).toBe('invite');
    expect(r.data.invite_link).not.toBe(link);
    const old = await call(RESET, { body: { token: new URL(link).searchParams.get('token'), password: 'ClaveNueva2026x' } });
    expect(old.status).toBe(404);
    link = r.data.invite_link;
  });

  it('el enlace sirve para definir la contraseña y entrar', async () => {
    const token = new URL(link).searchParams.get('token')!;
    const r = await call(RESET, { body: { token, password: 'ClaveNueva2026x' } });
    expect(r.status).toBe(200);
    expect(r.res.headers.get('set-cookie')).toMatch(/nce_session=/);
    const login = await call(LOGIN, { body: { username: 'a.pineda', password: 'ClaveNueva2026x' } });
    expect(login.status).toBe(200);
    const d = await call(DETAIL, { as: fx.owner, params: { id: created } });
    expect(d.data).toMatchObject({ has_password: true, invited_pending: false, patients_active: 0, future_appointments: 0 });
  });

  it('con contraseña ya definida solo se envía enlace si el dueño fuerza el restablecimiento', async () => {
    const no = await call(INVITE, { as: fx.owner, params: { id: created }, body: {} });
    expect(no.status).toBe(409);
    const yes = await call(INVITE, { as: fx.owner, params: { id: created }, body: { force_reset: true } });
    expect(yes.status).toBe(200);
    expect(yes.data.kind).toBe('reset');
    expect(yes.data.invite_link).toMatch(/\/restablecer\?token=/);
    const tokens = await sqlSystem((tx) => tx`select kind from auth_tokens where user_id = ${created} and used_at is null`);
    expect(tokens).toEqual([{ kind: 'reset' }]);
  });
});

describe('EQ-03 · edición por el dueño', () => {
  it('edita datos y valida unicidad al cambiar usuario o correo', async () => {
    const r = await call(EDIT, { as: fx.owner, params: { id: fx.therapistB.id }, method: 'PATCH',
      body: { specialty: 'Columna y postura', phone: '2721234567', username: 'd.salinas', title: 'Lic.' } });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ specialty: 'Columna y postura', username: 'd.salinas', display_name: 'Lic. Diego Salinas', phone: '2721234567' });
    const dup = await call(EDIT, { as: fx.owner, params: { id: fx.therapistB.id }, method: 'PATCH', body: { email: 'karla@prueba.mx' } });
    expect(dup.status).toBe(409);
    expect(dup.error!.fields).toHaveProperty('email');
    const same = await call(EDIT, { as: fx.owner, params: { id: fx.therapistB.id }, method: 'PATCH', body: { email: 'DIEGO@prueba.mx' } });
    expect(same.status).toBe(200);
  });

  it('no se puede marcar como médico sin cédula ni dejar sin cédula a un médico', async () => {
    await sqlSystem((tx) => tx`update users set license_number = null where id = ${fx.therapistB.id}`);
    const r = await call(EDIT, { as: fx.owner, params: { id: fx.therapistB.id }, method: 'PATCH', body: { is_physician: true } });
    expect(r.status).toBe(400);
    expect(r.error!.fields).toHaveProperty('license_number');
    const ok = await call(EDIT, { as: fx.owner, params: { id: fx.therapistB.id }, method: 'PATCH', body: { is_physician: true, license_number: '55667788' } });
    expect(ok.data).toMatchObject({ is_physician: true, license_number: '55667788' });
    const strip = await call(EDIT, { as: fx.owner, params: { id: fx.physician.id }, method: 'PATCH', body: { license_number: '' } });
    expect(strip.status).toBe(400);
    const off = await call(EDIT, { as: fx.owner, params: { id: fx.therapistB.id }, method: 'PATCH', body: { is_physician: false } });
    expect(off.data.is_physician).toBe(false);
  });

  it('404 si el usuario no existe', async () => {
    expect((await call(DETAIL, { as: fx.owner, params: { id: '00000000-0000-4000-8000-000000000000' } })).status).toBe(404);
    expect((await call(DETAIL, { as: fx.owner, params: { id: 'nada' } })).status).toBe(404);
  });
});

describe('CFG-08 · mi perfil y sesiones', () => {
  it('lee y edita sus propios datos', async () => {
    const g = await call(PROFILE, { as: fx.therapistA });
    expect(g.data).toMatchObject({ username: 'karla', location_name: 'Córdoba', is_physician: false, license_number: '11223344' });
    expect(g.data).not.toHaveProperty('password_hash');
    const r = await call(PROFILE_EDIT, { as: fx.therapistA, method: 'PATCH', body: { phone: '271 555 0000', specialty: 'Pediatría y neurodesarrollo', license_institution: '' } });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ phone: '271 555 0000', specialty: 'Pediatría y neurodesarrollo', license_institution: null, username: 'karla' });
  });

  it('no puede cambiarse is_physician, rol, usuario ni sede', async () => {
    for (const body of [{ is_physician: true }, { role: 'owner' }, { username: 'jefa' }, { location_id: fx.orizaba }]) {
      const r = await call(PROFILE_EDIT, { as: fx.therapistA, method: 'PATCH', body });
      expect(r.status).toBe(400);
      expect(Object.keys(r.error!.fields!)).toEqual(Object.keys(body));
    }
    const [u] = await sqlSystem((tx) => tx`select is_physician, role, username, location_id from users where id = ${fx.therapistA.id}`);
    expect(u).toEqual({ is_physician: false, role: 'therapist', username: 'karla', location_id: fx.cordoba });
  });

  it('correo duplicado → 409; un médico no puede vaciar su cédula', async () => {
    const r = await call(PROFILE_EDIT, { as: fx.therapistA, method: 'PATCH', body: { email: 'Mariana@prueba.mx' } });
    expect(r.status).toBe(409);
    expect(r.error!.fields).toHaveProperty('email');
    const m = await call(PROFILE_EDIT, { as: fx.physician, method: 'PATCH', body: { license_number: '' } });
    expect(m.status).toBe(400);
    expect(m.error!.fields).toHaveProperty('license_number');
  });

  it('lista sus sesiones, marca la actual y cierra las demás', async () => {
    const other = await sqlSystem((tx) => createSession(tx, fx.physician.id, {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' }));
    const otherUser = { ...fx.physician, token: other.token };
    const l = await call(SESSIONS, { as: fx.physician });
    expect(l.data).toHaveLength(2);
    expect(l.data[0].current).toBe(true);
    expect(l.data[1]).toMatchObject({ current: false, device: 'Safari · iPhone' });
    expect(l.data[0]).not.toHaveProperty('user_agent');

    const self = await call(SESSIONS_REVOKE, { as: fx.physician, body: { revoke: l.data[0].id } });
    expect(self.status).toBe(400);
    const foreign = await call(SESSIONS_REVOKE, { as: fx.therapistA, body: { revoke: l.data[1].id } });
    expect(foreign.status).toBe(404);

    const r = await call(SESSIONS_REVOKE, { as: fx.physician, body: { revoke: 'others' } });
    expect(r.data).toEqual({ revoked: 1 });
    expect((await call(PROFILE, { as: otherUser })).status).toBe(401);
    expect((await call(PROFILE, { as: fx.physician })).status).toBe(200);
    expect((await call(SESSIONS, { as: fx.physician })).data).toHaveLength(1);
  });

  it('resume el navegador y el sistema', () => {
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36')).toBe('Chrome · Windows');
    expect(describeDevice('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36 EdgA/126.0')).toBe('Edge · Android');
    expect(describeDevice(null)).toBe('Dispositivo desconocido');
  });
});

describe('EQ-04 / AUTH-09 · baja con reasignación', () => {
  it('no se puede desactivar al dueño ni a uno mismo', async () => {
    const r = await call(DEACTIVATE, { as: fx.owner, params: { id: fx.owner.id }, body: { reassign_to: fx.therapistB.id } });
    expect(r.status).toBe(403);
    const [o] = await sqlSystem((tx) => tx`select active from users where id = ${fx.owner.id}`);
    expect(o.active).toBe(true);
  });

  it('con pacientes o citas y sin destino → 409 que explica qué falta', async () => {
    const r = await call(DEACTIVATE, { as: fx.owner, params: { id: fx.therapistA.id }, body: { reassign_to: null } });
    expect(r.status).toBe(409);
    expect(r.error!.code).toBe('needs_reassign');
    expect(r.error!.message).toMatch(/2 pacientes activos/);
    expect(r.error!.message).toMatch(/citas? futuras?/);
    const partial = await call(DEACTIVATE, { as: fx.owner, params: { id: fx.therapistA.id }, body: { patients: { [fx.patientA1]: fx.therapistB.id } } });
    expect(partial.status).toBe(409);
    expect(partial.error!.message).toMatch(/Beto Prueba Dos/);
    const [u] = await sqlSystem((tx) => tx`select active from users where id = ${fx.therapistA.id}`);
    expect(u.active).toBe(true);
    const [p] = await sqlSystem((tx) => tx`select therapist_id from patients where id = ${fx.patientA1}`);
    expect(p.therapist_id).toBe(fx.therapistA.id);   // la transacción fallida no dejó nada a medias
  });

  it('el destino debe ser otro fisioterapeuta activo', async () => {
    const self = await call(DEACTIVATE, { as: fx.owner, params: { id: fx.therapistA.id }, body: { reassign_to: fx.therapistA.id } });
    expect(self.status).toBe(400);
    const owner = await call(DEACTIVATE, { as: fx.owner, params: { id: fx.therapistA.id }, body: { reassign_to: fx.owner.id } });
    expect(owner.status).toBe(400);
    const alien = await call(DEACTIVATE, { as: fx.owner, params: { id: fx.therapistA.id }, body: { reassign_to: fx.therapistB.id, patients: { [fx.patientB1]: fx.physician.id } } });
    expect(alien.status).toBe(400);
  });

  it('con destino: mueve pacientes y citas, cancela las empalmadas, revoca sesiones y conserva su firma', async () => {
    expect((await call(PROFILE, { as: fx.therapistA })).status).toBe(200);
    const r = await call(DEACTIVATE, { as: fx.owner, params: { id: fx.therapistA.id }, body: { reassign_to: fx.therapistB.id } });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ patients_moved: 2, appointments_moved: 1, fingerprint_removal: 'none' });
    expect(r.data.sessions_revoked).toBeGreaterThanOrEqual(1);
    expect(r.data.appointments_cancelled).toHaveLength(1);
    expect(r.data.appointments_cancelled[0]).toMatchObject({ id: appt.a2, patient_name: 'Beto Prueba Dos' });
    expect(r.data.user).toMatchObject({ active: false });
    expect(r.data.user.deactivated_at).toBeTruthy();

    const pats = await sqlSystem((tx) => tx<{ therapist_id: string }[]>`select therapist_id from patients where id in (${fx.patientA1}, ${fx.patientA2})`);
    expect(pats.every((p) => p.therapist_id === fx.therapistB.id)).toBe(true);
    const hist = await sqlSystem((tx) => tx`select therapist_id, to_at is null as open from patient_assignments where patient_id = ${fx.patientA1} order by from_at, to_at nulls last`);
    expect(hist).toEqual([{ therapist_id: fx.therapistA.id, open: false }, { therapist_id: fx.therapistB.id, open: true }]);

    const rows = await sqlSystem((tx) => tx<{ id: string; therapist_id: string; status: string; cancel_reason: string | null }[]>`
      select id, therapist_id, status, cancel_reason from appointments where id in (${appt.a1}, ${appt.a2}, ${appt.b1}, ${appt.mine})`);
    const by = Object.fromEntries(rows.map((x) => [x.id, x]));
    expect(by[appt.a1]).toMatchObject({ therapist_id: fx.therapistB.id, status: 'scheduled' });
    expect(by[appt.a2]).toMatchObject({ status: 'cancelled', cancel_reason: 'Fisioterapeuta dado de baja' });
    expect(by[appt.b1]).toMatchObject({ therapist_id: fx.therapistB.id, status: 'scheduled' });
    expect(by[appt.mine].therapist_id).toBe(fx.therapistA.id);   // lo ya ocurrido no se reescribe

    // Su sesión ya no autentica en ninguna ruta, y su contraseña tampoco abre una nueva.
    expect((await call(PROFILE, { as: fx.therapistA })).status).toBe(401);
    expect((await call(SESSIONS, { as: fx.therapistA })).status).toBe(401);
    expect((await call(LOGIN, { body: { username: 'karla', password: TEST_PASSWORD } })).status).toBe(401);

    // Su nota firmada sigue intacta, con su nombre.
    const [n] = await sqlAs(fx.therapistB, (tx) => tx`select author_name, author_id, signature_hash from evolution_notes where id = ${noteId}`);
    expect(n).toMatchObject({ author_name: 'L.F.T. Karla Ocampo', author_id: fx.therapistA.id });
    expect(n.signature_hash).toMatch(/^[0-9a-f]{64}$/);

    const w = await call(WORKLOAD, { as: fx.owner, url: '/api/users/workload' });
    expect(w.data.items.find((i: { id: string }) => i.id === fx.therapistA.id)).toMatchObject({ active: false, patients_active: 0 });
    expect(w.data.items.find((i: { id: string }) => i.id === fx.therapistB.id)).toMatchObject({ patients_active: 3 });
  });

  it('desactivar dos veces → 409; no se le puede enviar invitación estando inactivo', async () => {
    expect((await call(DEACTIVATE, { as: fx.owner, params: { id: fx.therapistA.id }, body: {} })).status).toBe(409);
    expect((await call(INVITE, { as: fx.owner, params: { id: fx.therapistA.id }, body: { force_reset: true } })).status).toBe(409);
  });

  it('reparto paciente por paciente y baja sin nada pendiente', async () => {
    // B tiene ahora 3 pacientes: dos pasan a la médica y uno a la recién creada.
    const [nu] = await sqlSystem((tx) => tx<{ id: string }[]>`select id from users where username = 'a.pineda'`);
    const r = await call(DEACTIVATE, { as: fx.owner, params: { id: fx.therapistB.id },
      body: { patients: { [fx.patientA1]: fx.physician.id, [fx.patientA2]: fx.physician.id, [fx.patientB1]: nu.id } } });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ patients_moved: 3, appointments_moved: 2, appointments_cancelled: [] });
    const [b1] = await sqlSystem((tx) => tx`select therapist_id from patients where id = ${fx.patientB1}`);
    expect(b1.therapist_id).toBe(nu.id);
    const [ab] = await sqlSystem((tx) => tx`select therapist_id from appointments where id = ${appt.b1}`);
    expect(ab.therapist_id).toBe(nu.id);
    // Sin pacientes ni citas no hace falta destino.
    const [otro] = await sqlSystem((tx) => tx<{ id: string }[]>`select id from users where username = 'otro.dueno'`);
    // Con huella enrolada: se encola su baja del lector si el módulo de Huella ya existe; si no, se avisa.
    await sqlSystem((tx) => tx`update users set fingerprint_enrolled_at = now() where id = ${otro.id}`);
    const solo = await call(DEACTIVATE, { as: fx.owner, params: { id: otro.id }, body: {} });
    expect(solo.status).toBe(200);
    expect(solo.data).toMatchObject({ patients_moved: 0, appointments_moved: 0 });
    expect(['queued', 'manual']).toContain(solo.data.fingerprint_removal);
    const tokens = await sqlSystem((tx) => tx`select 1 from auth_tokens where user_id = ${otro.id} and used_at is null`);
    expect(tokens).toHaveLength(0);   // su invitación quedó invalidada
  });

  it('reactivar devuelve el acceso, sin regresarle pacientes', async () => {
    const r = await call(REACTIVATE, { as: fx.owner, params: { id: fx.therapistA.id }, body: {} });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ active: true, deactivated_at: null });
    expect((await call(LOGIN, { body: { username: 'karla', password: TEST_PASSWORD } })).status).toBe(200);
    expect((await call(PROFILE, { as: fx.therapistA })).status).toBe(401);   // la sesión revocada no revive
    const [{ n }] = await sqlSystem((tx) => tx<{ n: number }[]>`select count(*)::int as n from patients where therapist_id = ${fx.therapistA.id}`);
    expect(n).toBe(0);
  });
});
