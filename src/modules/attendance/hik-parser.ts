/**
 * HUE-02 / HUE-03 · Parser PURO de las notificaciones del lector Hikvision (ISAPI "HTTP Listening").
 *
 * El lector puede mandar el mismo evento de tres formas:
 *   · multipart/form-data con una parte de texto (`event_log` o `AccessControllerEvent`) y, a veces,
 *     una parte binaria con la foto. La foto se IGNORA: nunca se decodifica ni se guarda.
 *   · application/json directo.
 *   · application/xml | text/xml (`<EventNotificationAlert>`).
 *
 * No toca la base ni la red: recibe el tipo de contenido y los bytes, devuelve eventos normalizados.
 * Nunca lanza por un cuerpo mal formado: devuelve [] (el webhook debe responder 200 de todos modos).
 */
import { TZ } from '@/lib/dates';

export type HikEvent = {
  /** access = evento del controlador de acceso · heartbeat = latido · other = cualquier otra cosa */
  kind: 'access' | 'heartbeat' | 'other';
  employeeNo: string | null;
  occurredAt: Date | null;
  serialNo: number | null;
  verifyMode: string;
  major: number | null;
  minor: number | null;
  deviceName: string;
  /** eventType original, para diagnóstico. */
  eventType: string;
};

/** Tamaño máximo de texto que se acepta en una notificación (HUE-02). */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/** major 5 = evento; estos sub-tipos son verificaciones correctas: huella, rostro, tarjeta. */
export const MAJOR_EVENT = 5;
export const VERIFIED_MINORS: ReadonlySet<number> = new Set([38, 75, 1]);

/** ¿Es una lectura que cuenta como asistencia? (verificación correcta y con número de persona) */
export function isVerifiedAccess(e: HikEvent): e is HikEvent & { employeeNo: string; occurredAt: Date } {
  return e.kind === 'access' && e.major === MAJOR_EVENT && e.minor !== null && VERIFIED_MINORS.has(e.minor)
    && !!e.employeeNo && e.occurredAt !== null;
}

/** Llave de idempotencia compartida por webhook y puente (HUE-04). */
export function dedupeKey(deviceId: string, e: { serialNo: number | null; employeeNo: string | null; occurredAt: Date }): string {
  const sec = Math.floor(e.occurredAt.getTime() / 1000);
  return e.serialNo !== null ? `${deviceId}:${e.serialNo}:${sec}` : `${deviceId}:${e.employeeNo ?? ''}:${sec}`;
}

// ───────── fechas ─────────
function tzOffsetMs(at: Date): number {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const g = (t: string) => Number(f.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * Fecha del lector → instante. Con zona ("-06:00", "Z", "+0800") se respeta;
 * sin zona se interpreta como hora local de la clínica (America/Mexico_City).
 */
export function parseHikDate(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, zone] = m;
  const utc = Date.UTC(+y, +mo - 1, +d, +hh, +mi, +(ss ?? 0));
  const probe = new Date(utc);
  if (Number.isNaN(utc) || probe.getUTCMonth() !== +mo - 1 || probe.getUTCDate() !== +d || +hh > 23 || +mi > 59 || +(ss ?? 0) > 59) return null;
  if (zone) {
    if (zone.toUpperCase() === 'Z') return probe;
    const z = zone.replace(':', '');
    const sign = z[0] === '-' ? -1 : 1;
    const off = sign * (Number(z.slice(1, 3)) * 60 + Number(z.slice(3, 5)));
    return new Date(utc - off * 60000);
  }
  // Sin zona: hora de México. Dos pasadas por si el instante cae junto a un cambio de desfase histórico.
  let guess = new Date(utc - tzOffsetMs(probe));
  guess = new Date(utc - tzOffsetMs(guess));
  return guess;
}

// ───────── normalización ─────────
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && /^\s*-?\d+\s*$/.test(v)) return parseInt(v, 10);
  return null;
};
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

