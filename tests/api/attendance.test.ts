// QA-02 · Integración de la API probada como dueño y como fisioterapeuta.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { call, sqlSystem, TEST_PASSWORD, type Fixtures, type TestUser } from '../helpers';
import { hashPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { addDays, localToInstant, todayIso } from '@/lib/dates';
import { GET as HOOK_GET, POST as HOOK } from '@/app/api/hik/events/[token]/route';
import { POST as POLL } from '@/app/api/bridge/poll/route';
import { POST as RESULT } from '@/app/api/bridge/result/route';
import { POST as BRIDGE_EVENTS } from '@/app/api/bridge/events/route';
import { POST as HEARTBEAT } from '@/app/api/bridge/heartbeat/route';
import { GET as DEVICES, POST as DEVICE_CREATE } from '@/app/api/devices/route';
import { PATCH as DEVICE_PATCH } from '@/app/api/devices/[id]/route';
import { GET as SECRETS, POST as SECRETS_ROTATE } from '@/app/api/devices/[id]/secrets/route';
import { POST as COMMAND } from '@/app/api/devices/[id]/command/route';
import { GET as ATT_LIST, POST as ATT_MANUAL } from '@/app/api/attendance/route';
import { POST as SIMULATE } from '@/app/api/attendance/simulate/route';
import { GET as REPORT } from '@/app/api/attendance/report/route';
import { GET as STATUS } from '@/app/api/attendance/status/route';
import { DELETE as ENROLL_DELETE, GET as ENROLL_INFO, POST as ENROLL } from '@/app/api/enrollments/route';
import { DELETE as COMMAND_CANCEL, GET as COMMAND_STATUS } from '@/app/api/enrollments/[commandId]/route';
import { queuePersonRemoval } from '@/modules/attendance/server';

const FIX = join(__dirname, '..', 'fixtures', 'hik');
const fixtureIndex = JSON.parse(readFileSync(join(FIX, 'index.json'), 'utf8')) as Record<string, { contentType: string }>;

/**
 * Mismos datos que `fixtures()` de tests/helpers.ts. Se arman aquí porque `resetData()` del helper ejecuta
 * `set local session_replication_role = replica`, que exige superusuario: con el rol `nce_admin` de la base
 * local la transacción completa falla. TRUNCATE no dispara triggers por fila, así que no hace falta.
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
    const mk = async (u: { username: string; role: 'owner' | 'therapist'; full_name: string; title?: string; location_id?: string | null; license?: string | null; physician?: boolean }): Promise<TestUser> => {
      const [row] = await tx<{ id: string }[]>`
        insert into users (username, email, password_hash, role, full_name, title, location_id, license_number, license_institution, is_physician)
        values (${u.username}, ${u.username + '@prueba.mx'}, ${hash}, ${u.role}, ${u.full_name}, ${u.title ?? ''}, ${u.location_id ?? null},
                ${u.license ?? null}, ${u.license ? 'Universidad Veracruzana' : null}, ${u.physician ?? false})
        returning id`;
      const { token } = await createSession(tx, row.id, { method: 'password' });
      return { id: row.id, role: u.role, username: u.username, token, location_id: u.location_id ?? null };
    };
    const owner = await mk({ username: 'dueno', role: 'owner', full_name: 'Nicolas Herrera' });
    const therapistA = await mk({ username: 'karla', role: 'therapist', full_name: 'Karla Ocampo', title: 'L.F.T.', location_id: cordoba, license: '11223344' });
    const therapistB = await mk({ username: 'diego', role: 'therapist', full_name: 'Diego Salinas', title: 'L.F.T.', location_id: orizaba, license: '55667788' });
    const physician = await mk({ username: 'mariana', role: 'therapist', full_name: 'Mariana Reyes', title: 'Dra.', location_id: cordoba, license: '99887766', physician: true });
    await tx`select set_config('app.user_id', ${owner.id}, true), set_config('app.user_role', 'owner', true)`;
    const patient = async (p: { name: string; birth: string; ther: string; loc: string; guardian?: string; plan: string; due: number; sessions?: number | null }) => {
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
let dev: { id: string; webhook: string; bridge: string };          // lector de Córdoba
let devOri: { id: string; webhook: string; bridge: string };       // lector de Orizaba
let emp: Record<string, string>;                                   // número de persona en el lector
const YESTERDAY = addDays(todayIso(), -1);
const at = (hhmm: string, day = YESTERDAY) => localToInstant(day, hhmm);
const iso = (d: Date) => d.toISOString();
let serial = 1000;

/** Envía un cuerpo crudo al webhook como lo haría el lector. */
async function hook(token: string, body: Uint8Array | string, contentType: string) {
  const req = new NextRequest(`http://localhost:3000/api/hik/events/${token}`, {
    method: 'POST', headers: { 'content-type': contentType }, body: body as BodyInit,
  });
  const res = await HOOK(req, { params: Promise.resolve({ token }) });
  return { status: res.status, text: await res.text() };
}
const accessJson = (o: { employeeNo?: string; time: Date; serialNo?: number | null; minor?: number }) => JSON.stringify({
  eventType: 'AccessControllerEvent', eventState: 'active', dateTime: iso(o.time),
  AccessControllerEvent: {
    deviceName: 'Access Controller', majorEventType: 5, subEventType: o.minor ?? 38,
    ...(o.employeeNo ? { employeeNoString: o.employeeNo } : {}),
    ...(o.serialNo === null ? {} : { serialNo: o.serialNo ?? ++serial }), currentVerifyMode: 'cardOrFaceOrFp',
  },
});
const multipart = (json: string, withPhoto = false) => {
  const B = 'MIME_boundary';
  const head = Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="event_log"\r\n\r\n${json}\r\n`);
  const photo = withPhoto
    ? Buffer.concat([Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="Picture"; filename="Picture.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0, 255, 13, 10, 45, 45]), Buffer.from('\r\n')])
    : Buffer.alloc(0);
  return { body: new Uint8Array(Buffer.concat([head, photo, Buffer.from(`--${B}--\r\n`)])), contentType: `multipart/form-data; boundary=${B}` };
};
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const events = (where = '') => sqlSystem((tx) => tx.unsafe<any[]>(`select * from attendance_events ${where} order by occurred_at`));
const countEvents = async () => (await events()).length;

async function createDevice(name: string, location_id: string, extra: Record<string, unknown> = {}) {
  const c = await call(DEVICE_CREATE, { as: fx.owner, body: { name, location_id, ...extra } });
  expect(c.status).toBe(200);
  const s = await call(SECRETS, { as: fx.owner, params: { id: c.data.id } });
  expect(s.status).toBe(200);
  return { id: c.data.id as string, webhook: s.data.webhook_url.split('/').pop() as string, bridge: s.data.bridge_token as string, secrets: s.data, row: c.data };
}

async function signBiometric(patientId: string, as: TestUser) {
  await sqlSystem((tx) => tx`
    insert into consents (patient_id, kind, body_snapshot, signer_name, signature_png, recorded_by)
    values (${patientId}, 'biometric', 'Consentimiento de huella', 'Firmante de Prueba', 'data:image/png;base64,AAAA', ${as.id})`);
}

beforeAll(async () => {
  fx = await fixtures();
  const d1 = await createDevice('Recepción Córdoba', fx.cordoba, { model: 'DS-K1T321EFWX-B', host: '192.168.80.212', use_https: true, password: 'Secreta123' });
  const d2 = await createDevice('Recepción Orizaba', fx.orizaba);
  dev = d1; devOri = d2;
  const rows = await sqlSystem((tx) => tx<{ id: string; no: string }[]>`
    select id, hik_employee_no as no from patients union all select id, hik_employee_no from users`);
  emp = Object.fromEntries(rows.map((r) => [r.id, r.no]));
});

describe('HUE-01 · lectores', () => {
  it('el alta genera tokens, cifra la contraseña y no devuelve secretos', async () => {
    const list = await call(DEVICES, { as: fx.owner });
    expect(list.status).toBe(200);
    expect(list.data).toHaveLength(2);
    const d = list.data.find((x: any) => x.id === dev.id);
    expect(d).toMatchObject({ name: 'Recepción Córdoba', model: 'DS-K1T321EFWX-B', host: '192.168.80.212', port: 443, use_https: true, has_password: true, online: false, bridge_online: false });
    const text = JSON.stringify(list.data);
    expect(text).not.toMatch(/token|password_enc|Secreta123/);
    expect(text).not.toContain(dev.webhook);
    const [row] = await sqlSystem((tx) => tx`select password_enc, webhook_token_hash, webhook_token_enc from devices where id = ${dev.id}`);
    expect(row.password_enc).toMatch(/^v1\./);
    expect(row.password_enc).not.toContain('Secreta123');
    expect(row.webhook_token_enc).not.toContain(dev.webhook);
    expect(row.webhook_token_hash).toHaveLength(64);
  });

  it('datos de conexión: URL del webhook, valores para el lector, config del puente y registro en bitácora', async () => {
    const s = await call(SECRETS, { as: fx.owner, params: { id: dev.id } });
    expect(s.data.webhook_url).toBe(`http://localhost:3000/api/hik/events/${dev.webhook}`);
    expect(s.data.listener).toEqual({ protocol: 'HTTP', host: 'localhost', port: 3000, path: `/api/hik/events/${dev.webhook}` });
    expect(s.data.bridge_config).toEqual({ cloud_url: 'http://localhost:3000', bridge_token: dev.bridge });
    expect(JSON.parse(s.data.bridge_config_json)).toEqual(s.data.bridge_config);
    const log = await sqlSystem((tx) => tx`select summary from audit_log where action = 'security' and row_id = ${dev.id}`);
    expect(log.length).toBeGreaterThan(0);
  });

  it('permisos: el fisioterapeuta recibe 403 en lectores, secretos y órdenes', async () => {
    expect((await call(DEVICES, { as: fx.therapistA })).status).toBe(403);
    expect((await call(DEVICE_CREATE, { as: fx.therapistA, body: { name: 'X', location_id: fx.cordoba } })).status).toBe(403);
    expect((await call(DEVICE_PATCH, { as: fx.therapistA, method: 'PATCH', body: { name: 'X' }, params: { id: dev.id } })).status).toBe(403);
    expect((await call(SECRETS, { as: fx.therapistA, params: { id: dev.id } })).status).toBe(403);
    expect((await call(COMMAND, { as: fx.therapistA, body: { kind: 'ping' }, params: { id: dev.id } })).status).toBe(403);
    expect((await call(DEVICES, { as: null })).status).toBe(401);
  });

  it('validación del alta y edición sin tocar la contraseña', async () => {
    const bad = await call(DEVICE_CREATE, { as: fx.owner, body: { name: '', location_id: fx.cordoba } });
    expect(bad.status).toBe(400);
    expect(bad.error?.fields?.name).toBeTruthy();
    const bad2 = await call(DEVICE_CREATE, { as: fx.owner, body: { name: 'L', location_id: fx.cordoba, host: 'http://1.2.3.4/' } });
    expect(bad2.status).toBe(400);
    const before = await sqlSystem((tx) => tx`select password_enc from devices where id = ${dev.id}`);
    const p = await call(DEVICE_PATCH, { as: fx.owner, method: 'PATCH', body: { name: 'Recepción Córdoba', port: 443, password: '' }, params: { id: dev.id } });
    expect(p.status).toBe(200);
    expect(p.data.has_password).toBe(true);
    const after = await sqlSystem((tx) => tx`select password_enc from devices where id = ${dev.id}`);
    expect(after[0].password_enc).toBe(before[0].password_enc);
  });

  it('regenerar el token del webhook invalida el anterior', async () => {
    const tmp = await createDevice('Temporal', fx.orizaba);
    expect((await hook(tmp.webhook, '{}', 'application/json')).status).toBe(200);
    const r = await call(SECRETS_ROTATE, { as: fx.owner, body: { regenerate: 'webhook' }, params: { id: tmp.id } });
    expect(r.status).toBe(200);
    const fresh = r.data.webhook_url.split('/').pop();
    expect(fresh).not.toBe(tmp.webhook);
    expect((await hook(tmp.webhook, '{}', 'application/json')).status).toBe(404);
    expect((await hook(fresh, '{}', 'application/json')).status).toBe(200);
    // dar de baja (no se borra): el webhook y el puente dejan de responder
    const off = await call(DEVICE_PATCH, { as: fx.owner, method: 'PATCH', body: { active: false }, params: { id: tmp.id } });
    expect(off.data.active).toBe(false);
    expect((await hook(fresh, '{}', 'application/json')).status).toBe(404);
    expect((await call(POLL, { body: { version: 't' }, headers: bearer(tmp.bridge) })).status).toBe(401);
    expect((await sqlSystem((tx) => tx`select 1 from devices where id = ${tmp.id}`)).length).toBe(1);
  });
});

