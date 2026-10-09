// QA-02 · PAG-12 cobro en línea (Stripe) y FAC-01…FAC-06 facturación CFDI (Facturapi), contra proveedores falsos.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as cronGET } from '@/app/api/cron/daily/route';
import { GET as membershipGET, PATCH as membershipPATCH } from '@/app/api/billing/memberships/[patientId]/route';
import { POST as linkActionPOST } from '@/app/api/billing/payment-links/[id]/route';
import { GET as linksGET, POST as linksPOST } from '@/app/api/billing/payment-links/route';
import { POST as voidPOST } from '@/app/api/billing/payments/[id]/void/route';
import { GET as paymentsGET, POST as paymentsPOST } from '@/app/api/billing/payments/route';
import { GET as settingsGET, PATCH as settingsPATCH } from '@/app/api/billing/settings/route';
import { GET as taxGET, PUT as taxPUT } from '@/app/api/billing/tax-profiles/[patientId]/route';
import { POST as invoiceActionPOST } from '@/app/api/invoices/[id]/route';
import { GET as invoiceFileGET } from '@/app/api/invoices/[id]/file/route';
import { GET as globalGET, POST as globalPOST } from '@/app/api/invoices/global/route';
import { GET as invoicesGET, POST as invoicesPOST } from '@/app/api/invoices/route';
import { POST as webhookPOST } from '@/app/api/webhooks/stripe/route';
import { env } from '@/lib/env';
import { signStripePayload } from '@/lib/integrations/stripe';
import { FakeProviders } from '../fakes/providers';
import { call, fixtures, sqlSystem, type Fixtures } from '../helpers';

// Igual que en billing.test.ts: la base local no es superusuario.
vi.mock('@/lib/db', async (original) => {
  const mod = await original<typeof import('@/lib/db')>();
  const skip = (tx: any) => new Proxy(tx, {
    get(target, key, receiver) {
      if (key === 'unsafe') return (q: string, ...rest: unknown[]) => (/session_replication_role/.test(q) ? Promise.resolve([]) : target.unsafe(q, ...rest));
      return Reflect.get(target, key, receiver);
    },
  });
  return { ...mod, asSystem: (fn: (tx: any) => Promise<unknown>, actor?: any) => mod.asSystem((tx) => fn(skip(tx)), actor) };
});

const WEBHOOK_SECRET = 'whsec_pruebas_nce';
const fake = new FakeProviders();
let fx: Fixtures;
let evN = 0;

beforeAll(async () => {
  await fake.start();
  Object.assign(process.env, {
    STRIPE_SECRET_KEY: 'sk_test_nce', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, STRIPE_API_BASE: fake.base,
    FACTURAPI_KEY: 'sk_test_facturapi', FACTURAPI_API_BASE: fake.base,
  });
  expect(env().STRIPE_API_BASE).toBe(fake.base);
});
afterAll(() => fake.stop());
beforeEach(async () => {
  fx = await fixtures();
  fake.reset();
  await sqlSystem((tx) => tx`update membership_plans set active = true, price_cents = 240000 where name = 'Mensual Elite'`);
});

const newLink = (patient_id: string, extra: Record<string, unknown> = {}, as = fx.owner) =>
  call(linksPOST, { as, body: { patient_id, methods: ['card', 'oxxo'], ...extra } });
const webhook = (type: string, object: unknown, opts: { id?: string; secret?: string } = {}) => {
  const event = { id: opts.id ?? `evt_${++evN}`, type, livemode: false, data: { object } };
  return call(webhookPOST, {
    body: event, headers: { 'stripe-signature': signStripePayload(JSON.stringify(event), opts.secret ?? WEBHOOK_SECRET), origin: 'https://stripe.com' },
  });
};
const linkRow = async (id: string) => (await sqlSystem((tx) => tx<any[]>`select * from payment_links where id = ${id}`))[0];
const paymentsOf = (patientId: string) =>
  sqlSystem((tx) => tx<any[]>`select * from payments where patient_id = ${patientId} order by created_at`);
