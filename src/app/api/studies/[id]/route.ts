import { z } from 'zod';
import { route } from '@/lib/api';
import { logEvent } from '@/lib/audit';
import { todayIso } from '@/lib/dates';
import { badRequest, notFound } from '@/lib/errors';
import { storage } from '@/lib/storage';
import { FILE_URL_TTL, findStudy, publicStudy } from '@/modules/studies/server';

/**
 * EST-01 · Detalle de un estudio con sus URLs firmadas. Primero se comprueba bajo RLS que el usuario
 * ve el estudio; solo entonces se firman `file_url` y `download_url` (5 minutos). Cada entrega queda
 * en la bitácora como acceso (`view`). Un archivado solo lo abre el dueño (EST-06).
 */
export const GET = route({ auth: 'clinical' }, async ({ db, user, params }) => {
  const row = await findStudy(db, params.id);
  if (!row || row.status !== 'ready' || (row.archived_at && user.role !== 'owner')) throw notFound('Estudio no encontrado.');
  const [file_url, download_url] = await Promise.all([
    storage.signedUrl(row.storage_path, { expiresIn: FILE_URL_TTL }),
    storage.signedUrl(row.storage_path, { expiresIn: FILE_URL_TTL, downloadName: row.file_name }),
  ]);
  await logEvent(db, 'view', `Abrió estudio: ${row.title}`, { patientId: row.patient_id, table: 'studies', rowId: row.id });
  return { ...(await publicStudy(row)), file_url, download_url, url_expires_in: FILE_URL_TTL };
});

const Patch = z.object({
  title: z.string().trim().min(1, 'Escribe el nombre del estudio.').max(160, 'El nombre es demasiado largo.').optional(),
  type_name: z.string().trim().min(1, 'Selecciona el tipo de estudio.').max(80).optional(),
  study_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida.').optional(),
});

// Corrige los metadatos (nombre, tipo, fecha). El archivo no cambia; el cambio queda en la bitácora por trigger.
export const PATCH = route({ auth: 'clinical', body: Patch }, async ({ db, user, params, body }) => {
  const row = await findStudy(db, params.id);
  if (!row || row.status !== 'ready' || (row.archived_at && user.role !== 'owner')) throw notFound('Estudio no encontrado.');
  if (body.study_date && body.study_date > todayIso()) {
    throw badRequest('La fecha del estudio no puede ser futura.', { study_date: 'La fecha del estudio no puede ser futura.' });
  }
  if (body.type_name && body.type_name !== row.type_name) {
    const [type] = await db`select name from study_types where name = ${body.type_name} and active`;
    if (!type) throw badRequest('Ese tipo de estudio no existe o está desactivado.', { type_name: 'Selecciona un tipo de estudio válido.' });
  }
  await db`
    update studies set title = ${body.title ?? row.title}, type_name = ${body.type_name ?? row.type_name},
                       study_date = ${body.study_date ?? row.study_date}
    where id = ${row.id}`;
  return publicStudy((await findStudy(db, row.id))!);
});
