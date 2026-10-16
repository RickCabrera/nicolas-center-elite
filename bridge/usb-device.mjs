/**
 * Nicolas Center Elite · Chofer del lector USB DigitalPersona U.are.U 4500 (HUE-20)
 *
 * El U.are.U 4500 es solo un sensor: no guarda huellas, no compara y no tiene reloj ni historial.
 * Todo eso lo hace este módulo en la PC de recepción, con las librerías del fabricante:
 *   · dpfpdd.dll  habla con el lector (lista, abre, captura la imagen del dedo)
 *   · dpfj.dll    convierte la imagen en plantilla (FMD ANSI 378) y compara plantillas (FingerJet)
 * Las dos vienen en el "DigitalPersona U.are.U RTE" (C:\Program Files\DigitalPersona\U.are.U RTE\Windows\Lib\x64).
 * Se cargan con `koffi` (FFI para Node sin compilar nada): `npm install` dentro de la carpeta bridge.
 *
 * PRIVACIDAD (HUE-16 / HUE-20): las plantillas viven en una bóveda cifrada en esta PC (vault-<lector>.enc,
 * AES-256-GCM con llave en vault.key) y en la memoria de este proceso. Nunca se envían a la nube, nunca
 * aparecen en los registros ni en los resultados de las órdenes.
 *
 * Expone la misma "forma" que HikDevice para que Bridge no distinga entre lectores: deviceInfo,
 * clockSkewSeconds, syncTime, upsertPerson, listPersons, deletePerson, countFingerprints, searchEvents…
 * Lo que un lector USB no puede hacer (rostro, aviso HTTP, captura en pantalla) responde `not_supported`.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BridgeError, isapiTime } from './bridge.mjs';

export const USB_KIND = 'usb_digitalpersona';
export const USB_MODEL = 'DigitalPersona U.are.U 4500';
/** Sub-tipo de evento que usa la app para "huella verificada" (mismo que el Hikvision). */
export const EVENT_MINOR_FINGERPRINT = 38;
/** Capturas que se piden al registrar una huella (el motor combina varias para una plantilla de buena calidad). */
export const ENROLL_SAMPLES = 4;
/** Lecturas que se recuerdan localmente para "Recuperar eventos" (la nube ya tiene las enviadas). */
const MAX_LOCAL_READINGS = 5000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────── constantes del SDK (dpfpdd.h / dpfj.h) ─────────────────────────
export const SDK = {
  DPFPDD_SUCCESS: 0,
  DPFPDD_E_MORE_DATA: 0x0d,
  DPFPDD_E_INVALID_DEVICE: 0x15,
  DPFPDD_E_DEVICE_BUSY: 0x1e,
  DPFPDD_E_DEVICE_FAILURE: 0x1f,
  DPFJ_E_NOT_IMPLEMENTED: 0x0a,
  DPFJ_E_MORE_DATA: 0x0d,
  DPFJ_E_INVALID_FID: 0x65,
  DPFJ_E_TOO_SMALL_AREA: 0x66,
  DPFJ_E_INVALID_FMD: 0xc9,
  DPFJ_E_ENROLLMENT_NOT_READY: 0x12f,
  DPFJ_E_ENROLLMENT_INVALID_SET: 0x130,
  DPFPDD_PRIORITY_COOPERATIVE: 2,
  DPFPDD_PRIORITY_EXCLUSIVE: 4,
  DPFPDD_IMG_FMT_ANSI381: 0x001b0401,
  DPFPDD_IMG_PROC_DEFAULT: 0,
  DPFPDD_QUALITY_GOOD: 0,
  DPFPDD_QUALITY_TIMED_OUT: 1,
  DPFPDD_QUALITY_CANCELED: 2,
  DPFPDD_QUALITY_NO_FINGER: 4,
  DPFJ_FID_ANSI_381_2004: 0x001b0401,
  DPFJ_FMD_ANSI_378_2004: 0x001b0001,
  DPFJ_PROBABILITY_ONE: 0x7fffffff,
  /** Tasa de falsos positivos aceptada al identificar: 1 en 100,000 (recomendación del fabricante). */
  FALSE_MATCH_RATE: Math.floor(0x7fffffff / 100000),
  MAX_FMD_SIZE: 26 + 4 + 255 * 6 + 2,
  IMAGE_BUFFER: 1024 * 1024,
  MAX_DEVICES: 8,
};

