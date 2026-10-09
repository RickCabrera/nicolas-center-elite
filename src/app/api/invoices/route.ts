import { z } from 'zod';
import { paging, route } from '@/lib/api';
import { TaxProfileSchema } from '@/modules/invoicing/schema';
import { issueInvoice } from '@/modules/invoicing/server';

const dropEmpty = (v: unknown) =>
  v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '')) : v;
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida.');

const Query = z.preprocess(dropEmpty, z.object({
  patient_id: z.uuid().optional(),
  kind: z.enum(['individual', 'global']).optional(),
  status: z.enum(['pending', 'valid', 'canceled', 'error']).optional(),
  from: DateStr.optional(),
  to: DateStr.optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
}));

// FAC-06 · Facturas emitidas (solo dueño), con los recibos que cubre cada una.
export const GET = route({ auth: 'owner', query: Query }, async ({ db, query }) => {
  const { limit, offset } = paging(query, 200, 50);
  const where = db`where true
    ${query.patient_id ? db`and i.patient_id = ${query.patient_id}` : db``}
    ${query.kind ? db`and i.kind = ${query.kind}` : db``}
    ${query.status ? db`and i.status = ${query.status}` : db``}
    ${query.from ? db`and mx_date(i.created_at) >= ${query.from}` : db``}
    ${query.to ? db`and mx_date(i.created_at) <= ${query.to}` : db``}`;
  const items = await db`
    select i.*, p.full_name as patient_name, p.record_number,
      (select coalesce(json_agg(json_build_object('id', y.id, 'receipt_number', y.receipt_number, 'amount_cents', y.amount_cents) order by y.receipt_number), '[]')
         from invoice_payments ip join payments y on y.id = ip.payment_id where ip.invoice_id = i.id) as payments
    from invoices i left join patients p on p.id = i.patient_id
    ${where}
    order by i.created_at desc
    limit ${limit} offset ${offset}`;
  const [t] = await db<{ total: number; total_cents: number }[]>`
    select count(*)::int as total, coalesce(sum(i.total_cents) filter (where i.status = 'valid'), 0)::int as total_cents from invoices i ${where}`;
  return { items, total: t.total, total_cents: t.total_cents };
});

const Body = z.object({
  payment_ids: z.array(z.uuid('Pago inválido.')).min(1, 'Elige al menos un pago.').max(50, 'Máximo 50 pagos por factura.'),
  payment_form: z.string().regex(/^\d{2}$/, 'Elige la forma de pago.').optional(),
  cfdi_use: z.string().regex(/^[A-Z]{1,2}\d{2}$/, 'Elige el uso de CFDI.').optional(),
  send_email: z.boolean().default(true),
  email: z.union([z.literal(''), z.email('Escribe un correo válido.')]).optional(),
  tax_profile: TaxProfileSchema.optional(),
});

// FAC-02 · Timbra la factura de uno o varios pagos de un paciente.
export const POST = route({ auth: 'owner', body: Body }, async ({ db, user, body }) => issueInvoice(db, user, body));
