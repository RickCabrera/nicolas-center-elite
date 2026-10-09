import { route } from '@/lib/api';
import { notFound } from '@/lib/errors';
import { loadDocument } from '@/modules/documents/server';

// REC-08 · Documento completo con renglones y `can_cancel` (dueño o emisor, y aún vigente).
export const GET = route({ auth: 'clinical' }, async ({ db, user, params }) => {
  const doc = await loadDocument(db, params.id, user);
  if (!doc) throw notFound('Documento no encontrado.');
  return doc;
});
