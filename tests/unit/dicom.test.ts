import { describe, expect, it } from 'vitest';
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, mimeForFile } from '@/lib/storage';
import { DICOM_COMPRESSED_MESSAGE, decodeDicom, renderDicom } from '@/modules/studies/dicom';
import { baseName, fileProblem, formatLabel, STUDY_EXTENSIONS, STUDY_MAX_BYTES, studyMime } from '@/modules/studies/file-rules';
import { allowedMime, safeFileName } from '@/modules/studies/server';
import { sampleDicom } from '../../scripts/lib/sample-files';

const toArrayBuffer = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** Cambia la sintaxis de transferencia del DICOM de muestra (misma longitud de UID o más corta, con relleno). */
function withTransferSyntax(src: Buffer, uid: string): Buffer {
  const out = Buffer.from(src);
  const at = out.indexOf(Buffer.from('1.2.840.10008.1.2.1\0', 'latin1'));
  expect(at).toBeGreaterThan(0);
  out.write(uid.padEnd(20, '\0'), at, 'latin1');
  return out;
}

describe('EST-04 · decodificador DICOM', () => {
  it('abre el DICOM de muestra: dimensiones, bits, ventana, modalidad y paciente', () => {
    const r = decodeDicom(toArrayBuffer(sampleDicom(3, 256, 200, 'CARDENAS^EMILIANO')));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const img = r.image;
    expect(img.rows).toBe(256);
    expect(img.cols).toBe(200);
    expect(img.bitsAllocated).toBe(16);
    expect(img.bitsStored).toBe(12);
    expect(img.pixelRepresentation).toBe(0);
    expect(img.photometric).toBe('MONOCHROME2');
    expect(img.modality).toBe('MR');
    expect(img.patientName).toBe('EMILIANO CARDENAS');
    expect(img.windowCenter).toBe(2048);
    expect(img.windowWidth).toBe(4096);
    expect(img.slope).toBe(1);
    expect(img.intercept).toBe(0);
    expect(img.values).toHaveLength(256 * 200);
    expect(img.min).toBeGreaterThanOrEqual(0);
    expect(img.max).toBeLessThanOrEqual(4095);
    expect(img.max - img.min).toBeGreaterThan(1000); // hay imagen, no un plano uniforme
  });

  it('acepta también un Uint8Array con desplazamiento (vista sobre otro búfer)', () => {
    const file = sampleDicom(1, 64, 64);
    const padded = new Uint8Array(file.length + 7);
    padded.set(file, 7);
    const r = decodeDicom(padded.subarray(7));
    expect(r.ok && r.image.rows).toBe(64);
  });

  it('dibuja en escala de grises y respeta ventana, nivel e invertir', () => {
    const r = decodeDicom(toArrayBuffer(sampleDicom(2, 64, 64)));
    if (!r.ok) throw new Error(r.message);
    const px = renderDicom(r.image);
    expect(px).toHaveLength(64 * 64 * 4);
    const center = (32 * 64 + 32) * 4, corner = 0;
    expect(px[center]).toBe(px[center + 1]);
    expect(px[center]).toBe(px[center + 2]);
    expect(px[center + 3]).toBe(255);
    expect(px[center]).toBeGreaterThan(px[corner] + 60); // el "hueso" del centro es más claro que el fondo
    const inv = renderDicom(r.image, { invert: true });
    expect(inv[center]).toBe(255 - px[center]);
    // Ventana angosta centrada muy arriba: casi todo queda negro.
    const dark = renderDicom(r.image, { center: 100000, width: 10 });
    expect(dark[center]).toBe(0);
    const bright = renderDicom(r.image, { center: -100000, width: 10 });
    expect(bright[center]).toBe(255);
  });

  it('rechaza basura, archivos vacíos y un PDF con error tipado', () => {
    for (const junk of [new Uint8Array(0), new Uint8Array(4000).fill(7), new TextEncoder().encode('%PDF-1.7 no soy un dicom'.repeat(40))]) {
      const r = decodeDicom(junk);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('not_dicom');
    }
    // Con la firma DICM pero sin contenido válido tampoco truena: devuelve un error tipado.
    const fake = new Uint8Array(600).fill(0xab);
    fake.set(new TextEncoder().encode('DICM'), 128);
    const r = decodeDicom(fake);
    expect(r.ok).toBe(false);
  });

  it('una sintaxis comprimida (JPEG, JPEG 2000, RLE) da el mensaje del visor y conserva el encabezado', () => {
    for (const uid of ['1.2.840.10008.1.2.4.50', '1.2.840.10008.1.2.4.90', '1.2.840.10008.1.2.5']) {
      const r = decodeDicom(withTransferSyntax(sampleDicom(1, 32, 32, 'DEMO^PACIENTE'), uid));
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.code).toBe('compressed');
      expect(r.message).toBe(DICOM_COMPRESSED_MESSAGE);
      expect(r.header?.modality).toBe('MR');
    }
  });

  it('sin pixel data (archivo truncado) responde no_pixel_data con el mismo mensaje', () => {
    const file = sampleDicom(1, 64, 64);
    const cut = file.subarray(0, file.length - 64 * 64 * 2 - 12); // quita el elemento 7FE0,0010 completo
    const r = decodeDicom(cut);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('no_pixel_data'); expect(r.message).toBe(DICOM_COMPRESSED_MESSAGE); }
  });
});

