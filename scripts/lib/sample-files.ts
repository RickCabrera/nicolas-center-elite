import { PDFDocument, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';

/** Archivos de muestra para la base de demostración y las pruebas (no son estudios reales). */

/** Imagen en escala de grises con forma de "radiografía" sintética. */
function synthetic(width: number, height: number, max: number, seed: number): Uint16Array {
  const px = new Uint16Array(width * height);
  const cx = width / 2, cy = height / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (x - cx) / (width * 0.18), dy = (y - cy) / (height * 0.44);
      const bone = Math.exp(-(dx * dx + Math.pow(dy, 4)));
      const joint = Math.exp(-(Math.pow((x - cx) / (width * 0.26), 2) + Math.pow((y - cy - Math.sin(seed) * 20) / (height * 0.09), 2)));
      const noise = (Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453) % 1;
      const v = 0.08 + 0.62 * bone + 0.28 * joint + 0.03 * noise;
      px[y * width + x] = Math.max(0, Math.min(max, Math.round(v * max)));
    }
  }
  return px;
}

export async function sampleJpeg(seed = 1, width = 900, height = 1100): Promise<Buffer> {
  const px = synthetic(width, height, 255, seed);
  return sharp(Buffer.from(Uint8Array.from(px)), { raw: { width, height, channels: 1 } }).jpeg({ quality: 82 }).toBuffer();
}

export async function samplePdf(title: string, lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  page.drawText(title, { x: 50, y: 730, size: 18, font: bold });
  page.drawText('Documento de demostración · sin validez clínica', { x: 50, y: 708, size: 10, font });
  lines.forEach((l, i) => page.drawText(l, { x: 50, y: 670 - i * 18, size: 11, font }));
  return Buffer.from(await doc.save());
}

/** DICOM mínimo válido: Explicit VR Little Endian, MONOCHROME2, 16 bits asignados / 12 almacenados. */
export function sampleDicom(seed = 1, rows = 256, cols = 256, patientName = 'DEMO^PACIENTE'): Buffer {
  const even = (s: string, pad = ' ') => (s.length % 2 ? s + pad : s);
  const el = (group: number, element: number, vr: string, value: Buffer): Buffer => {
    const long = ['OB', 'OW', 'OF', 'SQ', 'UT', 'UN'].includes(vr);
    const head = Buffer.alloc(long ? 12 : 8);
    head.writeUInt16LE(group, 0);
    head.writeUInt16LE(element, 2);
    head.write(vr, 4, 'latin1');
    if (long) head.writeUInt32LE(value.length, 8);
    else head.writeUInt16LE(value.length, 6);
    return Buffer.concat([head, value]);
  };
  const str = (g: number, e: number, vr: string, s: string) => el(g, e, vr, Buffer.from(even(s, vr === 'UI' ? '\0' : ' '), 'latin1'));
  const us = (g: number, e: number, n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return el(g, e, 'US', b); };

  const uid = `1.2.826.0.1.3680043.8.498.${Date.now()}${seed}`;
  const metaBody = Buffer.concat([
    el(0x0002, 0x0001, 'OB', Buffer.from([0, 1])),
    str(0x0002, 0x0002, 'UI', '1.2.840.10008.5.1.4.1.1.4'),
    str(0x0002, 0x0003, 'UI', uid),
    str(0x0002, 0x0010, 'UI', '1.2.840.10008.1.2.1'),
    str(0x0002, 0x0012, 'UI', '1.2.826.0.1.3680043.8.498.1'),
  ]);
  const len = Buffer.alloc(4);
  len.writeUInt32LE(metaBody.length, 0);
  const meta = Buffer.concat([el(0x0002, 0x0000, 'UL', len), metaBody]);

  const px = synthetic(cols, rows, 4095, seed);
  const pixels = Buffer.from(px.buffer, px.byteOffset, px.byteLength);
  const data = Buffer.concat([
    str(0x0008, 0x0016, 'UI', '1.2.840.10008.5.1.4.1.1.4'),
    str(0x0008, 0x0018, 'UI', uid),
    str(0x0008, 0x0060, 'CS', 'MR'),
    str(0x0010, 0x0010, 'PN', patientName),
    us(0x0028, 0x0002, 1),
    str(0x0028, 0x0004, 'CS', 'MONOCHROME2'),
    us(0x0028, 0x0010, rows),
    us(0x0028, 0x0011, cols),
    us(0x0028, 0x0100, 16),
    us(0x0028, 0x0101, 12),
    us(0x0028, 0x0102, 11),
    us(0x0028, 0x0103, 0),
    str(0x0028, 0x1050, 'DS', '2048'),
    str(0x0028, 0x1051, 'DS', '4096'),
    el(0x7fe0, 0x0010, 'OW', pixels),
  ]);
  return Buffer.concat([Buffer.alloc(128), Buffer.from('DICM', 'latin1'), meta, data]);
}
