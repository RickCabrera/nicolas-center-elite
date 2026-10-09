import type { Tx } from '@/lib/db';

/**
 * PAC-06 · Membresía inicial al dar de alta a un paciente: el primer pago queda pendiente desde hoy.
 *   · mensual / sesión individual → vence hoy (estado "por vencer" hasta registrar el pago)
 *   · paquete → 0 sesiones disponibles (estado "vencido" hasta registrar el pago)
 * Registrar el primer pago (módulo de mensualidades) recorre la fecha y carga las sesiones.
 */
export async function createInitialMembership(tx: Tx, patientId: string, planId: string, createdBy: string) {
  const [plan] = await tx<{ id: string; kind: string }[]>`select id, kind from membership_plans where id = ${planId} and active`;
  if (!plan) return null;
  const [m] = await tx<{ id: string }[]>`
    insert into memberships (patient_id, plan_id, started_on, next_due_date, sessions_remaining, created_by)
    values (${patientId}, ${plan.id}, mx_today(), mx_today(), ${plan.kind === 'package' ? 0 : null}, ${createdBy})
    returning id`;
  return m.id;
}