/** Rutas donde el RTE suele dejar las librerías (Windows). */
export const DEFAULT_LIB_DIRS = [
  'C:\\Program Files\\DigitalPersona\\U.are.U RTE\\Windows\\Lib\\x64',
  'C:\\Program Files\\DigitalPersona\\U.are.U SDK\\Windows\\Lib\\x64',
  'C:\\Program Files (x86)\\DigitalPersona\\U.are.U RTE\\Windows\\Lib\\x64',
];

// ───────────────────────── backend nativo (koffi) ─────────────────────────
/**
 * Carga dpfpdd y dpfj con koffi. Se aísla en una función para que las pruebas inyecten un backend falso
 * con la misma interfaz:  open() · info() · capture(timeoutMs) · fmdFromFid(fid) · enroll(fids) ·
 * identify(fmd, fmds) · compare(a, b) · close()
 */
export async function createNativeBackend({ libDir = null, readerName = null } = {}) {
  let koffi;
  try {
    koffi = (await import('koffi')).default;
  } catch {
    throw new BridgeError('usb_koffi_missing', 'falta el módulo koffi: ejecuta "npm install" dentro de la carpeta bridge');
  }
  const dirs = libDir ? [libDir] : DEFAULT_LIB_DIRS.filter((d) => fs.existsSync(d));
  const ext = process.platform === 'win32' ? '.dll' : '.so';
  const dir = dirs.find((d) => fs.existsSync(path.join(d, `dpfpdd${ext}`)) && fs.existsSync(path.join(d, `dpfj${ext}`)));
  if (!dir) throw new BridgeError('usb_lib_missing', `no se encontraron dpfpdd${ext} y dpfj${ext}`);
  let dpfpdd, dpfj;
  try {
    dpfpdd = koffi.load(path.join(dir, `dpfpdd${ext}`));
    dpfj = koffi.load(path.join(dir, `dpfj${ext}`));
  } catch (e) {
    throw new BridgeError('usb_lib_missing', `no se pudieron cargar las librerías (${String(e?.message ?? e).slice(0, 80)})`);
  }

  // Estructuras tal como las define el SDK 2.x/3.x (dpfpdd.h).
  const VerInfo = koffi.struct('DPFPDD_VER_INFO', { major: 'int', minor: 'int', maintenance: 'int' });
  koffi.struct('DPFPDD_HW_DESCR', { vendor_name: koffi.array('char', 128, 'String'), product_name: koffi.array('char', 128, 'String'), serial_num: koffi.array('char', 128, 'String') });
  koffi.struct('DPFPDD_HW_ID', { vendor_id: 'uint16', product_id: 'uint16' });
  koffi.struct('DPFPDD_HW_VERSION', { hw_ver: VerInfo, fw_ver: VerInfo, bcd_rev: 'uint16' });
  const DevInfo = koffi.struct('DPFPDD_DEV_INFO', {
    size: 'uint', name: koffi.array('char', 1024, 'String'), descr: 'DPFPDD_HW_DESCR', id: 'DPFPDD_HW_ID', ver: 'DPFPDD_HW_VERSION', modality: 'uint', technology: 'uint',
  });
  const CaptureParam = koffi.struct('DPFPDD_CAPTURE_PARAM', { size: 'uint', image_fmt: 'uint', image_proc: 'uint', image_res: 'uint' });
  koffi.struct('DPFPDD_IMAGE_INFO', { size: 'uint', width: 'uint', height: 'uint', res: 'uint', bpp: 'uint' });
  const CaptureResult = koffi.struct('DPFPDD_CAPTURE_RESULT', { size: 'uint', success: 'int', quality: 'uint', score: 'uint', info: 'DPFPDD_IMAGE_INFO' });
  const Candidate = koffi.struct('DPFJ_CANDIDATE', { size: 'uint', fmd_idx: 'uint', view_idx: 'uint' });

  const f = {
    init: dpfpdd.func('int dpfpdd_init()'),
    exit: dpfpdd.func('int dpfpdd_exit()'),
    query: dpfpdd.func('int dpfpdd_query_devices(_Inout_ uint *dev_cnt, _Out_ DPFPDD_DEV_INFO *dev_infos)'),
    open: dpfpdd.func('int dpfpdd_open_ext(const char *dev_name, uint priority, _Out_ void **pdev)'),
    close: dpfpdd.func('int dpfpdd_close(void *dev)'),
    cancel: dpfpdd.func('int dpfpdd_cancel(void *dev)'),
    capture: dpfpdd.func('int dpfpdd_capture(void *dev, DPFPDD_CAPTURE_PARAM *param, uint timeout, _Out_ DPFPDD_CAPTURE_RESULT *result, _Inout_ uint *image_size, _Out_ uint8 *image_data)'),
    fmdFromFid: dpfj.func('int dpfj_create_fmd_from_fid(int fid_type, const uint8 *fid, uint fid_size, int fmd_type, _Out_ uint8 *fmd, _Inout_ uint *fmd_size)'),
    compare: dpfj.func('int dpfj_compare(int fmd1_type, const uint8 *fmd1, uint fmd1_size, uint view1, int fmd2_type, const uint8 *fmd2, uint fmd2_size, uint view2, _Out_ uint *score)'),
    identify: dpfj.func('int dpfj_identify(int fmd1_type, const uint8 *fmd1, uint fmd1_size, uint view1, int fmds_type, uint fmds_cnt, const uint8 **fmds, const uint *fmd_sizes, uint threshold, _Inout_ uint *candidate_cnt, _Out_ DPFJ_CANDIDATE *candidates)'),
    startEnroll: dpfj.func('int dpfj_start_enrollment(int fmd_type)'),
    addEnroll: dpfj.func('int dpfj_add_to_enrollment(int fmd_type, const uint8 *fmd, uint fmd_size, uint view)'),
    createEnroll: dpfj.func('int dpfj_create_enrollment_fmd(_Out_ uint8 *fmd, _Inout_ uint *fmd_size)'),
    finishEnroll: dpfj.func('int dpfj_finish_enrollment()'),
  };
  let dev = null;
  let devInfo = null;
  const init = f.init();
  if (init !== SDK.DPFPDD_SUCCESS) throw new BridgeError('usb_lib_missing', `dpfpdd_init devolvió ${init}`);

  return {
    kind: 'koffi', libDir: dir,
    list() {
      const cnt = [SDK.MAX_DEVICES];
      const infos = Array.from({ length: SDK.MAX_DEVICES }, () => ({ size: koffi.sizeof(DevInfo) }));
      const r = f.query(cnt, infos);
      if (r !== SDK.DPFPDD_SUCCESS && r !== SDK.DPFPDD_E_MORE_DATA) throw new BridgeError('usb_no_reader', `dpfpdd_query_devices devolvió ${r}`);
      return infos.slice(0, Math.min(cnt[0], SDK.MAX_DEVICES)).map((i) => ({
        name: String(i.name ?? ''), vendor: String(i.descr?.vendor_name ?? ''), product: String(i.descr?.product_name ?? ''),
        serial: String(i.descr?.serial_num ?? ''), firmware: i.ver?.fw_ver ? `${i.ver.fw_ver.major}.${i.ver.fw_ver.minor}.${i.ver.fw_ver.maintenance}` : '',
      }));
    },
    open() {
      if (dev) return devInfo;
      const list = this.list();
      const chosen = (readerName ? list.find((d) => d.name === readerName || d.serial === readerName) : null) ?? list[0];
      if (!chosen) throw new BridgeError('usb_no_reader', 'no hay un lector DigitalPersona conectado por USB');
      const out = [null];
      const r = f.open(chosen.name, SDK.DPFPDD_PRIORITY_COOPERATIVE, out);
      if (r !== SDK.DPFPDD_SUCCESS) throw new BridgeError(r === SDK.DPFPDD_E_DEVICE_BUSY ? 'device_busy' : 'usb_no_reader', `dpfpdd_open devolvió ${r}`);
      dev = out[0];
      devInfo = { model: chosen.product || USB_MODEL, serial: chosen.serial, firmware: chosen.firmware, name: chosen.name };
      return devInfo;
    },
    info() { return this.open(); },
    /** Espera un dedo hasta timeoutMs. Devuelve { fid, quality } o null si nadie puso el dedo. */
    async capture(timeoutMs) {
      this.open();
      const param = { size: koffi.sizeof(CaptureParam), image_fmt: SDK.DPFPDD_IMG_FMT_ANSI381, image_proc: SDK.DPFPDD_IMG_PROC_DEFAULT, image_res: 500 };
      const result = { size: koffi.sizeof(CaptureResult) };
      const size = [SDK.IMAGE_BUFFER];
      const image = Buffer.alloc(SDK.IMAGE_BUFFER);
      // Llamada bloqueante en un hilo aparte (koffi .async) para no detener el ciclo del agente.
      const r = await new Promise((resolve, reject) => f.capture.async(dev, param, timeoutMs, result, size, image, (err, res) => (err ? reject(err) : resolve(res))));
      if (r === SDK.DPFPDD_E_DEVICE_BUSY) throw new BridgeError('device_busy');
      if (r !== SDK.DPFPDD_SUCCESS) throw new BridgeError('usb_capture_failed', `dpfpdd_capture devolvió ${r}`);
      if (!result.success) {
        if (result.quality & (SDK.DPFPDD_QUALITY_TIMED_OUT | SDK.DPFPDD_QUALITY_CANCELED | SDK.DPFPDD_QUALITY_NO_FINGER)) return null;
        return { fid: null, quality: result.quality };
      }
      return { fid: Buffer.from(image.subarray(0, size[0])), quality: result.quality };
    },
    fmdFromFid(fid) {
      const out = Buffer.alloc(SDK.MAX_FMD_SIZE);
      const size = [SDK.MAX_FMD_SIZE];
      const r = f.fmdFromFid(SDK.DPFJ_FID_ANSI_381_2004, fid, fid.length, SDK.DPFJ_FMD_ANSI_378_2004, out, size);
      if (r === SDK.DPFJ_E_TOO_SMALL_AREA || r === SDK.DPFJ_E_INVALID_FID) return null;
      if (r !== SDK.DPFPDD_SUCCESS) throw new BridgeError('usb_capture_failed', `dpfj_create_fmd_from_fid devolvió ${r}`);
      return Buffer.from(out.subarray(0, size[0]));
    },
    /** Combina varias capturas del mismo dedo en una plantilla de registro; null si el motor no lo permite. */
    enroll(fmds) {
      if (f.startEnroll(SDK.DPFJ_FMD_ANSI_378_2004) !== SDK.DPFPDD_SUCCESS) return null;
      try {
        for (const m of fmds) {
          const r = f.addEnroll(SDK.DPFJ_FMD_ANSI_378_2004, m, m.length, 0);
          if (r !== SDK.DPFPDD_SUCCESS && r !== SDK.DPFJ_E_MORE_DATA) return null;
        }
        const out = Buffer.alloc(SDK.MAX_FMD_SIZE);
        const size = [SDK.MAX_FMD_SIZE];
        const r = f.createEnroll(out, size);
        if (r !== SDK.DPFPDD_SUCCESS) return null;
        return Buffer.from(out.subarray(0, size[0]));
      } finally {
        try { f.finishEnroll(); } catch { /* sin estado */ }
      }
    },
    /** Índice de la plantilla que coincide con `fmd` dentro de `fmds`, o -1. */
    identify(fmd, fmds) {
      if (!fmds.length) return -1;
      const cnt = [1];
      const cands = [{ size: koffi.sizeof(Candidate) }];
      const r = f.identify(SDK.DPFJ_FMD_ANSI_378_2004, fmd, fmd.length, 0, SDK.DPFJ_FMD_ANSI_378_2004, fmds.length, fmds, fmds.map((m) => m.length), SDK.FALSE_MATCH_RATE, cnt, cands);
      if (r !== SDK.DPFPDD_SUCCESS) throw new BridgeError('usb_match_failed', `dpfj_identify devolvió ${r}`);
      return cnt[0] > 0 ? Number(cands[0].fmd_idx) : -1;
    },
    compare(a, b) {
      const score = [0];
      const r = f.compare(SDK.DPFJ_FMD_ANSI_378_2004, a, a.length, 0, SDK.DPFJ_FMD_ANSI_378_2004, b, b.length, 0, score);
      if (r !== SDK.DPFPDD_SUCCESS) throw new BridgeError('usb_match_failed', `dpfj_compare devolvió ${r}`);
      return score[0] < SDK.FALSE_MATCH_RATE;
    },
    cancel() { if (dev) { try { f.cancel(dev); } catch { /* ya cerrado */ } } },
    close() {
      if (dev) { try { f.close(dev); } catch { /* ya cerrado */ } dev = null; }
      try { f.exit(); } catch { /* ya cerrado */ }
    },
  };
}

