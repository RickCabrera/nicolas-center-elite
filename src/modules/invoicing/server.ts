import { createHash } from 'node:crypto';
import type { SessionUser } from '@/lib/auth/session';
import type { Tx } from '@/lib/db';
import { AppError, badRequest, conflict, notFound } from '@/lib/errors';
import {
  cancelInvoice, createInvoice, facturapiConfigured, facturapiLiveMode, retrieveInvoice, sendInvoiceEmail,
  type FacturapiInvoice, type InvoiceItem,
} from '@/lib/integrations/facturapi';
import { PUBLIC_CUSTOMER, readBillingSettings, satFormOf, type BillingSettings } from './catalogs';

/**
 * FAC-01…FAC-06 · Facturación CFDI 4.0 a través de Facturapi.
 *
 * · Factura individual: uno o varios pagos de un paciente, a nombre de sus datos fiscales.
 * · Factura global: los pagos del mes que nadie pidió facturar, a PÚBLICO EN GENERAL, una por forma de pago.
 * · Cancelación con motivo SAT; si el receptor debe aceptarla, queda "en proceso" y la tarea diaria la revisa.
 * Un pago solo puede estar en una factura vigente; mientras lo esté, no se puede anular.
 */

export type TaxProfile = { legal_name: string; tax_id: string; tax_system: string; zip: string; cfdi_use: string; email: string };

type PayRow = {
  id: string; patient_id: string; receipt_number: string; plan_name: string; amount_cents: number; method: string;
  sat_payment_form: string | null; paid_on: string; voided_at: Date | null; invoiced: boolean;
};

export function assertInvoicingReady() {
  if (!facturapiConfigured()) {
    throw new AppError(503, 'facturapi_not_configured', 'La facturación aún no está conectada. Falta configurar Facturapi (ver docs/despliegue.md).');
  }
}

export async function billingSettings(db: Tx): Promise<BillingSettings> {
  const [c] = await db<{ settings: unknown }[]>`select settings from clinic`;
  return readBillingSettings(c?.settings);
}

const cents = (c: number) => Math.round(c) / 100;

function itemTaxes(cfg: BillingSettings): Pick<InvoiceItem['product'], 'taxes' | 'taxability'> {
  return cfg.invoice_tax === 'exento'
    ? { taxability: '02', taxes: [{ type: 'IVA', rate: 0, factor: 'Exento' }] }
    : { taxability: '02', taxes: [{ type: 'IVA', rate: 0.16 }] };
}

// FAC-01 · Datos fiscales del paciente.
export async function getTaxProfile(db: Tx, patientId: string) {
  const [p] = await db<(TaxProfile & { updated_at: Date })[]>`
    select legal_name, tax_id, tax_system, zip, cfdi_use, email, updated_at from patient_tax_profiles where patient_id = ${patientId}`;
  return p ?? null;
}

export async function saveTaxProfile(db: Tx, user: SessionUser, patientId: string, p: TaxProfile) {
  const row = { ...p, legal_name: p.legal_name.trim().toUpperCase(), tax_id: p.tax_id.trim().toUpperCase(), email: p.email.trim().toLowerCase() };
  await db`
    insert into patient_tax_profiles (patient_id, legal_name, tax_id, tax_system, zip, cfdi_use, email, updated_by)
    values (${patientId}, ${row.legal_name}, ${row.tax_id}, ${row.tax_system}, ${row.zip}, ${row.cfdi_use}, ${row.email}, ${user.id})
    on conflict (patient_id) do update set legal_name = excluded.legal_name, tax_id = excluded.tax_id, tax_system = excluded.tax_system,
      zip = excluded.zip, cfdi_use = excluded.cfdi_use, email = excluded.email, updated_by = excluded.updated_by`;
  return getTaxProfile(db, patientId);
}

async function loadPayments(db: Tx, ids: string[]) {
  return db<PayRow[]>`
    select y.id, y.patient_id, y.receipt_number, y.plan_name, y.amount_cents, y.method, y.sat_payment_form, y.paid_on::text, y.voided_at,
           exists (select 1 from invoice_payments ip where ip.payment_id = y.id and ip.active) as invoiced
    from payments y where y.id = any(${ids}::uuid[])
    order by y.paid_on, y.receipt_number
    for update of y`;
}

