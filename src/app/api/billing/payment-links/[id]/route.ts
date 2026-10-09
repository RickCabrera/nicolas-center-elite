import { z } from 'zod';
import { route } from '@/lib/api';
import { forbidden, notFound } from '@/lib/errors';
import { applyReviewedLink, cancelLink, refundReviewedLink, syncLink } from '@/modules/billing/online';

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('sync') }),
  z.object({ action: z.literal('cancel') }),
  z.object({ action: z.literal('apply'), note: z.string().trim().max(500, 'Máximo 500 caracteres.').default('') }),
  z.object({ action: z.literal('refund') }),
], 'Acción inválida.');

// PAG-12 · Acciones sobre un link: consultar a Stripe, cancelar, y resolver los que requieren revisión.
// AUTH-10 · Recepción consulta y cancela; resolver un link en revisión (aplicarlo o reembolsarlo) es del dueño.
export const POST = route({ auth: 'front', body: Body }, async ({ db, user, params, body }) => {
  if ((body.action === 'apply' || body.action === 'refund') && user.role !== 'owner') {
    throw forbidden('Solo el dueño puede resolver un pago en revisión o reembolsarlo.');
  }
  if (!z.uuid().safeParse(params.id).success) throw notFound('Link de pago no encontrado.');
  switch (body.action) {
    case 'sync': return syncLink(db, params.id);
    case 'cancel': return { link: await cancelLink(db, params.id) };
    case 'apply': return applyReviewedLink(db, user, params.id, body.note);
    case 'refund': return { link: await refundReviewedLink(db, params.id) };
  }
});
