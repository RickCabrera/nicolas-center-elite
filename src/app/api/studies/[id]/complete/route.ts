import { route } from '@/lib/api';
import { badRequest, notFound } from '@/lib/errors';
import { MAX_UPLOAD_BYTES, storage } from '@/lib/storage';
import { findStudy, publicStudy } from '@/modules/studies/server';

/**
 * EST-02 · Paso 3 de la subida: comprueba en el almacenamiento que el archivo realmente llegó, guarda su
 * tamaño real, descarta la miniatura si no se subió y deja el estudio `ready` (hasta entonces no se lista).
 */
export const POST = route({ auth: 'user' }, async ({ db, params }) => {
  const row = await findStudy(db, params.id);
  if (!row) throw notFound('Estudio no encontrado.');
  if (row.status === 'ready') return publicStudy(row); // repetir la llamada no cambia nada

  const size = await storage.size(row.storage_path);
  if (!size) throw badRequest('El archivo no terminó de subirse. Intenta subirlo de nuevo.');
  if (size > MAX_UPLOAD_BYTES) throw badRequest(`El archivo supera el máximo de ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);

  let thumb = row.thumb_path;
  if (thumb && !(await storage.size(thumb))) thumb = null;

  await db`update studies set status = 'ready', size_bytes = ${size}, thumb_path = ${thumb} where id = ${row.id}`;
  return publicStudy((await findStudy(db, row.id))!);
});
