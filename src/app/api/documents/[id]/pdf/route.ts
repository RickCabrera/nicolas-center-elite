import { route } from '@/lib/api';
import { logEvent } from '@/lib/audit';
import { notFound } from '@/lib/errors';
import { pdfResponse } from '@/lib/pdf';
import { buildDocumentPdf, loadDocument } from '@/modules/documents/server';

// REC-08 · PDF en hoja carta con el mismo contenido que la vista (sello CANCELADO si aplica).
export const GET = route({ auth: 'clinical' }, async ({ db, user, params, query }) => {
  const doc = await loadDocument(db, params.id, user);
  if (!doc) throw notFound('Documento no encontrado.');
  const bytes = await buildDocumentPdf(doc);
  await logEvent(db, 'export', `Descargó ${doc.folio}`, { patientId: doc.patient_id, table: 'documents', rowId: doc.id });
  return pdfResponse(bytes, `${doc.folio}.pdf`, query.download !== '1');
});