const due = async (patientId: string) =>
  (await sqlSystem((tx) => tx<{ d: string }[]>`select next_due_date::text as d from memberships where patient_id = ${patientId} and status <> 'ended'`))[0].d;

describe('PAG-12 · configuración de cobro en línea', () => {
  it('muestra las conexiones en modo prueba y valida los parámetros', async () => {
    const r = await call(settingsGET, { as: fx.owner });
    expect(r.status).toBe(200);
    expect(r.data.integrations.stripe).toEqual({ configured: true, live: false, webhook_configured: true });
    expect(r.data.integrations.facturapi).toEqual({ configured: true, live: false });
    expect(r.data.integrations.webhook_url).toBe('http://localhost:3000/api/webhooks/stripe');
    expect(r.data.settings.invoice_product_key).toBe('85122101');

    const bad = await call(settingsPATCH, { as: fx.owner, method: 'PATCH', body: { payment_link_hours: 48, invoice_zip: '9400' } });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.error!.fields!)).toEqual(expect.arrayContaining(['payment_link_hours', 'invoice_zip']));
    const ok = await call(settingsPATCH, { as: fx.owner, method: 'PATCH', body: { invoice_zip: '94500', invoice_tax: 'exento' } });
    expect(ok.data.settings).toMatchObject({ invoice_zip: '94500', invoice_tax: 'exento', oxxo_enabled: true });
  });

  it('el fisioterapeuta no ve ni cambia cobros, links ni facturas', async () => {
    for (const r of [
      await call(settingsGET, { as: fx.therapistA }),
      await newLink(fx.patientA1, {}, fx.therapistA),
      await call(linksGET, { as: fx.therapistA }),
      await call(invoicesGET, { as: fx.therapistA }),
      await call(taxGET, { as: fx.therapistA, params: { patientId: fx.patientA1 } }),
    ]) expect(r.status).toBe(403);
  });
});

