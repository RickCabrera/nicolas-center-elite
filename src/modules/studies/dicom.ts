import * as dicomParserNs from 'dicom-parser';

/**
 * EST-04 · Decodificador DICOM básico. Función pura: recibe los bytes del archivo y devuelve la imagen
 * del primer cuadro lista para dibujarse, o un error tipado. No toca el DOM (se prueba en Node).
 *
 * Abre: Implicit/Explicit VR Little Endian y Explicit VR Big Endian, sin comprimir, de 8 o 16 bits,
 * MONOCHROME1, MONOCHROME2, RGB y YBR_FULL. Las sintaxis comprimidas (JPEG, JPEG 2000, JPEG-LS, RLE,
 * deflate) no se abren: el visor ofrece la descarga.
 */
type Parser = typeof dicomParserNs;
// El paquete es UMD: según el empaquetador llega como espacio de nombres o como `default`.
const parser: Parser = (dicomParserNs as unknown as { default?: Parser }).default ?? dicomParserNs;

export type DicomHeader = {
  modality: string | null;
  patientName: string | null;
  studyDescription: string | null;
  transferSyntax: string | null;
};

export type DicomImage = DicomHeader & {
  rows: number;
  cols: number;
  frames: number;
  bitsAllocated: number;
  bitsStored: number;
  /** 0 = sin signo, 1 = complemento a dos. */
  pixelRepresentation: number;
  photometric: string;
  samplesPerPixel: number;
  slope: number;
  intercept: number;
  /** Escala de grises: un valor por pixel ya con pendiente/intersección aplicadas. null si es a color. */
  values: Float32Array | null;
  /** Color: RGBA de 8 bits por pixel. null si es escala de grises. */
  rgba: Uint8ClampedArray | null;
  /** Mínimo y máximo de `values` (0-255 en color). */
  min: number;
  max: number;
  /** Ventana inicial: la del encabezado si existe; si no, el rango completo de la imagen. */
  windowCenter: number;
  windowWidth: number;
};

export type DicomErrorCode = 'not_dicom' | 'compressed' | 'no_pixel_data' | 'unsupported';
export type DicomResult =
  | { ok: true; image: DicomImage }
  | { ok: false; code: DicomErrorCode; message: string; header: DicomHeader | null };

export const DICOM_COMPRESSED_MESSAGE = 'Este estudio usa un formato comprimido que el visor básico no abre';
const MESSAGES: Record<DicomErrorCode, string> = {
  not_dicom: 'El archivo no es un DICOM válido.',
  compressed: DICOM_COMPRESSED_MESSAGE,
  no_pixel_data: DICOM_COMPRESSED_MESSAGE,
  unsupported: 'Este estudio usa un formato de imagen que el visor básico no abre',
};

const IMPLICIT_LE = '1.2.840.10008.1.2';
const EXPLICIT_LE = '1.2.840.10008.1.2.1';
const EXPLICIT_BE = '1.2.840.10008.1.2.2';
const MAX_PIXELS = 64_000_000; // tope de cordura: 8000 × 8000

const clean = (s: string | undefined | null) => {
  const t = (s ?? '').replace(/\0/g, '').trim();
  return t || null;
};
/** 'PEREZ^JUAN^^' → 'JUAN PEREZ' */
const personName = (pn: string | null) => {
  if (!pn) return null;
  const [family = '', given = '', middle = ''] = pn.split('=')[0].split('^');
  return [given, middle, family].map((x) => x.trim()).filter(Boolean).join(' ') || null;
};