/** Llave de idempotencia estable: mismo conjunto de pagos y mismo número de intento → misma factura en Facturapi. */
async function idemKey(db: Tx, prefix: string, paymentIds: string[]) {
  const [{ n }] = await db<{ n: number }[]>`
    select count(*)::int as n from invoice_payments where payment_id = any(${paymentIds}::uuid[]) and not active`;
  return `${prefix}-${createHash('sha256').update([...paymentIds].sort().join(',') + ':' + n).digest('hex').slice(0, 40)}`;
}

function stamped(inv: FacturapiInvoice) {
  return {
    provider_id: inv.id, uuid: inv.uuid ?? null, series: inv.series ?? '', folio_number: inv.folio_number ?? null,
    status: inv.status === 'canceled' ? 'canceled' : inv.status === 'valid' ? 'valid' : 'pending',
    livemode: inv.livemode ?? facturapiLiveMode(), verification_url: inv.verification_url ?? null,
  };
}

async function linkAndStamp(db: Tx, user: SessionUser, p: {
  kind: 'individual' | 'global'; patient_id: string | null; payments: PayRow[]; payment_form: string; cfdi_use: string;
  customer: Record<string, unknown>; global_period: Record<string, unknown> | null; build: (series: string) => Parameters<typeof createInvoice>[0];
  idem: string;
}) {
  const total = p.payments.reduce((s, x) => s + x.amount_cents, 0);
  const cfg = await billingSettings(db);
  const [inv] = await db<{ id: string }[]>`
    insert into invoices (kind, patient_id, total_cents, payment_form, cfdi_use, customer, global_period, series, created_by, created_by_name)
    values (${p.kind}, ${p.patient_id}, ${total}, ${p.payment_form}, ${p.cfdi_use}, ${db.json(p.customer as never)},
            ${p.global_period ? db.json(p.global_period as never) : null}, ${cfg.invoice_series}, ${user.id}, ${user.display_name})
    returning id`;
  for (const pay of p.payments) await db`insert into invoice_payments (invoice_id, payment_id) values (${inv.id}, ${pay.id})`;
  // Si Facturapi rechaza (RFC que no coincide con el SAT, CP, régimen…), la transacción se revierte completa.
  const result = await createInvoice({ ...p.build(cfg.invoice_series), external_id: inv.id, idempotency_key: p.idem });
  const s = stamped(result);
  const [row] = await db`
    update invoices set provider_id = ${s.provider_id}, uuid = ${s.uuid}, series = ${s.series || cfg.invoice_series},
      folio_number = ${s.folio_number}, status = ${s.status}, livemode = ${s.livemode}, verification_url = ${s.verification_url}
    where id = ${inv.id} returning *`;
  return row;
}

// FAC-02 · Factura individual de uno o varios pagos de un mismo paciente.
export async function issueInvoice(db: Tx, user: SessionUser, input: {
  payment_ids: string[]; payment_form?: string; cfdi_use?: string; send_email?: boolean; email?: string; tax_profile?: TaxProfile;
}) {
  assertInvoicingReady();
  const payments = await loadPayments(db, input.payment_ids);
  if (payments.length !== new Set(input.payment_ids).size) throw notFound('Algún pago no existe.');
  const patientId = payments[0].patient_id;
  if (payments.some((x) => x.patient_id !== patientId)) throw badRequest('Una factura individual solo puede incluir pagos de un mismo paciente.');
  const voided = payments.find((x) => x.voided_at);
  if (voided) throw conflict(`El pago ${voided.receipt_number} está anulado; no se puede facturar.`, 'voided');
  const done = payments.find((x) => x.invoiced);
  if (done) throw conflict(`El pago ${done.receipt_number} ya está en una factura vigente.`, 'already_invoiced');
  const zero = payments.find((x) => x.amount_cents <= 0);
  if (zero) throw badRequest(`El pago ${zero.receipt_number} es de $0 y no se puede facturar.`);

  if (input.tax_profile) await saveTaxProfile(db, user, patientId, input.tax_profile);
  const profile = await getTaxProfile(db, patientId);
  if (!profile) throw badRequest('Captura los datos fiscales del paciente antes de facturar.', { tax_profile: 'Faltan los datos fiscales.' });

  const cfg = await billingSettings(db);
  // Forma de pago: la del pago de mayor monto (el SAT admite una sola por factura de contado).
  const form = input.payment_form ?? satFormOf([...payments].sort((a, b) => b.amount_cents - a.amount_cents)[0]);
  const use = input.cfdi_use ?? profile.cfdi_use ?? cfg.invoice_default_use;
  const customer = { legal_name: profile.legal_name, tax_id: profile.tax_id, tax_system: profile.tax_system, email: profile.email || undefined, address: { zip: profile.zip } };

  const invoice = await linkAndStamp(db, user, {
    kind: 'individual', patient_id: patientId, payments, payment_form: form, cfdi_use: use, customer, global_period: null,
    idem: await idemKey(db, 'ind', input.payment_ids),
    build: (series) => ({
      customer, payment_form: form, payment_method: 'PUE', use, series,
      items: payments.map((x) => ({
        quantity: 1,
        product: {
          description: `${x.plan_name} · servicios de fisioterapia (recibo ${x.receipt_number})`,
          product_key: cfg.invoice_product_key, unit_key: cfg.invoice_unit_key, unit_name: 'Servicio',
          price: cents(x.amount_cents), tax_included: true, sku: x.receipt_number, ...itemTaxes(cfg),
        },
      })),
    }),
  });
  // Si los pagos se registraron como "tarjeta", se fija la forma SAT elegida (crédito/débito) para los reportes.
  for (const x of payments) if (!x.sat_payment_form) await db`update payments set sat_payment_form = ${form} where id = ${x.id}`;

  let email_error: string | null = null;
  const to = input.email || profile.email;
  if (input.send_email && to && invoice.provider_id) {
    try {
      await sendInvoiceEmail(invoice.provider_id as string, to);
    } catch (e) {
      email_error = e instanceof Error ? e.message : 'No se pudo enviar el correo.';
    }
  }
  return { invoice, email_error, emailed_to: input.send_email && to && !email_error ? to : null };
}