describe('PAG-12 · link de pago', () => {
  it('crea la sesión de Stripe con el precio del plan, tarjeta y OXXO, y metadatos del link', async () => {
    const r = await newLink(fx.patientA1, { email: 'ana@correo.mx' });
    expect(r.status).toBe(200);
    const link = r.data.link;
    expect(link).toMatchObject({ status: 'open', amount_cents: 240000, methods: ['card', 'oxxo'], customer_email: 'ana@correo.mx' });
    expect(link.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const created = fake.calls.find((c) => c.path === '/v1/checkout/sessions')!;
    expect(created.body.payment_method_types).toEqual(['card', 'oxxo']);
    expect(created.body.line_items[0].price_data).toMatchObject({ currency: 'mxn', unit_amount: '240000' });
    expect(created.body.metadata.link_id).toBe(link.id);
    expect(created.body.success_url).toBe(`http://localhost:3000/pago/gracias?l=${link.id}`);
    expect(created.headers['idempotency-key']).toBe(`link-${link.id}`);
    expect(Number(created.body.expires_at) - Date.now() / 1000).toBeGreaterThan(23 * 3600);
  });

  it('respeta OXXO desactivado, el mínimo de $10 y la membresía en pausa', async () => {
    await call(settingsPATCH, { as: fx.owner, method: 'PATCH', body: { oxxo_enabled: false } });
    expect((await newLink(fx.patientA1)).data.link.methods).toEqual(['card']);
    expect((await newLink(fx.patientA1, { amount_cents: 500 })).status).toBe(400);
    await call(membershipPATCH, { as: fx.owner, method: 'PATCH', params: { patientId: fx.patientA1 }, body: { action: 'pause' } });
    const paused = await newLink(fx.patientA1);
    expect(paused.status).toBe(409);
    expect(paused.error!.code).toBe('paused');
    await call(settingsPATCH, { as: fx.owner, method: 'PATCH', body: { online_payments_enabled: false } });
    expect((await newLink(fx.patientB1)).error!.code).toBe('online_disabled');
  });

  it('sin llave de Stripe responde 503 con un mensaje claro', async () => {
    const key = env().STRIPE_SECRET_KEY;
    env().STRIPE_SECRET_KEY = '';
    try {
      const r = await newLink(fx.patientA1);
      expect(r.status).toBe(503);
      expect(r.error!.code).toBe('stripe_not_configured');
    } finally {
      env().STRIPE_SECRET_KEY = key;
    }
  });
});

describe('PAG-12 · webhook de Stripe', () => {
  it('rechaza firmas inválidas', async () => {
    const r = await webhook('checkout.session.completed', { id: 'cs_x', object: 'checkout.session' }, { secret: 'otro' });
    expect(r.status).toBe(400);
    expect(r.error!.code).toBe('bad_signature');
  });

  it('pago con tarjeta: registra el pago solo, recorre el vencimiento y es idempotente', async () => {
    const before = await due(fx.patientB1);
    const { link } = (await newLink(fx.patientB1)).data;
    const s = fake.pay(link.provider_session_id);
    const r = await webhook('checkout.session.completed', s, { id: 'evt_card_1' });
    expect(r.data).toMatchObject({ received: true, duplicate: false, outcome: 'paid' });
    const again = await webhook('checkout.session.completed', s, { id: 'evt_card_1' });
    expect(again.data).toMatchObject({ duplicate: true });
    const again2 = await webhook('checkout.session.completed', s, { id: 'evt_card_2' });
    expect(again2.data.outcome).toBe('already_paid');

    const pays = await paymentsOf(fx.patientB1);
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ method: 'online_card', amount_cents: link.amount_cents, recorded_by: null, recorded_by_name: 'Pago en línea (Stripe)' });
    expect(pays[0].reference).toBe(`pi_test_${link.provider_session_id}`);
    expect(await due(fx.patientB1)).not.toBe(before);
    expect(await linkRow(link.id)).toMatchObject({ status: 'paid', paid_method: 'online_card', payment_id: pays[0].id });
    // Quedó en la bitácora como acción del sistema.
    const [audit] = await sqlSystem((tx) => tx<any[]>`select * from audit_log where table_name = 'payments' and action = 'insert'`);
    expect(audit).toBeTruthy();
  });

  it('OXXO: la ficha queda pendiente y el pago se registra al llegar async_payment_succeeded', async () => {
    const { link } = (await newLink(fx.patientA1)).data;
    const pending = fake.pay(link.provider_session_id, { oxxo: true, paid: false });
    pending.payment_method_types = ['oxxo'];
    expect((await webhook('checkout.session.completed', pending)).data.outcome).toBe('pending_oxxo');
    expect((await linkRow(link.id)).status).toBe('pending_oxxo');
    expect((await call(linkActionPOST, { as: fx.owner, params: { id: link.id }, body: { action: 'cancel' } })).status).toBe(409);
    const paid = fake.pay(link.provider_session_id, { oxxo: true });
    expect((await webhook('checkout.session.async_payment_succeeded', paid)).data.outcome).toBe('paid');
    expect((await paymentsOf(fx.patientA1))[0].method).toBe('oxxo');
  });

  it('OXXO vencido sin pagar: el link queda como fallido', async () => {
    const { link } = (await newLink(fx.patientA1)).data;
    const s = fake.pay(link.provider_session_id, { oxxo: true, paid: false });
    await webhook('checkout.session.completed', s);
    expect((await webhook('checkout.session.async_payment_failed', s)).data.outcome).toBe('failed');
    expect(await paymentsOf(fx.patientA1)).toHaveLength(0);
  });

  it('si el plan cambió antes del pago, queda en revisión; el dueño lo aplica al plan vigente', async () => {
    const { link } = (await newLink(fx.patientA1)).data;
    await call(membershipPATCH, { as: fx.owner, method: 'PATCH', params: { patientId: fx.patientA1 }, body: { action: 'change_plan', plan_id: fx.plans['Mensual Básica'] } });
    const r = await webhook('checkout.session.completed', fake.pay(link.provider_session_id));
    expect(r.data.outcome).toBe('needs_review');
    const row = await linkRow(link.id);
    expect(row.review_reason).toMatch(/plan del paciente cambió/);
    expect(await paymentsOf(fx.patientA1)).toHaveLength(0);
    const list = await call(linksGET, { as: fx.owner, url: '/api/billing/payment-links?status=active' });
    expect(list.data.counts.needs_review).toBe(1);
    expect(list.data.items[0].id).toBe(link.id);

    const applied = await call(linkActionPOST, { as: fx.owner, params: { id: link.id }, body: { action: 'apply', note: 'El paciente pagó el plan anterior; se acepta' } });
    expect(applied.status).toBe(200);
    const pays = await paymentsOf(fx.patientA1);
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ method: 'online_card', amount_cents: 240000, recorded_by: fx.owner.id });
    expect((await linkRow(link.id)).status).toBe('paid');
  });

  it('monto distinto: en revisión; reembolsar llama a Stripe con llave de idempotencia', async () => {
    const { link } = (await newLink(fx.patientA1)).data;
    const r = await webhook('checkout.session.completed', fake.pay(link.provider_session_id, { amount: 100000 }));
    expect(r.data.outcome).toBe('needs_review');
    const refunded = await call(linkActionPOST, { as: fx.owner, params: { id: link.id }, body: { action: 'refund' } });
    expect(refunded.data.link.status).toBe('refunded');
    expect(fake.refunds).toEqual([{ id: expect.stringMatching(/^re_test_/), payment_intent: `pi_test_${link.provider_session_id}`, key: `refund-link-${link.id}` }]);
    expect(await paymentsOf(fx.patientA1)).toHaveLength(0);
  });

  it('sesión expirada y cancelación de un link abierto', async () => {
    const a = (await newLink(fx.patientA1)).data.link;
    const sa = fake.sessions.get(a.provider_session_id)!;
    sa.status = 'expired';
    expect((await webhook('checkout.session.expired', sa)).data.outcome).toBe('expired');
    expect((await linkRow(a.id)).status).toBe('expired');

    const b = (await newLink(fx.patientA1)).data.link;
    const c = await call(linkActionPOST, { as: fx.owner, params: { id: b.id }, body: { action: 'cancel' } });
    expect(c.data.link.status).toBe('cancelled');
    expect(fake.sessions.get(b.provider_session_id)!.status).toBe('expired');
  });

  it('"Consultar a Stripe" registra un pago cuyo webhook no llegó', async () => {
    const { link } = (await newLink(fx.patientB1)).data;
    fake.pay(link.provider_session_id);
    const r = await call(linkActionPOST, { as: fx.owner, params: { id: link.id }, body: { action: 'sync' } });
    expect(r.data.outcome).toBe('paid');
    expect(r.data.link.status).toBe('paid');
    expect(await paymentsOf(fx.patientB1)).toHaveLength(1);
  });

  it('anular un pago en línea con reembolso devuelve el dinero por Stripe', async () => {
    const { link } = (await newLink(fx.patientB1)).data;
    await webhook('checkout.session.completed', fake.pay(link.provider_session_id));
    const [p] = await paymentsOf(fx.patientB1);
    const m = await call(membershipGET, { as: fx.owner, params: { patientId: fx.patientB1 } });
    expect(m.data.payments[0]).toMatchObject({ refundable: true, voidable: true });
    expect(m.data.patient.phone).toBe('271 000 0000');
    const r = await call(voidPOST, { as: fx.owner, params: { id: p.id }, body: { reason: 'El paciente canceló el tratamiento', refund: true } });
    expect(r.status).toBe(200);
    expect(r.data.refund_id).toMatch(/^re_test_/);
    expect((await linkRow(link.id)).status).toBe('refunded');
    // Un pago en efectivo no se puede reembolsar por Stripe (y la anulación se revierte completa).
    const cash = await call(paymentsPOST, { as: fx.owner, body: { patient_id: fx.patientA1, method: 'cash' } });
    const bad = await call(voidPOST, { as: fx.owner, params: { id: cash.data.payment.id }, body: { reason: 'Prueba de reembolso', refund: true } });
    expect(bad.status).toBe(409);
    expect((await paymentsOf(fx.patientA1))[0].voided_at).toBeNull();
  });

  it('la tarea diaria vence los links abandonados', async () => {
    const { link } = (await newLink(fx.patientA1)).data;
    await sqlSystem((tx) => tx`update payment_links set expires_at = now() - interval '2 hours' where id = ${link.id}`);
    const r = await call(cronGET, { headers: { authorization: 'Bearer cron-de-pruebas' } });
    expect(r.data.expired_payment_links).toBe(1);
    expect((await linkRow(link.id)).status).toBe('expired');
  });
});