describe('HUE-02/03/04 · webhook del lector', () => {
  it('token inválido → 404 genérico', async () => {
    const r = await hook('token-que-no-existe-0000000000000000', accessJson({ employeeNo: 'P1', time: at('08:00') }), 'application/json');
    expect(r.status).toBe(404);
    expect(r.text).not.toMatch(/lector|device|token/i);
    expect(await countEvents()).toBe(0);
    const g = await HOOK_GET(new NextRequest('http://localhost:3000/api/hik/events/x'), { params: Promise.resolve({ token: 'nada' }) });
    expect(g.status).toBe(404);
  });

  it('GET con token válido responde 200 (prueba de conexión del lector)', async () => {
    const g = await HOOK_GET(new NextRequest(`http://localhost:3000/api/hik/events/${dev.webhook}`), { params: Promise.resolve({ token: dev.webhook }) });
    expect(g.status).toBe(200);
  });

  it('evento válido (multipart + foto) crea la asistencia, marca la cita y descuenta la sesión del paquete', async () => {
    const when = at('10:00');
    const [appt] = await sqlSystem((tx) => tx`
      insert into appointments (patient_id, therapist_id, location_id, starts_at, duration_min, ends_at, type_name)
      values (${fx.patientA2}, ${fx.therapistA.id}, ${fx.cordoba}, ${at('10:30')}, 50, ${at('11:20')}, 'Fisioterapia') returning id`);
    const m = multipart(accessJson({ employeeNo: emp[fx.patientA2], time: when, serialNo: 501 }), true);
    const r = await hook(dev.webhook, m.body, m.contentType);
    expect(r.status).toBe(200);
    expect(r.text.length).toBeLessThan(20);
    const ev = await events(`where patient_id = '${fx.patientA2}'`);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ person_type: 'patient', source: 'device', direction: 'in', device_id: dev.id, location_id: fx.cordoba,
      appointment_id: appt.id, session_consumed: true, verify_mode: 'cardOrFaceOrFp', dedupe_key: `${dev.id}:501:${Math.floor(when.getTime() / 1000)}` });
    expect(new Date(ev[0].occurred_at).getTime()).toBe(when.getTime());
    const [a] = await sqlSystem((tx) => tx`select status, attended_at from appointments where id = ${appt.id}`);
    expect(a.status).toBe('attended');
    const [mem] = await sqlSystem((tx) => tx`select sessions_remaining from memberships where patient_id = ${fx.patientA2}`);
    expect(mem.sessions_remaining).toBe(9);
    const [d] = await sqlSystem((tx) => tx`select last_webhook_at, last_event_at from devices where id = ${dev.id}`);
    expect(d.last_webhook_at).toBeTruthy();
    expect(new Date(d.last_event_at).getTime()).toBe(when.getTime());
  });

  it('el mismo evento dos veces crea una sola asistencia (y no descuenta otra sesión)', async () => {
    const m = multipart(accessJson({ employeeNo: emp[fx.patientA2], time: at('10:00'), serialNo: 501 }), true);
    expect((await hook(dev.webhook, m.body, m.contentType)).status).toBe(200);
    expect((await hook(dev.webhook, accessJson({ employeeNo: emp[fx.patientA2], time: at('10:00'), serialNo: 501 }), 'application/json')).status).toBe(200);
    expect(await events(`where patient_id = '${fx.patientA2}'`)).toHaveLength(1);
    const [mem] = await sqlSystem((tx) => tx`select sessions_remaining from memberships where patient_id = ${fx.patientA2}`);
    expect(mem.sessions_remaining).toBe(9);
  });

  it('el mismo evento por webhook y por el puente no se duplica', async () => {
    const when = at('12:00');
    await hook(dev.webhook, accessJson({ employeeNo: emp[fx.patientA1], time: when, serialNo: 777 }), 'application/json');
    const b = await call(BRIDGE_EVENTS, { headers: bearer(dev.bridge), body: { events: [{ employee_no: emp[fx.patientA1], time: iso(when), serial_no: 777, minor: 38, verify_mode: 'fp' }] } });
    expect(b.status).toBe(200);
    expect(b.data).toMatchObject({ received: 1, created: 0 });
    const ev = await events(`where patient_id = '${fx.patientA1}'`);
    expect(ev).toHaveLength(1);
    expect(ev[0].source).toBe('device');
    // y al revés: primero el puente, luego el webhook
    const when2 = at('13:00');
    const b2 = await call(BRIDGE_EVENTS, { headers: bearer(dev.bridge), body: { events: [{ employee_no: emp[fx.patientA1], time: iso(when2), serial_no: 778, minor: 38 }] } });
    expect(b2.data.created).toBe(1);
    await hook(dev.webhook, accessJson({ employeeNo: emp[fx.patientA1], time: when2, serialNo: 778 }), 'application/json');
    const ev2 = await events(`where patient_id = '${fx.patientA1}'`);
    expect(ev2).toHaveLength(2);
    expect(ev2[1].source).toBe('bridge');
  });

  it('un número de persona desconocido queda como "unknown" para que el dueño lo vea', async () => {
    const r = await hook(dev.webhook, accessJson({ employeeNo: 'X9999', time: at('12:30') }), 'application/json');
    expect(r.status).toBe(200);
    const ev = await events(`where employee_no = 'X9999'`);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ person_type: 'unknown', patient_id: null, user_id: null, location_id: fx.cordoba });
  });

  it('latido: no crea asistencia y deja el lector en línea', async () => {
    await sqlSystem((tx) => tx`update devices set last_webhook_at = null where id = ${devOri.id}`);
    const before = await countEvents();
    expect((await call(DEVICES, { as: fx.owner })).data.find((d: any) => d.id === devOri.id).online).toBe(false);
    const r = await hook(devOri.webhook, readFileSync(join(FIX, 'heartbeat.json')), 'application/json');
    expect(r.status).toBe(200);
    expect(await countEvents()).toBe(before);
    expect((await call(DEVICES, { as: fx.owner })).data.find((d: any) => d.id === devOri.id).online).toBe(true);
    // pasado el margen de 3 minutos vuelve a "sin conexión"
    await sqlSystem((tx) => tx`update devices set last_webhook_at = now() - interval '4 minutes' where id = ${devOri.id}`);
    expect((await call(DEVICES, { as: fx.owner })).data.find((d: any) => d.id === devOri.id).online).toBe(false);
  });

  it('mal formado, puerta abierta, huella no reconocida y XML raro → 200 sin crear nada', async () => {
    const before = await countEvents();
    for (const f of ['malformed.json', 'malformed-multipart.bin', 'door-open.json', 'multipart-fingerprint-not-recognized.bin', 'heartbeat-videoloss.xml']) {
      const r = await hook(dev.webhook, new Uint8Array(readFileSync(join(FIX, f))), fixtureIndex[f].contentType);
      expect(r.status, f).toBe(200);
    }
    expect((await hook(dev.webhook, '', 'application/json')).status).toBe(200);
    expect((await hook(dev.webhook, new Uint8Array([0, 1, 2, 255]), 'application/octet-stream')).status).toBe(200);
    expect(await countEvents()).toBe(before);
  });

  it('las partes binarias se ignoran aunque contengan texto con forma de evento', async () => {
    const before = await countEvents();
    const B = 'MIME_boundary';
    const fake = accessJson({ employeeNo: emp[fx.patientB1], time: at('14:00') });
    const body = Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="Picture"; filename="Picture.jpg"\r\nContent-Type: image/jpeg\r\n\r\n${fake}\r\n--${B}--\r\n`);
    expect((await hook(dev.webhook, new Uint8Array(body), `multipart/form-data; boundary=${B}`)).status).toBe(200);
    expect(await countEvents()).toBe(before);
    // nada de la foto se guarda en ninguna parte
    const dump = await sqlSystem((tx) => tx`select coalesce(string_agg(to_jsonb(e)::text, ''), '') as t from attendance_events e`);
    expect(dump[0].t).not.toMatch(/JFIF|Picture/);
  });

  it('XML del lector también registra', async () => {
    const xml = `<EventNotificationAlert version="2.0"><dateTime>${iso(at('15:00'))}</dateTime><eventType>AccessControllerEvent</eventType>
      <AccessControllerEvent><majorEventType>5</majorEventType><subEventType>75</subEventType><employeeNoString>${emp[fx.patientB1]}</employeeNoString><serialNo>901</serialNo></AccessControllerEvent></EventNotificationAlert>`;
    expect((await hook(devOri.webhook, xml, 'application/xml')).status).toBe(200);
    const ev = await events(`where patient_id = '${fx.patientB1}'`);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ location_id: fx.orizaba, device_id: devOri.id });
  });

  it('una fecha futura (reloj del lector desfasado) no crea asistencia y avisa al dueño', async () => {
    const before = await countEvents();
    const future = new Date(Date.now() + 3 * 3600 * 1000);
    expect((await hook(dev.webhook, accessJson({ employeeNo: emp[fx.patientA1], time: future }), 'application/json')).status).toBe(200);
    expect(await countEvents()).toBe(before);
    const [d] = await sqlSystem((tx) => tx`select last_error from devices where id = ${dev.id}`);
    expect(d.last_error).toMatch(/hora/i);
  });

  it('rechaza cuerpos de texto mayores a 2 MB', async () => {
    const big = JSON.stringify({ eventType: 'x', relleno: 'a'.repeat(2 * 1024 * 1024 + 10) });
    expect((await hook(dev.webhook, big, 'application/json')).status).toBe(413);
  });
});

describe('HUE-09 · entrada/salida', () => {
  const day = addDays(todayIso(), -2);
  it('personal: entrada, salida, entrada; el rebote de 60 s cuenta como una sola', async () => {
    const no = emp[fx.therapistA.id];
    for (const t of ['08:00', '14:00', '15:00']) {
      await hook(dev.webhook, accessJson({ employeeNo: no, time: at(t, day) }), 'application/json');
    }
    // rebote: 20 s después de la última, con otro serialNo
    await hook(dev.webhook, accessJson({ employeeNo: no, time: new Date(at('15:00', day).getTime() + 20000) }), 'application/json');
    const ev = await events(`where user_id = '${fx.therapistA.id}'`);
    expect(ev.map((e) => e.direction)).toEqual(['in', 'out', 'in']);
    expect(ev[0]).toMatchObject({ person_type: 'staff', person_name: 'L.F.T. Karla Ocampo' });
  });

  it('paciente: siempre entrada por defecto', async () => {
    const no = emp[fx.patientA1];
    await hook(dev.webhook, accessJson({ employeeNo: no, time: at('09:00', day) }), 'application/json');
    await hook(dev.webhook, accessJson({ employeeNo: no, time: at('10:00', day) }), 'application/json');
    await hook(dev.webhook, accessJson({ employeeNo: no, time: new Date(at('10:00', day).getTime() + 30000) }), 'application/json'); // rebote
    const ev = (await events(`where patient_id = '${fx.patientA1}'`)).filter((e) => new Date(e.occurred_at) < at('00:00'));
    expect(ev.map((e) => e.direction)).toEqual(['in', 'in']);
  });
});

describe('HUE-05/06 · protocolo del agente puente', () => {
  it('token inválido o ausente → 401 en todas las rutas', async () => {
    for (const [h, body] of [[POLL, { version: '1' }], [RESULT, { command_id: '00000000-0000-4000-8000-000000000000', ok: true }], [BRIDGE_EVENTS, { events: [] }], [HEARTBEAT, {}]] as const) {
      expect((await call(h, { body, headers: bearer('token-falso-000000000000000000000000') })).status).toBe(401);
      expect((await call(h, { body })).status).toBe(401);
      // el token del webhook no sirve como token del puente
      expect((await call(h, { body, headers: bearer(dev.webhook) })).status).toBe(401);
    }
  });

  it('poll marca al puente en línea, entrega la configuración y pasa las órdenes a running', async () => {
    await sqlSystem((tx) => tx`update devices set bridge_seen_at = now() - interval '5 minutes' where id = ${dev.id}`);
    const c1 = await call(COMMAND, { as: fx.owner, body: { kind: 'ping' }, params: { id: dev.id } });
    expect(c1.status).toBe(200);
    expect(c1.data.bridge_online).toBe(false);
    const dup = await call(COMMAND, { as: fx.owner, body: { kind: 'ping' }, params: { id: dev.id } });
    expect(dup.data.command_id).toBe(c1.data.command_id); // no se apila la misma orden
    const c2 = await call(COMMAND, { as: fx.owner, body: { kind: 'sync_time' }, params: { id: dev.id } });

    const p = await call(POLL, { headers: bearer(dev.bridge), body: { version: '1.0.0', device_reachable: true, device_info: { firmware: 'V3.9.50 build 260130', serial: 'FX1234567' } } });
    expect(p.status).toBe(200);
    expect(p.data.commands.map((c: any) => c.kind)).toEqual(['ping', 'sync_time']);
    expect(p.data.commands[0].id).toBe(c1.data.command_id);
    expect(p.data.config).toMatchObject({ host: '192.168.80.212', port: 443, use_https: true, username: 'admin', password: 'Secreta123', poll_seconds: 2 });
    const rows = await sqlSystem((tx) => tx`select status, started_at from device_commands where id in (${c1.data.command_id}, ${c2.data.command_id})`);
    expect(rows.every((r) => r.status === 'running' && r.started_at)).toBe(true);

    const d = (await call(DEVICES, { as: fx.owner })).data.find((x: any) => x.id === dev.id);
    expect(d).toMatchObject({ bridge_online: true, online: true, firmware: 'V3.9.50 build 260130', serial: 'FX1234567', bridge_version: '1.0.0' });

    // segunda consulta: ya no hay pendientes
    const p2 = await call(POLL, { headers: bearer(dev.bridge), body: { version: '1.0.0' } });
    expect(p2.data.commands).toEqual([]);

    // el dueño ve la orden en curso; otro usuario no
    const st = await call(COMMAND_STATUS, { as: fx.owner, params: { commandId: c1.data.command_id } });
    expect(st.data).toMatchObject({ status: 'running', kind: 'ping', bridge_online: true });
    expect((await call(COMMAND_STATUS, { as: fx.therapistA, params: { commandId: c1.data.command_id } })).status).toBe(404);

    // resultado de ping: guarda modelo, serie y firmware
    const r = await call(RESULT, { headers: bearer(dev.bridge), body: { command_id: c1.data.command_id, ok: true, result: { model: 'DS-K1T321EFWX-B', serial: 'FX1234567', firmware: 'V3.9.50 build 260130' } } });
    expect(r.status).toBe(200);
    const st2 = await call(COMMAND_STATUS, { as: fx.owner, params: { commandId: c1.data.command_id } });
    expect(st2.data).toMatchObject({ status: 'done', error: null, result: { model: 'DS-K1T321EFWX-B' } });
    // sync_time ok → last_sync_at
    await call(RESULT, { headers: bearer(dev.bridge), body: { command_id: c2.data.command_id, ok: true, result: {} } });
    const d2 = (await call(DEVICES, { as: fx.owner })).data.find((x: any) => x.id === dev.id);
    expect(d2.last_sync_at).toBeTruthy();
    expect(d2.model).toBe('DS-K1T321EFWX-B');
    // reenviar un resultado ya cerrado no rompe nada
    const again = await call(RESULT, { headers: bearer(dev.bridge), body: { command_id: c1.data.command_id, ok: false, error: 'x' } });
    expect(again.data.already_closed).toBe(true);
    // un puente no puede cerrar órdenes de otro lector
    const c3 = await call(COMMAND, { as: fx.owner, body: { kind: 'ping' }, params: { id: dev.id } });
    expect((await call(RESULT, { headers: bearer(devOri.bridge), body: { command_id: c3.data.command_id, ok: true } })).status).toBe(404);
    await call(POLL, { headers: bearer(dev.bridge), body: { version: '1.0.0' } });
    await call(RESULT, { headers: bearer(dev.bridge), body: { command_id: c3.data.command_id, ok: false, error: 'device_unreachable: ECONNREFUSED' } });
    const st3 = await call(COMMAND_STATUS, { as: fx.owner, params: { commandId: c3.data.command_id } });
    expect(st3.data).toMatchObject({ status: 'error', error_code: 'device_unreachable' });
    expect(st3.data.error).toMatch(/no pudo conectarse al lector/);
  });

  it('una orden running sin respuesta vuelve a pending hasta 3 intentos y luego queda en error', async () => {
    const c = await call(COMMAND, { as: fx.owner, body: { kind: 'sync_time' }, params: { id: devOri.id } });
    const id = c.data.command_id;
    const age = () => sqlSystem((tx) => tx`update device_commands set started_at = now() - interval '3 minutes' where id = ${id}`);
    for (let i = 1; i <= 3; i++) {
      const p = await call(POLL, { headers: bearer(devOri.bridge), body: { version: '1' } });
      expect(p.data.commands.map((x: any) => x.id), `intento ${i}`).toEqual([id]);
      await age();
    }
    const p4 = await call(POLL, { headers: bearer(devOri.bridge), body: { version: '1' } });
    expect(p4.data.commands).toEqual([]);
    const st = await call(COMMAND_STATUS, { as: fx.owner, params: { commandId: id } });
    expect(st.data).toMatchObject({ status: 'error', error_code: 'no_response' });
  });

  it('backfill: valida el rango y lo entrega como instantes', async () => {
    expect((await call(COMMAND, { as: fx.owner, body: { kind: 'backfill_events', payload: { from: '2026-10-07', to: '2026-10-01' } }, params: { id: devOri.id } })).status).toBe(400);
    const c = await call(COMMAND, { as: fx.owner, body: { kind: 'backfill_events', payload: { from: '2026-10-01', to: '2026-10-02' } }, params: { id: devOri.id } });
    const p = await call(POLL, { headers: bearer(devOri.bridge), body: { version: '1' } });
    expect(p.data.commands[0]).toMatchObject({ id: c.data.command_id, kind: 'backfill_events', payload: { from: '2026-10-01T06:00:00.000Z', to: '2026-10-03T05:59:59.000Z' } });
    await call(RESULT, { headers: bearer(devOri.bridge), body: { command_id: c.data.command_id, ok: true, result: { sent: 0 } } });
  });

  it('configure_listener entrega la URL del webhook y no la conserva al terminar', async () => {
    const c = await call(COMMAND, { as: fx.owner, body: { kind: 'configure_listener' }, params: { id: devOri.id } });
    const p = await call(POLL, { headers: bearer(devOri.bridge), body: { version: '1' } });
    expect(p.data.commands[0].payload).toMatchObject({ webhook_url: `http://localhost:3000/api/hik/events/${devOri.webhook}`, host: 'localhost', port: 3000, protocol: 'HTTP' });
    await call(RESULT, { headers: bearer(devOri.bridge), body: { command_id: c.data.command_id, ok: false, error: 'listener_not_supported: 400' } });
    const [row] = await sqlSystem((tx) => tx`select payload from device_commands where id = ${c.data.command_id}`);
    expect(row.payload).toEqual({});
    const st = await call(COMMAND_STATUS, { as: fx.owner, params: { commandId: c.data.command_id } });
    expect(st.data.error).toMatch(/a mano/);
    expect(JSON.stringify(st.data)).not.toContain(devOri.webhook);
  });

  it('eventos del puente: registra los válidos, ignora los demás y marca al lector alcanzable', async () => {
    const b = await call(BRIDGE_EVENTS, { headers: bearer(devOri.bridge), body: { events: [
      { employee_no: emp[fx.therapistB.id], time: iso(at('08:00')), serial_no: 3001, minor: 38, verify_mode: 'fp' },
      { employee_no: emp[fx.therapistB.id], time: iso(at('08:00')), serial_no: 3001, minor: 38, verify_mode: 'fp' }, // repetido en el mismo lote
      { employee_no: null, time: iso(at('08:01')), serial_no: 3002, minor: 21 },                                    // puerta
      { employee_no: emp[fx.therapistB.id], time: 'no-es-fecha', serial_no: 3003, minor: 38 },
    ] } });
    expect(b.data).toEqual({ received: 4, created: 1, ignored: 3 });
    const ev = await events(`where user_id = '${fx.therapistB.id}'`);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ source: 'bridge', location_id: fx.orizaba, direction: 'in' });
    expect((await call(BRIDGE_EVENTS, { headers: bearer(devOri.bridge), body: { events: 'x' } })).status).toBe(400);
  });
});