function normalize(o: Obj): HikEvent {
  const nested = isObj(o.AccessControllerEvent) ? o.AccessControllerEvent : null;
  const src = nested ?? o;
  const eventType = str(o.eventType);
  const major = num(src.majorEventType ?? src.major ?? o.majorEventType ?? o.major);
  const minor = num(src.subEventType ?? src.minor ?? o.subEventType ?? o.minor);
  const employeeNo = str(src.employeeNoString) || str(src.employeeNo) || str(o.employeeNoString) || str(o.employeeNo) || null;
  const occurredAt = parseHikDate(o.dateTime) ?? parseHikDate(src.dateTime) ?? parseHikDate(src.time) ?? parseHikDate(o.time);
  const base: HikEvent = {
    kind: 'other',
    employeeNo: employeeNo && employeeNo.length <= 64 ? employeeNo : null,
    occurredAt,
    serialNo: num(src.serialNo ?? o.serialNo),
    verifyMode: str(src.currentVerifyMode ?? o.currentVerifyMode).slice(0, 60),
    major,
    minor,
    deviceName: str(src.deviceName ?? o.deviceName).slice(0, 120),
    eventType,
  };
  const type = eventType.toLowerCase();
  if (type === 'heartbeat') return { ...base, kind: 'heartbeat' };
  // Algunos firmwares usan "videoloss" inactivo como señal de vida.
  if (type === 'videoloss' && str(o.eventState).toLowerCase() !== 'active') return { ...base, kind: 'heartbeat' };
  const looksAccess = type === 'accesscontrollerevent' || nested !== null || (type === '' && major !== null && minor !== null);
  if (looksAccess && major !== null) return { ...base, kind: 'access' };
  return base;
}

function fromJsonValue(v: unknown, out: HikEvent[]) {
  if (Array.isArray(v)) {
    for (const x of v.slice(0, 200)) fromJsonValue(x, out);
    return;
  }
  if (!isObj(v)) return;
  // Respuesta de búsqueda (AcsEvent.InfoList) o sobre { EventNotificationAlert: {...} }.
  if (isObj(v.EventNotificationAlert)) return fromJsonValue(v.EventNotificationAlert, out);
  if (isObj(v.AcsEvent) && Array.isArray(v.AcsEvent.InfoList)) return fromJsonValue(v.AcsEvent.InfoList, out);
  out.push(normalize(v));
}

