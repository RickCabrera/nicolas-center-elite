#!/usr/bin/env node
/**
 * Nicolas Center Elite · Agente puente del lector de huella Hikvision (HUE-05, HUE-06, HUE-07, HUE-08, HUE-13)
 *
 * Corre en la PC de recepción, dentro de la red local de la clínica. Un solo archivo, sin dependencias
 * (Node.js 20 o superior). Solo hace conexiones de SALIDA:
 *   · a la nube (HTTPS, con verificación normal del certificado) para pedir órdenes y entregar resultados;
 *   · al lector (ISAPI con autenticación Digest) para ejecutar lo que la nube no puede hacer desde internet.
 *
 * PRIVACIDAD (HUE-16): la plantilla de la huella (fingerData) existe únicamente en la memoria de este
 * proceso entre "capturar" y "guardar en el lector". Nunca se envía a la nube, nunca se escribe en disco
 * y nunca aparece en los registros de consola.
 *
 * Uso:
 *   node bridge.mjs            servicio continuo
 *   node bridge.mjs --check    diagnóstico: configuración, nube y lector
 *   node bridge.mjs --once     un solo ciclo y termina (para pruebas)
 *   node bridge.mjs --probe    prueba de SOLO LECTURA contra el lector real (no necesita la nube):
 *                              modelo, capacidades, personas, huellas y eventos; genera probe-report.json
 *   node bridge.mjs --probe-enroll
 *                              prueba completa con una persona temporal: alta, huella, lectura de check-in y baja
 *   Opciones: --config <ruta a config.json>   --state <ruta a state.json>
 *             --host <ip> --user <usuario> --pass <contraseña> [--http]   (para --probe sin config.json)
 */
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const VERSION = '1.1.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));

// ───────────────────────── utilidades ─────────────────────────
const pad = (n) => String(n).padStart(2, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(msg) {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  console.log(`[${stamp}] ${msg}`);
}

/** Error con código estable (la nube lo traduce a un mensaje en español para la pantalla). */
export class BridgeError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.detail = detail;
  }
}

/** Texto corto y seguro para un detalle de error: jamás deja pasar un bloque largo (posible plantilla). */
function safeDetail(s) {
  const t = String(s ?? '').replace(/[A-Za-z0-9+/=]{60,}/g, '[omitido]').replace(/\s+/g, ' ').trim();
  return t.slice(0, 100);
}

/** Partes de fecha/hora de un instante en una zona horaria. */
function zoned(date, timeZone) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const g = (t) => f.find((p) => p.type === t)?.value ?? '00';
  const local = `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}`;
  const asUtc = Date.UTC(+g('year'), +g('month') - 1, +g('day'), +g('hour'), +g('minute'), +g('second'));
  const offsetMin = Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  return { local, offsetMin };
}

/** Instante → '2026-10-07T15:17:03-06:00' en la zona de la clínica (formato que espera ISAPI). */
export function isapiTime(date, timeZone) {
  const { local, offsetMin } = zoned(date, timeZone);
  const sign = offsetMin < 0 ? '-' : '+';
  const a = Math.abs(offsetMin);
  return `${local}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** Zona en formato del lector: UTC-6 → 'CST+6:00:00' (el signo va invertido, estilo POSIX). */
export function isapiTimeZone(offsetMin) {
  const sign = offsetMin <= 0 ? '+' : '-';
  const a = Math.abs(offsetMin);
  return `CST${sign}${Math.floor(a / 60)}:${pad(a % 60)}:00`;
}

export function xmlTag(xml, name) {
  const m = String(xml).match(new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}\\s*>`, 'i'));
  return m ? m[1].trim() : null;
}
const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/** Código de sub-estado que devuelve ISAPI en un error (JSON o XML). */
function subStatus(text) {
  const j = parseJson(text);
  if (j && typeof j === 'object') return String(j.subStatusCode ?? j.errorMsg ?? j.statusString ?? '');
  return xmlTag(text, 'subStatusCode') ?? xmlTag(text, 'statusString') ?? '';
}

// ───────────────────────── autenticación Digest (RFC 7616 / 2617) ─────────────────────────
export function parseDigestChallenge(header) {
  if (!header) return null;
  const raw = Array.isArray(header) ? header.join(', ') : String(header);
  const idx = raw.toLowerCase().indexOf('digest ');
  if (idx === -1) return null;
  const out = {};
  const re = /([a-zA-Z]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g;
  let m;
  const body = raw.slice(idx + 7);
  while ((m = re.exec(body))) {
    const k = m[1].toLowerCase();
    if (out[k] === undefined) out[k] = m[2] !== undefined ? m[2] : m[3];
  }
  return out.nonce ? out : null;
}

export function digestHeader({ username, password, method, uri, challenge, nc, cnonce }) {
  const algo = (challenge.algorithm || 'MD5').toUpperCase();
  const hashName = algo.startsWith('SHA-256') ? 'sha256' : 'md5';
  const H = (s) => crypto.createHash(hashName).update(s).digest('hex');
  let ha1 = H(`${username}:${challenge.realm ?? ''}:${password}`);
  if (algo.endsWith('-SESS')) ha1 = H(`${ha1}:${challenge.nonce}:${cnonce}`);
  const ha2 = H(`${method}:${uri}`);
  const qop = (challenge.qop || '').split(',').map((s) => s.trim()).includes('auth') ? 'auth' : '';
  const ncHex = nc.toString(16).padStart(8, '0');
  const response = qop ? H(`${ha1}:${challenge.nonce}:${ncHex}:${cnonce}:${qop}:${ha2}`) : H(`${ha1}:${challenge.nonce}:${ha2}`);
  const parts = [
    `username="${username}"`, `realm="${challenge.realm ?? ''}"`, `nonce="${challenge.nonce}"`, `uri="${uri}"`,
    `algorithm=${challenge.algorithm || 'MD5'}`, `response="${response}"`,
  ];
  if (qop) parts.push(`qop=${qop}`, `nc=${ncHex}`, `cnonce="${cnonce}"`);
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);
  return 'Digest ' + parts.join(', ');
}

// ───────────────────────── cliente ISAPI del lector ─────────────────────────
export class HikDevice {
  constructor({ host, port, https: useHttps, username, password }) {
    this.host = host;
    this.https = !!useHttps;
    this.port = Number(port) || (this.https ? 443 : 80);
    this.username = username || 'admin';
    this.password = password || '';
    this.challenge = null;
    this.nc = 0;
    // Si el lector rechaza la contraseña NO se insiste: varios intentos fallidos seguidos bloquean la cuenta
    // del lector. Se espera 5, 15, 30 y hasta 60 minutos entre intentos (o hasta que cambien los datos).
    this.authFailures = 0;
    this.authBlockedUntil = 0;
    // El lector trae un certificado autofirmado: se acepta SOLO en este agente, que solo habla con el lector.
    // Las conexiones a la nube usan fetch con la verificación normal de certificados.
    this.agent = this.https ? new https.Agent({ rejectUnauthorized: false, keepAlive: false }) : new http.Agent({ keepAlive: false });
  }

  get configured() { return !!(this.host && this.password); }
  sameAs(c) {
    return c && this.host === c.host && this.port === (Number(c.port) || (c.https ? 443 : 80)) && this.https === !!c.https
      && this.username === (c.username || 'admin') && this.password === (c.password || '');
  }

