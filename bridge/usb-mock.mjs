/**
 * Simulador del lector USB DigitalPersona para pruebas (sin dependencias, sin hardware).
 *
 * Imita la interfaz del backend nativo de usb-device.mjs (createNativeBackend): un "dedo" es un texto
 * (por ejemplo 'dedo-ana'); la "imagen" y la "plantilla" son ese texto en un Buffer, así que dos capturas del
 * mismo dedo coinciden y dedos distintos no. Nada aquí sirve para huellas reales.
 *
 *   const native = createMockNative();
 *   native.placeFinger('dedo-ana');          // alguien pone el dedo (resuelve la captura en curso o la siguiente)
 *   native.placeFinger('x', { lowQuality: true });
 */
import { BridgeError } from './bridge.mjs';
import { USB_MODEL } from './usb-device.mjs';

export function createMockNative({ readers = [{ name: 'DigitalPersona U.are.U 4500 {mock}', product: USB_MODEL, serial: 'MOCK0001', firmware: '1.0.0' }], noReader = false, failOpen = null } = {}) {
  const queue = [];            // dedos esperando a que alguien los capture
  let waiting = null;          // { resolve } captura en curso
  let open = false;
  const log = [];
  const take = () => {
    const f = queue.shift();
    return f ?? null;
  };
  return {
    kind: 'mock', libDir: null, log, queue,
    list() { return noReader ? [] : readers; },
    open() {
      if (failOpen) throw failOpen;
      if (noReader) throw new BridgeError('usb_no_reader', 'no hay un lector DigitalPersona conectado por USB');
      open = true;
      const r = readers[0];
      return { model: r.product, serial: r.serial, firmware: r.firmware, name: r.name };
    },
    info() { return this.open(); },
    async capture(timeoutMs) {
      log.push(['capture', timeoutMs]);
      const now = take();
      const finger = now ?? await new Promise((resolve) => {
        waiting = { resolve };
        setTimeout(() => { if (waiting?.resolve === resolve) { waiting = null; resolve(null); } }, timeoutMs);
      });
      if (!finger) return null;
      if (finger.lowQuality) return { fid: Buffer.from('LOW:' + finger.id), quality: 1 << 15 };
      return { fid: Buffer.from('FID:' + finger.id), quality: 0 };
    },
    fmdFromFid(fid) {
      const s = fid.toString();
      if (s.startsWith('LOW:')) return null;
      return Buffer.from('FMD:' + s.slice(4));
    },
    enroll(fmds) { return Buffer.from(fmds[0]); },
    identify(fmd, fmds) { const s = fmd.toString(); return fmds.findIndex((m) => m.toString() === s); },
    compare(a, b) { return a.toString() === b.toString(); },
    cancel() { if (waiting) { const w = waiting; waiting = null; w.resolve(null); } },
    close() { open = false; },
    get isOpen() { return open; },
    /** ¿Hay una captura esperando dedo en este momento? */
    get waiting() { return !!waiting; },
    /** "Pone el dedo": resuelve la captura en curso o se guarda para la siguiente. */
    placeFinger(id, { lowQuality = false } = {}) {
      const finger = { id: String(id), lowQuality };
      if (waiting) { const w = waiting; waiting = null; w.resolve(finger); } else queue.push(finger);
    },
  };
}
