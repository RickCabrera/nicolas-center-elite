import { z } from 'zod';
import { route } from '@/lib/api';
import { notFound } from '@/lib/errors';
import { assignPlan, billingOf, changePlan, pauseMembership, requirePatient, resumeMembership } from '@/modules/billing/server';

async function detail(db: Parameters<typeof billingOf>[0], patientId: string, owner: boolean) {
  const patient = await requirePatient(db, patientId);
  const b = await billingOf(db, patientId);
  const history = await db`
    select m.id, pl.name as plan_name, pl.kind as plan_kind, m.started_on, m.ended_on
    from memberships m join membership_plans pl on pl.id = m.plan_id
    where m.patient_id = ${patientId} and m.status = 'ended'
    order by m.ended_on desc nulls last, m.created_at desc`;
  const out: Record<string, unknown> = { patient, membership: b?.membership_id ? b : null, state: b?.state ?? 'sin_plan', history };
  // Los pagos (montos, métodos) son solo del dueño; RLS tampoco se los entrega al fisioterapeuta.
  if (owner) {
    const [contact] = await db<{ phone: string | null }[]>`select phone from patients where id = ${patientId}`;
    out.patient = { ...patient, phone: contact?.phone ?? null };
    out.payments = await db`
      select y.*, (select trim(u.title || ' ' || u.full_name) from users u where u.id = y.voided_by) as voided_by_name,
             inv.id as invoice_id, nullif(inv.series || coalesce(inv.folio_number::text, ''), '') as invoice_folio, inv.status as invoice_status,
             exists (select 1 from payment_links k where k.payment_id = y.id and k.payment_intent_id is not null and k.refund_id is null) as refundable,
             (y.voided_at is null and not exists (
                select 1 from payments z where z.membership_id = y.membership_id and z.voided_at is null and z.id <> y.id
                  and (z.created_at, z.receipt_number) > (y.created_at, y.receipt_number))) as voidable
      from payments y
      left join lateral (
        select i.id, i.series, i.folio_number, i.status from invoice_payments ip join invoices i on i.id = ip.invoice_id
        where ip.payment_id = y.id and ip.active limit 1
      ) inv on true
      where y.patient_id = ${patientId}
      order by y.created_at desc, y.receipt_number desc`;
  }
  return out;
}

const validId = (id: string) => { if (!z.uuid().safeParse(id).success) throw notFound('Paciente no encontrado.'); };

// PAG-02 · Membresía del paciente. El fisioterapeuta solo lee plan y estado de SUS pacientes (sin pagos).
export const GET = route({ auth: 'user' }, async ({ db, user, params }) => {
  validId(params.patientId);
  return detail(db, params.patientId, user.role === 'owner');
});

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assign'), plan_id: z.uuid('Elige un plan.') }),
  z.object({ action: z.literal('change_plan'), plan_id: z.uuid('Elige un plan.') }),
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('resume') }),
]);

// PAG-02 / PAG-09 · Asignar plan, cambiar de plan, pausar y reanudar (solo dueño).
export const PATCH = route({ auth: 'owner', body: Body }, async ({ db, user, params, body }) => {
  validId(params.patientId);
  await requirePatient(db, params.patientId);
  if (body.action === 'assign') await assignPlan(db, user, params.patientId, body.plan_id);
  else if (body.action === 'change_plan') await changePlan(db, user, params.patientId, body.plan_id);
  else if (body.action === 'pause') await pauseMembership(db, params.patientId);
  else await resumeMembership(db, params.patientId);
  return detail(db, params.patientId, true);
});
