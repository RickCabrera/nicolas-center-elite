/**
 * HUE-20 · Lector USB DigitalPersona U.are.U 4500: chofer del agente puente contra el simulador del sensor
 * (bridge/usb-mock.mjs) y una nube falsa. El agente corre EN PROCESO (new Bridge) para inyectar el sensor.
 *
 *   npx vitest run -c vitest.bridge.config.ts
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — módulos .mjs sin tipos
import { Bridge, loadConfig, readerConfig, readerStateFile, scrubResult } from '../../bridge/bridge.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { ENROLL_SAMPLES, UsbDevice, Vault, probeUsb, slugOf } from '../../bridge/usb-device.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { createMockNative } from '../../bridge/usb-mock.mjs';

const TOKEN = 'token-usb-de-prueba-del-agente-puente-0123456789';
type Cmd = { id: string; kind: string; payload: Record<string, unknown> };
type Cloud = { url: string; queue: Cmd[]; results: any[]; events: any[]; polls: any[]; progress: any[]; down: boolean; eventsDown: boolean; kind: string; close: () => Promise<void> };

async function startCloud(): Promise<Cloud> {
  const c: Cloud = { url: '', queue: [], results: [], events: [], polls: [], progress: [], down: false, eventsDown: false, kind: 'usb_digitalpersona', close: async () => {} };
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const ch of req) chunks.push(ch as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    const reply = (status: number, b: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (c.down) return reply(503, { ok: false, error: { code: 'down' } });
    if (String(req.headers.authorization) !== `Bearer ${TOKEN}`) return reply(401, { ok: false, error: { code: 'unauthorized' } });
    if (req.url === '/api/bridge/poll') {
      c.polls.push(body);
      const commands = body.dry_run ? [] : c.queue.splice(0, 5);
      // La nube no manda IP ni contraseña para un lector USB: solo su tipo.
      return reply(200, { ok: true, data: { commands, config: { kind: c.kind, host: '', port: 80, use_https: false, username: 'admin', password: '', poll_seconds: 2, backfill_since: null } } });
    }
    if (req.url === '/api/bridge/progress') { c.progress.push(body); return reply(200, { ok: true, data: { ok: true } }); }
    if (req.url === '/api/bridge/result') { c.results.push(body); return reply(200, { ok: true, data: { status: 'done' } }); }
    if (req.url === '/api/bridge/events') {
      if (c.eventsDown) return reply(503, { ok: false, error: { code: 'down' } });
      c.events.push(...body.events);
      return reply(200, { ok: true, data: { received: body.events.length, created: body.events.length, ignored: 0 } });
    }
    if (req.url === '/api/bridge/heartbeat') return reply(200, { ok: true, data: { device_name: 'USB de prueba' } });
    reply(404, { ok: false, error: { code: 'not_found' } });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  c.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  c.close = () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); });
  return c;
}

let cloud: Cloud;
let dir: string;
let native: any;
let n = 0;
const queue = (kind: string, payload: Record<string, unknown> = {}) => {
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  cloud.queue.push({ id, kind, payload });
  return id;
};
const resultOf = (id: string) => cloud.results.find((r) => r.command_id === id);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 5000) => { const t = Date.now() + ms; while (!f() && Date.now() < t) await sleep(25); expect(f()).toBe(true); };

function makeBridge(extra: Record<string, unknown> = {}) {
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ cloud_url: cloud.url, bridge_token: TOKEN, capture_timeout_seconds: 3, ...extra }));
  const cfg = loadConfig(path.join(dir, 'config.json'));
  const b = new Bridge(readerConfig(cfg, cfg.readers[0]), { stateFile: readerStateFile(path.join(dir, 'state.json'), cfg, cfg.readers[0]), quiet: true, usbNative: native });
  return b;
}
/** Registra la huella de una persona en un solo ciclo: encola la orden y "pone el dedo" las veces necesarias. */
async function enroll(b: any, employee_no: string, finger: string, name = employee_no) {
  const id = queue('enroll_fingerprint', { employee_no, name, finger_no: 1 });
  const run = b.cycle();
  await until(() => b.device?.busy);               // el registro pausa la identificación y toma el sensor
  for (let i = 0; i < ENROLL_SAMPLES; i++) {
    await until(() => native.waiting);
    native.placeFinger(finger);
    await until(() => !native.waiting);
  }
  await run;
  return id;
}

