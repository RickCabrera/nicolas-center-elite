import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env';
import { AppError } from '../errors';

/**
 * Cliente mínimo de Stripe (API REST, sin dependencias). Solo lo que usa la clínica:
 * Checkout Sessions (tarjeta y OXXO), expirar una sesión, reembolsos y verificación de webhooks.
 * Las llaves `sk_test_…` operan en modo prueba; `sk_live_…` cobran de verdad.
 */
export const stripeConfigured = () => !!env().STRIPE_SECRET_KEY;
export const stripeLiveMode = () => env().STRIPE_SECRET_KEY.startsWith('sk_live_');

/** Codifica un objeto anidado como application/x-www-form-urlencoded al estilo de Stripe (a[b][0][c]=…). */
export function formEncode(obj: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') parts.push(formEncode(item as Record<string, unknown>, `${key}[${i}]`));
        else parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === 'object') {
      parts.push(formEncode(v as Record<string, unknown>, key));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.filter(Boolean).join('&');
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const key = env().STRIPE_SECRET_KEY;
  if (!key) throw new AppError(503, 'stripe_not_configured', 'El cobro en línea no está configurado (falta STRIPE_SECRET_KEY).');
  let res: Response;
  try {
    res = await fetch(`${env().STRIPE_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': '2024-06-20',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: body ? formEncode(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new AppError(502, 'stripe_unreachable', 'No se pudo conectar con Stripe. Intenta de nuevo en un momento.');
  }
  const json = (await res.json().catch(() => null)) as (T & { error?: { message?: string; code?: string } }) | null;
  if (!res.ok || !json) {
    const msg = json?.error?.message ?? `Stripe respondió ${res.status}.`;
    throw new AppError(res.status >= 500 ? 502 : 400, 'stripe_error', `Stripe: ${msg}`);
  }
  return json;
}

export type CheckoutSession = {
  id: string; object?: string; url: string | null; status: 'open' | 'complete' | 'expired'; payment_status: 'paid' | 'unpaid' | 'no_payment_required';
  amount_total: number | null; currency: string; payment_intent: string | null; metadata: Record<string, string>;
  customer_details?: { email?: string | null; name?: string | null } | null; expires_at: number;
  payment_method_types?: string[];
};

export function createCheckoutSession(p: {
  amountCents: number; concept: string; description: string; methods: ('card' | 'oxxo')[]; email?: string | null;
  expiresAt: Date; successUrl: string; cancelUrl: string; metadata: Record<string, string>; idempotencyKey: string;
  oxxoDays?: number;
}) {
  return call<CheckoutSession>('POST', '/v1/checkout/sessions', {
    mode: 'payment',
    payment_method_types: p.methods,
    line_items: [{
      quantity: 1,
      price_data: { currency: 'mxn', unit_amount: p.amountCents, product_data: { name: p.concept, description: p.description } },
    }],
    ...(p.methods.includes('oxxo') ? { payment_method_options: { oxxo: { expires_after_days: p.oxxoDays ?? 3 } } } : {}),
    customer_email: p.email || undefined,
    expires_at: Math.floor(p.expiresAt.getTime() / 1000),
    success_url: p.successUrl,
    cancel_url: p.cancelUrl,
    locale: 'es',
    metadata: p.metadata,
    payment_intent_data: { metadata: p.metadata, description: p.description },
  }, p.idempotencyKey);
}

export const retrieveCheckoutSession = (id: string) => call<CheckoutSession>('GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`);
export const expireCheckoutSession = (id: string) => call<CheckoutSession>('POST', `/v1/checkout/sessions/${encodeURIComponent(id)}/expire`, {});
export const createRefund = (paymentIntent: string, idempotencyKey: string) =>
  call<{ id: string; status: string; amount: number }>('POST', '/v1/refunds', { payment_intent: paymentIntent }, idempotencyKey);

export type StripeEvent = { id: string; type: string; livemode: boolean; data: { object: CheckoutSession } };

/**
 * Verifica la firma `Stripe-Signature: t=…,v1=…` (HMAC-SHA256 del texto `${t}.${cuerpo}`) con
 * tolerancia de 5 minutos, y devuelve el evento. El cuerpo debe ser el texto crudo recibido.
 */
export function verifyStripeWebhook(rawBody: string, header: string | null, secret = env().STRIPE_WEBHOOK_SECRET, toleranceSec = 300): StripeEvent {
  if (!secret) throw new AppError(503, 'stripe_not_configured', 'Falta STRIPE_WEBHOOK_SECRET.');
  const parts = Object.fromEntries((header ?? '').split(',').map((kv) => kv.split('=').map((x) => x.trim())) as [string, string][]);
  const t = Number(parts.t);
  const signatures = (header ?? '').split(',').filter((kv) => kv.trim().startsWith('v1=')).map((kv) => kv.trim().slice(3));
  if (!t || !signatures.length) throw new AppError(400, 'bad_signature', 'Firma de Stripe ausente.');
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) throw new AppError(400, 'bad_signature', 'Firma de Stripe caducada.');
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const ok = signatures.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) throw new AppError(400, 'bad_signature', 'Firma de Stripe inválida.');
  return JSON.parse(rawBody) as StripeEvent;
}

/** Para pruebas: arma un encabezado de firma válido. */
export function signStripePayload(rawBody: string, secret: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')}`;
}
