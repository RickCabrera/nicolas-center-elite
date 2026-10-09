import type { SessionUser } from '@/lib/auth/session';
import type { Tx } from '@/lib/db';
import { env } from '@/lib/env';
import { AppError, badRequest, conflict, notFound } from '@/lib/errors';
import { money } from '@/lib/format';
import {
  createCheckoutSession, createRefund, expireCheckoutSession, retrieveCheckoutSession, stripeConfigured,
  type CheckoutSession, type StripeEvent,
} from '@/lib/integrations/stripe';
import { readBillingSettings } from '@/modules/invoicing/catalogs';
import { registerPayment, requirePatient } from './server';

/**
 * PAG-12 · Cobro en línea con Stripe Checkout (tarjeta y OXXO).
 *
 * Flujo: el dueño genera un link para la mensualidad del paciente → lo manda por WhatsApp o correo →
 * el paciente paga en la página de Stripe → Stripe avisa al webhook → el pago se registra solo,
 * exactamente igual que uno capturado a mano (recorre el vencimiento o carga sesiones, folio de recibo).
 * Si al llegar el pago la membresía ya no es la misma (cambio de plan, pausa, baja), el link queda en
 * "Requiere revisión" para que el dueño decida: aplicarlo al plan vigente o reembolsarlo.
 */

export type LinkRow = {
  id: string; patient_id: string; membership_id: string; plan_name: string; concept: string; amount_cents: number;
  methods: string[]; customer_email: string | null; provider_session_id: string | null; url: string | null;
  status: 'open' | 'pending_oxxo' | 'paid' | 'needs_review' | 'expired' | 'failed' | 'cancelled' | 'refunded';
  payment_intent_id: string | null; paid_method: 'online_card' | 'oxxo' | null; payment_id: string | null;
  review_reason: string | null; refund_id: string | null; expires_at: Date; paid_at: Date | null; created_at: Date;
};

const SYSTEM_ACTOR = { id: null, display_name: 'Pago en línea (Stripe)' } as const;

async function settings(db: Tx) {
  const [c] = await db<{ settings: unknown }[]>`select settings from clinic`;
  return readBillingSettings(c?.settings);
}

export function assertOnlineReady() {
  if (!stripeConfigured()) {
    throw new AppError(503, 'stripe_not_configured', 'El cobro en línea aún no está conectado. Falta configurar Stripe (ver docs/despliegue.md).');
  }
}

// PAG-12 · Genera un link de pago para la membresía vigente del paciente.
export async function createPaymentLink(db: Tx, user: SessionUser, input: {
  patient_id: string; amount_cents?: number; methods?: ('card' | 'oxxo')[]; email?: string;
}) {
  assertOnlineReady();
  const cfg = await settings(db);
  if (!cfg.online_payments_enabled) throw conflict('El cobro en línea está desactivado en Configuración → Cobros y facturación.', 'online_disabled');
  const patient = await requirePatient(db, input.patient_id);
  const [m] = await db<{ id: string; status: string; plan_name: string; price_cents: number; plan_kind: string }[]>`
    select m.id, m.status, pl.name as plan_name, pl.price_cents, pl.kind as plan_kind
    from memberships m join membership_plans pl on pl.id = m.plan_id
    where m.patient_id = ${patient.id} and m.status <> 'ended'`;
  if (!m) throw conflict('El paciente no tiene un plan asignado. Asígnale un plan antes de cobrar.', 'no_plan');
  if (m.status === 'paused') throw conflict('La membresía está en pausa. Reanúdala antes de cobrar.', 'paused');

  const amount = input.amount_cents ?? m.price_cents;
  if (amount < 1000) throw badRequest('El cobro en línea debe ser de al menos $10.00.', { amount_cents: 'Mínimo $10.00.' });
  let methods = [...new Set(input.methods?.length ? input.methods : ['card' as const])];
  if (!cfg.oxxo_enabled) methods = methods.filter((x) => x !== 'oxxo');
  // OXXO acepta hasta $10,000 MXN por ficha.
  if (amount > 1_000_000) methods = methods.filter((x) => x !== 'oxxo');
  if (!methods.length) methods = ['card'];

  const [clinic] = await db<{ name: string }[]>`select name from clinic`;
  const concept = `${m.plan_name} · ${clinic?.name ?? 'Nicolas Center Elite'}`;
  const description = `Paciente ${patient.full_name} (${patient.record_number})`;
  const expiresAt = new Date(Date.now() + Math.min(24, Math.max(1, cfg.payment_link_hours)) * 3600_000);

  const [link] = await db<LinkRow[]>`
    insert into payment_links (patient_id, membership_id, plan_name, concept, amount_cents, methods, customer_email,
                               expires_at, created_by, created_by_name)
    values (${patient.id}, ${m.id}, ${m.plan_name}, ${concept}, ${amount}, ${methods}::text[], ${input.email || null},
            ${expiresAt}, ${user.id}, ${user.display_name})
    returning *`;

  const base = env().APP_URL.replace(/\/$/, '');
  const session = await createCheckoutSession({
    amountCents: amount, concept, description, methods, email: input.email || null, expiresAt,
    successUrl: `${base}/pago/gracias?l=${link.id}`,
    cancelUrl: `${base}/pago/cancelado?l=${link.id}`,
    metadata: { link_id: link.id, patient_id: patient.id, record_number: patient.record_number },
    idempotencyKey: `link-${link.id}`,
    oxxoDays: cfg.oxxo_days,
  });
  const [saved] = await db<LinkRow[]>`
    update payment_links set provider_session_id = ${session.id}, url = ${session.url} where id = ${link.id} returning *`;
  return { link: saved, patient, amount_label: money(amount) };
}