beforeAll(async () => { cloud = await startCloud(); });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nce-usb-'));
  native = createMockNative();
  Object.assign(cloud, { queue: [], results: [], events: [], polls: [], progress: [], down: false, eventsDown: false, kind: 'usb_digitalpersona' });
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
afterAll(async () => { await cloud.close(); });

describe('bóveda cifrada', () => {
  it('guarda y recupera plantillas con AES-256-GCM; sin la llave no se abre', () => {
    const v = new Vault(path.join(dir, 'vault-x.enc'), path.join(dir, 'vault.key'));
    v.load();
    v.persons.set('P1', { name: 'Ana', fmds: [Buffer.from('FMD:a1'), Buffer.from('FMD:a2')] });
    v.save();
    const raw = fs.readFileSync(path.join(dir, 'vault-x.enc'));
    expect(raw.subarray(0, 4).toString()).toBe('NCE1');
    expect(raw.includes(Buffer.from('FMD:a1'))).toBe(false);   // cifrado de verdad
    expect(raw.includes(Buffer.from('Ana'))).toBe(false);
    const again = new Vault(path.join(dir, 'vault-x.enc'), path.join(dir, 'vault.key')).load();
    expect(again.persons.get('P1')?.fmds.map((m: Buffer) => m.toString())).toEqual(['FMD:a1', 'FMD:a2']);
    expect(again.entries()).toHaveLength(2);
    fs.writeFileSync(path.join(dir, 'vault.key'), 'ab'.repeat(32));
    expect(() => new Vault(path.join(dir, 'vault-x.enc'), path.join(dir, 'vault.key')).load()).toThrow(/bóveda/);
  });

  it('slugOf: nombre del lector → nombre de archivo', () => {
    expect(slugOf('Recepción Córdoba')).toBe('recepcion-cordoba');
    expect(slugOf('')).toBe('usb');
  });
});