// ───────────────────────── bóveda cifrada de plantillas ─────────────────────────
/**
 * vault-<lector>.enc: JSON { persons: { [employeeNo]: { name, fmds: [base64…] } } } cifrado con AES-256-GCM.
 * La llave vive en vault.key (32 bytes, hex) junto a config.json; se crea sola la primera vez.
 * El archivo nunca se lee para mostrar nada: solo lo abre este módulo para comparar.
 */
export class Vault {
  constructor(file, keyFile) {
    this.file = file;
    this.keyFile = keyFile;
    this.persons = new Map();
    this.key = null;
  }

  loadKey() {
    if (this.key) return this.key;
    if (fs.existsSync(this.keyFile)) {
      const hex = fs.readFileSync(this.keyFile, 'utf8').trim();
      if (!/^[0-9a-f]{64}$/i.test(hex)) throw new BridgeError('vault_error', 'vault.key está dañado');
      this.key = Buffer.from(hex, 'hex');
    } else {
      this.key = crypto.randomBytes(32);
      fs.writeFileSync(this.keyFile, this.key.toString('hex') + '\n', { mode: 0o600 });
    }
    return this.key;
  }

  load() {
    this.persons = new Map();
    if (!fs.existsSync(this.file)) return this;
    const key = this.loadKey();
    const raw = fs.readFileSync(this.file);
    if (raw.length < 29 || raw.subarray(0, 4).toString('latin1') !== 'NCE1') throw new BridgeError('vault_error', 'la bóveda está dañada');
    try {
      const iv = raw.subarray(4, 16), tag = raw.subarray(16, 32), body = raw.subarray(32);
      const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
      d.setAuthTag(tag);
      const json = JSON.parse(Buffer.concat([d.update(body), d.final()]).toString('utf8'));
      for (const [no, p] of Object.entries(json.persons ?? {})) {
        this.persons.set(String(no), { name: String(p.name ?? ''), fmds: (p.fmds ?? []).map((b) => Buffer.from(b, 'base64')) });
      }
    } catch (e) {
      if (e instanceof BridgeError) throw e;
      throw new BridgeError('vault_error', 'no se pudo abrir la bóveda (¿cambió vault.key?)');
    }
    return this;
  }

