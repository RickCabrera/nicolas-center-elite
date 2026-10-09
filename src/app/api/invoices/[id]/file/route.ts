import { z } from 'zod';
import { route } from '@/lib/api';
import { logEvent } from '@/lib/audit';
import { conflict, notFound } from '@/lib/errors';
import { downloadInvoice } from '@/lib/integrations/facturapi';

const TYPES = { pdf: 'application/pdf', xml: 'application/xml', zip: 'application/zip' } as const;

// FAC-06 · Descarga el PDF, el XML o ambos (ZIP) del CFDI timbrado.
export const GET = route({ auth: 'owner', query: z.object({ format: z.enum(['pdf', 'xml', 'zip']).default('pdf') }) }, async ({ db, params, query }) => {
  if (!z.uuid().safeParse(params.id).success) throw notFound('Factura no encontrada.');
  const [inv] = await db<{ id: string; provider_id: string | null; series: string; folio_number: number | null; patient_id: string | null }[]>`
    select id, provider_id, series, folio_number, patient_id from invoices where id = ${params.id}`;
  if (!inv) throw notFound('Factura no encontrada.');
  if (!inv.provider_id) throw conflict('La factura no llegó a timbrarse.', 'not_stamped');
  const file = await downloadInvoice(inv.provider_id, query.format);
  const name = `Factura ${inv.series}${inv.folio_number ?? ''}.${query.format}`;
  await logEvent(db, 'print', `Factura ${inv.series}${inv.folio_number ?? ''} (${query.format.toUpperCase()})`, { patientId: inv.patient_id ?? undefined, table: 'invoices', rowId: inv.id });
  return new Response(new Uint8Array(file), {
    headers: {
      'Content-Type': TYPES[query.format],
      'Content-Disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'private, no-store',
    },
  });
});