// ───────── XML mínimo (sin dependencias) ─────────
const unescapeXml = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Devuelve el contenido de la primera etiqueta `name` (ignora prefijos de espacio de nombres). */
export function xmlTag(xml: string, name: string): string | null {
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}\\s*>`, 'i');
  const m = xml.match(re);
  return m ? m[1] : null;
}

function fromXml(text: string, out: HikEvent[]) {
  const blocks = text.match(/<(?:[\w.-]+:)?EventNotificationAlert[\s>][\s\S]*?<\/(?:[\w.-]+:)?EventNotificationAlert\s*>/gi);
  if (!blocks) return;
  for (const block of blocks.slice(0, 200)) {
    const inner = xmlTag(block, 'AccessControllerEvent');
    const outer = inner !== null ? block.replace(inner, '') : block;
    const get = (src: string | null, tag: string) => {
      const v = src ? xmlTag(src, tag) : null;
      return v === null || /</.test(v) ? undefined : unescapeXml(v).trim();
    };
    const o: Obj = {
      eventType: get(outer, 'eventType'),
      eventState: get(outer, 'eventState'),
      dateTime: get(outer, 'dateTime'),
    };
    if (inner !== null) {
      o.AccessControllerEvent = {
        deviceName: get(inner, 'deviceName'),
        majorEventType: get(inner, 'majorEventType') ?? get(inner, 'major'),
        subEventType: get(inner, 'subEventType') ?? get(inner, 'minor'),
        employeeNoString: get(inner, 'employeeNoString'),
        employeeNo: get(inner, 'employeeNo'),
        serialNo: get(inner, 'serialNo'),
        currentVerifyMode: get(inner, 'currentVerifyMode'),
      };
    }
    out.push(normalize(o));
  }
}

function fromText(text: string, hint: 'json' | 'xml' | 'auto', out: HikEvent[]) {
  const t = text.replace(/^﻿/, '').trim();
  if (!t) return;
  const asJson = hint === 'json' || (hint === 'auto' && (t[0] === '{' || t[0] === '['));
  if (asJson) {
    try {
      fromJsonValue(JSON.parse(t), out);
    } catch {
      /* mal formado: se ignora */
    }
    return;
  }
  if (t[0] === '<') fromXml(t, out);
}

// ───────── multipart ─────────
type Part = { headers: Record<string, string>; body: Uint8Array };

function indexOf(hay: Uint8Array, needle: Uint8Array, from: number): number {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Separa un cuerpo multipart en partes sin interpretar su contenido. Tolera saltos LF o CRLF. */
export function splitMultipart(body: Uint8Array, boundary: string): Part[] {
  const enc = new TextEncoder();
  const delim = enc.encode('--' + boundary);
  const parts: Part[] = [];
  let pos = indexOf(body, delim, 0);
  while (pos !== -1 && parts.length < 20) {
    let start = pos + delim.length;
    if (body[start] === 45 && body[start + 1] === 45) break; // "--" final
    if (body[start] === 13) start++;
    if (body[start] === 10) start++;
    const next = indexOf(body, delim, start);
    let end = next === -1 ? body.length : next;
    if (end > start && body[end - 1] === 10) end--;
    if (end > start && body[end - 1] === 13) end--;
    // Encabezados: hasta la primera línea vacía.
    let sep = -1, sepLen = 0;
    for (let i = start; i < end - 1; i++) {
      if (body[i] === 13 && body[i + 1] === 10 && body[i + 2] === 13 && body[i + 3] === 10) { sep = i; sepLen = 4; break; }
      if (body[i] === 10 && body[i + 1] === 10) { sep = i; sepLen = 2; break; }
    }
    const headers: Record<string, string> = {};
    let content = body.subarray(start, end);
    if (sep !== -1) {
      const head = new TextDecoder('latin1').decode(body.subarray(start, sep));
      for (const line of head.split(/\r?\n/)) {
        const c = line.indexOf(':');
        if (c > 0) headers[line.slice(0, c).trim().toLowerCase()] = line.slice(c + 1).trim();
      }
      content = body.subarray(sep + sepLen, end);
    }
    parts.push({ headers, body: content });
    pos = next;
  }
  return parts;
}

const TEXT_PART_NAMES = /name="?(event_log|AccessControllerEvent|EventNotificationAlert|event|json|xml)"?/i;

function looksLikeText(b: Uint8Array): boolean {
  let i = 0;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3;
  while (i < b.length && (b[i] === 32 || b[i] === 9 || b[i] === 10 || b[i] === 13)) i++;
  return b[i] === 123 /* { */ || b[i] === 91 /* [ */ || b[i] === 60 /* < */;
}

/**
 * Convierte el cuerpo de una notificación en eventos.
 * @param contentType encabezado Content-Type tal como llegó (puede venir vacío)
 * @param body bytes del cuerpo
 */
export function parseHikPayload(contentType: string | null | undefined, body: Uint8Array): HikEvent[] {
  const out: HikEvent[] = [];
  try {
    const ct = (contentType ?? '').toLowerCase();
    const decode = (b: Uint8Array) => new TextDecoder('utf-8').decode(b);
    if (ct.includes('multipart/')) {
      const m = (contentType ?? '').match(/boundary="?([^";,\s]+)"?/i);
      if (!m) return out;
      for (const part of splitMultipart(body, m[1])) {
        const pct = (part.headers['content-type'] ?? '').toLowerCase();
        const disp = part.headers['content-disposition'] ?? '';
        const binaryType = /^(image|video|audio)\//.test(pct) || pct.includes('octet-stream');
        const hasFile = /filename=/i.test(disp);
        const declaredText = pct.includes('json') || pct.includes('xml') || pct.startsWith('text/');
        // Las fotos y cualquier parte binaria se descartan sin leerlas (HUE-16).
        if (binaryType) continue;
        if (hasFile && !declaredText) continue;
        if (!declaredText && !TEXT_PART_NAMES.test(disp) && !looksLikeText(part.body)) continue;
        if (!looksLikeText(part.body)) continue;
        if (part.body.length > MAX_TEXT_BYTES) continue;
        fromText(decode(part.body), pct.includes('json') ? 'json' : pct.includes('xml') ? 'xml' : 'auto', out);
      }
      return out;
    }
    if (body.length > MAX_TEXT_BYTES) return out;
    if (ct.includes('json')) fromText(decode(body), 'auto', out);
    else if (ct.includes('xml')) fromText(decode(body), 'auto', out);
    else if (looksLikeText(body)) fromText(decode(body), 'auto', out); // sin Content-Type o text/plain
    return out;
  } catch {
    return out;
  }
}

/** Tamaño total de las partes de texto (para aplicar el límite de 2 MB sin contar la foto). */
export function textBytes(contentType: string | null | undefined, body: Uint8Array): number {
  const ct = contentType ?? '';
  if (!ct.toLowerCase().includes('multipart/')) return body.length;
  const m = ct.match(/boundary="?([^";,\s]+)"?/i);
  if (!m) return 0;
  let total = 0;
  for (const p of splitMultipart(body, m[1])) {
    const pct = (p.headers['content-type'] ?? '').toLowerCase();
    if (/^(image|video|audio)\//.test(pct) || pct.includes('octet-stream')) continue;
    if (looksLikeText(p.body)) total += p.body.length;
  }
  return total;
}
