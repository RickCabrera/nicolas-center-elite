// QA-04 · Cargas reales del lector Hikvision: válido, duplicado, desconocido, mal formado.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dedupeKey, isVerifiedAccess, parseHikDate, parseHikPayload, splitMultipart, textBytes } from '@/modules/attendance/hik-parser';
import { buildStaffReport, csvCell, dayHours, fmtMinutes, weekStart } from '@/modules/attendance/hours';
import { asciiName, stripBiometric, translateDeviceError } from '@/modules/attendance/server';

const dir = join(__dirname, '..', 'fixtures', 'hik');
const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as Record<string, { contentType: string }>;
const load = (name: string) => parseHikPayload(index[name].contentType, new Uint8Array(readFileSync(join(dir, name))));

describe('HUE-02 · parser de notificaciones Hikvision', () => {
  it('multipart con JSON y foto: toma el evento e ignora la parte binaria', () => {
    const ev = load('multipart-access-with-photo.bin');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: 'access', employeeNo: 'P1002', serialNo: 187, major: 5, minor: 38, verifyMode: 'cardOrFaceOrFp', deviceName: 'Access Controller' });
    expect(ev[0].occurredAt?.toISOString()).toBe('2026-10-07T21:17:03.000Z');
    expect(isVerifiedAccess(ev[0])).toBe(true);
    // la foto trae texto con forma de evento: no debe colarse
    expect(JSON.stringify(ev)).not.toContain('HACK');
  });

  it('multipart: el límite de texto no cuenta la foto', () => {
    const raw = new Uint8Array(readFileSync(join(dir, 'multipart-access-with-photo.bin')));
    const ct = index['multipart-access-with-photo.bin'].contentType;
    expect(splitMultipart(raw, 'MIME_boundary')).toHaveLength(2);
    expect(textBytes(ct, raw)).toBeLessThan(700);
    expect(textBytes(ct, raw)).toBeGreaterThan(400);
  });

  it('multipart con parte "AccessControllerEvent", saltos LF y límite entre comillas (rostro, personal)', () => {
    const ev = load('multipart-named-part-lf.bin');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: 'access', employeeNo: 'S1004', minor: 75, serialNo: 188 });
    expect(isVerifiedAccess(ev[0])).toBe(true);
  });

  it('JSON directo', () => {
    const ev = load('json-access.json');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: 'access', employeeNo: 'P1002', serialNo: 187, minor: 38 });
  });

  it('JSON plano: employeeNo numérico, serialNo como texto y fecha sin zona = hora de México', () => {
    const ev = load('json-flat-no-zone.json');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: 'access', employeeNo: '1002', serialNo: 190, minor: 1, major: 5 });
    expect(ev[0].occurredAt?.toISOString()).toBe('2026-10-07T21:17:03.000Z');
    expect(isVerifiedAccess(ev[0])).toBe(true);
  });

  it('XML EventNotificationAlert', () => {
    const ev = load('xml-access.xml');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: 'access', employeeNo: 'P1002', serialNo: 187, major: 5, minor: 38, verifyMode: 'cardOrFaceOrFp' });
    expect(ev[0].occurredAt?.toISOString()).toBe('2026-10-07T21:17:03.000Z');
  });

  it('latidos: heartBeat y videoloss inactivo', () => {
    expect(load('heartbeat.json')).toMatchObject([{ kind: 'heartbeat', employeeNo: null }]);
    expect(load('heartbeat-videoloss.xml')).toMatchObject([{ kind: 'heartbeat' }]);
    expect(isVerifiedAccess(load('heartbeat.json')[0])).toBe(false);
  });

  it('puerta abierta y huella no reconocida son eventos de acceso pero NO asistencia', () => {
    const door = load('door-open.json');
    expect(door).toMatchObject([{ kind: 'access', minor: 21, employeeNo: null }]);
    expect(isVerifiedAccess(door[0])).toBe(false);
    const bad = load('multipart-fingerprint-not-recognized.bin');
    expect(bad).toMatchObject([{ kind: 'access', minor: 39, employeeNo: null }]);
    expect(isVerifiedAccess(bad[0])).toBe(false);
  });

  it('mal formado: nunca lanza, devuelve vacío', () => {
    expect(load('malformed.json')).toEqual([]);
    expect(load('malformed-multipart.bin')).toEqual([]);
    expect(parseHikPayload('multipart/form-data', new Uint8Array([1, 2, 3]))).toEqual([]);
    expect(parseHikPayload(null, new Uint8Array())).toEqual([]);
    expect(parseHikPayload('application/json', new TextEncoder().encode('null'))).toEqual([]);
    expect(parseHikPayload('application/json', new TextEncoder().encode('"texto"'))).toEqual([]);
    expect(parseHikPayload('application/xml', new TextEncoder().encode('<a><b></a>'))).toEqual([]);
    expect(parseHikPayload('image/jpeg', new Uint8Array([0xff, 0xd8, 0xff]))).toEqual([]);
  });

  it('sin Content-Type pero con cuerpo JSON también se entiende', () => {
    const raw = new Uint8Array(readFileSync(join(dir, 'json-access.json')));
    expect(parseHikPayload('', raw)).toHaveLength(1);
    expect(parseHikPayload('text/plain', raw)).toHaveLength(1);
  });

  it('una verificación correcta sin fecha válida no cuenta', () => {
    const ev = parseHikPayload('application/json', new TextEncoder().encode(JSON.stringify({
      eventType: 'AccessControllerEvent', dateTime: 'ayer', AccessControllerEvent: { majorEventType: 5, subEventType: 38, employeeNoString: 'P1' },
    })));
    expect(ev[0].occurredAt).toBeNull();
    expect(isVerifiedAccess(ev[0])).toBe(false);
  });

  it('fechas: con zona, Z, sin dos puntos, sin zona, inválidas', () => {
    expect(parseHikDate('2026-10-07T15:17:03-06:00')?.toISOString()).toBe('2026-10-07T21:17:03.000Z');
    expect(parseHikDate('2026-10-07T21:17:03Z')?.toISOString()).toBe('2026-10-07T21:17:03.000Z');
    expect(parseHikDate('2026-10-07T23:17:03+0200')?.toISOString()).toBe('2026-10-07T21:17:03.000Z');
    expect(parseHikDate('2026-10-07 15:17:03')?.toISOString()).toBe('2026-10-07T21:17:03.000Z');
    expect(parseHikDate('2026-01-15T08:00')?.toISOString()).toBe('2026-01-15T14:00:00.000Z');
    expect(parseHikDate('2026-13-40T08:00:00')).toBeNull();
    expect(parseHikDate('')).toBeNull();
    expect(parseHikDate(12345)).toBeNull();
  });

  it('HUE-04 · llave de idempotencia: serialNo + segundo; sin serialNo usa el número de persona', () => {
    const at = new Date('2026-10-07T21:17:03.400Z');
    expect(dedupeKey('dev', { serialNo: 187, employeeNo: 'P1002', occurredAt: at })).toBe('dev:187:1791407823');
    expect(dedupeKey('dev', { serialNo: null, employeeNo: 'P1002', occurredAt: at })).toBe('dev:P1002:1791407823');
  });
});

