import { route } from '@/lib/api';
import { verifyStripeWebhook } from '@/lib/integrations/stripe';
import { handleStripeEvent } from '@/modules/billing/online';

export const dynamic = 'force-dynamic';

/**
 * PAG-12 · Webhook de Stripe. Público: la autenticidad la da la firma `Stripe-Signature` (STRIPE_WEBHOOK_SECRET).
 * Eventos: checkout.session.completed, .async_payment_succeeded, .async_payment_failed y .expired.
 * Cada evento se procesa una sola vez aunque Stripe lo reintente.
 */
export const POST = route({ auth: 'public' }, async ({ req, db }) => {
  const raw = await req.text();
  const event = verifyStripeWebhook(raw, req.headers.get('stripe-signature'));
  const r = await handleStripeEvent(db, event);
  return { received: true, ...r };
});