describe('HUE-07 / HUE-13 · enrolamiento', () => {
  it('paciente sin consentimiento de huella → 409 consent_required', async () => {
    const r = await call(ENROLL, { as: fx.therapistA, body: { person_type: 'patient', person_id: fx.patientA1 } });
    expect(r.status).toBe(409);
    expect(r.error).toMatchObject({ code: 'consent_required', message: 'Falta firmar el consentimiento de huella.' });
    const info = await call(ENROLL_INFO, { as: fx.therapistA, url: `/api/enrollments?person_type=patient&person_id=${fx.patientA1}` });
    expect(info.data).toMatchObject({ has_consent: false, enrolled_at: null, device: { name: 'Recepción Córdoba' } });
  });

  it('el fisioterapeuta B no puede enrolar ni consultar al paciente de A', async () => {
    await signBiometric(fx.patientA1, fx.therapistA);
    expect((await call(ENROLL, { as: fx.therapistB, body: { person_type: 'patient', person_id: fx.patientA1 } })).status).toBe(404);
    expect((await call(ENROLL_INFO, { as: fx.therapistB, url: `/api/enrollments?person_type=patient&person_id=${fx.patientA1}` })).status).toBe(404);
    expect((await call(ENROLL_DELETE, { as: fx.therapistB, method: 'DELETE', body: { person_type: 'patient', person_id: fx.patientA1 } })).status).toBe(404);
    // tampoco la huella de otro miembro del equipo
    expect((await call(ENROLL, { as: fx.therapistB, body: { person_type: 'staff', person_id: fx.therapistA.id } })).status).toBe(403);
    expect((await call(ENROLL, { as: null, body: { person_type: 'patient', person_id: fx.patientA1 } })).status).toBe(401);
    const [n] = await sqlSystem((tx) => tx`select count(*)::int as n from device_commands where kind = 'enroll_fingerprint'`);
    expect(n.n).toBe(0);
  });

  it('con consentimiento: encola la orden, el puente la ejecuta y el resultado marca la huella', async () => {
    const r = await call(ENROLL, { as: fx.therapistA, body: { person_type: 'patient', person_id: fx.patientA1 } });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ device_name: 'Recepción Córdoba', device_id: dev.id });
    expect(typeof r.data.bridge_online).toBe('boolean');
    // doble clic: misma orden
    const again = await call(ENROLL, { as: fx.therapistA, body: { person_type: 'patient', person_id: fx.patientA1 } });
    expect(again.data.command_id).toBe(r.data.command_id);

    const st = await call(COMMAND_STATUS, { as: fx.therapistA, params: { commandId: r.data.command_id } });
    expect(st.data).toMatchObject({ status: 'pending', kind: 'enroll_fingerprint' });
    expect((await call(COMMAND_STATUS, { as: fx.therapistB, params: { commandId: r.data.command_id } })).status).toBe(404);

    const p = await call(POLL, { headers: bearer(dev.bridge), body: { version: '1.0.0' } });
    const cmd = p.data.commands.find((c: any) => c.id === r.data.command_id);
    expect(cmd).toMatchObject({ kind: 'enroll_fingerprint', payload: { employee_no: emp[fx.patientA1], name: 'Ana Prueba Uno', finger_no: 1 } });

    const res = await call(RESULT, { headers: bearer(dev.bridge), body: { command_id: r.data.command_id, ok: true, result: { quality: 82, finger_no: 1 } } });
    expect(res.status).toBe(200);
    const [pat] = await sqlSystem((tx) => tx`select fingerprint_enrolled_at from patients where id = ${fx.patientA1}`);
    expect(pat.fingerprint_enrolled_at).toBeTruthy();
    const enr = await sqlSystem((tx) => tx`select status, enrolled_at, employee_no from enrollments where patient_id = ${fx.patientA1}`);
    expect(enr).toHaveLength(1);
    expect(enr[0]).toMatchObject({ status: 'enrolled', employee_no: emp[fx.patientA1] });
    const done = await call(COMMAND_STATUS, { as: fx.therapistA, params: { commandId: r.data.command_id } });
    expect(done.data).toMatchObject({ status: 'done', result: { quality: 82 } });
    const info = await call(ENROLL_INFO, { as: fx.therapistA, url: `/api/enrollments?person_type=patient&person_id=${fx.patientA1}` });
    expect(info.data.enrolled_at).toBeTruthy();
    expect(info.data.enrollments).toMatchObject([{ status: 'enrolled', device_name: 'Recepción Córdoba' }]);
  });

  it('HUE-16 · un resultado con fingerData se rechaza, no se guarda y queda como incidente de seguridad', async () => {
    await signBiometric(fx.patientA2, fx.therapistA);
    const r = await call(ENROLL, { as: fx.therapistA, body: { person_type: 'patient', person_id: fx.patientA2 } });
    await call(POLL, { headers: bearer(dev.bridge), body: { version: '1.0.0' } });
    const secret = 'UExBTlRJTExBX0RFX0hVRUxMQV9TRUNSRVRB';
    const res = await call(RESULT, { headers: bearer(dev.bridge), body: { command_id: r.data.command_id, ok: true, result: { quality: 80, capture: { fingerData: secret } } } });
    expect(res.status).toBe(400);
    expect(res.error?.code).toBe('biometric_rejected');
    const [cmd] = await sqlSystem((tx) => tx`select status, result::text as result, error, payload::text as payload from device_commands where id = ${r.data.command_id}`);
    expect(cmd.status).toBe('error');
    expect(`${cmd.result}${cmd.error}${cmd.payload}`).not.toContain(secret);
    const [pat] = await sqlSystem((tx) => tx`select fingerprint_enrolled_at from patients where id = ${fx.patientA2}`);
    expect(pat.fingerprint_enrolled_at).toBeNull();
    const log = await sqlSystem((tx) => tx`select summary, patient_id from audit_log where action = 'security' and row_id = ${r.data.command_id}`);
    expect(log).toHaveLength(1);
    expect(log[0].summary).toMatch(/biométricos/);
    // en ninguna tabla quedó la plantilla
    const [all] = await sqlSystem((tx) => tx`
      select (select coalesce(string_agg(to_jsonb(c)::text, ''), '') from device_commands c)
          || (select coalesce(string_agg(to_jsonb(a)::text, ''), '') from audit_log a)
          || (select coalesce(string_agg(to_jsonb(e)::text, ''), '') from enrollments e) as t`);
    expect(all.t).not.toContain(secret);
    // también en la raíz del cuerpo
    const r2 = await call(ENROLL, { as: fx.therapistA, body: { person_type: 'patient', person_id: fx.patientA2 } });
    await call(POLL, { headers: bearer(dev.bridge), body: { version: '1.0.0' } });
    expect((await call(RESULT, { headers: bearer(dev.bridge), body: { command_id: r2.data.command_id, ok: true, fingerData: secret } })).status).toBe(400);
  });

  it('error del lector: se traduce y el enrolamiento queda fallido', async () => {
    const r = await call(ENROLL, { as: fx.therapistA, body: { person_type: 'patient', person_id: fx.patientA2 } });
    await call(POLL, { headers: bearer(dev.bridge), body: { version: '1.0.0' } });
    await call(RESULT, { headers: bearer(dev.bridge), body: { command_id: r.data.command_id, ok: false, error: 'capture_timeout' } });
    const st = await call(COMMAND_STATUS, { as: fx.therapistA, params: { commandId: r.data.command_id } });
    expect(st.data).toMatchObject({ status: 'error', error_code: 'capture_timeout' });
    expect(st.data.error).toMatch(/agotó el tiempo/);
    const enr = await sqlSystem((tx) => tx`select status from enrollments where patient_id = ${fx.patientA2}`);
    expect(enr[0].status).toBe('failed');
  });

  it('un enrolamiento en cola se puede cancelar y caduca si el puente no lo toma', async () => {
    const r = await call(ENROLL, { as: fx.therapistA, body: { person_type: 'patient', person_id: fx.patientA2 } });
    expect((await call(COMMAND_CANCEL, { as: fx.therapistB, method: 'DELETE', params: { commandId: r.data.command_id } })).status).toBe(404);
    const c = await call(COMMAND_CANCEL, { as: fx.therapistA, method: 'DELETE', params: { commandId: r.data.command_id } });
    expect(c.data.cancelled).toBe(true);
    expect((await call(POLL, { headers: bearer(dev.bridge), body: { version: '1' } })).data.commands).toEqual([]);

    const r2 = await call(ENROLL, { as: fx.therapistA, body: { person_type: 'patient', person_id: fx.patientA2 } });
    await sqlSystem((tx) => tx`update device_commands set created_at = now() - interval '11 minutes' where id = ${r2.data.command_id}`);
    expect((await call(POLL, { headers: bearer(dev.bridge), body: { version: '1' } })).data.commands).toEqual([]);
    const st = await call(COMMAND_STATUS, { as: fx.therapistA, params: { commandId: r2.data.command_id } });
    expect(st.data).toMatchObject({ status: 'error', error_code: 'expired' });
  });

  it('personal: el propio usuario y el dueño pueden; sin lector en la sede → 409', async () => {
    const self = await call(ENROLL, { as: fx.therapistB, body: { person_type: 'staff', person_id: fx.therapistB.id } });
    expect(self.status).toBe(200);
    expect(self.data.device_name).toBe('Recepción Orizaba');
    const byOwner = await call(ENROLL, { as: fx.owner, body: { person_type: 'staff', person_id: fx.therapistA.id } });
    expect(byOwner.status).toBe(200);
    await call(POLL, { headers: bearer(dev.bridge), body: { version: '1' } });
    await call(RESULT, { headers: bearer(dev.bridge), body: { command_id: byOwner.data.command_id, ok: true, result: {} } });
    const [u] = await sqlSystem((tx) => tx`select fingerprint_enrolled_at from users where id = ${fx.therapistA.id}`);
    expect(u.fingerprint_enrolled_at).toBeTruthy();

    await sqlSystem((tx) => tx`update devices set active = false where id = ${devOri.id}`);
    await signBiometric(fx.patientB1, fx.therapistB);
    const none = await call(ENROLL, { as: fx.therapistB, body: { person_type: 'patient', person_id: fx.patientB1 } });
    expect(none.status).toBe(409);
    expect(none.error?.message).toBe('No hay un lector activo en la sede.');
    await sqlSystem((tx) => tx`update devices set active = true where id = ${devOri.id}`);
  });

  it('HUE-13 · eliminar huella: encola delete_person y al confirmar limpia la marca', async () => {
    const del = await call(ENROLL_DELETE, { as: fx.therapistA, method: 'DELETE', body: { person_type: 'patient', person_id: fx.patientA1 } });
    expect(del.status).toBe(200);
    expect(del.data.command_ids).toHaveLength(1);
    const p = await call(POLL, { headers: bearer(dev.bridge), body: { version: '1' } });
    const cmd = p.data.commands.find((c: any) => c.id === del.data.command_id);
    expect(cmd).toMatchObject({ kind: 'delete_person', payload: { employee_no: emp[fx.patientA1] } });
    // mientras el lector no confirma, sigue marcada
    expect((await sqlSystem((tx) => tx`select fingerprint_enrolled_at from patients where id = ${fx.patientA1}`))[0].fingerprint_enrolled_at).toBeTruthy();
    await call(RESULT, { headers: bearer(dev.bridge), body: { command_id: del.data.command_id, ok: true, result: {} } });
    expect((await sqlSystem((tx) => tx`select fingerprint_enrolled_at from patients where id = ${fx.patientA1}`))[0].fingerprint_enrolled_at).toBeNull();
    expect((await sqlSystem((tx) => tx`select status, removed_at from enrollments where patient_id = ${fx.patientA1}`))[0]).toMatchObject({ status: 'removed' });
  });

  it('HUE-13 · queuePersonRemoval para otros módulos (baja de usuario)', async () => {
    const r = await sqlSystem((tx) => queuePersonRemoval(tx, { personType: 'staff', personId: fx.therapistA.id }));
    expect(r.command_ids).toHaveLength(1);
    const again = await sqlSystem((tx) => queuePersonRemoval(tx, { personType: 'staff', personId: fx.therapistA.id }));
    expect(again.command_ids).toEqual(r.command_ids); // idempotente
    const [c] = await sqlSystem((tx) => tx`select kind, status, user_id, payload from device_commands where id = ${r.command_ids[0]}`);
    expect(c).toMatchObject({ kind: 'delete_person', status: 'pending', user_id: fx.therapistA.id, payload: { employee_no: emp[fx.therapistA.id] } });
    // persona sin alta en ningún lector: no encola nada
    const none = await sqlSystem((tx) => queuePersonRemoval(tx, { personType: 'patient', personId: fx.patientB1 }));
    expect(none.command_ids).toEqual([]);
  });
});