  save() {
    const key = this.loadKey();
    const persons = {};
    for (const [no, p] of this.persons) persons[no] = { name: p.name, fmds: p.fmds.map((m) => m.toString('base64')) };
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([c.update(JSON.stringify({ v: 1, persons })), c.final()]);
    const out = Buffer.concat([Buffer.from('NCE1', 'latin1'), iv, c.getAuthTag(), body]);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, out, { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  /** Todas las plantillas con su dueño, en orden estable (para identificar). */
  entries() {
    const out = [];
    for (const [no, p] of this.persons) for (const fmd of p.fmds) out.push({ employee_no: no, fmd });
    return out;
  }
}

// ───────────────────────── el chofer ─────────────────────────
export class UsbDevice {
  /**
   * @param {object} o
   * @param {string} o.stateDir       carpeta de config.json (ahí van vault y lecturas)
   * @param {string} o.slug           identificador del lector para los nombres de archivo
   * @param {object} [o.native]       backend nativo ya creado (pruebas) · si falta se carga koffi al abrir
   * @param {object} [o.nativeOpts]   { libDir, readerName } para createNativeBackend
   */
  constructor({ stateDir, slug = 'usb', native = null, nativeOpts = {}, timeZone = 'America/Mexico_City', log = () => {} }) {
    this.host = 'usb'; // Bridge comprueba `device.host` para saber si hay lector configurado
    this.kind = USB_KIND;
    this.stateDir = stateDir;
    this.slug = slug;
    this.native = native;
    this.nativeOpts = nativeOpts;
    this.timeZone = timeZone;
    this.log = log;
    this.vault = new Vault(path.join(stateDir, `vault-${slug}.enc`), path.join(stateDir, 'vault.key'));
    this.readingsFile = path.join(stateDir, `readings-${slug}.json`);
    this.readings = [];      // { employee_no, time, minor, verify_mode, serial_no }
    this.pending = [];       // lecturas aún no enviadas a la nube
    this.listeners = new Set();
    this.busy = false;       // true mientras se registra una huella (la identificación se pausa)
    this.identifying = false;
    this.stopIdentify = false;
    this.lastIdentifyError = '';
    this.loaded = false;
    this.lastMatch = null;   // { employee_no, at } para no repetir la misma lectura si el dedo sigue puesto
    this.password = 'usb';   // Bridge.check() exige "contraseña"; el USB no la necesita
  }

  get configured() { return true; }
  sameAs() { return true; }

  async ensureOpen() {
    if (!this.native) this.native = await createNativeBackend(this.nativeOpts);
    if (!this.loaded) {
      this.vault.load();
      this.loadReadings();
      this.loaded = true;
    }
    return this.native.open();
  }

  loadReadings() {
    try {
      const j = JSON.parse(fs.readFileSync(this.readingsFile, 'utf8'));
      this.readings = Array.isArray(j.readings) ? j.readings : [];
      this.pending = Array.isArray(j.pending) ? j.pending : [];
    } catch { this.readings = []; this.pending = []; }
  }
  saveReadings() {
    if (this.readings.length > MAX_LOCAL_READINGS) this.readings = this.readings.slice(-MAX_LOCAL_READINGS);
    const tmp = this.readingsFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ readings: this.readings, pending: this.pending }));
    fs.renameSync(tmp, this.readingsFile);
  }

  // ── lo mismo que HikDevice, adaptado ──
  async deviceInfo() {
    const i = await this.ensureOpen();
    return { model: i.model || USB_MODEL, serial: i.serial || '', firmware: i.firmware || '', name: i.name || '' };
  }
  /** El lector no tiene reloj: la hora es la de esta PC. */
  async clockSkewSeconds() { return 0; }
  async syncTime() { return { local_time: new Date().toISOString(), time_zone: this.timeZone, note: 'El lector USB usa la hora de la PC de recepción.' }; }

  async upsertPerson(employeeNo, name) {
    await this.ensureOpen();
    const no = String(employeeNo);
    const cur = this.vault.persons.get(no);
    this.vault.persons.set(no, { name: String(name || no).slice(0, 64), fmds: cur?.fmds ?? [] });
    this.vault.save();
    return { created: !cur };
  }
  async listPersons() {
    await this.ensureOpen();
    return [...this.vault.persons].map(([no, p]) => ({ employee_no: no, name: p.name, fingerprints: p.fmds.length, faces: 0, cards: 0 }));
  }
  async deletePerson(employeeNo) {
    await this.ensureOpen();
    this.vault.persons.delete(String(employeeNo));
    this.vault.save();
  }
  async countFingerprints(employeeNo) {
    await this.ensureOpen();
    return this.vault.persons.get(String(employeeNo))?.fmds.length ?? 0;
  }
  async countFaces() { return 0; }
  async captureFace() { throw new BridgeError('not_supported', 'el lector USB no captura rostros'); }
  async setFace() { throw new BridgeError('not_supported', 'el lector USB no guarda rostros'); }
  async configureListener() { throw new BridgeError('listener_not_supported', 'el lector USB no envía avisos: las lecturas llegan por este agente'); }
  async listenerHost() { return null; }
  async probeGet() { return { status: 0, supported: false }; }

  /** Historial local (para "Recuperar eventos"): las lecturas entre dos instantes. */
  async searchEvents(from, to, _tz, onPage) {
    await this.ensureOpen();
    const a = from.getTime(), b = to.getTime();
    const list = this.readings.filter((e) => { const t = Date.parse(e.time); return t >= a && t <= b; });
    for (let i = 0; i < list.length; i += 100) await onPage(list.slice(i, i + 100));
    return list.length;
  }

  // ── registro de huella ──
  /**
   * Pide ENROLL_SAMPLES toques del mismo dedo, saca una plantilla y comprueba que no sea de otra persona.
   * Devuelve { fingerData: Buffer, quality } SOLO a enrollFingerprint, que la guarda en la bóveda y la suelta.
   */
  async captureFingerprint(_fingerNo, timeoutMs, { onSample } = {}) {
    await this.ensureOpen();
    const wasIdentifying = await this.pauseIdentify();
    this.busy = true;
    try {
      const fmds = [];
      const until = Date.now() + timeoutMs;
      let lowQuality = 0;
      while (fmds.length < ENROLL_SAMPLES) {
        const left = until - Date.now();
        if (left <= 0) throw new BridgeError(fmds.length ? 'capture_failed' : 'capture_timeout', fmds.length ? `solo se tomaron ${fmds.length} de ${ENROLL_SAMPLES} toques` : '');
        const cap = await this.native.capture(Math.min(left, 10000));
        if (!cap) continue;
        const fmd = cap.fid ? this.native.fmdFromFid(cap.fid) : null;
        if (cap.fid) cap.fid.fill(0);
        if (!fmd) {
          if (++lowQuality >= 6) throw new BridgeError('low_quality');
          continue;
        }
        fmds.push(fmd);
        await onSample?.(fmds.length, ENROLL_SAMPLES);
        // Que levante el dedo entre toques: una captura inmediata sería la misma imagen.
        await sleep(400);
      }
      const combined = this.native.enroll(fmds) ?? fmds[0];
      for (const m of fmds) if (m !== combined) m.fill(0);
      return { fingerData: combined, quality: null };
    } finally {
      this.busy = false;
      // Terminado el registro, el lector vuelve a esperar checadas.
      if (wasIdentifying) this.startIdentify();
    }
  }

  /** Guarda la plantilla en la bóveda. Si ya está registrada a nombre de otra persona: fingerprint_duplicate. */
  async setFingerprint(employeeNo, _fingerNo, fingerData) {
    await this.ensureOpen();
    const no = String(employeeNo);
    const entries = this.vault.entries();
    const idx = this.native.identify(fingerData, entries.map((e) => e.fmd));
    if (idx >= 0 && entries[idx].employee_no !== no) throw new BridgeError('fingerprint_duplicate', `ya registrada para ${entries[idx].employee_no}`);
    const p = this.vault.persons.get(no) ?? { name: no, fmds: [] };
    // Un dedo nuevo de la misma persona se agrega; volver a registrar el mismo dedo lo reemplaza.
    p.fmds = idx >= 0 ? p.fmds.map((m) => (m === entries[idx].fmd ? fingerData : m)) : [...p.fmds, fingerData].slice(-10);
    this.vault.persons.set(no, p);
    this.vault.save();
  }

  // ── checadas: identificación en vivo ──
  onReading(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** Arranca el ciclo "esperar dedo → identificar → anotar lectura". No lanza: los errores se guardan y se reintenta. */
  startIdentify() {
    if (this.identifying) return;
    this.identifying = true;
    this.stopIdentify = false;
    void this.identifyLoop();
  }
  /** Detiene el ciclo de identificación (si corría) y devuelve si estaba corriendo. */
  async pauseIdentify() {
    const was = this.identifying;
    this.stopIdentify = true;
    try { this.native?.cancel?.(); } catch { /* opcional */ }
    while (this.identifying) await sleep(50);
    return was;
  }
  async identifyLoop() {
    try {
      while (!this.stopIdentify) {
        if (this.busy) { await sleep(100); continue; }
        let cap;
        try {
          await this.ensureOpen();
          cap = await this.native.capture(1500);
          this.lastIdentifyError = '';
        } catch (e) {
          const code = e instanceof BridgeError ? e.code : 'usb_capture_failed';
          if (this.lastIdentifyError !== code) this.log(`Lector USB: ${code}${e?.detail ? ' · ' + e.detail : ''}. Se reintenta.`);
          this.lastIdentifyError = code;
          if (code === 'usb_no_reader' || code === 'usb_lib_missing' || code === 'usb_koffi_missing') { this.native?.close?.(); if (this.native?.kind === 'koffi') this.native = null; }
          await sleep(3000);
          continue;
        }
        if (!cap?.fid) continue;
        const fmd = this.native.fmdFromFid(cap.fid);
        cap.fid.fill(0);
        if (!fmd) continue;
        const entries = this.vault.entries();
        const idx = this.native.identify(fmd, entries.map((e) => e.fmd));
        fmd.fill(0);
        if (idx < 0) { this.note('unknown'); await sleep(800); continue; }
        const no = entries[idx].employee_no;
        // El mismo dedo que sigue en el sensor no cuenta dos veces.
        if (this.lastMatch && this.lastMatch.employee_no === no && Date.now() - this.lastMatch.at < 4000) { await sleep(300); continue; }
        this.lastMatch = { employee_no: no, at: Date.now() };
        this.note(no);
        await sleep(800);
      }
    } finally {
      this.identifying = false;
    }
  }

  /** Anota una lectura (o una huella no reconocida) y avisa a quien escuche. */
  note(employeeNo) {
    const time = isapiTime(new Date(), this.timeZone);
    if (employeeNo === 'unknown') { for (const fn of this.listeners) fn({ employee_no: null, time }); return; }
    const ev = { employee_no: String(employeeNo), time, serial_no: null, major: 5, minor: EVENT_MINOR_FINGERPRINT, verify_mode: 'fingerPrint' };
    this.readings.push(ev);
    this.pending.push(ev);
    this.saveReadings();
    for (const fn of this.listeners) fn(ev);
  }

  /** Lecturas que aún no llegaron a la nube; se confirman con `ack` cuando la nube las acepta. */
  takePending() { return [...this.pending]; }
  ack(n) { this.pending.splice(0, n); this.saveReadings(); }

  async close() {
    await this.pauseIdentify();
    this.native?.close?.();
  }
}

