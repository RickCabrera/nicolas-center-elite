import { z } from 'zod';
import { paging, route } from '@/lib/api';
import { createPaymentLink } from '@/modules/billing/online';

const dropEmpty = (v: unknown) =>
  v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '')) : v;

const Query = z.preprocess(dropEmpty, z.object({
  patient_id: z.uuid().optional(),
  status: z.enum(['open', 'pending_oxxo', 'paid', 'needs_review', 'expired', 'failed', 'cancelled', 'refunded', 'active']).optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
}));

// PAG-12 · Links de pago en línea (solo dueño). status=active → los que siguen esperando o requieren revisión.
export const GET = route({ auth: 'owner', query: Query }, async ({ db, query }) => {
  const { limit, offset } = paging(query, 200, 50);
  const where = db`where true
    ${query.patient_id ? db`and k.patient_id = ${query.patient_id}` : db``}
    ${query.status === 'active' ? db`and k.status in ('open','pending_oxxo','needs_review')`
      : query.status ? db`and k.status = ${query.status}` : db``}`;
  const items = await db`
    select k.*, p.full_name as patient_name, p.record_number, y.receipt_number
    from payment_links k join patients p on p.id = k.patient_id left join payments y on y.id = k.payment_id
    ${where}
    order by (k.status = 'needs_review') desc, k.created_at desc
    limit ${limit} offset ${offset}`;
  const counts = await db<{ status: string; n: number }[]>`select status, count(*)::int as n from payment_links group by status`;
  const [t] = await db<{ total: number }[]>`select count(*)::int as total from payment_links k ${where}`;
  return { items, total: t.total, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
});

const Body = z.object({
  patient_id: z.uuid('Paciente inválido.'),
  amount_cents: z.number('Escribe un monto válido.').int('Escribe un monto válido.').min(1000, 'El cobro en línea debe ser de al menos $10.00.').max(100_000_000, 'El monto es demasiado alto.').optional(),
  methods: z.array(z.enum(['card', 'oxxo'])).max(2).optional(),
  email: z.union([z.literal(''), z.email('Escribe un correo válido.')]).optional(),
});

// PAG-12 · Genera el link de pago de la mensualidad (Stripe Checkout).
export const POST = route({ auth: 'owner', body: Body }, async ({ db, user, body }) => createPaymentLink(db, user, body));