describe('HUE-10 / HUE-15 · consulta de asistencias', () => {
  it('visibilidad por sede y rol', async () => {
    const all = await call(ATT_LIST, { as: fx.owner, url: `/api/attendance?date=${YESTERDAY}` });
    expect(all.status).toBe(200);
    expect(all.data.date).toBe(YESTERDAY);
    expect(all.data.total).toBe(all.data.items.length);
    const types = new Set(all.data.items.map((i: any) => i.person_type));
    expect(types).toEqual(new Set(['patient', 'staff', 'unknown']));
    // orden: la más reciente arriba
    const times = all.data.items.map((i: any) => new Date(i.occurred_at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    const a = await call(ATT_LIST, { as: fx.therapistA, url: `/api/attendance?date=${YESTERDAY}` });
    expect(a.data.items.length).toBeGreaterThan(0);
    expect(a.data.items.every((i: any) => i.location_id === fx.cordoba)).toBe(true);
    expect(a.data.items.some((i: any) => i.person_type === 'unknown')).toBe(false); // los no reconocidos son del dueño
    expect(a.data.items.some((i: any) => i.patient_id === fx.patientB1)).toBe(false);

    const b = await call(ATT_LIST, { as: fx.therapistB, url: `/api/attendance?date=${YESTERDAY}` });
    expect(b.data.items.every((i: any) => i.location_id === fx.orizaba)).toBe(true);
    expect(b.data.items.some((i: any) => i.patient_id === fx.patientB1)).toBe(true);
    expect(b.data.items.some((i: any) => i.patient_id === fx.patientA1)).toBe(false);

    expect((await call(ATT_LIST, { as: null, url: '/api/attendance' })).status).toBe(401);
    expect((await call(ATT_LIST, { as: fx.owner, url: '/api/attendance?date=ayer' })).status).toBe(400);
  });

  it('filtros por rol, sede y persona; incluye sede, rol y estado de pago', async () => {
    const staff = await call(ATT_LIST, { as: fx.owner, url: `/api/attendance?date=${YESTERDAY}&role=staff` });
    expect(staff.data.items.length).toBeGreaterThan(0);
    expect(staff.data.items.every((i: any) => i.person_type === 'staff')).toBe(true);
    expect(staff.data.items[0]).toMatchObject({ role_label: 'Fisioterapeuta', location_name: 'Orizaba', billing_state: null });
    const ori = await call(ATT_LIST, { as: fx.owner, url: `/api/attendance?date=${YESTERDAY}&location_id=${fx.orizaba}` });
    expect(ori.data.items.every((i: any) => i.location_name === 'Orizaba')).toBe(true);
    // HUE-15: la paciente con mensualidad vencida llega marcada
    const b1 = ori.data.items.find((i: any) => i.patient_id === fx.patientB1);
    expect(b1).toMatchObject({ billing_state: 'vencido', role_label: 'Paciente', person_name: 'Carmen Prueba Tres', direction: 'in' });
    const hist = await call(ATT_LIST, { as: fx.therapistA, url: `/api/attendance?patient_id=${fx.patientA1}` });
    expect(hist.data.date).toBeNull();
    expect(hist.data.items.length).toBeGreaterThanOrEqual(4);
    expect(hist.data.items.every((i: any) => i.patient_id === fx.patientA1 && i.billing_state === 'pagado')).toBe(true);
    const limited = await call(ATT_LIST, { as: fx.therapistA, url: `/api/attendance?patient_id=${fx.patientA1}&limit=2` });
    expect(limited.data.items).toHaveLength(2);
    expect(limited.data.total).toBeGreaterThanOrEqual(4);
  });

  it('estado del lector: el fisioterapeuta ve el de su sede, sin datos de red', async () => {
    const a = await call(STATUS, { as: fx.therapistA });
    expect(a.status).toBe(200);
    expect(a.data.devices).toHaveLength(1);
    expect(a.data.devices[0]).toMatchObject({ name: 'Recepción Córdoba', location_name: 'Córdoba', last_error: null });
    expect(typeof a.data.devices[0].online).toBe('boolean');
    expect(JSON.stringify(a.data)).not.toMatch(/192\.168|host|username|token/);
    expect(a.data.devices[0].last_read.person_name).toBeTruthy();
    const o = await call(STATUS, { as: fx.owner });
    expect(o.data.devices.map((d: any) => d.location_name).sort()).toEqual(['Córdoba', 'Orizaba']);
  });
});

describe('HUE-11 · registro manual', () => {
  it('exige motivo', async () => {
    const r = await call(ATT_MANUAL, { as: fx.owner, body: { person_type: 'patient', person_id: fx.patientA1 } });
    expect(r.status).toBe(400);
    expect(r.error?.fields?.reason).toBe('Escribe el motivo del registro manual.');
    const r2 = await call(ATT_MANUAL, { as: fx.owner, body: { person_type: 'patient', person_id: fx.patientA1, reason: '  ' } });
    expect(r2.status).toBe(400);
  });

  it('el fisioterapeuta registra a su paciente en su sede; queda auditado', async () => {
    const r = await call(ATT_MANUAL, { as: fx.therapistA, body: { person_type: 'patient', person_id: fx.patientA1, reason: 'El lector no reconoció la huella', location_id: fx.orizaba } });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ source: 'manual', manual_reason: 'El lector no reconoció la huella', location_id: fx.cordoba, person_name: 'Ana Prueba Uno', recorded_by_name: 'L.F.T. Karla Ocampo', direction: 'in' });
    const [row] = await sqlSystem((tx) => tx`select recorded_by, device_id from attendance_events where id = ${r.data.id}`);
    expect(row).toMatchObject({ recorded_by: fx.therapistA.id, device_id: null });
    const log = await sqlSystem((tx) => tx`select actor_id from audit_log where table_name = 'attendance_events' and row_id = ${r.data.id}`);
    expect(log).toMatchObject([{ actor_id: fx.therapistA.id }]);
    // de inmediato otra vez: rebote → 409
    const dup = await call(ATT_MANUAL, { as: fx.therapistA, body: { person_type: 'patient', person_id: fx.patientA1, reason: 'Repetido por error' } });
    expect(dup.status).toBe(409);
  });

  it('permisos: no a pacientes de otro, no al personal; el dueño sí', async () => {
    expect((await call(ATT_MANUAL, { as: fx.therapistA, body: { person_type: 'patient', person_id: fx.patientB1, reason: 'Intento' } })).status).toBe(404);
    expect((await call(ATT_MANUAL, { as: fx.therapistA, body: { person_type: 'staff', person_id: fx.therapistA.id, reason: 'Olvidé checar' } })).status).toBe(403);
    const o = await call(ATT_MANUAL, { as: fx.owner, body: { person_type: 'staff', person_id: fx.therapistB.id, reason: 'Olvidó checar la entrada', time: '00:00' } });
    expect(o.status).toBe(200);
    expect(o.data).toMatchObject({ person_type: 'staff', location_id: fx.orizaba, source: 'manual' });
    expect(new Date(o.data.occurred_at).getTime()).toBe(localToInstant(todayIso(), '00:00').getTime());
    expect((await call(ATT_MANUAL, { as: fx.owner, body: { person_type: 'patient', person_id: fx.patientB1, reason: 'Hora mala', time: '25:00' } })).status).toBe(400);
    expect((await call(ATT_MANUAL, { as: null, body: { person_type: 'patient', person_id: fx.patientB1, reason: 'Sin sesión' } })).status).toBe(401);
  });
});