/**
 * --probe --usb · Prueba del lector USB sin nube y sin tocar la bóveda: librerías, lector, dos capturas del
 * mismo dedo y comparación. Devuelve cuántos pasos fallaron.
 */
export async function probeUsb({ libDir = null, readerName = null, ask, print = console.log, native = null } = {}) {
  let failed = 0;
  const ok = (m) => print(`  [OK]    ${m}`);
  const bad = (m, hint) => { failed++; print(`  [FALLA] ${m}`); if (hint) print(`          → ${hint}`); };
  print('\nPrueba del lector USB DigitalPersona (sin nube; no se guarda ninguna huella)\n');
  let n = native;
  try {
    n = n ?? await createNativeBackend({ libDir, readerName });
    ok(`Librerías del fabricante cargadas${n.libDir ? ` desde ${n.libDir}` : ''}.`);
  } catch (e) {
    if (e?.code === 'usb_koffi_missing') bad('Falta el módulo koffi.', 'En esta carpeta ejecuta:  npm install');
    else bad(`No se pudieron cargar dpfpdd y dpfj (${e?.detail || e?.message}).`, 'Instala el "DigitalPersona U.are.U RTE" o usa --lib-dir con la carpeta Lib\\x64.');
    return failed;
  }
  try {
    const list = n.list?.() ?? [];
    if (!list.length) { bad('No hay lectores DigitalPersona conectados por USB.', 'Conecta el lector y revisa que Windows lo reconozca (luz azul).'); return failed; }
    for (const d of list) ok(`Lector encontrado: ${d.product || USB_MODEL}${d.serial ? ` · serie ${d.serial}` : ''}${d.firmware ? ` · firmware ${d.firmware}` : ''}`);
    n.open();
  } catch (e) {
    bad(`No se pudo abrir el lector (${e?.detail || e?.message}).`);
    return failed;
  }
  const fmds = [];
  for (let i = 1; i <= 2; i++) {
    try {
      await ask?.(`Coloca el MISMO dedo en el lector (toque ${i} de 2) y presiona Enter…`);
      const cap = await n.capture(10000);
      if (!cap?.fid) { bad(`Toque ${i}: no se detectó el dedo a tiempo.`); continue; }
      const fmd = n.fmdFromFid(cap.fid);
      cap.fid.fill(0);
      if (!fmd) { bad(`Toque ${i}: la imagen salió con baja calidad.`, 'Limpia el dedo y el sensor, y cubre bien la ventana.'); continue; }
      fmds.push(fmd);
      ok(`Toque ${i}: captura y plantilla correctas (${fmd.length} bytes; se descarta al terminar).`);
    } catch (e) {
      bad(`Toque ${i}: ${e?.code ?? ''} ${e?.detail ?? e?.message ?? ''}`.trim());
    }
  }
  if (fmds.length === 2) {
    try {
      const same = n.compare(fmds[0], fmds[1]);
      (same ? ok : bad)(same ? 'Las dos capturas coinciden: el motor de comparación funciona.' : 'Las dos capturas NO coincidieron (¿fue el mismo dedo?).');
      const idx = n.identify(fmds[1], [fmds[0]]);
      (idx === 0 ? ok : bad)(idx === 0 ? 'Identificación 1:N correcta.' : 'La identificación 1:N no encontró la huella.');
    } catch (e) { bad(`Comparación: ${e?.code ?? ''} ${e?.detail ?? e?.message ?? ''}`.trim()); }
  }
  for (const m of fmds) m.fill(0);
  try { n.close(); } catch { /* ya cerrado */ }
  print(failed ? `\n${failed} paso(s) fallaron. Manda esta salida a quien mantiene el sistema.\n` : '\nEl lector USB es compatible. Siguiente paso: config.json y  node bridge.mjs --check\n');
  return failed;
}

/** Nombre corto de archivo a partir del nombre del lector. */
export function slugOf(name, fallback = 'usb') {
  return String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;
}