const PROFILE = { legal_name: 'Ana Prueba Uno', tax_id: 'PUAA900510AB1', tax_system: '612', zip: '94500', cfdi_use: 'D01', email: 'ana@correo.mx' };
const cashPay = async (patient_id: string, extra: Record<string, unknown> = {}) =>
  (await call(paymentsPOST, { as: fx.owner, body: { patient_id, method: 'cash', ...extra } })).data.payment;

describe('FAC-01 · datos fiscales', () => {
  it('valida RFC y código postal, y guarda en mayúsculas', async () => {
    const bad = await call(taxPUT, { as: fx.owner, method: 'PUT', params: { patientId: fx.patientA1 }, body: { ...PROFILE, tax_id: 'ABC-123', zip: '945' } });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.error!.fields!)).toEqual(expect.arrayContaining(['tax_id', 'zip']));
    const ok = await call(taxPUT, { as: fx.owner, method: 'PUT', params: { patientId: fx.patientA1 }, body: { ...PROFILE, tax_id: 'puaa900510ab1' } });
    expect(ok.data.profile).toMatchObject({ legal_name: 'ANA PRUEBA UNO', tax_id: 'PUAA900510AB1' });
    expect((await call(taxGET, { as: fx.owner, params: { patientId: fx.patientA1 } })).data.profile.tax_system).toBe('612');
  });
});

