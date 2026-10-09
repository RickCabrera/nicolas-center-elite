import { z } from 'zod';
import { route } from '@/lib/api';
import { badRequest, conflict, notFound } from '@/lib/errors';
import { findStudy, publicStudy } from '@/modules/studies/server';

const Body = z.object({
  reason: z.string().trim().max(500, 'El motivo es demasiado largo.').optional(),
  restore: z.boolean().optional(),
});

/**
 * EST-06 · Archivar o restaurar un estudio (solo dueño). Nunca se borra la fila ni el archivo:
 * archivar lo saca de los listados y guarda quién, cuándo y por qué.
 */
export const POST = route({ auth: 'owner', body: Body }, async ({ db, user, params, body }) => {
  const row = await findStudy(db, params.id);
  if (!row || row.status !== 'ready') throw notFound('Estudio no encontrado.');

  if (body.restore) {
    if (!row.archived_at) throw conflict('El estudio no está archivado.');
    await db`update studies set archived_at = null, archived_by = null, archive_reason = null where id = ${row.id}`;
  } else {
    const reason = body.reason ?? '';
    if (reason.length < 3) throw badRequest('Escribe el motivo para archivar el estudio.', { reason: 'Escribe el motivo.' });
    if (row.archived_at) throw conflict('El estudio ya está archivado.');
    await db`update studies set archived_at = now(), archived_by = ${user.id}, archive_reason = ${reason} where id = ${row.id}`;
  }
  return publicStudy((await findStudy(db, row.id))!);
});
