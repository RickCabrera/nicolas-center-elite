import type { SessionUser } from '@/lib/auth/session';
import type { Tx } from '@/lib/db';
import { badRequest, conflict, notFound } from '@/lib/errors';
import { createInitialMembership } from './membership';
import { applyPayment, changePlanStart, paidOnError, resumeDueDate, revertPayment, type PlanKind } from './rules';

/** Lógica de servidor de mensualidades. Las rutas validan el rol; aquí viven las transacciones. */

type Current = {
  id: string; patient_id: string; plan_id: string; next_due_date: string; sessions_remaining: number | null;
  status: 'active' | 'paused'; paused_on: string | null;
  plan_name: string; plan_kind: PlanKind; price_cents: number; period_days: number; sessions_count: number | null;
  today: string;
};

export async function today(db: Tx): Promise<string> {
  const [r] = await db<{ d: string }[]>`select mx_today()::text as d`;
  return r.d;
}

/** Membresía vigente del paciente, bloqueada para que dos operaciones simultáneas no se pisen. */
async function lockCurrent(db: Tx, patientId: string): Promise<Current | undefined> {
  const [m] = await db<Current[]>`
    select m.id, m.patient_id, m.plan_id, m.next_due_date, m.sessions_remaining, m.status, m.paused_on,
           pl.name as plan_name, pl.kind as plan_kind, pl.price_cents, pl.period_days, pl.sessions_count,
           mx_today()::text as today
    from memberships m join membership_plans pl on pl.id = m.plan_id
    where m.patient_id = ${patientId} and m.status <> 'ended'
    for update of m`;
  return m;
}

export async function requirePatient(db: Tx, patientId: string) {
  const [p] = await db<{ id: string; full_name: string; record_number: string }[]>`
    select id, full_name, record_number from patients where id = ${patientId}`; // RLS: si no es suyo, no existe
  if (!p) throw notFound('Paciente no encontrado.');
  return p;
}

export async function billingOf(db: Tx, patientId: string) {
  const [b] = await db`
    select b.*, m.paused_on, pl.active as plan_active
    from patient_billing b
    left join memberships m on m.id = b.membership_id
    left join membership_plans pl on pl.id = b.plan_id
    where b.patient_id = ${patientId}`;
  return b;
}

export type PaymentMethod = 'cash' | 'transfer' | 'card' | 'online_card' | 'oxxo';
export type PaymentInput = {
  patient_id: string; amount_cents?: number; method: PaymentMethod;
  paid_on?: string; reference: string; note: string;
  /** Forma de pago SAT (01, 03, 04, 28…). Opcional; al facturar se deduce del método. */
  sat_payment_form?: string | null;
  /** Solo pagos en línea: la membresía para la que se generó el link. Si ya no es la vigente, no se aplica. */
  expect_membership_id?: string;
};
/** Quién registra: un usuario, o el sistema (pago en línea confirmado por el webhook). */
export type PaymentActor = Pick<SessionUser, 'id' | 'display_name'> | { id: null; display_name: string };

// PAG-04 · Registra un pago sobre la membresía vigente y recorre el vencimiento / carga sesiones.
export async function registerPayment(db: Tx, user: PaymentActor, input: PaymentInput) {
  const patient = await requirePatient(db, input.patient_id);
  const m = await lockCurrent(db, patient.id);
  if (m && input.expect_membership_id && m.id !== input.expect_membership_id) {
    throw conflict('El plan del paciente cambió después de generar el link de pago.', 'membership_changed');
  }
  if (!m) throw conflict('El paciente no tiene un plan asignado. Asígnale un plan antes de registrar el pago.', 'no_plan');
  if (m.status === 'paused') throw conflict('La membresía está en pausa. Reanúdala antes de registrar el pago.', 'paused');

  const paidOn = input.paid_on ?? m.today;
  const dateErr = paidOnError(paidOn, m.today);
  if (dateErr) throw badRequest(dateErr, { paid_on: dateErr });
  const amount = input.amount_cents ?? m.price_cents;
  if (amount !== m.price_cents && !input.note) {
    const msg = 'El monto es distinto al precio del plan: explica el motivo en la nota.';
    throw badRequest(msg, { note: msg });
  }

  const fx = applyPayment({ kind: m.plan_kind, period_days: m.period_days, sessions_count: m.sessions_count },
    { next_due_date: m.next_due_date, sessions_remaining: m.sessions_remaining }, paidOn);

  const [payment] = await db`
    insert into payments (patient_id, membership_id, plan_name, plan_kind, amount_cents, method, paid_on, reference, note,
                          prev_due_date, new_due_date, prev_sessions, new_sessions, recorded_by, recorded_by_name, sat_payment_form)
    values (${patient.id}, ${m.id}, ${m.plan_name}, ${m.plan_kind}, ${amount}, ${input.method}, ${paidOn}, ${input.reference}, ${input.note},
            ${fx.prev_due_date}, ${fx.new_due_date}, ${fx.prev_sessions}, ${fx.new_sessions}, ${user.id}, ${user.display_name},
            ${input.sat_payment_form ?? null})
    returning *`;
  await db`update memberships set next_due_date = ${fx.new_due_date}, sessions_remaining = ${fx.new_sessions} where id = ${m.id}`;
  return { payment, billing: await billingOf(db, patient.id), patient };
}