describe('HUE-12 · horas trabajadas (función pura)', () => {
  const r = (t: string, direction: 'in' | 'out') => ({ occurred_at: `2026-10-05T${t}:00-06:00`, direction });

  it('suma los pares entrada→salida', () => {
    const d = dayHours([r('08:00', 'in'), r('14:00', 'out'), r('15:00', 'in'), r('18:30', 'out')]);
    expect(d).toEqual({ first_in: '08:00', last_out: '18:30', minutes: 570, pairs: 2, incomplete: false });
    expect(fmtMinutes(d.minutes)).toBe('9:30');
  });

  it('entrada sin salida: incompleto y no suma', () => {
    expect(dayHours([r('08:00', 'in')])).toEqual({ first_in: '08:00', last_out: null, minutes: 0, pairs: 0, incomplete: true });
  });

  it('par cerrado + entrada abierta: cuenta el par y marca incompleto', () => {
    const d = dayHours([r('15:00', 'in'), r('08:00', 'in'), r('14:00', 'out')]); // desordenadas a propósito
    expect(d).toMatchObject({ minutes: 360, pairs: 1, incomplete: true, first_in: '08:00', last_out: '14:00' });
  });

  it('salida sin entrada se ignora y marca incompleto; día vacío no es incompleto', () => {
    expect(dayHours([r('09:00', 'out')])).toMatchObject({ minutes: 0, incomplete: true, first_in: null });
    expect(dayHours([])).toMatchObject({ minutes: 0, incomplete: false });
  });

  it('semana de lunes a domingo', () => {
    expect(weekStart('2026-10-07')).toBe('2026-10-05'); // miércoles
    expect(weekStart('2026-10-05')).toBe('2026-10-05'); // lunes
    expect(weekStart('2026-10-11')).toBe('2026-10-05'); // domingo
  });

  it('reporte por persona, día y semana usando el día local de la clínica', () => {
    const base = { user_id: 'u1', person_name: 'L.F.T. Karla Ocampo', location_name: 'Córdoba' };
    const rep = buildStaffReport([
      { ...base, occurred_at: '2026-10-05T08:00:00-06:00', direction: 'in' },
      { ...base, occurred_at: '2026-10-05T16:00:00-06:00', direction: 'out' },
      // 19:00 → 23:30 hora local: en UTC cruza de día, pero sigue siendo el martes 6
      { ...base, occurred_at: '2026-10-06T19:00:00-06:00', direction: 'in' },
      { ...base, occurred_at: '2026-10-06T23:30:00-06:00', direction: 'out' },
      { ...base, occurred_at: '2026-10-12T08:00:00-06:00', direction: 'in' },
      { user_id: 'u2', person_name: 'Ana', location_name: 'Orizaba', occurred_at: '2026-10-05T09:00:00-06:00', direction: 'in' },
      { user_id: 'u2', person_name: 'Ana', location_name: 'Orizaba', occurred_at: '2026-10-05T10:00:00-06:00', direction: 'out' },
    ]);
    expect(rep.map((x) => x.person_name)).toEqual(['Ana', 'L.F.T. Karla Ocampo']);
    const k = rep[1];
    expect(k.days.map((d) => [d.date, d.minutes, d.incomplete])).toEqual([['2026-10-05', 480, false], ['2026-10-06', 270, false], ['2026-10-12', 0, true]]);
    expect(k.weeks).toEqual([{ week_start: '2026-10-05', minutes: 750, incomplete_days: 0 }, { week_start: '2026-10-12', minutes: 0, incomplete_days: 1 }]);
    expect(k.total_minutes).toBe(750);
    expect(k.incomplete_days).toBe(1);
  });

  it('CSV: comillas, comas y fórmulas neutralizadas', () => {
    expect(csvCell('Solís, Regina')).toBe('"Solís, Regina"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell(480)).toBe('480');
    expect(csvCell('9:30')).toBe('9:30');
    expect(csvCell(null)).toBe('');
  });
});

describe('utilidades de servidor del lector', () => {
  it('HUE-07 · nombre para el lector: sin acentos, ASCII, máximo 32', () => {
    expect(asciiName('Regina Solís Núñez')).toBe('Regina Solis Nunez');
    expect(asciiName('  María   José  de la Concepción Hernández-Güemes ')).toHaveLength(32);
    expect(asciiName('李小龙')).toBe('');
  });

  it('HUE-16 · detecta y elimina plantillas biométricas a cualquier profundidad', () => {
    const r = stripBiometric({ ok: true, result: { quality: 80, capture: [{ fingerData: 'QUJD', fingerNo: 1 }] } });
    expect(r.found).toBe(true);
    expect(JSON.stringify(r.clean)).not.toContain('QUJD');
    expect(stripBiometric({ result: { finger_data: 'x' } }).found).toBe(true);
    expect(stripBiometric({ result: { blob: 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo'.repeat(20) } }).found).toBe(true);
    expect(stripBiometric({ result: { model: 'DS-K1T321EFWX-B', quality: 80, finger_no: 1 } }).found).toBe(false);
  });

  it('traduce los errores del lector', () => {
    expect(translateDeviceError('capture_timeout')).toMatch(/agotó el tiempo/);
    expect(translateDeviceError('low_quality: 12')).toMatch(/baja calidad/);
    expect(translateDeviceError('Sin respuesta del agente puente')).toBe('Sin respuesta del agente puente');
    expect(translateDeviceError('weirdCode')).toMatch(/weirdCode/);
  });
});
