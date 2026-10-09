/**
 * HUE-05 / HUE-06 / HUE-07 / HUE-08 · Agente puente contra el simulador del lector (bridge/mock-device.mjs)
 * y una nube falsa mínima. Corre el programa real (`node bridge/bridge.mjs --once`) como proceso aparte.
 *
 *   npx vitest run -c vitest.bridge.config.ts
 */
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — módulos .mjs sin tipos (el puente es Node puro, fuera del proyecto TypeScript)
import { startMockDevice } from '../../bridge/mock-device.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { digestHeader, isapiTime, isapiTimeZone, loadConfig, parseDigestChallenge, scrubResult, scrubText } from '../../bridge/bridge.mjs';

const ROOT = path.resolve(__dirname, '..', '..');
const BRIDGE = path.join(ROOT, 'bridge', 'bridge.mjs');
const TOKEN = 'token-de-prueba-del-agente-puente-0123456789';
const PASSWORD = 'Lector#2026';

type Cmd = { id: string; kind: string; payload: Record<string, unknown> };
type Cloud = {
  url: string; queue: Cmd[]; results: any[]; events: any[]; polls: any[]; raw: string[]; progress: any[];
  down: boolean; eventsDown: boolean; deviceConfig: Record<string, unknown> | null; close: () => Promise<void>;
};

/** Nube falsa: mismas rutas y sobre de respuesta que la API real. */
async function startCloud(tls?: { key: string; cert: string }): Promise<Cloud> {
  const c: Cloud = { url: '', queue: [], results: [], events: [], polls: [], raw: [], progress: [], down: false, eventsDown: false, deviceConfig: null, close: async () => {} };
  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const ch of req) chunks.push(ch as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    c.raw.push(`${req.url} ${text}`);
    const reply = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (c.down) return reply(503, { ok: false, error: { code: 'down', message: 'fuera de servicio' } });
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return reply(401, { ok: false, error: { code: 'unauthorized', message: 'no' } });
    const body = text ? JSON.parse(text) : {};
    if (req.url === '/api/bridge/poll') {
      c.polls.push(body);
      const commands = body.dry_run ? [] : c.queue.splice(0, 5);
      return reply(200, { ok: true, data: { commands, config: { ...(c.deviceConfig ?? { host: '', port: 80, use_https: false, username: 'admin', password: '' }), poll_seconds: 2, backfill_since: null } } });
    }
    if (req.url === '/api/bridge/progress') { c.progress.push(body); return reply(200, { ok: true, data: { ok: true } }); }
    if (req.url === '/api/bridge/result') { c.results.push(body); return reply(200, { ok: true, data: { status: 'done' } }); }
    if (req.url === '/api/bridge/events') {
      if (c.eventsDown) return reply(503, { ok: false, error: { code: 'down', message: 'x' } });
      c.events.push(...body.events);
      return reply(200, { ok: true, data: { received: body.events.length, created: body.events.length, ignored: 0 } });
    }
    if (req.url === '/api/bridge/heartbeat') return reply(200, { ok: true, data: { device_name: 'Recepción de prueba' } });
    reply(404, { ok: false, error: { code: 'not_found', message: 'x' } });
  };
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  c.url = `${tls ? 'https' : 'http'}://127.0.0.1:${port}`;
  c.close = () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); });
  return c;
}

let dir: string;
let cloud: Cloud;
let device: any;
let n = 0;

function writeConfig(extra: Record<string, unknown> = {}, deviceOverride?: Record<string, unknown> | null) {
  const cfg: Record<string, unknown> = {
    cloud_url: cloud.url, bridge_token: TOKEN, capture_timeout_seconds: 4, delete_poll_ms: 20,
    device: deviceOverride === null ? undefined : { host: '127.0.0.1', port: device.port, https: false, username: 'admin', password: PASSWORD, ...deviceOverride },
    ...extra,
  };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
}
const statePath = () => path.join(dir, 'state.json');
const readState = () => JSON.parse(fs.readFileSync(statePath(), 'utf8'));