  raw(method, uri, headers, body, timeoutMs) {
    return new Promise((resolve, reject) => {
      const lib = this.https ? https : http;
      const req = lib.request({ host: this.host, port: this.port, method, path: uri, headers, agent: this.agent, timeout: timeoutMs }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', (e) => reject(new BridgeError('device_unreachable', e.code || 'respuesta interrumpida')));
      });
      req.on('timeout', () => req.destroy(new BridgeError('device_timeout')));
      req.on('error', (e) => reject(e instanceof BridgeError ? e : new BridgeError('device_unreachable', e.code || 'sin conexión')));
      if (body !== undefined && body !== null) req.write(body);
      req.end();
    });
  }

  /** Petición ISAPI con Digest. Reutiliza el reto (nonce) entre llamadas y lo renueva si caduca. */
  async request(method, uri, { body = null, contentType = null, timeoutMs = 10000 } = {}) {
    if (!this.host) throw new BridgeError('device_not_configured');
    if (Date.now() < this.authBlockedUntil) throw new BridgeError('auth_failed', 'en espera para no bloquear la cuenta del lector');
    const payload = body === null ? null : Buffer.from(body, 'utf8');
    for (let attempt = 0; attempt < 3; attempt++) {
      const headers = { Accept: '*/*', Connection: 'close' };
      if (payload) {
        headers['Content-Type'] = contentType ?? 'application/json';
        headers['Content-Length'] = String(payload.length);
      }
      if (this.challenge) {
        this.nc += 1;
        headers.Authorization = digestHeader({
          username: this.username, password: this.password, method, uri, challenge: this.challenge,
          nc: this.nc, cnonce: crypto.randomBytes(8).toString('hex'),
        });
      }
      const res = await this.raw(method, uri, headers, payload, timeoutMs);
      if (res.status !== 401) {
        if (headers.Authorization) this.authFailures = 0;
        return res;
      }
      const ch = parseDigestChallenge(res.headers['www-authenticate']);
      if (!ch) throw new BridgeError('auth_failed', 'el lector no ofreció autenticación Digest');
      // Con credenciales ya enviadas sobre un reto nuevo y sin "stale", el lector las rechazó.
      if (headers.Authorization && String(ch.stale ?? '').toLowerCase() !== 'true' && attempt > 0) return this.authRejected();
      this.challenge = ch;
      this.nc = 0;
    }
    return this.authRejected();
  }

  authRejected() {
    this.challenge = null;
    this.authFailures += 1;
    const minutes = [5, 15, 30, 60][Math.min(this.authFailures - 1, 3)];
    this.authBlockedUntil = Date.now() + minutes * 60000;
    throw new BridgeError('auth_failed');
  }

  // ── operaciones ──
  async deviceInfo() {
    const r = await this.request('GET', '/ISAPI/System/deviceInfo');
    if (r.status !== 200) throw new BridgeError('device_unreachable', `HTTP ${r.status}`);
    const version = xmlTag(r.text, 'firmwareVersion') ?? '';
    const build = xmlTag(r.text, 'firmwareReleasedDate') ?? '';
    return {
      model: xmlTag(r.text, 'model') ?? '',
      serial: xmlTag(r.text, 'serialNumber') ?? '',
      firmware: [version, build].filter(Boolean).join(' '),
      name: xmlTag(r.text, 'deviceName') ?? '',
    };
  }

  /** Diferencia (segundos) entre el reloj del lector y el de esta PC. Positivo = lector adelantado. */
  async clockSkewSeconds() {
    const r = await this.request('GET', '/ISAPI/System/time');
    if (r.status !== 200) return null;
    const local = xmlTag(r.text, 'localTime');
    const t = local ? Date.parse(local) : NaN;
    return Number.isNaN(t) ? null : Math.round((t - Date.now()) / 1000);
  }

  async syncTime(timeZone) {
    const now = new Date();
    const { local, offsetMin } = zoned(now, timeZone);
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Time version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">`
      + `<timeMode>manual</timeMode><localTime>${local}</localTime><timeZone>${isapiTimeZone(offsetMin)}</timeZone></Time>`;
    const r = await this.request('PUT', '/ISAPI/System/time', { body: xml, contentType: 'application/xml' });
    if (r.status !== 200) throw new BridgeError('time_failed', safeDetail(subStatus(r.text) || `HTTP ${r.status}`));
    return { local_time: local, time_zone: isapiTimeZone(offsetMin) };
  }

  async upsertPerson(employeeNo, name) {
    const UserInfo = {
      employeeNo: String(employeeNo), name: String(name || employeeNo), userType: 'normal',
      Valid: { enable: true, beginTime: '2020-01-01T00:00:00', endTime: '2037-12-31T23:59:59' },
      doorRight: '1', RightPlan: [{ doorNo: 1, planTemplateNo: '1' }],
    };
    let r = await this.request('POST', '/ISAPI/AccessControl/UserInfo/Record?format=json', { body: JSON.stringify({ UserInfo }) });
    if (r.status === 200) return { created: true };
    if (/employeeNoAlreadyExist/i.test(r.text)) {
      r = await this.request('PUT', '/ISAPI/AccessControl/UserInfo/Modify?format=json', { body: JSON.stringify({ UserInfo }) });
      if (r.status === 200) return { created: false };
    }
    const sub = subStatus(r.text);
    if (/full|upperLimit|overLimit|exceed/i.test(sub)) throw new BridgeError('device_full', safeDetail(sub));
    throw new BridgeError('person_failed', safeDetail(sub || `HTTP ${r.status}`));
  }

  /**
   * Pide al lector que capture un dedo. Devuelve la plantilla SOLO a quien la va a guardar en el lector.
   * Quien llama es responsable de no conservarla (ver enrollFingerprint).
   */
  async captureFingerprint(fingerNo, timeoutMs) {
    const xml = `<CaptureFingerPrintCond version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><fingerNo>${Number(fingerNo) || 1}</fingerNo></CaptureFingerPrintCond>`;
    let r;
    try {
      r = await this.request('POST', '/ISAPI/AccessControl/CaptureFingerPrint', { body: xml, contentType: 'application/xml', timeoutMs });
    } catch (e) {
      if (e instanceof BridgeError && e.code === 'device_timeout') throw new BridgeError('capture_timeout');
      throw e;
    }
    const fingerData = r.status === 200 ? xmlTag(r.text, 'fingerData') : null;
    if (fingerData) {
      const q = Number(xmlTag(r.text, 'fingerPrintQuality'));
      return { fingerData, quality: Number.isFinite(q) ? q : null };
    }
    const sub = subStatus(r.text);
    if (/time\s*out|timeout/i.test(sub)) throw new BridgeError('capture_timeout');
    if (/quality/i.test(sub)) throw new BridgeError('low_quality');
    if (/busy/i.test(sub)) throw new BridgeError('device_busy');
    if (/notSupport|invalidOperation|methodNotAllowed|badXmlContent|invalidContent/i.test(sub) || [400, 403, 404, 405, 501].includes(r.status)) {
      throw new BridgeError('not_supported', safeDetail(sub || `HTTP ${r.status}`));
    }
    throw new BridgeError('capture_failed', safeDetail(sub || `HTTP ${r.status}`));
  }

  async setFingerprint(employeeNo, fingerNo, fingerData) {
    const body = JSON.stringify({
      FingerPrintCfg: { employeeNo: String(employeeNo), enableCardReader: [1], fingerPrintID: Number(fingerNo) || 1, fingerType: 'normalFP', fingerData },
    });
    const r = await this.request('POST', '/ISAPI/AccessControl/FingerPrint/SetUp?format=json', { body, timeoutMs: 20000 });
    const j = parseJson(r.text);
    const list = j?.FingerPrintStatus?.StatusList;
    const rejected = Array.isArray(list) ? list.find((s) => s && s.cardReaderRecvStatus !== undefined && Number(s.cardReaderRecvStatus) !== 1) : null;
    const failed = r.status !== 200 || rejected || /fail/i.test(String(j?.FingerPrintStatus?.status ?? ''));
    if (!failed) return;
    const sub = rejected?.errorMsg || subStatus(r.text);
    if (/duplicate|alreadyExist|repeat/i.test(sub)) throw new BridgeError('fingerprint_duplicate');
    if (/quality/i.test(sub)) throw new BridgeError('low_quality');
    if (/full|upperLimit|overLimit|exceed/i.test(sub)) throw new BridgeError('device_full', safeDetail(sub));
    throw new BridgeError('setup_failed', safeDetail(sub || `HTTP ${r.status}`));
  }

  async deletePerson(employeeNo, { pollMs = 1000, maxPolls = 30 } = {}) {
    const body = JSON.stringify({ UserInfoDetail: { mode: 'byEmployeeNo', EmployeeNoList: [{ employeeNo: String(employeeNo) }] } });
    const r = await this.request('PUT', '/ISAPI/AccessControl/UserInfoDetail/Delete?format=json', { body });
    if (r.status !== 200) throw new BridgeError('delete_failed', safeDetail(subStatus(r.text) || `HTTP ${r.status}`));
    for (let i = 0; i < maxPolls; i++) {
      const p = await this.request('GET', '/ISAPI/AccessControl/UserInfoDetail/DeleteProcess?format=json');
      const status = String(parseJson(p.text)?.UserInfoDetailDeleteProcess?.status ?? '');
      if (p.status !== 200 || status === 'success') return; // firmware sin consulta de progreso: el PUT ya respondió 200
      if (status === 'failed') throw new BridgeError('delete_failed');
      await sleep(pollMs);
    }
    throw new BridgeError('delete_failed', 'el lector no terminó de borrar');
  }

  /** Recorre el historial de eventos del lector entre dos instantes, página por página. */
  async searchEvents(from, to, timeZone, onPage) {
    const searchID = crypto.randomUUID();
    let position = 0;
    let total = 0;
    for (let page = 0; page < 5000; page++) {
      const cond = {
        AcsEventCond: {
          searchID, searchResultPosition: position, maxResults: 30, major: 5, minor: 0,
          startTime: isapiTime(from, timeZone), endTime: isapiTime(to, timeZone),
        },
      };
      const r = await this.request('POST', '/ISAPI/AccessControl/AcsEvent?format=json', { body: JSON.stringify(cond), timeoutMs: 20000 });
      const acs = parseJson(r.text)?.AcsEvent;
      if (r.status !== 200 || !acs) throw new BridgeError('search_failed', safeDetail(subStatus(r.text) || `HTTP ${r.status}`));
      const list = Array.isArray(acs.InfoList) ? acs.InfoList : [];
      const events = list
        .filter((e) => e && (e.employeeNoString || e.employeeNo) && e.time)
        .map((e) => ({
          employee_no: String(e.employeeNoString ?? e.employeeNo), time: String(e.time),
          serial_no: e.serialNo ?? null, major: e.major ?? 5, minor: e.minor, verify_mode: String(e.currentVerifyMode ?? ''),
        }));
      total += list.length;
      if (events.length) await onPage(events);
      const n = Number(acs.numOfMatches ?? list.length) || 0;
      if (String(acs.responseStatusStrg).toUpperCase() !== 'MORE' || n === 0) break;
      position += n;
    }
    return total;
  }

  /**
   * Cuántas huellas tiene registradas una persona en el lector. La respuesta del lector incluye las
   * plantillas: se cuentan y se descartan aquí mismo, nunca salen de esta función.
   */
  async countFingerprints(employeeNo) {
    const body = JSON.stringify({ FingerPrintCond: { searchID: crypto.randomUUID(), employeeNo: String(employeeNo) } });
    const r = await this.request('POST', '/ISAPI/AccessControl/FingerPrintUpload?format=json', { body, timeoutMs: 15000 });
    const j = parseJson(r.text);
    if (r.status !== 200 || !j) throw new BridgeError('fingerprint_query_failed', safeDetail(subStatus(r.text) || `HTTP ${r.status}`));
    const up = j.FingerPrintInfo ?? j.FingerPrintUpload ?? j;
    if (/NoFP|notExist|noRecord/i.test(String(up?.status ?? ''))) return 0;
    const list = Array.isArray(up?.FingerPrintList) ? up.FingerPrintList : Array.isArray(up?.FingerPrintInfoList) ? up.FingerPrintInfoList : null;
    const n = list ? list.length : (up?.fingerData ? 1 : 0);
    return n;
  }

  /** Personas dadas de alta en el lector: número, nombre y cuántas huellas tiene cada una (sin datos biométricos). */
  async listPersons({ max = 5000 } = {}) {
    const searchID = crypto.randomUUID();
    const out = [];
    let position = 0;
    for (let page = 0; page < 500 && out.length < max; page++) {
      const body = JSON.stringify({ UserInfoSearchCond: { searchID, searchResultPosition: position, maxResults: 30 } });
      const r = await this.request('POST', '/ISAPI/AccessControl/UserInfo/Search?format=json', { body, timeoutMs: 15000 });
      const res = parseJson(r.text)?.UserInfoSearch;
      if (r.status !== 200 || !res) throw new BridgeError('person_search_failed', safeDetail(subStatus(r.text) || `HTTP ${r.status}`));
      const list = Array.isArray(res.UserInfo) ? res.UserInfo : [];
      for (const u of list) {
        if (!u?.employeeNo) continue;
        out.push({
          employee_no: String(u.employeeNo), name: String(u.name ?? '').slice(0, 64),
          fingerprints: Number(u.numOfFP ?? 0) || 0, faces: Number(u.numOfFace ?? 0) || 0, cards: Number(u.numOfCard ?? 0) || 0,
        });
      }
      const n = Number(res.numOfMatches ?? list.length) || 0;
      if (String(res.responseStatusStrg).toUpperCase() !== 'MORE' || n === 0) break;
      position += n;
    }
    return out;
  }

  /** GET de solo lectura para el diagnóstico (capacidades del lector). */
  async probeGet(uri) {
    try {
      const r = await this.request('GET', uri, { timeoutMs: 10000 });
      return { status: r.status, supported: r.status === 200, sample: scrubText(r.text).slice(0, 1500) };
    } catch (e) {
      return { status: 0, supported: false, error: e instanceof BridgeError ? e.code : safeDetail(e?.message) };
    }
  }

  async configureListener({ host, port, path: urlPath, protocol }) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><HttpHostNotification version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">`
      + `<id>1</id><url>${xmlEscape(urlPath)}</url><protocolType>${protocol === 'HTTP' ? 'HTTP' : 'HTTPS'}</protocolType>`
      + `<parameterFormatType>JSON</parameterFormatType><addressingFormatType>hostname</addressingFormatType>`
      + `<hostName>${xmlEscape(host)}</hostName><portNo>${Number(port) || 443}</portNo>`
      + `<httpAuthenticationMethod>none</httpAuthenticationMethod></HttpHostNotification>`;
    const r = await this.request('PUT', '/ISAPI/Event/notification/httpHosts/1', { body: xml, contentType: 'application/xml' });
    if (r.status !== 200) throw new BridgeError('listener_not_supported', safeDetail(subStatus(r.text) || `HTTP ${r.status}`));
  }

  /** Solo lectura: ¿el lector ya tiene un destino de avisos configurado? (para --check) */
  async listenerHost() {
    const r = await this.request('GET', '/ISAPI/Event/notification/httpHosts');
    if (r.status !== 200) return null;
    return { host: xmlTag(r.text, 'hostName') || xmlTag(r.text, 'ipAddress') || '', url: xmlTag(r.text, 'url') || '' };
  }
}