/**
 * Aplica el estado de una sesión de Stripe a su link. Idempotente: se llama desde el webhook,
 * desde "Actualizar" (consulta manual) y desde la tarea diaria.
 */
export async function applySession(db: Tx, session: CheckoutSession, eventType?: string): Promise<string> {
  const linkId = session.metadata?.link_id;
  const [link] = linkId
    ? await db<LinkRow[]>`select * from payment_links where id = ${linkId} for update`
    : await db<LinkRow[]>`select * from payment_links where provider_session_id = ${session.id} for update`;
  if (!link) return 'unknown_link';
  if (link.provider_session_id && link.provider_session_id !== session.id) return 'session_mismatch';
  if (['paid', 'needs_review', 'refunded'].includes(link.status)) return 'already_' + link.status;

  const pi = typeof session.payment_intent === 'string' ? session.payment_intent : null;
  const isOxxo = (session.payment_method_types ?? []).length === 1 && session.payment_method_types?.[0] === 'oxxo';

  if (session.payment_status === 'paid') {
    const method = eventType === 'checkout.session.async_payment_succeeded' || link.status === 'pending_oxxo' || isOxxo ? 'oxxo' : 'online_card';
    const review = async (reason: string) => {
      await db`update payment_links set status = 'needs_review', review_reason = ${reason}, payment_intent_id = ${pi},
               paid_method = ${method}, paid_at = now() where id = ${link.id}`;
      return 'needs_review';
    };
    if (session.amount_total !== link.amount_cents || (session.currency ?? 'mxn').toLowerCase() !== 'mxn') {
      return review(`Stripe cobró ${money(session.amount_total ?? 0)} ${String(session.currency).toUpperCase()} y el link era por ${money(link.amount_cents)} MXN.`);
    }
    try {
      await db.savepoint(async (sp) => {
        const { payment } = await registerPayment(sp as unknown as Tx, SYSTEM_ACTOR, {
          patient_id: link.patient_id, amount_cents: link.amount_cents, method,
          reference: pi ?? session.id, note: `Pago en línea · link ${link.id.slice(0, 8)}`,
          expect_membership_id: link.membership_id,
        });
        await sp`update payment_links set status = 'paid', payment_id = ${payment.id as string}, payment_intent_id = ${pi},
                 paid_method = ${method}, paid_at = now(), review_reason = null where id = ${link.id}`;
      });
      return 'paid';
    } catch (e) {
      if (e instanceof AppError) return review(e.message);
      throw e;
    }
  }

  if (eventType === 'checkout.session.async_payment_failed') {
    await db`update payment_links set status = 'failed', payment_intent_id = ${pi} where id = ${link.id}`;
    return 'failed';
  }
  if (session.status === 'complete' && session.payment_status === 'unpaid') {
    // OXXO: el paciente generó la ficha; el pago llega después (async_payment_succeeded).
    if (link.status !== 'pending_oxxo') await db`update payment_links set status = 'pending_oxxo', payment_intent_id = ${pi} where id = ${link.id}`;
    return 'pending_oxxo';
  }
  if (session.status === 'expired') {
    if (link.status === 'open') await db`update payment_links set status = 'expired' where id = ${link.id}`;
    return 'expired';
  }
  return 'noop';
}

const HANDLED = new Set([
  'checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed', 'checkout.session.expired',
]);