function runBridge(...args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [BRIDGE, ...args, '--config', path.join(dir, 'config.json')], { timeout: 45000, env: { ...process.env, TZ: 'UTC' } }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as any).code ?? 1) : 0, out: stdout + stderr });
    });
  });
}
const queue = (kind: string, payload: Record<string, unknown> = {}) => {
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  cloud.queue.push({ id, kind, payload });
  return id;
};
const resultOf = (id: string) => cloud.results.find((r) => r.command_id === id);

beforeAll(async () => {
  cloud = await startCloud();
});
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nce-bridge-'));
  device = await startMockDevice({ password: PASSWORD, captureTimeoutMs: 600, autoFingerMs: 80 });
  Object.assign(cloud, { queue: [], results: [], events: [], polls: [], raw: [], progress: [], down: false, eventsDown: false, deviceConfig: null });
  writeConfig();
});
afterEach(async () => {
  await device.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
afterAll(async () => {
  await cloud.close();
});

describe('autenticación Digest', () => {
  it('calcula la respuesta del ejemplo del RFC 2617', () => {
    const challenge = parseDigestChallenge('Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"');
    expect(challenge).toMatchObject({ realm: 'testrealm@host.com', qop: 'auth,auth-int' });
    const h = digestHeader({ username: 'Mufasa', password: 'Circle Of Life', method: 'GET', uri: '/dir/index.html', challenge, nc: 1, cnonce: '0a4f113b' });
    expect(h).toContain('response="6629fae49393a05397450978507c4ef1"');
    expect(h).toContain('nc=00000001');
    expect(h).toContain('opaque="5ccc069c403ebaf9f0171e9517f40e41"');
    expect(parseDigestChallenge('Basic realm="x"')).toBeNull();
  });

  it('ping: negocia Digest con el lector y devuelve modelo, serie y firmware', async () => {
    const id = queue('ping');
    const r = await runBridge('--once');
    expect(r.code).toBe(0);
    expect(resultOf(id)).toMatchObject({ ok: true, result: { model: 'DS-K1T321EFWX-B', firmware: 'V3.9.50 build 260130' } });
    expect(resultOf(id).result.serial).toContain('DS-K1T321EFWX-B');
    const reqs = device.state.requests as { path: string; authorized: boolean }[];
    expect(reqs[0]).toMatchObject({ path: '/ISAPI/System/deviceInfo', authorized: false }); // reto 401
    expect(reqs.filter((x) => x.authorized).length).toBeGreaterThan(1);
    expect(reqs.filter((x) => !x.authorized)).toHaveLength(1);                               // el nonce se reutiliza
    expect(device.state.authFailures).toBe(0);
    // el siguiente poll ya informa que el lector responde
    expect(r.out).not.toContain(PASSWORD);
    expect(r.out).not.toContain(TOKEN);
  });

  it('contraseña incorrecta: auth_failed, sin martillar al lector', async () => {
    writeConfig({}, { password: 'equivocada' });
    const id = queue('ping');
    await runBridge('--once');
    expect(resultOf(id)).toMatchObject({ ok: false });
    expect(resultOf(id).error).toMatch(/^auth_failed/);
    expect(device.state.authFailures).toBe(1); // un solo intento con contraseña mala por arranque: no bloquea la cuenta
  });

  it('lector apagado: device_unreachable y el poll lo reporta', async () => {
    await device.close();
    const id = queue('ping');
    const r = await runBridge('--once');
    expect(r.code).toBe(0);
    expect(resultOf(id).error).toMatch(/^device_unreachable/);
    device = await startMockDevice({ password: PASSWORD }); // para que afterEach cierre algo
  });

  it('usa los datos del lector que entrega la nube cuando config.json no los trae', async () => {
    writeConfig({}, null);
    cloud.deviceConfig = { host: '127.0.0.1', port: device.port, use_https: false, username: 'admin', password: PASSWORD };
    const id = queue('ping');
    await runBridge('--once');
    expect(resultOf(id)).toMatchObject({ ok: true, result: { model: 'DS-K1T321EFWX-B' } });
    expect(fs.readFileSync(statePath(), 'utf8')).not.toContain(PASSWORD); // la contraseña no se guarda en disco
  });
});

describe('HUE-07 · enrolamiento', () => {
  it('Record → CaptureFingerPrint → SetUp, y la plantilla nunca sale del puente', async () => {
    const id = queue('enroll_fingerprint', { employee_no: 'P1002', name: 'Regina Solis', finger_no: 1 });
    const r = await runBridge('--once');
    expect(r.code).toBe(0);
    const res = resultOf(id);
    expect(res).toMatchObject({ ok: true, result: { quality: 85, finger_no: 1 } });

    const paths = (device.state.requests as { path: string; authorized: boolean }[]).filter((x) => x.authorized).map((x) => x.path);
    const iRecord = paths.indexOf('/ISAPI/AccessControl/UserInfo/Record');
    const iCapture = paths.indexOf('/ISAPI/AccessControl/CaptureFingerPrint');
    const iSetup = paths.indexOf('/ISAPI/AccessControl/FingerPrint/SetUp');
    expect(iRecord).toBeGreaterThanOrEqual(0);
    expect(iCapture).toBeGreaterThan(iRecord);
    expect(iSetup).toBeGreaterThan(iCapture);

    expect(device.state.users.get('P1002')).toMatchObject({ name: 'Regina Solis' });
    const stored = device.state.fingerprints.get('P1002');
    const template: string = device.state.lastCaptured;
    expect(template.length).toBeGreaterThan(300);
    expect(stored.fingerData).toBe(template); // el lector recibió exactamente lo que capturó

    // HUE-16: ni la nube, ni la consola, ni el disco vieron la plantilla
    const sentToCloud = cloud.raw.join('\n');
    expect(sentToCloud).not.toContain(template);
    expect(sentToCloud).not.toContain(template.slice(0, 40));
    expect(sentToCloud).not.toMatch(/finger_?data/i);
    expect(JSON.stringify(res)).not.toMatch(/finger_?data/i);
    expect(r.out).not.toContain(template.slice(0, 40));
    expect(r.out).not.toMatch(/fingerData/i);
    for (const f of fs.readdirSync(dir)) {
      const content = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(content, f).not.toContain(template.slice(0, 40));
      expect(content, f).not.toMatch(/fingerData/i);
    }
  });

  it('si la persona ya existe en el lector usa Modify y vuelve a capturar', async () => {
    device.state.users.set('S1004', { name: 'Nombre Viejo', userType: 'normal' });
    const id = queue('enroll_fingerprint', { employee_no: 'S1004', name: 'Karla Ocampo' });
    await runBridge('--once');
    expect(resultOf(id).ok).toBe(true);
    expect(device.state.users.get('S1004').name).toBe('Karla Ocampo');
    expect((device.state.requests as { path: string }[]).some((x) => x.path === '/ISAPI/AccessControl/UserInfo/Modify')).toBe(true);
    expect(device.state.fingerprints.has('S1004')).toBe(true);
  });

  it('nadie pone el dedo: capture_timeout; huella mala: low_quality; nada queda guardado', async () => {
    await device.close();
    device = await startMockDevice({ password: PASSWORD, captureTimeoutMs: 300, autoFingerMs: null });
    writeConfig();
    const id1 = queue('enroll_fingerprint', { employee_no: 'P2001', name: 'Sin Dedo' });
    await runBridge('--once');
    expect(resultOf(id1)).toEqual({ command_id: id1, ok: false, error: 'capture_timeout' });
    expect(device.state.fingerprints.has('P2001')).toBe(false);

    device.placeFinger({ fail: 'quality' });
    const id2 = queue('enroll_fingerprint', { employee_no: 'P2001', name: 'Sin Dedo' });
    await runBridge('--once');
    expect(resultOf(id2)).toEqual({ command_id: id2, ok: false, error: 'low_quality' });
    expect(device.state.fingerprints.has('P2001')).toBe(false);
  });

  it('el lector no responde a la captura dentro del tiempo del puente: capture_timeout', async () => {
    await device.close();
    device = await startMockDevice({ password: PASSWORD, captureTimeoutMs: 8000, autoFingerMs: null });
    writeConfig({ capture_timeout_seconds: 1 });
    const id = queue('enroll_fingerprint', { employee_no: 'P2002', name: 'Lento' });
    await runBridge('--once');
    expect(resultOf(id).error).toBe('capture_timeout');
  });

  it('HUE-13 · delete_person borra a la persona y su huella del lector', async () => {
    const e = queue('enroll_fingerprint', { employee_no: 'P3001', name: 'Baja Proxima' });
    await runBridge('--once');
    expect(resultOf(e).ok).toBe(true);
    const d = queue('delete_person', { employee_no: 'P3001' });
    await runBridge('--once');
    expect(resultOf(d)).toMatchObject({ ok: true, result: { deleted: true } });
    expect(device.state.users.has('P3001')).toBe(false);
    expect(device.state.fingerprints.has('P3001')).toBe(false);
    const paths = (device.state.requests as { path: string }[]).map((x) => x.path);
    expect(paths).toContain('/ISAPI/AccessControl/UserInfoDetail/DeleteProcess');
  });

  it('última defensa: scrubResult elimina cualquier plantilla de un resultado', () => {
    const clean = scrubResult({ quality: 80, capture: { fingerData: 'QUJD', fingerNo: 1 }, list: [{ finger_data: 'x' }], blob: 'A'.repeat(500) });
    expect(clean).toEqual({ quality: 80, capture: { fingerNo: 1 }, list: [{}], blob: '[omitido]' });
  });
});

describe('otras órdenes', () => {
  it('sync_time pone el reloj del lector en hora de México', async () => {
    device.state.clockOffsetMs = 7 * 60 * 1000; // lector 7 min adelantado
    const id = queue('sync_time');
    await runBridge('--once');
    expect(resultOf(id)).toMatchObject({ ok: true, result: { time_zone: 'CST+6:00:00' } });
    expect(resultOf(id).result.local_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(Math.abs(device.state.clockOffsetMs)).toBeLessThan(3000);
    expect(isapiTime(new Date('2026-10-07T21:17:03Z'), 'America/Mexico_City')).toBe('2026-10-07T15:17:03-06:00');
    expect(isapiTimeZone(-360)).toBe('CST+6:00:00');
  });

  it('configure_listener programa el aviso de eventos; si el firmware no lo admite, lo dice', async () => {
    const id = queue('configure_listener', { webhook_url: 'https://app.ejemplo.mx/api/hik/events/TOKEN', protocol: 'HTTPS', host: 'app.ejemplo.mx', port: 443, path: '/api/hik/events/TOKEN' });
    await runBridge('--once');
    expect(resultOf(id)).toMatchObject({ ok: true });
    expect(device.state.listener).toEqual({ protocol: 'HTTPS', host: 'app.ejemplo.mx', port: 443, url: '/api/hik/events/TOKEN' });

    await device.close();
    device = await startMockDevice({ password: PASSWORD, listenerSupported: false });
    writeConfig();
    const id2 = queue('configure_listener', { protocol: 'HTTPS', host: 'app.ejemplo.mx', port: 443, path: '/api/hik/events/TOKEN' });
    await runBridge('--once');
    expect(resultOf(id2).error).toMatch(/^listener_not_supported/);
  });

  it('orden desconocida o incompleta: error claro, el puente sigue', async () => {
    const a = queue('formatear_lector');
    const b = queue('enroll_fingerprint', {});
    const c = queue('ping');
    await runBridge('--once');
    expect(resultOf(a).error).toMatch(/^unknown_command/);
    expect(resultOf(b).error).toBe('bad_payload');
    expect(resultOf(c).ok).toBe(true);
  });
});

describe('HUE-05 / HUE-08 · eventos', () => {
  it('backfill_events pagina el historial del lector y envía todo a la nube', async () => {
    const base = Date.now() - 3 * 24 * 3600 * 1000;
    for (let i = 0; i < 75; i++) device.addEvent({ employeeNo: `P${1000 + (i % 5)}`, minor: 38, time: new Date(base + i * 60000) });
    device.addEvent({ minor: 21, time: new Date(base + 5000) });                 // puerta: sin persona, no se envía
    device.addEvent({ employeeNo: 'P1000', minor: 38, time: new Date(base - 2 * 24 * 3600 * 1000) }); // fuera del rango
    const id = queue('backfill_events', { from: new Date(base - 60000).toISOString(), to: new Date(base + 80 * 60000).toISOString() });
    const r = await runBridge('--once');
    expect(r.code).toBe(0);
    expect(resultOf(id)).toMatchObject({ ok: true, result: { read: 76, sent: 75 } });
    const searches = (device.state.requests as { path: string; authorized: boolean }[]).filter((x) => x.authorized && x.path === '/ISAPI/AccessControl/AcsEvent');
    expect(searches.length).toBeGreaterThanOrEqual(3); // 76 eventos en páginas de 30
    const got = cloud.events.filter((e) => Date.parse(e.time) >= base - 60000 && Date.parse(e.time) <= base + 80 * 60000);
    expect(new Set(got.map((e) => e.serial_no)).size).toBe(75);
    expect(got[0]).toMatchObject({ employee_no: 'P1000', minor: 38, major: 5, verify_mode: 'cardOrFaceOrFp' });
    expect(got[0].time).toMatch(/-06:00$/);
  });

  it('consulta periódica: manda las lecturas recientes aunque el webhook del lector no exista', async () => {
    device.addEvent({ employeeNo: 'P1002', minor: 38, time: new Date(Date.now() - 30000) });
    device.addEvent({ employeeNo: 'S1004', minor: 75, time: new Date(Date.now() - 5000) });
    const r = await runBridge('--once');
    expect(r.code).toBe(0);
    expect(cloud.events.map((e) => e.employee_no).sort()).toEqual(['P1002', 'S1004']);
    const st = readState();
    expect(Date.parse(st.cursor)).toBeGreaterThan(Date.now() - 60000);
    expect(st.last_event_time).toMatch(/-06:00$/);
    expect(cloud.polls[0].version).toBeTruthy();
    expect(cloud.polls[0]).toMatchObject({ device_reachable: true, device_info: { model: 'DS-K1T321EFWX-B' } });
  });

  it('corte de nube de 2 horas: no avanza el cursor y al volver reenvía todo desde state.json', async () => {
    const t0 = Date.now() - 3 * 3600 * 1000;
    fs.writeFileSync(statePath(), JSON.stringify({ cursor: new Date(t0).toISOString(), last_event_time: null, pending_results: [] }));
    device.addEvent({ employeeNo: 'P1002', minor: 38, time: new Date(t0 + 30 * 60000) });   // durante el corte
    device.addEvent({ employeeNo: 'S1004', minor: 38, time: new Date(t0 + 120 * 60000) });  // durante el corte
    device.addEvent({ employeeNo: 'P1003', minor: 38, time: new Date(Date.now() - 10000) });

    cloud.down = true;
    const id = 'pendiente';
    const off = await runBridge('--once');
    expect(off.code).toBe(3);
    expect(off.out).toMatch(/Sin conexión con la nube/);
    expect(cloud.events).toHaveLength(0);
    expect(readState().cursor).toBe(new Date(t0).toISOString()); // intacto

    // la nube acepta el poll pero falla al recibir eventos: tampoco se avanza
    cloud.down = false;
    cloud.eventsDown = true;
    const half = await runBridge('--once');
    expect(half.code).toBe(3);
    expect(readState().cursor).toBe(new Date(t0).toISOString());
    expect(cloud.events).toHaveLength(0);

    cloud.eventsDown = false;
    const on = await runBridge('--once');
    expect(on.code).toBe(0);
    expect(cloud.events.map((e) => e.employee_no).sort()).toEqual(['P1002', 'P1003', 'S1004']);
    expect(Date.parse(readState().cursor)).toBeGreaterThan(Date.now() - 60000);
    expect(id).toBe('pendiente');

    // siguiente ciclo: solo vuelve a pedir el traslape; lo nuevo llega
    cloud.events = [];
    device.addEvent({ employeeNo: 'P1005', minor: 38 });
    await runBridge('--once');
    expect(cloud.events.map((e) => e.employee_no)).toContain('P1005');
    expect(cloud.events.map((e) => e.employee_no)).not.toContain('P1002'); // lo viejo ya no se relee
  });

  it('el resultado de una orden que no pudo entregarse se guarda (sin datos sensibles) y se envía al volver la nube', async () => {
    const id = queue('enroll_fingerprint', { employee_no: 'P4001', name: 'Corte Justo' });
    // la nube entrega la orden y se cae antes de recibir el resultado
    const original = cloud.queue.splice(0);
    cloud.queue.push(...original);
    const dropResults = setInterval(() => { if (cloud.polls.length) cloud.down = true; }, 5);
    const r1 = await runBridge('--once');
    clearInterval(dropResults);
    expect(cloud.results).toHaveLength(0);
    const st = readState();
    expect(st.pending_results).toHaveLength(1);
    expect(st.pending_results[0]).toMatchObject({ command_id: id, ok: true });
    expect(JSON.stringify(st)).not.toMatch(/fingerData/i);
    expect(JSON.stringify(st)).not.toContain(String(device.state.lastCaptured).slice(0, 40));
    expect(r1.code).toBe(3);
    cloud.down = false;
    await runBridge('--once');
    expect(resultOf(id)).toMatchObject({ ok: true });
    expect(readState().pending_results).toHaveLength(0);
  });
});

describe('configuración y diagnóstico', () => {
  it('--check: todo en orden', async () => {
    const r = await runBridge('--check');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/La nube respondió y aceptó el token/);
    expect(r.out).toMatch(/autenticación Digest\. Modelo DS-K1T321EFWX-B/);
    expect(r.out).toMatch(/Reloj del lector en hora/);
    expect(r.out).toMatch(/historial de eventos correcta/);
    expect(r.out).toMatch(/Todo en orden/);
    expect(r.out).not.toContain(PASSWORD);
    expect(r.out).not.toContain(TOKEN);
    expect(cloud.polls.every((p) => p.dry_run)).toBe(true); // el diagnóstico no toma órdenes
  });

  it('--check: explica en español la contraseña incorrecta y la nube caída', async () => {
    writeConfig({}, { password: 'mala' });
    const a = await runBridge('--check');
    expect(a.code).toBe(1);
    expect(a.out).toMatch(/rechazó el usuario o la contraseña/);
    writeConfig();
    cloud.down = true;
    const b = await runBridge('--check');
    expect(b.code).toBe(1);
    expect(b.out).toMatch(/No se pudo conectar con la nube/);
  });

  it('config.json ausente, inválido o con nube sin https: mensaje claro y código 2', async () => {
    fs.rmSync(path.join(dir, 'config.json'));
    const a = await runBridge('--once');
    expect(a.code).toBe(2);
    expect(a.out).toMatch(/No se encontró/);
    fs.writeFileSync(path.join(dir, 'config.json'), '{ esto no es json');
    expect((await runBridge('--once')).code).toBe(2);
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ cloud_url: 'http://app.ejemplo.mx', bridge_token: TOKEN }));
    const c = await runBridge('--once');
    expect(c.code).toBe(2);
    expect(c.out).toMatch(/https:\/\//);
  });

  it('token rechazado por la nube: no ejecuta nada', async () => {
    writeConfig({ bridge_token: 'otro-token-que-la-nube-no-conoce-000000' });
    queue('ping');
    const r = await runBridge('--once');
    expect(r.code).toBe(3);
    expect(cloud.results).toHaveLength(0);
    expect(cloud.queue).toHaveLength(1);
  });
});

