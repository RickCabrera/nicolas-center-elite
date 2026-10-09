import { route } from '@/lib/api';
import { logEvent } from '@/lib/audit';
import { notFound } from '@/lib/errors';
import { loadDocument } from '@/modules/documents/server';

// REC-08 · Deja constancia en la bitácora de que el documento se mandó a imprimir.
export const POST = route({ auth: 'user' }, async ({ db, user, params }) => {
  const doc = await loadDocument(db, params.id, user);
  if (!doc) throw notFound('Documento no encontrado.');
  await logEvent(db, 'print', `Imprimió ${doc.folio}`, { patientId: doc.patient_id, table: 'documents', rowId: doc.id });
  return { ok: true };
});