// PAG-05 · Anula el pago vigente más reciente de su membresía y revierte su efecto.
export async function voidPayment(db: Tx, user: SessionUser, paymentId: string, reason: string) {
  const [p] = await db<{
    id: string; patient_id: string; membership_id: string; plan_kind: string; receipt_number: string;
    prev_due_date: string; prev_sessions: number | null; new_sessions: number | null; voided_at: Date | null;
  }[]>`select * from payments where id = ${paymentId} for update`;
  if (!p) throw notFound('Pago no encontrado.');
  if (p.voided_at) throw conflict('El pago ya está anulado.', 'already_voided');
  const [inv] = await db<{ series: string; folio_number: number | null }[]>`
    select i.series, i.folio_number from invoice_payments ip join invoices i on i.id = ip.invoice_id
    where ip.payment_id = ${p.id} and ip.active`;
  if (inv) {
    throw conflict(`Este pago está facturado (${inv.series}${inv.folio_number ?? ''}). Cancela primero la factura y después anula el pago.`, 'invoiced');
  }

  const [m] = await db<{ id: string; next_due_date: string; sessions_remaining: number | null; status: string }[]>`
    select id, next_due_date, sessions_remaining, status from memberships where id = ${p.membership_id} for update`;
  const [later] = await db<{ receipt_number: string }[]>`
    select receipt_number from payments
    where membership_id = ${p.membership_id} and voided_at is null and id <> ${p.id}
      and (created_at, receipt_number) > (select x.created_at, x.receipt_number from payments x where x.id = ${p.id})
    order by created_at desc, receipt_number desc limit 1`;
  if (later) {
    throw conflict(`Hay un pago posterior vigente (${later.receipt_number}). Anula primero ese pago y después este.`, 'not_latest');
  }

  // Si el plan cambió después de este pago, la membresía de ese pago ya terminó: el pago se anula
  // (para que los ingresos cuadren) pero la fecha del plan actual no se toca.
  const reverted = m.status !== 'ended';
  if (reverted) {
    const back = revertPayment(p, m);
    await db`update memberships set next_due_date = ${back.next_due_date}, sessions_remaining = ${back.sessions_remaining} where id = ${m.id}`;
  }
  const [payment] = await db`
    update payments set voided_at = now(), voided_by = ${user.id}, void_reason = ${reason} where id = ${p.id} returning *`;
  return { payment, billing: await billingOf(db, p.patient_id), reverted };
}

async function activePlan(db: Tx, planId: string) {
  const [plan] = await db<{ id: string; kind: PlanKind; active: boolean }[]>`select id, kind, active from membership_plans where id = ${planId}`;
  if (!plan) throw badRequest('El plan no existe.', { plan_id: 'El plan no existe.' });
  if (!plan.active) throw badRequest('Ese plan está inactivo y no se puede asignar.', { plan_id: 'Ese plan está inactivo.' });
  return plan;
}

// PAG-02 · Asigna plan a un paciente que no tiene (misma regla que el alta: primer pago pendiente desde hoy).
export async function assignPlan(db: Tx, user: SessionUser, patientId: string, planId: string) {
  if (await lockCurrent(db, patientId)) throw conflict('El paciente ya tiene una membresía vigente. Usa "Cambiar plan".', 'has_plan');
  await activePlan(db, planId);
  await createInitialMembership(db, patientId, planId, user.id);
}

// PAG-09 · Cambio de plan: termina la membresía actual y abre otra, en la misma transacción.
export async function changePlan(db: Tx, user: SessionUser, patientId: string, planId: string) {
  const m = await lockCurrent(db, patientId);
  if (!m) throw conflict('El paciente no tiene membresía vigente. Usa "Asignar plan".', 'no_plan');
  if (m.status === 'paused') throw conflict('La membresía está en pausa. Reanúdala antes de cambiar de plan.', 'paused');
  if (m.plan_id === planId) throw badRequest('El paciente ya tiene ese plan.', { plan_id: 'El paciente ya tiene ese plan.' });
  const plan = await activePlan(db, planId);
  const [{ state }] = await db<{ state: string }[]>`select state from patient_billing where patient_id = ${patientId}`;
  const start = changePlanStart({ next_due_date: m.next_due_date, state }, plan, m.today);
  await db`update memberships set status = 'ended', ended_on = mx_today() where id = ${m.id}`;
  await db`
    insert into memberships (patient_id, plan_id, started_on, next_due_date, sessions_remaining, created_by)
    values (${patientId}, ${plan.id}, mx_today(), ${start.next_due_date}, ${start.sessions_remaining}, ${user.id})`;
}

// PAG-09 · Pausa: el estado pasa a "pausado" y deja de contar el vencimiento.
export async function pauseMembership(db: Tx, patientId: string) {
  const m = await lockCurrent(db, patientId);
  if (!m) throw conflict('El paciente no tiene membresía vigente.', 'no_plan');
  if (m.status === 'paused') throw conflict('La membresía ya está en pausa.', 'paused');
  await db`update memberships set status = 'paused', paused_on = mx_today() where id = ${m.id}`;
}

// PAG-09 · Reanudar: la pausa recorre la fecha de vencimiento los días que duró.
export async function resumeMembership(db: Tx, patientId: string) {
  const m = await lockCurrent(db, patientId);
  if (!m) throw conflict('El paciente no tiene membresía vigente.', 'no_plan');
  if (m.status !== 'paused') throw conflict('La membresía no está en pausa.', 'not_paused');
  const due = resumeDueDate(m.next_due_date, m.paused_on, m.today);
  await db`update memberships set status = 'active', paused_on = null, next_due_date = ${due} where id = ${m.id}`;
}
