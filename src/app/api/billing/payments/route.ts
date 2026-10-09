import { z } from 'zod';
import { paging, route } from '@/lib/api';
import { registerPayment } from '@/modules/billing/server';

const dropEmpty = (v: unknown) =>
  v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '')) : v;
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida.');

const Query = z.preprocess(dropEmpty, z.object({
  patient_id: z.uuid().optional(),
  from: DateStr.optional(),
  to: DateStr.optional(),
  method: z.enum(['cash', 'transfer', 'card', 'online_card', 'oxxo']).optional(),
  include_voided: z.enum(['true', 'false', '1', '0']).optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
}));

// PAG-04 · Historial de pagos (solo dueño). Por defecto no incluye los anulados.
export const GET = route({ auth: 'owner', query: Query }, async ({ db, query }) => {
  const { limit, offset } = paging(query, 500, 100);
  const voided = query.include_voided === 'true' || query.include_voided === '1';
  const where = db`where true
    ${query.patient_id ? db`and y.patient_id = ${query.patient_id}` : db``}
    ${query.from ? db`and y.paid_on >= ${query.from}` : db``}
    ${query.to ? db`and y.paid_on <= ${query.to}` : db``}
    ${query.method ? db`and y.method = ${query.method}` : db``}
    ${voided ? db`` : db`and y.voided_at is null`}`;
  const items = await db`
    select y.*, p.full_name as patient_name, p.record_number, l.name as location_name,
           inv.id as invoice_id, nullif(inv.series || coalesce(inv.folio_number::text, ''), '') as invoice_folio, inv.status as invoice_status
    from payments y join patients p on p.id = y.patient_id join locations l on l.id = p.location_id
    left join lateral (
      select i.id, i.series, i.folio_number, i.status from invoice_payments ip join invoices i on i.id = ip.invoice_id
      where ip.payment_id = y.id and ip.active limit 1
    ) inv on true
    ${where}
    order by y.paid_on desc, y.created_at desc
    limit ${limit} offset ${offset}`;
  const [t] = await db<{ total: number; total_cents: number }[]>`
    select count(*)::int as total, coalesce(sum(y.amount_cents) filter (where y.voided_at is null), 0)::int as total_cents
    from payments y ${where}`;
  return { items, total: t.total, total_cents: t.total_cents };
});

const Body = z.object({
  patient_id: z.uuid('Paciente inválido.'),
  amount_cents: z.number('Escribe un monto válido.').int('Escribe un monto válido.').min(0, 'El monto no puede ser negativo.').max(100_000_000, 'El monto es demasiado alto.').optional(),
  method: z.enum(['cash', 'transfer', 'card'], 'Elige el método de pago.'),
  // Tarjeta: 04 crédito o 28 débito (sirve al facturar). Los pagos en línea se registran solos por el webhook.
  sat_payment_form: z.enum(['01', '02', '03', '04', '28'], 'Forma de pago inválida.').optional(),
  paid_on: DateStr.optional(),
  reference: z.string().trim().max(120, 'Máximo 120 caracteres.').default(''),
  note: z.string().trim().max(500, 'Máximo 500 caracteres.').default(''),
});

// PAG-04 · Registra un pago: recorre el vencimiento o carga sesiones según el tipo de plan.
export const POST = route({ auth: 'owner', body: Body }, async ({ db, user, body }) => {
  const { payment, billing } = await registerPayment(db, user, body);
  return { payment, billing, state: billing.state };
});