function monthRange(year: number, month: number) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return { from, next };
}

async function globalCandidates(db: Tx, year: number, month: number) {
  const { from, next } = monthRange(year, month);
  return db<PayRow[]>`
    select y.id, y.patient_id, y.receipt_number, y.plan_name, y.amount_cents, y.method, y.sat_payment_form, y.paid_on::text, y.voided_at, false as invoiced
    from payments y
    where y.paid_on >= ${from} and y.paid_on < ${next} and y.voided_at is null and y.amount_cents > 0
      and not exists (select 1 from invoice_payments ip where ip.payment_id = y.id and ip.active)
    order by y.paid_on, y.receipt_number
    for update of y`;
}

// FAC-03 · Vista previa de la factura global del mes: pagos sin factura, agrupados por forma de pago.
export async function globalPreview(db: Tx, year: number, month: number) {
  const rows = await globalCandidates(db, year, month);
  const groups = new Map<string, { payment_form: string; payments: number; total_cents: number }>();
  for (const r of rows) {
    const f = satFormOf(r);
    const g = groups.get(f) ?? { payment_form: f, payments: 0, total_cents: 0 };
    g.payments += 1;
    g.total_cents += r.amount_cents;
    groups.set(f, g);
  }
  const issued = await db`
    select id, series, folio_number, uuid, status, total_cents, payment_form, created_at from invoices
    where kind = 'global' and global_period->>'year' = ${String(year)} and global_period->>'months' = ${String(month).padStart(2, '0')}
    order by created_at`;
  const cfg = await billingSettings(db);
  return { year, month, groups: [...groups.values()].sort((a, b) => b.total_cents - a.total_cents), issued, zip_configured: /^\d{5}$/.test(cfg.invoice_zip) };
}

// FAC-03 · Timbra la factura global del mes para una forma de pago.
export async function issueGlobal(db: Tx, user: SessionUser, input: { year: number; month: number; payment_form: string }) {
  assertInvoicingReady();
  const cfg = await billingSettings(db);
  if (!/^\d{5}$/.test(cfg.invoice_zip)) {
    throw badRequest('Configura el código postal del lugar de expedición en Configuración → Cobros y facturación.', { invoice_zip: 'Falta el código postal.' });
  }
  const payments = (await globalCandidates(db, input.year, input.month)).filter((r) => satFormOf(r) === input.payment_form);
  if (!payments.length) throw conflict('No hay pagos sin facturar de ese mes con esa forma de pago.', 'nothing_to_invoice');
  const months = String(input.month).padStart(2, '0');
  const customer = { ...PUBLIC_CUSTOMER, address: { zip: cfg.invoice_zip } };
  const global = { periodicity: 'month' as const, months, year: input.year };
  const invoice = await linkAndStamp(db, user, {
    kind: 'global', patient_id: null, payments, payment_form: input.payment_form, cfdi_use: 'S01', customer, global_period: global,
    idem: await idemKey(db, 'glb', payments.map((x) => x.id)),
    build: (series) => ({
      customer, payment_form: input.payment_form, payment_method: 'PUE', use: 'S01', series, global,
      // En la global cada pago (ticket) es un concepto: clave 01010101, unidad ACT y el folio del recibo como número de identificación.
      items: payments.map((x) => ({
        quantity: 1,
        product: {
          description: 'Venta', product_key: '01010101', unit_key: 'ACT', unit_name: 'Actividad',
          price: cents(x.amount_cents), tax_included: true, sku: x.receipt_number, ...itemTaxes(cfg),
        },
      })),
    }),
  });
  return { invoice, payments: payments.length };
}