export function decodeDicom(buffer: ArrayBuffer | Uint8Array): DicomResult {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const fail = (code: DicomErrorCode, header: DicomHeader | null = null): DicomResult => ({ ok: false, code, message: MESSAGES[code], header });

  if (bytes.length < 136 || String.fromCharCode(bytes[128], bytes[129], bytes[130], bytes[131]) !== 'DICM') return fail('not_dicom');

  let ds: dicomParserNs.DataSet;
  let header: DicomHeader;
  let ts: string;
  try {
    // La cabecera (grupo 0002) siempre va en Explicit VR Little Endian: se lee primero para saber
    // la sintaxis de transferencia sin tener que interpretar el resto del archivo.
    ts = clean(parser.readPart10Header(bytes).string('x00020010')) ?? IMPLICIT_LE;
  } catch {
    return fail('not_dicom');
  }
  const uncompressed = ts === IMPLICIT_LE || ts === EXPLICIT_LE || ts === EXPLICIT_BE;
  try {
    // En las sintaxis comprimidas solo interesa el encabezado: se deja de leer al llegar al pixel data.
    ds = parser.parseDicom(bytes, uncompressed ? undefined : { untilTag: 'x7fe00010' });
    header = {
      modality: clean(ds.string('x00080060')),
      patientName: personName(clean(ds.string('x00100010'))),
      studyDescription: clean(ds.string('x00081030')),
      transferSyntax: ts,
    };
  } catch {
    return uncompressed ? fail('not_dicom') : fail('compressed', { modality: null, patientName: null, studyDescription: null, transferSyntax: ts });
  }
  if (!uncompressed) return fail('compressed', header);

  const px = ds.elements.x7fe00010;
  if (!px) return fail('no_pixel_data', header);
  if (px.encapsulatedPixelData || px.hadUndefinedLength) return fail('compressed', header);

  const rows = ds.uint16('x00280010') ?? 0;
  const cols = ds.uint16('x00280011') ?? 0;
  const samplesPerPixel = ds.uint16('x00280002') ?? 1;
  const bitsAllocated = ds.uint16('x00280100') ?? 0;
  const bitsStored = Math.min(ds.uint16('x00280101') ?? bitsAllocated, bitsAllocated);
  const pixelRepresentation = ds.uint16('x00280103') ?? 0;
  const planar = ds.uint16('x00280006') ?? 0;
  const photometric = clean(ds.string('x00280004')) ?? 'MONOCHROME2';
  const frames = Math.max(1, parseInt(clean(ds.string('x00280008')) ?? '1', 10) || 1);
  if (!rows || !cols || rows * cols > MAX_PIXELS) return fail('unsupported', header);

  const n = rows * cols;
  const bytesPerSample = bitsAllocated / 8;
  const mono = photometric === 'MONOCHROME1' || photometric === 'MONOCHROME2';
  const color = photometric === 'RGB' || photometric === 'YBR_FULL';
  if (mono ? (samplesPerPixel !== 1 || (bitsAllocated !== 8 && bitsAllocated !== 16)) : !(color && samplesPerPixel === 3 && bitsAllocated === 8)) {
    return fail('unsupported', header);
  }
  if (bitsStored < 1) return fail('unsupported', header);
  const frameBytes = n * samplesPerPixel * bytesPerSample;
  if (px.length < frameBytes || px.dataOffset + frameBytes > bytes.length) return fail('no_pixel_data', header);

  const num = (tag: string, fallback: number) => {
    const v = parseFloat((clean(ds.string(tag)) ?? '').split('\\')[0]);
    return Number.isFinite(v) ? v : fallback;
  };
  const base = {
    ...header, rows, cols, frames, bitsAllocated, bitsStored, pixelRepresentation, photometric, samplesPerPixel,
  };

  if (!mono) {
    const rgba = new Uint8ClampedArray(n * 4);
    const o = px.dataOffset;
    for (let i = 0; i < n; i++) {
      let a: number, b: number, c: number;
      if (planar === 1) { a = bytes[o + i]; b = bytes[o + n + i]; c = bytes[o + 2 * n + i]; }
      else { a = bytes[o + i * 3]; b = bytes[o + i * 3 + 1]; c = bytes[o + i * 3 + 2]; }
      if (photometric === 'YBR_FULL') {
        const y = a, cb = b - 128, cr = c - 128;
        a = y + 1.402 * cr; b = y - 0.344136 * cb - 0.714136 * cr; c = y + 1.772 * cb;
      }
      rgba[i * 4] = a; rgba[i * 4 + 1] = b; rgba[i * 4 + 2] = c; rgba[i * 4 + 3] = 255;
    }
    return { ok: true, image: { ...base, slope: 1, intercept: 0, values: null, rgba, min: 0, max: 255, windowCenter: 127.5, windowWidth: 255 } };
  }

  const slope = num('x00281053', 1) || 1;
  const intercept = num('x00281052', 0);
  const values = new Float32Array(n);
  const signed = pixelRepresentation === 1;
  const mask = bitsStored >= 32 ? 0xffffffff : (1 << bitsStored) - 1;
  const signBit = 1 << (bitsStored - 1);
  const view = new DataView(bytes.buffer, bytes.byteOffset + px.dataOffset, frameBytes);
  const little = ts !== EXPLICIT_BE;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < n; i++) {
    let raw = (bitsAllocated === 16 ? view.getUint16(i * 2, little) : view.getUint8(i)) & mask;
    if (signed && raw & signBit) raw -= signBit << 1;
    const v = raw * slope + intercept;
    values[i] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  let windowCenter = num('x00281050', NaN);
  let windowWidth = num('x00281051', NaN);
  if (!Number.isFinite(windowCenter) || !Number.isFinite(windowWidth) || windowWidth < 1) {
    windowCenter = (min + max) / 2;
    windowWidth = Math.max(max - min, 1);
  }
  return { ok: true, image: { ...base, slope, intercept, values, rgba: null, min, max, windowCenter, windowWidth } };
}

export type DicomView = { center?: number; width?: number; invert?: boolean };

/**
 * Convierte la imagen a RGBA de 8 bits aplicando ventana (contraste) y nivel (brillo) con la función
 * lineal del estándar. MONOCHROME1 se dibuja invertido (el valor mínimo es blanco). Pura: el visor
 * solo copia el resultado a un <canvas>.
 */
export function renderDicom(image: DicomImage, view: DicomView = {}): Uint8ClampedArray {
  const n = image.rows * image.cols;
  const out = new Uint8ClampedArray(n * 4);
  const invert = !!view.invert;
  if (image.rgba) {
    out.set(image.rgba);
    if (invert) for (let i = 0; i < n * 4; i += 4) { out[i] = 255 - out[i]; out[i + 1] = 255 - out[i + 1]; out[i + 2] = 255 - out[i + 2]; }
    return out;
  }
  const values = image.values!;
  const c = view.center ?? image.windowCenter;
  const w = Math.max(view.width ?? image.windowWidth, 1);
  const flip = (image.photometric === 'MONOCHROME1') !== invert;
  const lo = c - 0.5 - (w - 1) / 2;
  const scale = w > 1 ? 255 / (w - 1) : 255;
  for (let i = 0; i < n; i++) {
    let g = (values[i] - lo) * scale;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    if (flip) g = 255 - g;
    const j = i * 4;
    out[j] = g; out[j + 1] = g; out[j + 2] = g; out[j + 3] = 255;
  }
  return out;
}
