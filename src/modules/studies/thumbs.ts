'use client';
/**
 * EST-05 · Miniaturas reales generadas en el navegador antes de subir:
 *   · imagen → JPEG de ~480 px de ancho dibujado en un <canvas>
 *   · DICOM  → primer cuadro renderizado con el mismo decodificador del visor
 *   · PDF    → sin miniatura (la tarjeta muestra el mosaico con el tipo)
 * Si algo falla se devuelve null: el estudio se sube igual, solo sin miniatura.
 */
const THUMB_WIDTH = 480;
const DICOM_THUMB_MAX_BYTES = 120 * 1024 * 1024; // decodificar exige el archivo completo en memoria

type Drawable = { source: CanvasImageSource; width: number; height: number; release: () => void };

async function loadImage(file: Blob): Promise<Drawable> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
    } catch { /* se intenta con <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('No se pudo leer la imagen.'));
      img.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

function toJpeg(source: CanvasImageSource, width: number, height: number): Promise<Blob | null> {
  if (!width || !height) return Promise.resolve(null);
  const scale = Math.min(1, THUMB_WIDTH / width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b && b.size > 0 ? b : null), 'image/jpeg', 0.8));
}

export async function makeThumbnail(file: Blob, mime: string): Promise<Blob | null> {
  try {
    if (mime.startsWith('image/')) {
      const img = await loadImage(file);
      try {
        return await toJpeg(img.source, img.width, img.height);
      } finally {
        img.release();
      }
    }
    if (mime === 'application/dicom' && file.size <= DICOM_THUMB_MAX_BYTES) {
      const { decodeDicom, renderDicom } = await import('./dicom');
      const r = decodeDicom(await file.arrayBuffer());
      if (!r.ok) return null;
      const full = document.createElement('canvas');
      full.width = r.image.cols;
      full.height = r.image.rows;
      const ctx = full.getContext('2d');
      if (!ctx) return null;
      const data = ctx.createImageData(r.image.cols, r.image.rows);
      data.data.set(renderDicom(r.image));
      ctx.putImageData(data, 0, 0);
      return await toJpeg(full, full.width, full.height);
    }
  } catch { /* sin miniatura */ }
  return null;
}