describe('HUE-14 · simulador', () => {
  it('en desarrollo registra una lectura de un paciente visible', async () => {
    const r = await call(SIMULATE, { as: fx.therapistB, body: {} });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ source: 'simulator', patient_id: fx.patientB1, person_name: 'Carmen Prueba Tres', billing_state: 'vencido' });
    expect((await call(SIMULATE, { as: fx.therapistB, body: { patient_id: fx.patientA1 } })).status).toBe(404);
    expect((await call(SIMULATE, { as: null, body: {} })).status).toBe(401);
  });

  it('con APP_ENV=production la ruta responde 404', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, {
      APP_ENV: 'production', ENABLE_SIMULATOR: 'true', STORAGE_DRIVER: 'supabase',
      SUPABASE_URL: 'https://ejemplo.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
    });
    vi.resetModules();
    try {
      const { simulatorEnabled } = await import('@/lib/env');
      expect(simulatorEnabled()).toBe(false);
      const prod = await import('@/app/api/attendance/simulate/route');
      const before = await countEvents();
      const r = await call(prod.POST, { as: fx.owner, body: {} });
      expect(r.status).toBe(404);
      expect(await countEvents()).toBe(before);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
      vi.resetModules();
    }
  });
});

describe('HUE-12 · reporte', () => {
  const day = addDays(todayIso(), -2);
  it('solo el dueño', async () => {
    expect((await call(REPORT, { as: fx.therapistA, url: '/api/attendance/report' })).status).toBe(403);
    expect((await call(REPORT, { as: null, url: '/api/attendance/report' })).status).toBe(401);
  });

  it('horas por persona y día: pares completos suman, la entrada sin salida sale incompleta', async () => {
    // HUE-09 dejó a Karla con entrada 08:00, salida 14:00 y entrada 15:00 (sin salida) hace dos días.
    const r = await call(REPORT, { as: fx.owner, url: `/api/attendance/report?from=${day}&to=${day}` });
    expect(r.status).toBe(200);
    const karla = r.data.staff.find((s: any) => s.user_id === fx.therapistA.id);
    expect(karla).toMatchObject({ person_name: 'L.F.T. Karla Ocampo', location_name: 'Córdoba', total_minutes: 360, incomplete_days: 1 });
    expect(karla.days).toEqual([{ date: day, first_in: '08:00', last_out: '14:00', minutes: 360, pairs: 1, incomplete: true }]);
    expect(karla.weeks).toHaveLength(1);
    expect(karla.weeks[0].minutes).toBe(360);
    const ana = r.data.patients.find((p: any) => p.patient_id === fx.patientA1);
    expect(ana).toMatchObject({ visits: 2, days: 1, person_name: 'Ana Prueba Uno' });
    expect(r.data.totals).toMatchObject({ staff_minutes: 360, incomplete_days: 1 });

    // al cerrar el día con una salida, las horas se completan
    await hook(dev.webhook, accessJson({ employeeNo: emp[fx.therapistA.id], time: at('19:30', day) }), 'application/json');
    const r2 = await call(REPORT, { as: fx.owner, url: `/api/attendance/report?from=${day}&to=${day}&location_id=${fx.cordoba}` });
    const k2 = r2.data.staff.find((s: any) => s.user_id === fx.therapistA.id);
    expect(k2.days[0]).toMatchObject({ minutes: 630, pairs: 2, incomplete: false, last_out: '19:30' });
    const other = await call(REPORT, { as: fx.owner, url: `/api/attendance/report?from=${day}&to=${day}&location_id=${fx.orizaba}` });
    expect(other.data.staff.find((s: any) => s.user_id === fx.therapistA.id)).toBeUndefined();
  });

  it('CSV UTF-8 con BOM y registro de la exportación', async () => {
    const r = await call(REPORT, { as: fx.owner, url: `/api/attendance/report?from=${day}&to=${todayIso()}&format=csv` });
    expect(r.status).toBe(200);
    expect(r.res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(r.res.headers.get('content-disposition')).toContain(`asistencia_${day}_a_${todayIso()}.csv`);
    const bytes = new Uint8Array(await r.res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('Persona,Sede,Fecha,Primera entrada,Última salida,Horas trabajadas,Minutos,Estado');
    expect(text).toMatch(/L\.F\.T\. Karla Ocampo,Córdoba,\d{2}\/\d{2}\/\d{4},08:00,19:30,10:30,630,Completo/);
    expect(text).toContain('Ana Prueba Uno');
    const log = await sqlSystem((tx) => tx`select 1 from audit_log where action = 'export' and table_name = 'attendance_events'`);
    expect(log.length).toBe(1);
  });

  it('valida el rango', async () => {
    expect((await call(REPORT, { as: fx.owner, url: '/api/attendance/report?from=2026-10-07&to=2026-10-01' })).status).toBe(400);
    const def = await call(REPORT, { as: fx.owner, url: '/api/attendance/report' });
    expect(def.status).toBe(200);
    expect(def.data.from <= todayIso() && def.data.to >= todayIso()).toBe(true);
  });
});

afterAll(async () => {
  // deja la base utilizable por otra corrida
  await sqlSystem((tx) => tx`update devices set active = true`);
});

describe('lector real · personas existentes y registro en la pantalla del lector', () => {
  it('progress: el agente avisa que la huella se registra en el lector y la pantalla lo ve', async () => {
    const { POST: PROGRESS } = await import('@/app/api/bridge/progress/route');
    await signBiometric(fx.patientA2, fx.therapistA);
    const e = await call(ENROLL, { as: fx.therapistA, body: { person_type: 'patient', person_id: fx.patientA2, device_id: dev.id } });
    expect(e.status).toBe(200);
    await call(POLL, { headers: bearer(dev.bridge), body: { version: 't' } }); // el agente toma la orden
    const p = await call(PROGRESS, { headers: bearer(dev.bridge), body: { command_id: e.data.command_id, stage: 'on_device', employee_no: emp[fx.patientA2] } });
    expect(p.status).toBe(200);
    const st = await call(COMMAND_STATUS, { as: fx.therapistA, params: { commandId: e.data.command_id } });
    expect(st.data).toMatchObject({ status: 'running', progress: { stage: 'on_device', employee_no: emp[fx.patientA2] } });
    // Con otro token no se puede tocar la orden.
    expect((await call(PROGRESS, { headers: bearer(devOri.bridge), body: { command_id: e.data.command_id, stage: 'on_device' } })).status).toBe(404);
    const done = await call(RESULT, { headers: bearer(dev.bridge), body: { command_id: e.data.command_id, ok: true, result: { mode: 'on_device', fingerprints: 1, finger_no: 1 } } });
    expect(done.status).toBe(200);
    const [pt] = await sqlSystem((tx) => tx`select fingerprint_enrolled_at from patients where id = ${fx.patientA2}`);
    expect(pt.fingerprint_enrolled_at).not.toBeNull();
  });

  it('personas del lector: solo dueño; lista con quién es cada una y vinculación de una persona existente', async () => {
    const { GET: PERSONS, POST: PERSONS_ASK } = await import('@/app/api/devices/[id]/persons/route');
    const { POST: LINK } = await import('@/app/api/devices/[id]/link/route');
    expect((await call(PERSONS_ASK, { as: fx.therapistA, params: { id: dev.id }, body: {} })).status).toBe(403);
    const ask = await call(PERSONS_ASK, { as: fx.owner, params: { id: dev.id }, body: {} });
    expect(ask.status).toBe(200);
    await call(POLL, { headers: bearer(dev.bridge), body: { version: 't' } });
    // Una lectura del jefe llegó antes de vincularlo: quedó como "no reconocido".
    await hook(dev.webhook, accessJson({ employeeNo: '1', time: at('07:30') }), 'application/json');
    const persons = [
      { employee_no: '1', name: 'Jefe', fingerprints: 1 },
      { employee_no: emp[fx.patientA2], name: 'Beto', fingerprints: 1 },
    ];
    await call(RESULT, { headers: bearer(dev.bridge), body: { command_id: ask.data.command_id, ok: true, result: { persons, total: 2 } } });
    const list = await call(PERSONS, { as: fx.owner, params: { id: dev.id }, url: `/api/devices/${dev.id}/persons?command_id=${ask.data.command_id}` });
    expect(list.status).toBe(200);
    expect(list.data.persons.find((p: any) => p.employee_no === '1').linked).toBeNull();
    expect(list.data.persons.find((p: any) => p.employee_no === emp[fx.patientA2]).linked).toMatchObject({ type: 'patient', id: fx.patientA2 });

    expect((await call(LINK, { as: fx.therapistA, params: { id: dev.id }, body: { employee_no: '1', person_type: 'staff', person_id: fx.therapistB.id } })).status).toBe(403);
    const link = await call(LINK, { as: fx.owner, params: { id: dev.id }, body: { employee_no: '1', person_type: 'staff', person_id: fx.therapistB.id } });
    expect(link.status).toBe(200);
    expect(link.data.reassigned_events).toBe(1);
    const [u] = await sqlSystem((tx) => tx`select hik_employee_no, fingerprint_enrolled_at from users where id = ${fx.therapistB.id}`);
    expect(u.hik_employee_no).toBe('1');
    expect(u.fingerprint_enrolled_at).not.toBeNull();
    const evs = await events(`where employee_no = '1'`);
    expect(evs.every((x) => x.person_type === 'staff' && x.user_id === fx.therapistB.id)).toBe(true);
    // Las siguientes lecturas del número 1 ya cuentan como suyas.
    await hook(dev.webhook, accessJson({ employeeNo: '1', time: at('18:30') }), 'application/json');
    expect((await events(`where employee_no = '1'`)).at(-1).user_id).toBe(fx.therapistB.id);
    // Un número ya tomado no se puede vincular a otra persona.
    const dup = await call(LINK, { as: fx.owner, params: { id: dev.id }, body: { employee_no: '1', person_type: 'patient', person_id: fx.patientA1 } });
    expect(dup.status).toBe(409);
  });
});