describe('FAC-02 · factura individual', () => {
  it('timbra con los datos del paciente, el concepto de fisioterapia e IVA incluido, y la envía por correo', async () => {
    const p = await cashPay(fx.patientA1);
    const noProfile = await call(invoicesPOST, { as: fx.owner, body: { payment_ids: [p.id] } });
    expect(noProfile.status).toBe(400);

    const r = await call(invoicesPOST, { as: fx.owner, body: { payment_ids: [p.id], tax_profile: PROFILE } });
    expect(r.status).toBe(200);
    expect(r.data.invoice).toMatchObject({ kind: 'individual', status: 'valid', total_cents: 240000, payment_form: '01', cfdi_use: 'D01', series: 'NCE', livemode: false });
    expect(r.data.invoice.uuid).toMatch(/^[0-9A-F-]{36}$/);
    expect(r.data.emailed_to).toBe('ana@correo.mx');
    const sent = [...fake.invoices.values()][0].body;
    expect(sent.customer).toEqual({ legal_name: 'ANA PRUEBA UNO', tax_id: 'PUAA900510AB1', tax_system: '612', email: 'ana@correo.mx', address: { zip: '94500' } });
    expect(sent).toMatchObject({ payment_form: '01', payment_method: 'PUE', use: 'D01', series: 'NCE', external_id: r.data.invoice.id });
    expect(sent.items[0].product).toMatchObject({
      product_key: '85122101', unit_key: 'E48', price: 2400, tax_included: true, sku: p.receipt_number, taxes: [{ type: 'IVA', rate: 0.16 }],
    });
    expect(fake.emails).toEqual([{ id: r.data.invoice.provider_id, email: 'ana@correo.mx' }]);

    // El pago muestra su factura, no se factura dos veces y no se puede anular mientras esté facturado.
    const list = await call(paymentsGET, { as: fx.owner, url: `/api/billing/payments?patient_id=${fx.patientA1}` });
    expect(list.data.items[0].invoice_folio).toBe(`NCE${r.data.invoice.folio_number}`);
    expect((await call(invoicesPOST, { as: fx.owner, body: { payment_ids: [p.id] } })).error!.code).toBe('already_invoiced');
    expect((await call(voidPOST, { as: fx.owner, params: { id: p.id }, body: { reason: 'Captura duplicada' } })).error!.code).toBe('invoiced');

    const pdf = await call(invoiceFileGET, { as: fx.owner, params: { id: r.data.invoice.id }, url: '/x?format=pdf' });
    expect(pdf.res.headers.get('content-type')).toBe('application/pdf');
    expect(await pdf.res.text()).toContain('%PDF');
    const xml = await call(invoiceFileGET, { as: fx.owner, params: { id: r.data.invoice.id }, url: '/x?format=xml' });
    expect(await xml.res.text()).toContain(r.data.invoice.uuid);
  });

  it('tarjeta de débito → forma 28; exento de IVA según la configuración', async () => {
    await call(settingsPATCH, { as: fx.owner, method: 'PATCH', body: { invoice_tax: 'exento' } });
    const p = await cashPay(fx.patientA1, { method: 'card', sat_payment_form: '28' });
    const r = await call(invoicesPOST, { as: fx.owner, body: { payment_ids: [p.id], tax_profile: PROFILE, send_email: false } });
    expect(r.data.invoice.payment_form).toBe('28');
    expect([...fake.invoices.values()][0].body.items[0].product.taxes).toEqual([{ type: 'IVA', rate: 0, factor: 'Exento' }]);
    expect(fake.emails).toHaveLength(0);
  });

  it('si Facturapi rechaza, no queda nada a medias', async () => {
    const p = await cashPay(fx.patientA1);
    fake.failNextInvoice = 'El RFC del receptor no se encuentra en la lista de RFC inscritos no cancelados del SAT.';
    const r = await call(invoicesPOST, { as: fx.owner, body: { payment_ids: [p.id], tax_profile: PROFILE } });
    expect(r.status).toBe(400);
    expect(r.error!.message).toMatch(/^Facturapi: El RFC del receptor/);
    expect(await sqlSystem((tx) => tx`select 1 from invoices`)).toHaveLength(0);
    expect(await sqlSystem((tx) => tx`select 1 from patient_tax_profiles`)).toHaveLength(0);
  });

  it('no mezcla pacientes ni factura pagos anulados', async () => {
    const a = await cashPay(fx.patientA1);
    const b = await cashPay(fx.patientB1);
    expect((await call(invoicesPOST, { as: fx.owner, body: { payment_ids: [a.id, b.id], tax_profile: PROFILE } })).status).toBe(400);
    await call(voidPOST, { as: fx.owner, params: { id: a.id }, body: { reason: 'Captura duplicada' } });
    expect((await call(invoicesPOST, { as: fx.owner, body: { payment_ids: [a.id], tax_profile: PROFILE } })).error!.code).toBe('voided');
  });
});