describe('EST-02 · reglas de archivo', () => {
  it('las extensiones y el tamaño máximo del navegador coinciden con los del servidor', () => {
    const server: Record<string, string> = {};
    for (const [mime, exts] of Object.entries(ALLOWED_MIME)) for (const e of exts) server[e] = mime;
    expect(STUDY_EXTENSIONS).toEqual(server);
    expect(STUDY_MAX_BYTES).toBe(MAX_UPLOAD_BYTES);
    for (const name of ['a.jpg', 'b.JPEG', 'c.png', 'd.webp', 'e.pdf', 'f.dcm', 'g.exe', 'h']) {
      expect(studyMime(name)).toBe(mimeForFile(name));
    }
  });

  it('valida tipo y tamaño con mensajes claros', () => {
    expect(fileProblem({ name: 'rx.jpg', size: 1000 })).toBeNull();
    expect(fileProblem({ name: 'virus.exe', size: 1000 })).toMatch(/no se admite/);
    expect(fileProblem({ name: 'virus.exe', size: 1000, type: 'image/jpeg' })).toMatch(/no se admite/);
    expect(fileProblem({ name: 'rx.jpg', size: 0 })).toMatch(/vacío/);
    expect(fileProblem({ name: 'rm.dcm', size: STUDY_MAX_BYTES + 1 })).toMatch(/máximo es 200 MB/);
    expect(baseName('Rx rodilla izq.JPG')).toBe('Rx rodilla izq');
    expect(formatLabel('application/dicom', 'x.dcm')).toBe('DICOM');
    expect(formatLabel('image/jpeg', 'x.jpeg')).toBe('JPG');
  });

  it('nombre seguro: sin acentos, solo [A-Za-z0-9._-] y con extensión', () => {
    expect(safeFileName('Radiografía de rodilla (izq).JPG', 'image/jpeg')).toBe('Radiografia_de_rodilla_izq.jpg');
    expect(safeFileName('../../etc/passwd.pdf', 'application/pdf')).toBe('etc_passwd.pdf');
    expect(safeFileName('foto', 'image/jpeg')).toBe('foto.jpg');
    expect(safeFileName('thumb.jpg', 'image/jpeg')).toBe('archivo_thumb.jpg');
    expect(safeFileName('ñ.png', 'image/png')).toBe('n.png');
    expect(safeFileName('日本.pdf', 'application/pdf')).toBe('archivo.pdf');
    expect(safeFileName('a..b...c.dcm', 'application/dicom')).toBe('a.b.c.dcm');
    for (const n of ['Radiografía de rodilla (izq).JPG', '../../x.pdf', 'a b c.webp']) {
      expect(safeFileName(n, allowedMime(n)!)).toMatch(/^[A-Za-z0-9._-]+$/);
    }
    expect(allowedMime('malo.exe', 'image/jpeg')).toBeNull();
    expect(allowedMime('captura', 'image/png')).toBe('image/png');
  });
});