/**
 * HUE-07 · Alta de persona → captura → guardado en el lector.
 * La plantilla vive solo en variables locales de esta función y se suelta en cuanto el lector la recibe.
 * Devuelve únicamente calidad y número de dedo: nada biométrico.
 */
export async function enrollFingerprint(device, { employee_no, name, finger_no = 1 }, {
  captureTimeoutMs = 45000, onWaiting, onDeviceMode, deviceModeTimeoutMs = 240000, pollMs = 4000,
} = {}) {
  await device.upsertPerson(employee_no, name);
  onWaiting?.();
  let capture;
  try {
    capture = await device.captureFingerprint(finger_no, captureTimeoutMs);
  } catch (e) {
    // Algunos firmwares no permiten capturar a distancia: la persona ya existe en el lector, así que la
    // huella se registra en la pantalla del propio lector (Gestión de personas → número) y aquí se espera
    // a que aparezca. Así funciona con cualquier modelo de la serie.
    if (!(e instanceof BridgeError && e.code === 'not_supported')) throw e;
    return waitForFingerprintOnDevice(device, { employee_no, finger_no, onDeviceMode, timeoutMs: deviceModeTimeoutMs, pollMs });
  }
  const quality = capture.quality;
  try {
    await device.setFingerprint(employee_no, finger_no, capture.fingerData);
  } finally {
    capture.fingerData = null;
    capture = null;
  }
  return { quality, finger_no: Number(finger_no) || 1, mode: 'remote' };
}