async function lockInvoice(db: Tx, id: string) {
  const [inv] = await db<{ id: string; provider_id: string | null; status: string; cancellation_status: string | null; patient_id: string | null; customer: { email?: string } }[]>`
    select * from invoices where id = ${id} for update`;
  if (!inv) throw notFound('Factura no encontrada.');
  return inv;
}

async function applyRemote(db: Tx, id: string, remote: FacturapiInvoice, motive?: string) {
  const status = remote.status === 'canceled' ? 'canceled' : remote.status === 'valid' ? 'valid' : 'pending';
  const [row] = await db`
    update invoices set status = ${status}, cancellation_status = ${remote.cancellation_status ?? null},
      uuid = coalesce(${remote.uuid ?? null}, uuid),
      cancel_motive = coalesce(${motive ?? null}, cancel_motive),
      canceled_at = case when ${status} = 'canceled' and canceled_at is null then now() else canceled_at end
    where id = ${id} returning *`;
  // Al quedar cancelada, sus pagos se liberan: se pueden volver a facturar o anular.
  if (status === 'canceled') await db`update invoice_payments set active = false where invoice_id = ${id} and active`;
  return row;
}

// FAC-04 · Cancelación ante el SAT con motivo.
export async function cancel(db: Tx, id: string, motive: '01' | '02' | '03' | '04', substitutionId?: string) {
  assertInvoicingReady();
  const inv = await lockInvoice(db, id);
  if (inv.status === 'canceled') throw conflict('La factura ya está cancelada.', 'already_canceled');
  if (!inv.provider_id) throw conflict('La factura no llegó a timbrarse.', 'not_stamped');
  let substitution: string | undefined;
  if (motive === '01') {
    if (!substitutionId) throw badRequest('Con el motivo 01 indica la factura que sustituye a esta.', { substitution_id: 'Elige la factura sustituta.' });
    const [sub] = await db<{ provider_id: string | null; status: string }[]>`select provider_id, status from invoices where id = ${substitutionId}`;
    if (!sub?.provider_id || sub.status !== 'valid') throw badRequest('La factura sustituta debe estar vigente.', { substitution_id: 'Debe estar vigente.' });
    substitution = sub.provider_id;
  }
  const remote = await cancelInvoice(inv.provider_id, motive, substitution);
  return applyRemote(db, id, remote, motive);
}

// Consulta el estado actual (cancelación en proceso, por ejemplo).
export async function refresh(db: Tx, id: string) {
  assertInvoicingReady();
  const inv = await lockInvoice(db, id);
  if (!inv.provider_id) throw conflict('La factura no llegó a timbrarse.', 'not_stamped');
  return applyRemote(db, id, await retrieveInvoice(inv.provider_id));
}

export async function email(db: Tx, id: string, to?: string) {
  assertInvoicingReady();
  const inv = await lockInvoice(db, id);
  if (!inv.provider_id) throw conflict('La factura no llegó a timbrarse.', 'not_stamped');
  const address = to || inv.customer?.email;
  if (!address) throw badRequest('Escribe el correo al que se enviará.', { email: 'Escribe el correo.' });
  await sendInvoiceEmail(inv.provider_id, address);
  return { sent_to: address };
}

/** Tarea diaria: revisa las cancelaciones que esperan respuesta del receptor. */
export async function syncPendingCancellations(db: Tx) {
  if (!facturapiConfigured()) return { checked: 0, canceled: 0 };
  const rows = await db<{ id: string; provider_id: string }[]>`
    select id, provider_id from invoices where provider_id is not null and status <> 'canceled'
      and cancellation_status in ('pending', 'accepted', 'verify')
    limit 50`;
  let canceled = 0;
  for (const r of rows) {
    try {
      const out = await applyRemote(db, r.id, await retrieveInvoice(r.provider_id));
      if (out.status === 'canceled') canceled++;
    } catch {
      // Se reintenta en la siguiente corrida.
    }
  }
  return { checked: rows.length, canceled };
}