describe('TLS', () => {
  let cert: { key: string; cert: string } | null = null;
  beforeAll(() => {
    try {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nce-cert-'));
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(d, 'k.pem'), '-out', path.join(d, 'c.pem'), '-days', '2', '-subj', '/CN=127.0.0.1'], { stdio: 'pipe' });
      cert = { key: fs.readFileSync(path.join(d, 'k.pem'), 'utf8'), cert: fs.readFileSync(path.join(d, 'c.pem'), 'utf8') };
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      cert = null; // sin openssl no se puede generar el certificado de prueba
    }
  });

  it('acepta el certificado autofirmado del LECTOR', async (ctx) => {
    if (!cert) return ctx.skip();
    await device.close();
    device = await startMockDevice({ password: PASSWORD, tls: cert });
    writeConfig({}, { https: true });
    const id = queue('ping');
    await runBridge('--once');
    expect(resultOf(id)).toMatchObject({ ok: true, result: { model: 'DS-K1T321EFWX-B' } });
  });

  it('NO acepta un certificado autofirmado de la NUBE', async (ctx) => {
    if (!cert) return ctx.skip();
    const evil = await startCloud(cert);
    try {
      evil.queue.push({ id: 'x', kind: 'ping', payload: {} });
      fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ cloud_url: evil.url, bridge_token: TOKEN, device: { host: '127.0.0.1', port: device.port, username: 'admin', password: PASSWORD } }));
      const r = await runBridge('--once');
      expect(r.code).toBe(3);
      expect(evil.polls).toHaveLength(0);
      expect(evil.raw).toHaveLength(0); // ni siquiera llegó a enviar el token
    } finally {
      await evil.close();
    }
  });
});