/** Espera a que la persona tenga al menos una huella registrada en el lector (alta hecha en la pantalla del lector). */
export async function waitForFingerprintOnDevice(device, { employee_no, finger_no = 1, onDeviceMode, timeoutMs = 240000, pollMs = 4000 }) {
  const before = await device.countFingerprints(employee_no).catch(() => 0);
  await onDeviceMode?.({ employee_no: String(employee_no), existing: before });
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await sleep(pollMs);
    let n = 0;
    try { n = await device.countFingerprints(employee_no); } catch { continue; }
    if (n > before || (before === 0 && n > 0)) return { quality: null, finger_no: Number(finger_no) || 1, mode: 'on_device', fingerprints: n };
    await onDeviceMode?.({ employee_no: String(employee_no), existing: before, heartbeat: true });
  }
  throw new BridgeError('device_enroll_timeout');
}

// ───────────────────────── configuración y estado ─────────────────────────
function isLocalHost(hostname) {
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname) || hostname.endsWith('.local')) return true;
  // Red privada de la clínica (prueba con la app corriendo en una PC de la misma red).
  const m = hostname.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function loadConfig(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`No se encontró ${file}. Copia config.example.json como config.json y pega ahí los datos de "Configuración → Lector de huellas → Datos de conexión".`);
  }
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(`config.json no es un JSON válido (${e.message}). Vuelve a copiarlo desde la pantalla de Configuración.`);
  }
  const problems = [];
  let url = null;
  try { url = new URL(String(cfg.cloud_url ?? '')); } catch { problems.push('cloud_url: falta la dirección de la aplicación (por ejemplo https://app.tuclinica.mx).'); }
  if (url && url.protocol !== 'https:' && !isLocalHost(url.hostname)) problems.push('cloud_url: debe empezar con https:// (http:// solo se permite con localhost o una IP de la red local).');
  if (typeof cfg.bridge_token !== 'string' || cfg.bridge_token.length < 16) problems.push('bridge_token: falta el token del agente puente.');
  if (cfg.device !== undefined && (typeof cfg.device !== 'object' || cfg.device === null)) problems.push('device: debe ser un objeto { host, port, https, username, password }.');
  if (problems.length) throw new Error('config.json incompleto:\n' + problems.map((p) => '  · ' + p).join('\n'));
  return {
    cloud_url: String(cfg.cloud_url).replace(/\/+$/, ''),
    bridge_token: cfg.bridge_token,
    device: cfg.device ?? null,
    timezone: cfg.timezone || 'America/Mexico_City',
    events_interval_seconds: Number(cfg.events_interval_seconds) || 15,
    capture_timeout_seconds: Number(cfg.capture_timeout_seconds) || 45,
    initial_backfill_hours: Number(cfg.initial_backfill_hours) || 24,
    delete_poll_ms: Number(cfg.delete_poll_ms) || 1000,
    device_enroll_timeout_seconds: Number(cfg.device_enroll_timeout_seconds) || 240,
    device_enroll_poll_ms: Number(cfg.device_enroll_poll_ms) || 4000,
  };
}

/** state.json: hasta dónde ya se enviaron eventos y resultados que la nube aún no recibe. Sin secretos ni huellas. */
export function loadState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { cursor: s.cursor ?? null, last_event_time: s.last_event_time ?? null, pending_results: Array.isArray(s.pending_results) ? s.pending_results : [] };
  } catch {
    return { cursor: null, last_event_time: null, pending_results: [] };
  }
}
export function saveState(file, state) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