/** Procesa un evento del webhook una sola vez (provider_events evita duplicados por reintentos de Stripe). */
export async function handleStripeEvent(db: Tx, event: StripeEvent) {
  const [fresh] = await db<{ event_id: string }[]>`
    insert into provider_events (provider, event_id, type) values ('stripe', ${event.id}, ${event.type})
    on conflict do nothing returning event_id`;
  if (!fresh) return { duplicate: true, outcome: 'duplicate' };
  const outcome = HANDLED.has(event.type) && event.data?.object?.object === 'checkout.session'
    ? await applySession(db, event.data.object, event.type)
    : 'ignored';
  await db`update provider_events set outcome = ${outcome} where provider = 'stripe' and event_id = ${event.id}`;
  return { duplicate: false, outcome };
}

async function lockLink(db: Tx, id: string) {
  const [link] = await db<LinkRow[]>`select * from payment_links where id = ${id} for update`;
  if (!link) throw notFound('Link de pago no encontrado.');
  return link;
}

// Consulta a Stripe el estado actual (si el webhook no llegó o para confirmar).
export async function syncLink(db: Tx, id: string) {
  const link = await lockLink(db, id);
  if (!link.provider_session_id) throw conflict('El link no llegó a crearse en Stripe.', 'no_session');
  const session = await retrieveCheckoutSession(link.provider_session_id);
  const outcome = await applySession(db, session);
  return { outcome, link: await lockLink(db, id) };
}

// Cancela un link que aún no se paga (Stripe lo expira para que ya no acepte el pago).
export async function cancelLink(db: Tx, id: string) {
  const link = await lockLink(db, id);
  if (link.status !== 'open') {
    throw conflict(link.status === 'pending_oxxo'
      ? 'El paciente ya generó su ficha OXXO; no se puede cancelar desde aquí. Si paga, el pago se registrará solo.'
      : 'Solo se puede cancelar un link que sigue esperando pago.', 'not_open');
  }
  if (link.provider_session_id) {
    try {
      await expireCheckoutSession(link.provider_session_id);
    } catch (e) {
      // Si Stripe dice que ya se completó, se sincroniza en lugar de cancelar.
      if (e instanceof AppError && e.code === 'stripe_error') {
        const s = await retrieveCheckoutSession(link.provider_session_id);
        const outcome = await applySession(db, s);
        if (outcome !== 'expired' && outcome !== 'noop') throw conflict('El link ya recibió un pago; se actualizó su estado.', 'already_paid');
      } else throw e;
    }
  }
  await db`update payment_links set status = 'cancelled' where id = ${id}`;
  return lockLink(db, id);
}

// Link en revisión: el dueño decide aplicarlo a la membresía vigente.
export async function applyReviewedLink(db: Tx, user: SessionUser, id: string, note: string) {
  const link = await lockLink(db, id);
  if (link.status !== 'needs_review') throw conflict('Este link no está en revisión.', 'not_in_review');
  const { payment } = await registerPayment(db, user, {
    patient_id: link.patient_id, amount_cents: link.amount_cents, method: link.paid_method ?? 'online_card',
    reference: link.payment_intent_id ?? link.provider_session_id ?? '', note: note || `Pago en línea revisado · link ${link.id.slice(0, 8)}`,
  });
  await db`update payment_links set status = 'paid', payment_id = ${payment.id as string} where id = ${id}`;
  return { link: await lockLink(db, id), payment };
}

// Link en revisión: el dueño decide devolver el dinero.
export async function refundReviewedLink(db: Tx, id: string) {
  const link = await lockLink(db, id);
  if (link.status !== 'needs_review') throw conflict('Este link no está en revisión.', 'not_in_review');
  if (!link.payment_intent_id) throw conflict('Stripe no reportó el cargo de este link; revisa en el panel de Stripe.', 'no_charge');
  const refund = await createRefund(link.payment_intent_id, `refund-link-${link.id}`);
  await db`update payment_links set status = 'refunded', refund_id = ${refund.id} where id = ${id}`;
  return lockLink(db, id);
}

/** Al anular un pago en línea, opcionalmente se devuelve el dinero al paciente por Stripe. */
export async function refundPayment(db: Tx, paymentId: string) {
  const [link] = await db<LinkRow[]>`select * from payment_links where payment_id = ${paymentId} for update`;
  if (!link?.payment_intent_id) throw conflict('Este pago no se cobró en línea; el reembolso se hace por fuera.', 'not_online');
  if (link.refund_id) return link.refund_id;
  const refund = await createRefund(link.payment_intent_id, `refund-payment-${paymentId}`);
  await db`update payment_links set status = 'refunded', refund_id = ${refund.id} where id = ${link.id}`;
  return refund.id;
}

/** Tarea diaria: marca como vencidos los links abiertos cuya vigencia ya pasó. */
export async function expireStaleLinks(db: Tx) {
  const rows = await db`update payment_links set status = 'expired' where status = 'open' and expires_at < now() - interval '1 hour' returning id`;
  return rows.length;
}