describe('FAC-04 · cancelación', () => {
  it('menor a $1,000: se cancela al momento y el pago queda libre', async () => {
    const p = await cashPay(fx.patientA1, { amount_cents: 80000, note: 'Promoción' });
    const inv = (await call(invoicesPOST, { as: fx.owner, body: { payment_ids: [p.id], tax_profile: PROFILE } })).data.invoice;
    const r = await call(invoiceActionPOST, { as: fx.owner, params: { id: inv.id }, body: { action: 'cancel', motive: '02' } });
    expect(r.data.invoice).toMatchObject({ status: 'canceled', cancel_motive: '02' });
    expect(fake.calls.at(-1)!.path).toBe(`/v2/invoices/${inv.provider_id}?motive=02`);
    expect((await call(voidPOST, { as: fx.owner, params: { id: p.id }, body: { reason: 'Se devolvió el dinero' } })).status).toBe(200);
  });

  it('mayor a $1,000: queda en proceso y la tarea diaria la cierra cuando el receptor acepta', async () => {
    const p = await cashPay(fx.patientA1);
    const inv = (await call(invoicesPOST, { as: fx.owner, body: { payment_ids: [p.id], tax_profile: PROFILE } })).data.invoice;
    const r = await call(invoiceActionPOST, { as: fx.owner, params: { id: inv.id }, body: { action: 'cancel', motive: '03' } });
    expect(r.data.invoice).toMatchObject({ status: 'valid', cancellation_status: 'pending' });
    fake.acceptCancellation(inv.provider_id);
    const cron = await call(cronGET, { headers: { authorization: 'Bearer cron-de-pruebas' } });
    expect(cron.data).toMatchObject({ invoice_cancellations_checked: 1, invoices_canceled: 1 });
    // Con el pago libre se vuelve a facturar (nueva llave de idempotencia).
    const again = await call(invoicesPOST, { as: fx.owner, body: { payment_ids: [p.id] } });
    expect(again.status).toBe(200);
    expect(again.data.invoice.provider_id).not.toBe(inv.provider_id);
  });

  it('motivo 01 exige una factura sustituta vigente', async () => {
    const p = await cashPay(fx.patientA1);
    const inv = (await call(invoicesPOST, { as: fx.owner, body: { payment_ids: [p.id], tax_profile: PROFILE } })).data.invoice;
    const r = await call(invoiceActionPOST, { as: fx.owner, params: { id: inv.id }, body: { action: 'cancel', motive: '01' } });
    expect(r.status).toBe(400);
    expect(r.error!.fields).toHaveProperty('substitution_id');
  });
});

