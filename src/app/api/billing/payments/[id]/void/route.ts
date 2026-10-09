import { z } from 'zod';
import { route } from '@/lib/api';
import { notFound } from '@/lib/errors';
import { refundPayment } from '@/modules/billing/online';
import { voidPayment } from '@/modules/billing/server';

const Body = z.object({
  reason: z.string('Escribe el motivo de la anulación.').trim().min(3, 'Escribe el motivo de la anulación.').max(500, 'Máximo 500 caracteres.'),
  // Solo pagos en línea: devolver también el dinero al paciente por Stripe.
  refund: z.boolean().default(false),
});

// PAG-05 · Anula un pago (solo dueño, con motivo) y revierte su efecto en la membresía.
export const POST = route({ auth: 'owner', body: Body }, async ({ db, user, params, body }) => {
  if (!z.uuid().safeParse(params.id).success) throw notFound('Pago no encontrado.');
  const { payment, billing, reverted } = await voidPayment(db, user, params.id, body.reason);
  // El reembolso va al final: si Stripe lo rechaza, la anulación se revierte junto con todo lo demás.
  const refund_id = body.refund ? await refundPayment(db, params.id) : null;
  return { payment, billing, state: billing?.state ?? 'sin_plan', reverted, refund_id };
});