describe('lector real · compatibilidad con cualquier firmware', () => {
  const noLeak = (text: string, template: string) => {
    expect(text).not.toContain(template.slice(0, 40));
    expect(text).not.toMatch(/fingerData/i);
  };

  it('firmware sin captura a distancia: la huella se registra en la pantalla del lector y el agente lo confirma', async () => {
    await device.close();
    device = await startMockDevice({ password: PASSWORD, captureSupported: false });
    writeConfig({ device_enroll_poll_ms: 100, device_enroll_timeout_seconds: 15 });
    const id = queue('enroll_fingerprint', { employee_no: 'P2001', name: 'Javier Montes', finger_no: 1 });
    const run = runBridge('--once');
    // Alguien registra el dedo en la pantalla del lector mientras el agente espera.
    for (let i = 0; i < 60 && !cloud.progress.some((x) => x.stage === 'on_device'); i++) await new Promise((r) => setTimeout(r, 100));
    expect(cloud.progress.find((x) => x.stage === 'on_device')).toMatchObject({ command_id: id, employee_no: 'P2001' });
    await fetch(`${device.url}/__control/enroll-on-device`, { method: 'POST', body: JSON.stringify({ employeeNo: 'P2001' }) });
    const r = await run;
    expect(r.code).toBe(0);
    expect(resultOf(id)).toMatchObject({ ok: true, result: { mode: 'on_device', fingerprints: 1 } });
    const template = device.state.fingerprints.get('P2001').fingerData as string;
    noLeak(cloud.raw.join('\n'), template);
    noLeak(r.out, template);
  });

  it('si nadie registra la huella en el lector: device_enroll_timeout', async () => {
    await device.close();
    device = await startMockDevice({ password: PASSWORD, captureSupported: false });
    writeConfig({ device_enroll_poll_ms: 100, device_enroll_timeout_seconds: 1 });
    const id = queue('enroll_fingerprint', { employee_no: 'P2002', name: 'Nadie', finger_no: 1 });
    await runBridge('--once');
    expect(resultOf(id)).toMatchObject({ ok: false, error: 'device_enroll_timeout' });
  });

  it('list_persons trae las personas que ya existen en el lector, sin datos biométricos', async () => {
    await fetch(`${device.url}/__control/person`, { method: 'POST', body: JSON.stringify({ employeeNo: '1', name: 'Jefe', fingerprint: true }) });
    await fetch(`${device.url}/__control/person`, { method: 'POST', body: JSON.stringify({ employeeNo: '2', name: 'Sin huella' }) });
    const id = queue('list_persons');
    await runBridge('--once');
    expect(resultOf(id)).toMatchObject({ ok: true, result: { total: 2 } });
    expect(resultOf(id).result.persons).toEqual(expect.arrayContaining([
      expect.objectContaining({ employee_no: '1', name: 'Jefe', fingerprints: 1 }),
      expect.objectContaining({ employee_no: '2', fingerprints: 0 }),
    ]));
    noLeak(cloud.raw.join('\n'), device.state.fingerprints.get('1').fingerData);
  });

  it('--probe: diagnóstico de solo lectura con usuario y contraseña en la línea de comandos, sin la nube', async () => {
    await fetch(`${device.url}/__control/person`, { method: 'POST', body: JSON.stringify({ employeeNo: '1', name: 'Jefe', fingerprint: true }) });
    await fetch(`${device.url}/__control/scan`, { method: 'POST', body: JSON.stringify({ employeeNo: '1' }) });
    const before = device.state.users.size;
    const r = await new Promise<{ code: number; out: string }>((resolve) => {
      execFile(process.execPath, [BRIDGE, '--probe', '--config', path.join(dir, 'config.json'), '--host', '127.0.0.1', '--port', String(device.port), '--http', '--user', 'admin', '--pass', PASSWORD],
        { timeout: 30000 }, (err, so, se) => resolve({ code: err ? ((err as any).code ?? 1) : 0, out: so + se }));
    });
    expect(r.out).toMatch(/DS-K1T321EFWX-B/);
    expect(r.out).toMatch(/Personas en el lector: 1/);
    expect(r.out).toMatch(/1 lectura/);
    expect(r.code).toBe(0);
    expect(device.state.users.size).toBe(before); // solo lectura
    const report = fs.readFileSync(path.join(dir, 'probe-report.json'), 'utf8');
    noLeak(report, device.state.fingerprints.get('1').fingerData);
    noLeak(r.out, device.state.fingerprints.get('1').fingerData);
  });

  it('scrubText quita plantillas en JSON, XML y base64 largo', () => {
    const b64 = 'A'.repeat(500);
    expect(scrubText(`{"fingerData":"${b64}"}`)).toBe('{"fingerData":"[omitido]"}');
    expect(scrubText(`<fingerData>${b64}</fingerData>`)).toBe('<fingerData>[omitido]</fingerData>');
    expect(scrubText(`x ${b64} y`)).toBe('x [omitido] y');
  });

  it('prueba en la red de la clínica: acepta http:// con IP privada o localhost, rechaza http:// público', () => {
    const f = path.join(dir, 'c.json');
    for (const url of ['http://192.168.80.15:3100', 'http://10.0.0.5:3100', 'http://localhost:3100', 'http://recepcion.local:3100']) {
      fs.writeFileSync(f, JSON.stringify({ cloud_url: url, bridge_token: TOKEN }));
      expect(loadConfig(f).cloud_url).toBe(url);
    }
    fs.writeFileSync(f, JSON.stringify({ cloud_url: 'http://8.8.8.8:3100', bridge_token: TOKEN }));
    expect(() => loadConfig(f)).toThrow(/https/);
  });
});
