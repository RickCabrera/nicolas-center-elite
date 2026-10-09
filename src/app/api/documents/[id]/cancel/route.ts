import { z } from 'zod';
import { route } from '@/lib/api';
import { conflict, forbidden, notFound } from '@/lib/errors';
import { loadDocument } from '@/modules/documents/server';

const Body = z.object({
  reason: z.string('Escribe el motivo de la cancelación.').trim().min(3, 'Escribe el motivo de la cancelación.').max(500, 'Máximo 500 caracteres.'),
});

// REC-05 · Cancela un documento emitido (dueño o emisor). No se borra y conserva su folio.
export const POST = route({ auth: 'user', body: Body }, async ({ db, user, params, body }) => {
  const doc = await loadDocument(db, params.id, user);
  if (!doc) throw notFound('Documento no encontrado.');
  if (user.role !== 'owner' && doc.issuer_id !== user.id) throw forbidden('Solo quien emitió el documento o el dueño pueden cancelarlo.');
  if (doc.status === 'cancelled') throw conflict('El documento ya está cancelado.', 'already_cancelled');
  await db`update documents set status = 'cancelled', cancel_reason = ${body.reason}, cancelled_by = ${user.id}, cancelled_at = now()
           where id = ${doc.id}`;
  return loadDocument(db, doc.id, user);
});