describe('FAC-03 · factura global', () => {
  it('agrupa por forma de pago, excluye lo facturado y timbra a PÚBLICO EN GENERAL', async () => {
    const a = await cashPay(fx.patientA1);
    await cashPay(fx.patientB1, { method: 'transfer' });
    const c = await cashPay(fx.patientA2, { method: 'cash' });
    await call(invoicesPOST, { as: fx.owner, body: { payment_ids: [a.id], tax_profile: PROFILE } });
    const [y, m] = c.paid_on.split('-').map(Number);

    const pre = await call(globalGET, { as: fx.owner, url: `/x?year=${y}&month=${m}` });
    expect(pre.data.zip_configured).toBe(false);
    expect(pre.data.groups.map((g: any) => [g.payment_form, g.payments]).sort()).toEqual([['01', 1], ['03', 1]]);
    expect((await call(globalPOST, { as: fx.owner, body: { year: y, month: m, payment_form: '01' } })).status).toBe(400);

    await call(settingsPATCH, { as: fx.owner, method: 'PATCH', body: { invoice_zip: '94500' } });
    const r = await call(globalPOST, { as: fx.owner, body: { year: y, month: m, payment_form: '01' } });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ payments: 1, invoice: { kind: 'global', patient_id: null, cfdi_use: 'S01', payment_form: '01' } });
    const sent = [...fake.invoices.values()].at(-1)!.body;
    expect(sent.customer).toEqual({ legal_name: 'PUBLICO EN GENERAL', tax_id: 'XAXX010101000', tax_system: '616', address: { zip: '94500' } });
    expect(sent.global).toEqual({ periodicity: 'month', months: String(m).padStart(2, '0'), year: y });
    expect(sent.items).toEqual([expect.objectContaining({ product: expect.objectContaining({ product_key: '01010101', unit_key: 'ACT', sku: c.receipt_number }) })]);

    const after = await call(globalGET, { as: fx.owner, url: `/x?year=${y}&month=${m}` });
    expect(after.data.groups.map((g: any) => g.payment_form)).toEqual(['03']);
    expect(after.data.issued).toHaveLength(1);
    const list = await call(invoicesGET, { as: fx.owner, url: '/api/invoices?kind=global' });
    expect(list.data.items[0].payments).toEqual([{ id: c.id, receipt_number: c.receipt_number, amount_cents: c.amount_cents }]);
  });
});
