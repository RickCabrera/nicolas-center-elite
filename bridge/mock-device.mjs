#!/usr/bin/env node
/**
 * Simulador del lector Hikvision DS-K1T321EFWX-B para pruebas y demostraciones (sin dependencias).
 *
 * Implementa, con estado en memoria y autenticación HTTP Digest (MD5, qop=auth), los endpoints ISAPI que usa
 * el agente puente. NO es el lector real: las respuestas imitan la documentación de ISAPI, y lo que solo se
 * puede confirmar con el equipo físico está listado en README.md ("Pendiente de validar en el equipo real").
 *
 * Como programa:
 *   node mock-device.mjs --port 8088 --user admin --password Prueba123 [--auto-finger 2500] [--webhook URL]
 *
 * Control (sin autenticación, solo para pruebas):
 *   POST /__control/finger   { "quality": 85 } | { "fail": "timeout" | "quality" }   "pone el dedo" en la captura
 *   POST /__control/scan     { "employeeNo": "P1002" }     una persona pasa el dedo: evento 38 si está enrolada, 39 si no
 *   POST /__control/event    { "employeeNo", "minor", "time" }   agrega un evento arbitrario al historial
 *   POST /__control/webhook  { "url": "https://…/api/hik/events/TOKEN" }   a dónde empujar los eventos
 *   GET  /__control/state    personas, huellas (solo si existen), eventos, peticiones
 *
 * Como módulo:  const dev = await startMockDevice({ password: 'x' });  dev.placeFinger(); dev.addEvent({...}); await dev.close();
 */
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const pad = (n) => String(n).padStart(2, '0');
const xmlTag = (xml, name) => {
  const m = String(xml).match(new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}\\s*>`, 'i'));
  return m ? m[1].trim() : null;
};

/** Hora local del "lector" con desfase fijo (por defecto UTC-6). */
function deviceTime(date, offsetMin) {
  const d = new Date(date.getTime() + offsetMin * 60000);
  const sign = offsetMin < 0 ? '-' : '+';
  const a = Math.abs(offsetMin);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export async function startMockDevice(opts = {}) {
  const cfg = {
    port: 0, host: '127.0.0.1', username: 'admin', password: 'Prueba123', tls: null,
    captureTimeoutMs: 3000, autoFingerMs: null, offsetMin: -360, pushPhoto: true,
    model: 'DS-K1T321EFWX-B', serial: 'DS-K1T321EFWX-B20260130V030950ENFX0000001', firmware: 'V3.9.50', build: 'build 260130',
    deleteSteps: 1, listenerSupported: true, captureSupported: true, quiet: true,
    ...opts,
  };
  const realm = 'DS-MOCK';
  const nonces = new Map(); // nonce → expira
  const state = {
    users: new Map(),         // employeeNo → { name, userType }
    fingerprints: new Map(),  // employeeNo → { fingerPrintID, fingerData }
    events: [],               // { major, minor, time, employeeNoString?, name?, serialNo, currentVerifyMode }
    serial: 0,
    clockOffsetMs: 0,         // desfase del reloj del lector respecto al real
    timeZone: 'CST+6:00:00',
    listener: null,           // { protocol, host, port, url }
    webhookUrl: cfg.webhookUrl ?? null,
    requests: [],             // { method, path, authorized }
    authFailures: 0,
    pendingCapture: null,     // { resolve }
    queuedFinger: null,
    lastCaptured: null,
    deleteProgress: 0,
    pushes: [],               // promesas de envíos al webhook (para pruebas)
  };
  const now = () => new Date(Date.now() + state.clockOffsetMs);

  const newNonce = () => {
    const n = crypto.randomBytes(16).toString('hex');
    nonces.set(n, Date.now() + 5 * 60000);
    return n;
  };
  function checkDigest(req) {
    const h = req.headers.authorization ?? '';
    if (!/^Digest /i.test(h)) return false;
    const p = {};
    for (const m of h.slice(7).matchAll(/([a-zA-Z]+)\s*=\s*(?:"([^"]*)"|([^\s,]+))/g)) p[m[1].toLowerCase()] = m[2] ?? m[3];
    const exp = nonces.get(p.nonce);
    if (!exp || exp < Date.now()) return false;
    if (p.username !== cfg.username || p.realm !== realm || p.uri !== req.url) return false;
    const ha1 = md5(`${cfg.username}:${realm}:${cfg.password}`);
    const ha2 = md5(`${req.method}:${p.uri}`);
    const expected = p.qop ? md5(`${ha1}:${p.nonce}:${p.nc}:${p.cnonce}:${p.qop}:${ha2}`) : md5(`${ha1}:${p.nonce}:${ha2}`);
    return expected === p.response;
  }

  const send = (res, status, body, type = 'application/json') => {
    const buf = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    res.writeHead(status, { 'Content-Type': type, 'Content-Length': buf.length, Connection: 'close' });
    res.end(buf);
  };
  const okJson = (res) => send(res, 200, { statusCode: 1, statusString: 'OK', subStatusCode: 'ok' });
  const errJson = (res, sub, status = 400) => send(res, status, { statusCode: 6, statusString: 'Invalid Content', subStatusCode: sub, errorCode: 1610612737, errorMsg: sub });
  const okXml = (res) => send(res, 200, `<?xml version="1.0" encoding="UTF-8"?><ResponseStatus version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><statusCode>1</statusCode><statusString>OK</statusString><subStatusCode>ok</subStatusCode></ResponseStatus>`, 'application/xml');
  const errXml = (res, sub, status = 400) => send(res, status, `<?xml version="1.0" encoding="UTF-8"?><ResponseStatus version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><statusCode>4</statusCode><statusString>Invalid Operation</statusString><subStatusCode>${sub}</subStatusCode></ResponseStatus>`, 'application/xml');

  function addEvent({ employeeNo = null, minor = 38, major = 5, time = null, name = null, verifyMode = 'cardOrFaceOrFp', push = true } = {}) {
    const at = time ? new Date(time) : now();
    const ev = {
      major, minor, time: deviceTime(at, cfg.offsetMin), serialNo: ++state.serial, currentVerifyMode: verifyMode,
      ...(employeeNo ? { employeeNoString: String(employeeNo), name: name ?? state.users.get(String(employeeNo))?.name ?? '' } : {}),
    };
    state.events.push(ev);
    if (push && state.webhookUrl) state.pushes.push(pushEvent(ev).catch(() => 'error'));
    return ev;
  }

  /** Empuja un evento al webhook como lo hace el lector: multipart con `event_log` y una foto. */
  async function pushEvent(ev) {
    const boundary = 'MIME_boundary';
    const json = JSON.stringify({
      ipAddress: '192.168.80.212', portNo: 80, protocol: 'HTTP', macAddress: 'a4:d5:c2:00:11:22', channelID: 1,
      dateTime: ev.time, activePostCount: 1, eventType: 'AccessControllerEvent', eventState: 'active', eventDescription: 'Access Controller Event',
      AccessControllerEvent: {
        deviceName: 'Access Controller', majorEventType: ev.major, subEventType: ev.minor, cardReaderNo: 1, serialNo: ev.serialNo,
        currentVerifyMode: ev.currentVerifyMode, userType: 'normal', attendanceStatus: 'undefined', mask: 'unknown',
        ...(ev.employeeNoString ? { employeeNoString: ev.employeeNoString, name: ev.name } : {}),
      },
    });
    const parts = [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="event_log"\r\n\r\n${json}\r\n`)];
    if (cfg.pushPhoto) {
      const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(256), Buffer.from([0xff, 0xd9])]);
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="Picture"; filename="Picture.jpg"\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.length}\r\n\r\n`), jpg, Buffer.from('\r\n'));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    const r = await fetch(state.webhookUrl, { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body: Buffer.concat(parts), signal: AbortSignal.timeout(8000) });
    return r.status;
  }

  function placeFinger(o = {}) {
    const finger = { quality: o.quality ?? 85, fail: o.fail ?? null };
    if (state.pendingCapture) {
      const p = state.pendingCapture;
      state.pendingCapture = null;
      p.resolve(finger);
    } else state.queuedFinger = finger;
  }
  function waitFinger() {
    if (state.queuedFinger) {
      const f = state.queuedFinger;
      state.queuedFinger = null;
      return Promise.resolve(f);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => { state.pendingCapture = null; resolve({ fail: 'timeout' }); }, cfg.captureTimeoutMs);
      state.pendingCapture = { resolve: (f) => { clearTimeout(timer); resolve(f); } };
      if (cfg.autoFingerMs !== null) setTimeout(() => state.pendingCapture && placeFinger(), cfg.autoFingerMs);
    });
  }

  async function readBody(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return Buffer.concat(chunks).toString('utf8');
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://mock');
    const p = url.pathname;
    const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : '';

    // ── control (sin autenticación) ──
    if (p.startsWith('/__control/')) {
      const j = body ? JSON.parse(body) : {};
      if (p === '/__control/finger') { placeFinger(j); return send(res, 200, { ok: true }); }
      if (p === '/__control/event') return send(res, 200, addEvent(j));
      if (p === '/__control/scan') {
        const known = state.fingerprints.has(String(j.employeeNo));
        return send(res, 200, known ? addEvent({ employeeNo: j.employeeNo, minor: 38, time: j.time }) : addEvent({ minor: 39, time: j.time }));
      }
      if (p === '/__control/webhook') { state.webhookUrl = j.url || null; return send(res, 200, { ok: true }); }
      // Simula que alguien registró la huella en la pantalla del lector (firmware sin captura a distancia).
      if (p === '/__control/enroll-on-device') {
        if (!state.users.has(String(j.employeeNo))) return send(res, 404, { error: 'persona inexistente' });
        state.fingerprints.set(String(j.employeeNo), { fingerPrintID: 1, fingerData: crypto.randomBytes(384).toString('base64') });
        return send(res, 200, { ok: true });
      }
      if (p === '/__control/person') {
        state.users.set(String(j.employeeNo), { name: j.name ?? '', userType: 'normal' });
        if (j.fingerprint) state.fingerprints.set(String(j.employeeNo), { fingerPrintID: 1, fingerData: crypto.randomBytes(384).toString('base64') });
        return send(res, 200, { ok: true });
      }
      if (p === '/__control/state') {
        return send(res, 200, {
          users: [...state.users].map(([employeeNo, u]) => ({ employeeNo, ...u, hasFingerprint: state.fingerprints.has(employeeNo) })),
          events: state.events, listener: state.listener, webhookUrl: state.webhookUrl, requests: state.requests.length, authFailures: state.authFailures,
        });
      }
      return send(res, 404, { error: 'control desconocido' });
    }

    // ── Digest ──
    const authorized = checkDigest(req);
    state.requests.push({ method: req.method, path: p, authorized });
    if (!authorized) {
      if (req.headers.authorization) state.authFailures++;
      const body401 = '<html><body>Document Error: Unauthorized</body></html>';
      res.writeHead(401, {
        'WWW-Authenticate': `Digest qop="auth", realm="${realm}", nonce="${newNonce()}", stale="FALSE"`,
        'Content-Type': 'text/html', 'Content-Length': Buffer.byteLength(body401), Connection: 'close',
      });
      return res.end(body401);
    }

    // ── ISAPI ──
    if (req.method === 'GET' && p === '/ISAPI/System/deviceInfo') {
      return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?>
<DeviceInfo version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
<deviceName>Access Controller</deviceName>
<deviceID>255</deviceID>
<model>${cfg.model}</model>
<serialNumber>${cfg.serial}</serialNumber>
<macAddress>a4:d5:c2:00:11:22</macAddress>
<firmwareVersion>${cfg.firmware}</firmwareVersion>
<firmwareReleasedDate>${cfg.build}</firmwareReleasedDate>
<deviceType>ACS</deviceType>
</DeviceInfo>`, 'application/xml');
    }
    if (p === '/ISAPI/System/time') {
      if (req.method === 'GET') {
        return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?><Time version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><timeMode>manual</timeMode><localTime>${deviceTime(now(), cfg.offsetMin)}</localTime><timeZone>${state.timeZone}</timeZone></Time>`, 'application/xml');
      }
      if (req.method === 'PUT') {
        const local = xmlTag(body, 'localTime');
        const tz = xmlTag(body, 'timeZone');
        if (!local || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(local)) return errXml(res, 'badXmlContent');
        const asInstant = Date.parse(local + 'Z') - cfg.offsetMin * 60000;
        state.clockOffsetMs = asInstant - Date.now();
        if (tz) state.timeZone = tz;
        return okXml(res);
      }
    }
    if (req.method === 'POST' && p === '/ISAPI/AccessControl/UserInfo/Record') {
      const u = JSON.parse(body).UserInfo;
      if (!u?.employeeNo) return errJson(res, 'badJsonContent');
      if (state.users.has(String(u.employeeNo))) return errJson(res, 'employeeNoAlreadyExist');
      if (state.users.size >= 3000) return errJson(res, 'userNumberOverLimit');
      state.users.set(String(u.employeeNo), { name: u.name ?? '', userType: u.userType ?? 'normal' });
      return okJson(res);
    }
    if (req.method === 'PUT' && p === '/ISAPI/AccessControl/UserInfo/Modify') {
      const u = JSON.parse(body).UserInfo;
      if (!state.users.has(String(u?.employeeNo))) return errJson(res, 'employeeNoNotExist');
      state.users.set(String(u.employeeNo), { name: u.name ?? '', userType: u.userType ?? 'normal' });
      return okJson(res);
    }
    if (req.method === 'POST' && p === '/ISAPI/AccessControl/CaptureFingerPrint' && !cfg.captureSupported) return errXml(res, 'notSupport', 403);
    if (req.method === 'POST' && p === '/ISAPI/AccessControl/CaptureFingerPrint') {
      const fingerNo = Number(xmlTag(body, 'fingerNo')) || 1;
      if (state.pendingCapture) return errXml(res, 'deviceBusy', 503);
      const f = await waitFinger();
      if (f.fail === 'timeout') return errXml(res, 'captureFingerPrintTimeout');
      if (f.fail === 'quality') return errXml(res, 'fingerPrintQualityPoor');
      const fingerData = crypto.randomBytes(384).toString('base64');
      state.lastCaptured = fingerData;
      return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?><CaptureFingerPrint version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><fingerData>${fingerData}</fingerData><fingerNo>${fingerNo}</fingerNo><fingerPrintQuality>${f.quality}</fingerPrintQuality></CaptureFingerPrint>`, 'application/xml');
    }
    if (req.method === 'POST' && p === '/ISAPI/AccessControl/FingerPrint/SetUp') {
      const c = JSON.parse(body).FingerPrintCfg;
      if (!c?.employeeNo || !c.fingerData) return errJson(res, 'badJsonContent');
      if (!state.users.has(String(c.employeeNo))) return errJson(res, 'employeeNoNotExist');
      state.fingerprints.set(String(c.employeeNo), { fingerPrintID: c.fingerPrintID ?? 1, fingerData: c.fingerData });
      return send(res, 200, { FingerPrintStatus: { StatusList: [{ id: 1, cardReaderRecvStatus: 1, errorMsg: '' }] } });
    }
    if (req.method === 'PUT' && p === '/ISAPI/AccessControl/UserInfoDetail/Delete') {
      const d = JSON.parse(body).UserInfoDetail;
      for (const e of d?.EmployeeNoList ?? []) {
        state.users.delete(String(e.employeeNo));
        state.fingerprints.delete(String(e.employeeNo));
      }
      state.deleteProgress = cfg.deleteSteps;
      return okJson(res);
    }
    if (req.method === 'GET' && p === '/ISAPI/AccessControl/UserInfoDetail/DeleteProcess') {
      const status = state.deleteProgress > 0 ? 'processing' : 'success';
      if (state.deleteProgress > 0) state.deleteProgress--;
      return send(res, 200, { UserInfoDetailDeleteProcess: { status } });
    }
    if (req.method === 'POST' && p === '/ISAPI/AccessControl/AcsEvent') {
      const c = JSON.parse(body).AcsEventCond;
      const from = Date.parse(c.startTime), to = Date.parse(c.endTime);
      if (Number.isNaN(from) || Number.isNaN(to)) return errJson(res, 'badJsonContent');
      const all = state.events.filter((e) => {
        const t = Date.parse(e.time);
        return t >= from && t <= to && (!c.major || e.major === c.major) && (!c.minor || e.minor === c.minor);
      });
      const pos = Number(c.searchResultPosition) || 0;
      const max = Math.min(Number(c.maxResults) || 30, 30);
      const page = all.slice(pos, pos + max);
      const more = pos + page.length < all.length;
      return send(res, 200, {
        AcsEvent: {
          searchID: c.searchID, totalMatches: all.length, numOfMatches: page.length,
          responseStatusStrg: all.length === 0 ? 'NO MATCH' : more ? 'MORE' : 'OK',
          ...(page.length ? { InfoList: page } : {}),
        },
      });
    }
    if (req.method === 'POST' && p === '/ISAPI/AccessControl/FingerPrintUpload') {
      const c = JSON.parse(body).FingerPrintCond;
      const fp = state.fingerprints.get(String(c?.employeeNo));
      if (!fp) return send(res, 200, { FingerPrintInfo: { searchID: c?.searchID, status: 'NoFP' } });
      // Como el lector real: la respuesta incluye la plantilla (el agente la descarta).
      return send(res, 200, { FingerPrintInfo: { searchID: c.searchID, status: 'OK', FingerPrintList: [{ cardReaderNo: 1, fingerPrintID: fp.fingerPrintID, fingerType: 'normalFP', fingerData: fp.fingerData }] } });
    }
    if (req.method === 'POST' && p === '/ISAPI/AccessControl/UserInfo/Search') {
      const c = JSON.parse(body).UserInfoSearchCond;
      const all = [...state.users].map(([employeeNo, u]) => ({ employeeNo, name: u.name, userType: u.userType, numOfFP: state.fingerprints.has(employeeNo) ? 1 : 0, numOfFace: 0, numOfCard: 0 }));
      const pos = Number(c?.searchResultPosition) || 0;
      const page = all.slice(pos, pos + Math.min(Number(c?.maxResults) || 30, 30));
      return send(res, 200, { UserInfoSearch: { searchID: c?.searchID, responseStatusStrg: all.length === 0 ? 'NO MATCH' : pos + page.length < all.length ? 'MORE' : 'OK', numOfMatches: page.length, totalMatches: all.length, UserInfo: page } });
    }
    if (req.method === 'GET' && /\/capabilities$/.test(p)) {
      if (p.includes('CaptureFingerPrint') && !cfg.captureSupported) return errXml(res, 'notSupport', 404);
      return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?><Capabilities version="2.0"><supported>true</supported></Capabilities>`, 'application/xml');
    }
    if (p === '/ISAPI/Event/notification/httpHosts' && req.method === 'GET') {
      const l = state.listener;
      return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?><HttpHostNotificationList version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><HttpHostNotification><id>1</id><url>${l?.url ?? ''}</url><protocolType>${l?.protocol ?? 'HTTP'}</protocolType><parameterFormatType>JSON</parameterFormatType><addressingFormatType>hostname</addressingFormatType><hostName>${l?.host ?? ''}</hostName><portNo>${l?.port ?? 80}</portNo><httpAuthenticationMethod>none</httpAuthenticationMethod></HttpHostNotification></HttpHostNotificationList>`, 'application/xml');
    }
    if (p === '/ISAPI/Event/notification/httpHosts/1' && req.method === 'PUT') {
      if (!cfg.listenerSupported) return errXml(res, 'notSupport', 403);
      const l = { protocol: xmlTag(body, 'protocolType') ?? 'HTTP', host: xmlTag(body, 'hostName') ?? '', port: Number(xmlTag(body, 'portNo')) || 80, url: (xmlTag(body, 'url') ?? '').replace(/&amp;/g, '&') };
      if (!l.host || !l.url) return errXml(res, 'badXmlContent');
      state.listener = l;
      state.webhookUrl = `${l.protocol.toLowerCase()}://${l.host}:${l.port}${l.url}`;
      return okXml(res);
    }
    return errXml(res, 'notSupport', 404);
  }

  const listener = (req, res) => {
    handle(req, res).catch((e) => {
      if (!res.headersSent) send(res, 500, { statusCode: 3, statusString: 'Device Error', subStatusCode: 'deviceError', errorMsg: String(e?.message ?? e).slice(0, 80) });
    });
  };
  const server = cfg.tls ? https.createServer(cfg.tls, listener) : http.createServer(listener);
  await new Promise((resolve) => server.listen(cfg.port, cfg.host, resolve));
  const port = server.address().port;
  return {
    port, host: cfg.host, url: `${cfg.tls ? 'https' : 'http'}://${cfg.host}:${port}`, state, config: cfg,
    placeFinger, addEvent,
    setWebhook: (u) => { state.webhookUrl = u; },
    expireNonces: () => nonces.clear(),
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

// ── línea de comandos ──
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const a = process.argv.slice(2);
  const arg = (n, d = null) => { const i = a.indexOf(n); return i !== -1 ? a[i + 1] : d; };
  const dev = await startMockDevice({
    port: Number(arg('--port', 8088)), host: arg('--host', '127.0.0.1'), username: arg('--user', 'admin'), password: arg('--password', 'Prueba123'),
    autoFingerMs: arg('--auto-finger') ? Number(arg('--auto-finger')) : null, captureTimeoutMs: Number(arg('--capture-timeout', 20000)),
    captureSupported: !a.includes('--no-remote-capture'),
    webhookUrl: arg('--webhook'),
  });
  console.log(`Simulador de lector Hikvision escuchando en ${dev.url}`);
  console.log(`  usuario: ${dev.config.username}   (autenticación Digest)`);
  console.log(`  control: POST ${dev.url}/__control/finger | /__control/scan | /__control/event   GET ${dev.url}/__control/state`);
}