describe('chofer USB en el agente', () => {
  it('la nube dice que el lector es USB: ping reporta el modelo y no pide IP ni contraseña', async () => {
    const b = makeBridge();
    const id = queue('ping');
    await b.cycle();
    expect(b.isUsb).toBe(true);
    expect(resultOf(id)).toMatchObject({ ok: true, result: { model: 'DigitalPersona U.are.U 4500', serial: 'MOCK0001' } });
    await b.cycle();
    expect(cloud.polls.at(-1)).toMatchObject({ device_reachable: true, device_info: { model: 'DigitalPersona U.are.U 4500' } });
    await b.device.close();
  });

  it('registra una huella con varios toques, avisa el avance y la guarda solo en la bóveda', async () => {
    const b = makeBridge();
    const id = await enroll(b, 'P1003', 'dedo-ana', 'Ana Lopez');
    const r = resultOf(id);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.result).toMatchObject({ mode: 'remote', finger_no: 1 });
    expect(JSON.stringify(r)).not.toMatch(/FMD|fingerData/);
    const samples = cloud.progress.filter((p) => p.sample).map((p) => [p.sample, p.samples]);
    expect(samples).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]]);
    // En disco solo hay bóveda cifrada: ni plantilla ni nombre en claro.
    const files = fs.readdirSync(dir);
    expect(files).toContain('vault-usb.enc');
    expect(files).toContain('vault.key');
    for (const f of files) if (f !== 'vault.key') expect(fs.readFileSync(path.join(dir, f)).includes(Buffer.from('FMD:dedo-ana'))).toBe(false);
    const persons = await b.device.listPersons();
    expect(persons).toEqual([{ employee_no: 'P1003', name: 'Ana Lopez', fingerprints: 1, faces: 0, cards: 0 }]);
    await b.device.close();
  });

  it('la misma huella para otra persona → fingerprint_duplicate; registrar de nuevo la propia la reemplaza', async () => {
    const b = makeBridge();
    await enroll(b, 'P1003', 'dedo-ana');
    const dup = await enroll(b, 'P1004', 'dedo-ana');
    expect(resultOf(dup).ok).toBe(false);
    expect(resultOf(dup).error).toMatch(/^fingerprint_duplicate/);
    expect((await b.device.listPersons()).find((p: any) => p.employee_no === 'P1004')).toMatchObject({ fingerprints: 0 });
    const again = await enroll(b, 'P1003', 'dedo-ana');
    expect(resultOf(again).ok).toBe(true);
    expect(await b.device.countFingerprints('P1003')).toBe(1);
    const otro = await enroll(b, 'P1003', 'dedo-ana-pulgar');
    expect(resultOf(otro).ok).toBe(true);
    expect(await b.device.countFingerprints('P1003')).toBe(2);
    await b.device.close();
  });

  it('nadie pone el dedo → capture_timeout; baja calidad repetida → low_quality', async () => {
    const b = makeBridge({ capture_timeout_seconds: 1 });
    const id = queue('enroll_fingerprint', { employee_no: 'P1', name: 'x' });
    await b.cycle();
    expect(resultOf(id)).toMatchObject({ ok: false, error: 'capture_timeout' });
    const id2 = queue('enroll_fingerprint', { employee_no: 'P1', name: 'x' });
    const run = b.cycle();
    await until(() => b.device?.busy);
    for (let i = 0; i < 6; i++) {
      await until(() => native.waiting);
      native.placeFinger('malo', { lowQuality: true });
      await until(() => !native.waiting);
    }
    await run;
    expect(resultOf(id2).error).toMatch(/^low_quality/);
    await b.device.close();
  });

  it('checadas: identifica el dedo, lo manda a la nube como huella verificada (38) y no repite el dedo que sigue puesto', async () => {
    const b = makeBridge();
    await enroll(b, 'P1003', 'dedo-ana');
    await enroll(b, 'U7', 'dedo-jhony');
    // Al terminar el ciclo el agente vuelve a esperar dedos.
    await until(() => b.device.identifying);
    native.placeFinger('dedo-jhony');
    await until(() => b.device.takePending().length === 1);
    native.placeFinger('dedo-jhony');          // el mismo dedo sigue en el sensor: no cuenta
    native.placeFinger('dedo-desconocido');    // no registrado: no genera asistencia
    await sleep(300);
    expect(b.device.takePending()).toHaveLength(1);
    await b.cycle();
    expect(cloud.events).toHaveLength(1);
    expect(cloud.events[0]).toMatchObject({ employee_no: 'U7', minor: 38, major: 5, verify_mode: 'fingerPrint', serial_no: null });
    expect(cloud.events[0].time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-06:00$/);
    expect(b.device.takePending()).toHaveLength(0);
    await b.device.close();
    expect(b.device.identifying).toBe(false);
  });

  it('sin internet las checadas se guardan en la PC y se envían al volver; "Recuperar eventos" las relee', async () => {
    const b = makeBridge();
    await enroll(b, 'P1003', 'dedo-ana');
    await until(() => b.device.identifying);
    cloud.eventsDown = true;
    native.placeFinger('dedo-ana');
    await until(() => b.device.takePending().length === 1);
    const r1 = await b.cycle();
    expect(r1.cloudOk).toBe(false);
    expect(cloud.events).toHaveLength(0);
    // Sobrevive a un reinicio del agente: queda en readings-usb.json (sin plantillas).
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'readings-usb.json'), 'utf8'));
    expect(saved.pending).toHaveLength(1);
    expect(JSON.stringify(saved)).not.toMatch(/FMD/);
    cloud.eventsDown = false;
    const r2 = await b.cycle();
    expect(r2.cloudOk).toBe(true);
    expect(cloud.events).toHaveLength(1);
    const id = queue('backfill_events', { from: new Date(Date.now() - 3600000).toISOString(), to: new Date(Date.now() + 60000).toISOString() });
    await b.cycle();
    expect(resultOf(id)).toMatchObject({ ok: true, result: { read: 1, sent: 1 } });
    await b.device.close();
  });

  it('borrar persona la quita de la bóveda; rostro y aviso HTTP responden "no soportado"; la hora no se toca', async () => {
    const b = makeBridge();
    await enroll(b, 'P1003', 'dedo-ana');
    const del = queue('delete_person', { employee_no: 'P1003' });
    const face = queue('enroll_face', { employee_no: 'P1003', name: 'Ana' });
    const lis = queue('configure_listener', { host: 'x', path: '/y' });
    const t = queue('sync_time');
    await b.cycle();
    expect(resultOf(del)).toMatchObject({ ok: true, result: { deleted: true } });
    expect(await b.device.listPersons()).toEqual([]);
    expect(resultOf(face).error).toMatch(/^not_supported/);
    expect(resultOf(lis).error).toMatch(/^listener_not_supported/);
    expect(resultOf(t).ok).toBe(true);
    await b.device.close();
  });

  it('sin lector conectado: la nube ve "sin conexión" con el motivo y el agente sigue intentando', async () => {
    native = createMockNative({ noReader: true });
    const b = makeBridge();
    await b.cycle();
    await b.cycle();
    expect(cloud.polls.at(-1)).toMatchObject({ device_reachable: false, device_error: 'usb_no_reader' });
    const id = queue('ping');
    await b.cycle();
    expect(resultOf(id).error).toMatch(/^usb_no_reader/);
    await b.device.close();
  });

  it('config.json puede fijar el tipo USB sin esperar a la nube (device.type = "usb")', async () => {
    cloud.kind = 'hikvision';
    const b = makeBridge({ device: { type: 'usb', lib_dir: 'C:\\no\\existe' } });
    const id = queue('ping');
    await b.cycle();
    expect(b.isUsb).toBe(true);
    expect(resultOf(id).ok).toBe(true);
    await b.device.close();
  });

  it('--check reporta lector, bóveda y pendientes', async () => {
    const b = makeBridge();
    const r = await b.check();
    expect(r.failures).toBe(0);
    expect(r.lines.join('\n')).toMatch(/Lector conectado: DigitalPersona U.are.U 4500/);
    expect(r.lines.join('\n')).toMatch(/Bóveda abierta: 0 persona/);
    native = createMockNative({ noReader: true });
    const b2 = makeBridge();
    const r2 = await b2.check();
    expect(r2.failures).toBe(1);
    expect(r2.lines.join('\n')).toMatch(/No hay un lector DigitalPersona/);
  });

  it('--probe --usb: dos toques del mismo dedo coinciden, de dedos distintos no', async () => {
    const lines: string[] = [];
    native.placeFinger('a'); native.placeFinger('a');
    expect(await probeUsb({ native, print: (s: string) => lines.push(s) })).toBe(0);
    expect(lines.join('\n')).toMatch(/coinciden/);
    const native2 = createMockNative();
    native2.placeFinger('a'); native2.placeFinger('b');
    expect(await probeUsb({ native: native2, print: () => {} })).toBeGreaterThan(0);
  });

  it('scrubResult sigue sin dejar pasar plantillas del chofer USB', () => {
    expect(scrubResult({ ok: true, fingerData: 'x', nested: { finger_template: 'y', quality: 1 } })).toEqual({ ok: true, nested: { quality: 1 } });
    expect(new UsbDevice({ stateDir: dir }).kind).toBe('usb_digitalpersona');
  });
});