/** Última defensa antes de enviar un resultado: elimina cualquier clave con pinta de plantilla. */
/** Quita plantillas biométricas e imágenes de un texto crudo del lector (XML o JSON) antes de mostrarlo o guardarlo. */
export function scrubText(text) {
  return String(text ?? '')
    .replace(/("(?:fingerData|faceData|fingerPrintData|modelData|picData)"\s*:\s*")[^"]*"/gi, '$1[omitido]"')
    .replace(/<(fingerData|faceData|modelData|picData)>[\s\S]*?<\/\1>/gi, '<$1>[omitido]</$1>')
    .replace(/[A-Za-z0-9+/=]{200,}/g, '[omitido]');
}

export function scrubResult(value, depth = 0) {
  if (value === null || typeof value !== 'object' || depth > 8) {
    return typeof value === 'string' && value.length > 300 ? '[omitido]' : value;
  }
  if (Array.isArray(value)) return value.map((v) => scrubResult(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (/finger.?(print)?.?(data|template)|face.?data|biometric/i.test(k)) continue;
    out[k] = scrubResult(v, depth + 1);
  }
  return out;
}

// ───────────────────────── el agente ─────────────────────────
export class Bridge {
  constructor(config, { stateFile, quiet = false } = {}) {
    this.config = config;
    this.stateFile = stateFile;
    this.state = loadState(stateFile);
    this.quiet = quiet;
    this.device = config.device ? new HikDevice(config.device) : null;
    this.deviceFromCloud = !config.device;
    this.deviceReachable = null;
    this.deviceError = '';
    this.deviceInfo = null;
    this.lastInfoAt = 0;
    this.lastEventsAt = 0;
    this.skewSeconds = 0;
    this.lastSkewAt = 0;
    this.pollSeconds = 2;
    this.backfillSince = null;
    this.cloudOk = null;
  }

  log(msg) { if (!this.quiet) log(msg); }

  // ── nube ──
  async cloud(pathname, body) {
    let res;
    try {
      res = await fetch(this.config.cloud_url + pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.bridge_token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      throw new BridgeError('cloud_unreachable', safeDetail(e?.cause?.code || e?.name || 'sin conexión'));
    }
    const json = await res.json().catch(() => null);
    if (res.status === 401) throw new BridgeError('cloud_unauthorized', 'la nube rechazó el token del agente');
    if (!res.ok || !json?.ok) {
      const err = new BridgeError(res.status >= 500 || !json ? 'cloud_unreachable' : 'cloud_rejected', `HTTP ${res.status} ${safeDetail(json?.error?.code ?? '')}`);
      err.status = res.status;
      throw err;
    }
    return json.data;
  }

  // ── lector ──
  useDeviceConfig(c) {
    if (!this.deviceFromCloud || !c || !c.host) return;
    const next = { host: c.host, port: c.port, https: c.use_https, username: c.username, password: c.password };
    if (!this.device || !this.device.sameAs(next)) {
      this.device = new HikDevice(next);
      this.lastInfoAt = 0;
      this.log(`Datos del lector recibidos de la nube (${c.use_https ? 'https' : 'http'}://${c.host}:${c.port}).`);
    }
  }

  markDevice(err) {
    const was = this.deviceReachable;
    if (!err) {
      this.deviceReachable = true;
      this.deviceError = '';
      if (was === false) this.log('El lector volvió a responder.');
      return;
    }
    if (err instanceof BridgeError && ['device_unreachable', 'device_timeout', 'auth_failed', 'device_not_configured'].includes(err.code)) {
      this.deviceReachable = false;
      this.deviceError = err.code;
      if (was !== false) this.log(`Sin conexión con el lector (${err.code}${err.detail ? ' · ' + err.detail : ''}).`);
    }
  }

  async refreshDeviceInfo(force = false) {
    if (!this.device?.host) return;
    if (!force && Date.now() - this.lastInfoAt < 60000) return;
    this.lastInfoAt = Date.now();
    try {
      this.deviceInfo = await this.device.deviceInfo();
      this.markDevice(null);
    } catch (e) {
      this.markDevice(e);
    }
    if (this.deviceReachable && Date.now() - this.lastSkewAt > 10 * 60000) {
      this.lastSkewAt = Date.now();
      try {
        const skew = await this.device.clockSkewSeconds();
        if (skew !== null) {
          this.skewSeconds = skew;
          if (Math.abs(skew) > 60) this.log(`Aviso: el reloj del lector difiere ${skew} s del de esta PC. Usa "Sincronizar hora" en Configuración.`);
        }
      } catch { /* no todos los firmwares exponen la hora */ }
    }
  }

  // ── órdenes ──
  async execute(cmd) {
    const p = cmd.payload ?? {};
    const dev = this.device;
    if (!dev?.host) throw new BridgeError('device_not_configured');
    switch (cmd.kind) {
      case 'ping': {
        const info = await dev.deviceInfo();
        this.deviceInfo = info;
        let skew = null;
        try { skew = await dev.clockSkewSeconds(); } catch { /* opcional */ }
        return { model: info.model, serial: info.serial, firmware: info.firmware, clock_skew_seconds: skew };
      }
      case 'sync_time': {
        const r = await dev.syncTime(this.config.timezone);
        this.skewSeconds = 0;
        return r;
      }
      case 'upsert_person': {
        if (!p.employee_no) throw new BridgeError('bad_payload');
        return dev.upsertPerson(p.employee_no, p.name);
      }
      case 'enroll_fingerprint': {
        if (!p.employee_no) throw new BridgeError('bad_payload');
        await this.progress(cmd.id, { stage: 'capturing' });
        return enrollFingerprint(dev, p, {
          captureTimeoutMs: this.config.capture_timeout_seconds * 1000,
          deviceModeTimeoutMs: this.config.device_enroll_timeout_seconds * 1000,
          pollMs: this.config.device_enroll_poll_ms,
          onWaiting: () => this.log(`Enrolamiento de ${p.employee_no}: esperando el dedo en el lector…`),
          onDeviceMode: async (st) => {
            if (!st.heartbeat) this.log(`El lector no permite captura a distancia: registra la huella de ${p.employee_no} en la pantalla del lector.`);
            await this.progress(cmd.id, { stage: 'on_device', employee_no: String(p.employee_no) });
          },
        });
      }
      case 'list_persons': {
        const persons = await dev.listPersons();
        return { persons, total: persons.length };
      }
      case 'delete_person': {
        if (!p.employee_no) throw new BridgeError('bad_payload');
        await dev.deletePerson(p.employee_no, { pollMs: this.config.delete_poll_ms ?? 1000 });
        return { deleted: true };
      }
      case 'backfill_events': {
        const from = new Date(p.from), to = new Date(p.to);
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw new BridgeError('bad_payload');
        const r = await this.pullEvents(from, to);
        return { read: r.read, sent: r.sent, created: r.created };
      }
      case 'configure_listener': {
        if (!p.host || !p.path) throw new BridgeError('bad_payload');
        await dev.configureListener(p);
        return { configured: true };
      }
      default:
        throw new BridgeError('unknown_command', safeDetail(cmd.kind));
    }
  }

  /** Avisa a la nube en qué paso va una orden larga (y la mantiene viva mientras espera). Nunca lanza. */
  async progress(commandId, data) {
    try {
      await this.cloud('/api/bridge/progress', { command_id: commandId, ...data });
    } catch { /* si la nube no responde, la orden sigue y el resultado se entrega después */ }
  }

  async runCommand(cmd) {
    this.log(`Orden recibida: ${cmd.kind}.`);
    let report;
    try {
      const result = await this.execute(cmd);
      this.markDevice(null);
      report = { command_id: cmd.id, ok: true, result: scrubResult(result ?? {}) };
      this.log(`Orden ${cmd.kind}: lista.`);
    } catch (e) {
      this.markDevice(e);
      const code = e instanceof BridgeError ? (e.detail ? `${e.code}: ${safeDetail(e.detail)}` : e.code) : `error: ${safeDetail(e?.message)}`;
      report = { command_id: cmd.id, ok: false, error: code };
      this.log(`Orden ${cmd.kind}: falló (${code}).`);
    }
    // Se guarda en la cola local (sin datos sensibles) por si la nube no responde en este momento.
    this.state.pending_results.push(report);
    saveState(this.stateFile, this.state);
    await this.flushResults();
  }

  async flushResults() {
    while (this.state.pending_results.length) {
      const r = this.state.pending_results[0];
      try {
        await this.cloud('/api/bridge/result', r);
      } catch (e) {
        if (e instanceof BridgeError && e.code === 'cloud_rejected') {
          this.log(`La nube no aceptó el resultado de una orden (${e.detail}); se descarta.`);
        } else {
          return false; // sin nube: se reintenta en el siguiente ciclo
        }
      }
      this.state.pending_results.shift();
      saveState(this.stateFile, this.state);
    }
    return true;
  }

  // ── eventos (HUE-05 / HUE-08) ──
  /** Lee del lector un rango y lo manda a la nube en lotes. Lanza si el lector o la nube fallan. */
  async pullEvents(from, to) {
    let sent = 0, created = 0, lastTime = this.state.last_event_time;
    const read = await this.device.searchEvents(from, to, this.config.timezone, async (events) => {
      for (let i = 0; i < events.length; i += 100) {
        const batch = events.slice(i, i + 100);
        const r = await this.cloud('/api/bridge/events', { events: batch });
        sent += batch.length;
        created += Number(r?.created ?? 0);
      }
      for (const e of events) if (!lastTime || Date.parse(e.time) > Date.parse(lastTime)) lastTime = e.time;
    });
    if (lastTime !== this.state.last_event_time) this.state.last_event_time = lastTime;
    return { read, sent, created };
  }

  /**
   * Consulta periódica del historial. El cursor (state.json) solo avanza cuando un tramo completo
   * llegó a la nube: tras un corte de internet se reanuda desde el último punto confirmado y no se
   * pierde nada. Cada consulta retrocede un margen para tolerar desfases de reloj; la nube descarta
   * los repetidos por su llave de idempotencia.
   */
  async syncEvents() {
    if (!this.device?.host) return { skipped: true };
    const now = new Date();
    const overlapMs = (120 + Math.abs(this.skewSeconds)) * 1000;
    let cursor = this.state.cursor ? new Date(this.state.cursor) : null;
    if (!cursor || Number.isNaN(cursor.getTime())) {
      const since = this.backfillSince ? new Date(this.backfillSince) : null;
      const floor = new Date(now.getTime() - this.config.initial_backfill_hours * 3600 * 1000);
      cursor = since && !Number.isNaN(since.getTime()) && since > floor ? since : floor;
    }
    const WINDOW = 6 * 3600 * 1000;
    const end = new Date(now.getTime() + Math.max(0, this.skewSeconds) * 1000 + 60000);
    let total = { read: 0, sent: 0, created: 0 };
    let start = new Date(cursor.getTime() - overlapMs);
    try {
      while (start < end) {
        const stop = new Date(Math.min(start.getTime() + WINDOW, end.getTime()));
        const r = await this.pullEvents(start, stop);
        total = { read: total.read + r.read, sent: total.sent + r.sent, created: total.created + r.created };
        // Tramo confirmado: el cursor nunca pasa de "ahora" para no saltarse lo que aún no ocurre.
        this.state.cursor = new Date(Math.min(stop.getTime(), now.getTime())).toISOString();
        saveState(this.stateFile, this.state);
        start = stop;
      }
      this.markDevice(null);
    } catch (e) {
      this.markDevice(e);
      saveState(this.stateFile, this.state);
      throw e;
    }
    if (total.created) this.log(`Eventos del lector: ${total.created} asistencia(s) nueva(s) enviadas a la nube.`);
    return total;
  }

  // ── ciclo ──
  async cycle({ forceEvents = false } = {}) {
    let cloudOk = true;
    await this.flushResults().catch(() => {});
    await this.refreshDeviceInfo();
    let data = null;
    try {
      data = await this.cloud('/api/bridge/poll', {
        version: VERSION,
        ...(this.deviceReachable === null ? {} : { device_reachable: this.deviceReachable }),
        ...(this.deviceInfo ? { device_info: { model: this.deviceInfo.model, serial: this.deviceInfo.serial, firmware: this.deviceInfo.firmware } } : {}),
        ...(this.deviceError ? { device_error: this.deviceError } : {}),
      });
    } catch (e) {
      cloudOk = false;
      if (this.cloudOk !== false) this.log(`Sin conexión con la nube (${e.message}). Se reintentará.`);
      if (e instanceof BridgeError && e.code === 'cloud_unauthorized') this.unauthorized = true;
    }
    if (data) {
      if (this.cloudOk === false) this.log('La conexión con la nube se restableció.');
      this.pollSeconds = Math.min(Math.max(Number(data.config?.poll_seconds) || 2, 1), 30);
      this.backfillSince = data.config?.backfill_since ?? null;
      this.useDeviceConfig(data.config);
      if (this.deviceReachable === null) await this.refreshDeviceInfo(true);
      for (const cmd of data.commands ?? []) await this.runCommand(cmd);
    }
    this.cloudOk = cloudOk;

    if (forceEvents || Date.now() - this.lastEventsAt >= this.config.events_interval_seconds * 1000) {
      this.lastEventsAt = Date.now();
      try {
        await this.syncEvents();
      } catch (e) {
        if (e instanceof BridgeError && e.code.startsWith('cloud')) {
          cloudOk = false;
          if (this.eventsCloudOk !== false) this.log('Los eventos leídos no se pudieron enviar a la nube; se reenviarán desde el último punto confirmado.');
          this.eventsCloudOk = false;
        } else if (!(e instanceof BridgeError)) {
          this.log(`Error al leer eventos: ${safeDetail(e?.message)}`);
        }
      }
      if (cloudOk) this.eventsCloudOk = true;
    }
    if (!(await this.flushResults().catch(() => false))) cloudOk = false;
    this.cloudOk = cloudOk;
    return { cloudOk, deviceReachable: this.deviceReachable };
  }

  async run({ once = false } = {}) {
    this.log(`Agente puente ${VERSION} iniciado. Nube: ${this.config.cloud_url}`);
    let backoff = 0;
    let stop = false;
    const onSignal = () => { stop = true; this.log('Deteniendo el agente…'); };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    let last = { cloudOk: false, deviceReachable: null };
    while (!stop) {
      last = await this.cycle({ forceEvents: once });
      if (once) break;
      if (this.unauthorized) {
        this.log('La nube rechazó el token. Copia de nuevo config.json desde Configuración → Lector de huellas → Datos de conexión.');
        backoff = 60;
      } else if (last.cloudOk) backoff = 0;
      else backoff = Math.min(backoff ? backoff * 2 : 2, 60); // 2, 4, 8 … 60 s
      const wait = (backoff || this.pollSeconds) * 1000;
      for (let t = 0; t < wait && !stop; t += 250) await sleep(250);
    }
    return last;
  }

  // ── diagnóstico (--check) ──
  async check() {
    const out = [];
    const ok = (m) => out.push(`  [OK]    ${m}`);
    const bad = (m, hint) => { out.push(`  [FALLA] ${m}`); if (hint) out.push(`          → ${hint}`); failures++; };
    const info = (m) => out.push(`  [INFO]  ${m}`);
    let failures = 0;

    ok(`config.json leído. Nube: ${this.config.cloud_url}`);
    let cloudConfig = null;
    try {
      const hb = await this.cloud('/api/bridge/heartbeat', { version: VERSION });
      ok(`La nube respondió y aceptó el token. Lector registrado: "${hb.device_name}".`);
      const poll = await this.cloud('/api/bridge/poll', { version: VERSION, dry_run: true });
      cloudConfig = poll.config;
    } catch (e) {
      if (e.code === 'cloud_unauthorized') bad('La nube rechazó el token del agente.', 'Copia de nuevo config.json desde Configuración → Lector de huellas → Datos de conexión.');
      else bad(`No se pudo conectar con la nube (${e.message}).`, 'Revisa el internet de esta PC y que cloud_url sea la dirección correcta de la aplicación.');
    }

    this.useDeviceConfig(cloudConfig);
    const dev = this.device;
    if (!dev?.host) {
      bad('No hay dirección del lector.', 'Captura IP, usuario y contraseña del lector en Configuración → Lector de huellas (o en "device" de config.json).');
    } else if (!dev.password) {
      bad('No hay contraseña del lector.', 'Captúrala en Configuración → Lector de huellas → Editar.');
    } else {
      info(`Lector: ${dev.https ? 'https' : 'http'}://${dev.host}:${dev.port} · usuario ${dev.username} · datos tomados de ${this.deviceFromCloud ? 'la nube' : 'config.json'}`);
      try {
        const di = await dev.deviceInfo();
        ok(`El lector respondió con autenticación Digest. Modelo ${di.model || '¿?'} · serie ${di.serial || '¿?'} · firmware ${di.firmware || '¿?'}`);
        try {
          const skew = await dev.clockSkewSeconds();
          if (skew === null) info('El lector no informó su hora.');
          else if (Math.abs(skew) > 60) bad(`El reloj del lector difiere ${skew} s del de esta PC.`, 'Usa "Sincronizar hora" en Configuración → Lector de huellas.');
          else ok(`Reloj del lector en hora (diferencia de ${skew} s).`);
        } catch { info('No se pudo leer la hora del lector.'); }
        try {
          const now = new Date();
          const n = await dev.searchEvents(new Date(now.getTime() - 3600 * 1000), new Date(now.getTime() + 60000), this.config.timezone, async () => {});
          ok(`Consulta del historial de eventos correcta (${n} evento(s) en la última hora).`);
        } catch (e) { bad(`El lector no entregó su historial de eventos (${e.message}).`); }
        try {
          const l = await dev.listenerHost();
          if (!l) info('No se pudo leer la configuración de "HTTP Listening" del lector (se puede capturar a mano).');
          else if (!l.host) info('El lector NO tiene configurado el aviso de eventos (HTTP Listening). Las asistencias llegarán por este agente cada 15 s.');
          else ok(`Aviso de eventos del lector configurado hacia ${l.host}.`);
        } catch { info('No se pudo leer la configuración de "HTTP Listening" del lector.'); }
      } catch (e) {
        if (e.code === 'auth_failed') bad('El lector rechazó el usuario o la contraseña.', 'Corrígelos en Configuración → Lector de huellas → Editar. Ojo: varios intentos fallidos bloquean al lector unos minutos.');
        else bad(`No se pudo conectar con el lector (${e.message}).`, 'Revisa que esté encendido, que la IP sea la correcta y que esta PC esté en la misma red. Prueba abrir la dirección del lector en el navegador.');
      }
    }
    try { await this.cloud('/api/bridge/heartbeat', { version: VERSION, ...(dev?.host ? { device_reachable: failures === 0 } : {}) }); } catch { /* ya reportado */ }
    return { failures, lines: out };
  }
}


// ───────────────────────── pruebas contra el lector real ─────────────────────────
const PROBE_PATHS = [
  ['Capacidades de control de acceso', '/ISAPI/AccessControl/capabilities'],
  ['Alta de personas (UserInfo)', '/ISAPI/AccessControl/UserInfo/capabilities?format=json'],
  ['Huellas (FingerPrintCfg)', '/ISAPI/AccessControl/FingerPrintCfg/capabilities?format=json'],
  ['Captura de huella a distancia', '/ISAPI/AccessControl/CaptureFingerPrint/capabilities'],
  ['Historial de eventos (AcsEvent)', '/ISAPI/AccessControl/AcsEvent/capabilities?format=json'],
  ['Aviso de eventos por HTTP (HTTP Listening)', '/ISAPI/Event/notification/httpHosts/capabilities'],
  ['Hora del lector', '/ISAPI/System/time'],
];

/**
 * --probe · Prueba de SOLO LECTURA contra el lector. No da de alta ni borra nada.
 * Devuelve un reporte sin datos biométricos para revisar compatibilidad con este modelo y firmware.
 */
export async function probeDevice(dev, { timeZone = 'America/Mexico_City', print = console.log } = {}) {
  const report = { version: VERSION, at: new Date().toISOString(), host: dev.host, checks: [], persons: [], events: [], capabilities: {} };
  const ok = (m) => { report.checks.push({ ok: true, msg: m }); print(`  [OK]    ${m}`); };
  const bad = (m) => { report.checks.push({ ok: false, msg: m }); print(`  [FALLA] ${m}`); };
  const info = (m) => { report.checks.push({ info: true, msg: m }); print(`  [INFO]  ${m}`); };
  try {
    const di = await dev.deviceInfo();
    report.device = di;
    ok(`Conexión y autenticación Digest. Modelo ${di.model} · serie ${di.serial} · firmware ${di.firmware}`);
  } catch (e) {
    bad(`No se pudo conectar con el lector (${e.code ?? e.message}). Revisa IP, usuario, contraseña y que esta PC esté en la misma red.`);
    return report;
  }
  for (const [label, uri] of PROBE_PATHS) {
    const r = await dev.probeGet(uri);
    report.capabilities[uri] = r;
    (r.supported ? ok : info)(`${label}: ${r.supported ? 'disponible' : `no disponible (HTTP ${r.status || r.error})`}`);
  }
  try {
    const skew = await dev.clockSkewSeconds();
    report.clock_skew_seconds = skew;
    if (skew !== null) (Math.abs(skew) > 60 ? bad : ok)(`Reloj del lector: diferencia de ${skew} s con esta PC`);
  } catch { info('No se pudo leer la hora del lector.'); }
  try {
    report.persons = await dev.listPersons();
    ok(`Personas en el lector: ${report.persons.length}`);
    for (const p of report.persons.slice(0, 20)) print(`          · ${p.employee_no.padEnd(12)} ${p.name || '(sin nombre)'} · ${p.fingerprints} huella(s)`);
  } catch (e) { bad(`No se pudo listar las personas (${e.code ?? e.message}).`); }
  for (const p of report.persons.filter((x) => x.fingerprints > 0).slice(0, 3)) {
    try {
      const n = await dev.countFingerprints(p.employee_no);
      ok(`Consulta de huellas de ${p.employee_no}: ${n} (la plantilla se descarta, no se guarda)`);
    } catch (e) { bad(`No se pudo consultar las huellas de ${p.employee_no} (${e.code ?? e.message}). El registro en la pantalla del lector no se podrá confirmar automáticamente.`); }
  }
  try {
    const now = new Date();
    const evs = [];
    await dev.searchEvents(new Date(now.getTime() - 7 * 86400000), new Date(now.getTime() + 60000), timeZone, async (page) => { evs.push(...page); });
    report.events = evs.slice(-15);
    ok(`Historial de eventos de los últimos 7 días: ${evs.length} lectura(s) de personas`);
    for (const e of report.events) print(`          · ${e.time} · persona ${e.employee_no} · subtipo ${e.minor} · modo ${e.verify_mode || '¿?'}`);
  } catch (e) { bad(`No se pudo leer el historial de eventos (${e.code ?? e.message}).`); }
  try {
    const l = await dev.listenerHost();
    report.listener = l;
    if (l?.host) ok(`Aviso de eventos (HTTP Listening) configurado hacia ${l.host}${l.url ? ' · ' + l.url.replace(/[A-Za-z0-9_-]{20,}/, '<token>') : ''}`);
    else info('El lector no tiene configurado el aviso de eventos (HTTP Listening).');
  } catch { info('No se pudo leer el aviso de eventos.'); }
  return report;
}

/**
 * --probe-enroll · Prueba completa con una persona TEMPORAL (número NCE-PRUEBA): alta → huella → lectura
 * (check-in) → baja. Pide confirmación en consola en cada paso que requiere a alguien frente al lector.
 */
export async function probeEnroll(dev, { ask, print = console.log, timeZone = 'America/Mexico_City', captureTimeoutMs = 45000 } = {}) {
  const EMP = 'NCEPRUEBA';
  const steps = [];
  const step = (ok, msg) => { steps.push({ ok, msg }); print(`  [${ok ? 'OK' : 'FALLA'}]${ok ? '    ' : ' '}${msg}`); return ok; };
  try {
    await dev.upsertPerson(EMP, 'Prueba Nicolas Center');
    step(true, `Alta de la persona temporal ${EMP} en el lector.`);
  } catch (e) { step(false, `Alta de persona (${e.code ?? e.message}).`); return steps; }
  try {
    await ask('Coloca un dedo en el lector cuando se encienda y presiona Enter para empezar la captura…');
    const r = await enrollFingerprint(dev, { employee_no: EMP, name: 'Prueba Nicolas Center', finger_no: 1 }, {
      captureTimeoutMs,
      onDeviceMode: async (st) => {
        if (!st.heartbeat) print(`  [INFO]  Este firmware no captura a distancia. En la pantalla del lector: Gestión de personas → ${EMP} → Huella, y registra un dedo (tienes 4 min).`);
      },
    });
    step(true, `Huella registrada (${r.mode === 'remote' ? 'captura a distancia desde la app' : 'registro en la pantalla del lector, confirmado automáticamente'}).`);
  } catch (e) {
    step(false, `Registro de huella (${e.code ?? e.message}).`);
  }
  try {
    const t0 = new Date(Date.now() - 5000);
    await ask('Ahora pon el MISMO dedo en el lector como si fuera un check-in y presiona Enter…');
    await sleep(2500);
    const evs = [];
    await dev.searchEvents(t0, new Date(Date.now() + 60000), timeZone, async (page) => { evs.push(...page); });
    const mine = evs.filter((e) => e.employee_no === EMP);
    step(mine.length > 0, mine.length ? `Lectura encontrada en el historial: ${mine.at(-1).time} · subtipo ${mine.at(-1).minor}.` : 'No apareció la lectura en el historial (¿la huella no se reconoció?).');
  } catch (e) { step(false, `Consulta de la lectura (${e.code ?? e.message}).`); }
  try {
    await dev.deletePerson(EMP);
    step(true, `Baja de la persona temporal ${EMP}.`);
  } catch (e) { step(false, `Baja de persona (${e.code ?? e.message}). Bórrala a mano en el lector.`); }
  return steps;
}

// ───────────────────────── línea de comandos ─────────────────────────
async function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i !== -1 ? argv[i + 1] : null; };
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Uso: node bridge.mjs [--check | --once | --probe | --probe-enroll] [--config ruta] [--state ruta] [--host ip --user u --pass p --http]');
    return 0;
  }
  const configFile = path.resolve(arg('--config') ?? path.join(HERE, 'config.json'));
  const stateFile = path.resolve(arg('--state') ?? path.join(path.dirname(configFile), 'state.json'));

  if (argv.includes('--probe') || argv.includes('--probe-enroll')) {
    // Datos del lector: línea de comandos > "device" de config.json > los que entrega la nube.
    let dev = null, tz = 'America/Mexico_City', cfg = null;
    if (arg('--host')) {
      const https = !argv.includes('--http');
      dev = new HikDevice({ host: arg('--host'), port: Number(arg('--port')) || (https ? 443 : 80), https, username: arg('--user') || 'admin', password: arg('--pass') || '' });
    } else {
      try { cfg = loadConfig(configFile); } catch (e) { console.error(e.message + '\nO bien usa: node bridge.mjs --probe --host 192.168.80.212 --user admin --pass ****'); return 2; }
      tz = cfg.timezone;
      if (cfg.device) dev = new HikDevice(cfg.device);
      else {
        const b = new Bridge(cfg, { stateFile, quiet: true });
        try { b.useDeviceConfig((await b.cloud('/api/bridge/poll', { version: VERSION, dry_run: true })).config); } catch (e) { console.error(`No se pudieron obtener los datos del lector desde la nube (${e.message}).`); return 2; }
        dev = b.device;
      }
    }
    if (!dev?.host) { console.error('Faltan los datos del lector.'); return 2; }
    if (argv.includes('--probe-enroll')) {
      const readline = await import('node:readline/promises');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      console.log(`\nPrueba completa contra ${dev.host} (persona temporal NCEPRUEBA)\n`);
      const steps = await probeEnroll(dev, { timeZone: tz, ask: (q) => rl.question(`\n  → ${q}`) });
      rl.close();
      const failed = steps.filter((x) => !x.ok).length;
      console.log(failed ? `\n${failed} paso(s) fallaron. Manda esta salida a quien mantiene el sistema.\n` : '\nEl lector es 100% compatible: alta, huella, check-in y baja funcionan.\n');
      return failed ? 1 : 0;
    }
    console.log(`\nPrueba de solo lectura contra ${dev.host}\n`);
    const report = await probeDevice(dev, { timeZone: tz });
    const out = path.resolve(path.dirname(configFile), 'probe-report.json');
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    const failed = report.checks.filter((c) => c.ok === false).length;
    console.log(`\nReporte guardado en ${out} (sin datos biométricos).`);
    console.log(failed ? `${failed} problema(s). Manda probe-report.json a quien mantiene el sistema.\n` : 'Sin problemas de solo lectura. Siguiente paso: node bridge.mjs --probe-enroll\n');
    return failed ? 1 : 0;
  }

  let config;
  try {
    config = loadConfig(configFile);
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  const bridge = new Bridge(config, { stateFile });
  if (argv.includes('--check')) {
    console.log(`\nDiagnóstico del agente puente ${VERSION}\n`);
    const r = await bridge.check();
    console.log(r.lines.join('\n'));
    console.log(r.failures ? `\nHay ${r.failures} problema(s) por resolver.\n` : '\nTodo en orden. Ya puedes instalar el servicio (install-windows.ps1).\n');
    return r.failures ? 1 : 0;
  }
  const last = await bridge.run({ once: argv.includes('--once') });
  return argv.includes('--once') && !last.cloudOk ? 3 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    console.error('Error inesperado:', safeDetail(e?.message));
    process.exitCode = 1;
  });
}
