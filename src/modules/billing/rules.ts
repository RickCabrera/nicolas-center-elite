/**
 * Reglas de mensualidades como funciones puras (sin base de datos ni reloj): las usan las rutas
 * para aplicar el cambio y las pantallas para mostrar la vista previa ("Nuevo vencimiento: …").
 * El ESTADO de pago (pagado / por vencer / vencido) no se calcula aquí: lo calcula la base (PAG-03).
 * Todas las fechas son texto 'AAAA-MM-DD'.
 */
import { addDays } from '@/lib/dates';

export type PlanKind = 'monthly' | 'package' | 'single';
export type PlanRule = { kind: PlanKind; period_days: number; sessions_count: number | null };
export type MembershipDates = { next_due_date: string; sessions_remaining: number | null };
export type PaymentEffect = { prev_due_date: string; new_due_date: string; prev_sessions: number | null; new_sessions: number | null };

const maxDate = (a: string, b: string) => (a >= b ? a : b);

/** Días de `from` a `to` (positivo si `to` es posterior). */
export function diffDays(from: string, to: string): number {
  const t = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(to) - t(from)) / 86400000);
}

/** PAG-04 · La fecha de pago no puede ser futura. Devuelve el mensaje de error o null. */
export function paidOnError(paidOn: string, today: string): string | null {
  return paidOn > today ? 'La fecha de pago no puede ser futura.' : null;
}

/**
 * PAG-04 · Efecto de registrar un pago sobre la membresía vigente.
 *  · mensual: max(vencimiento, fecha de pago) + vigencia. Atrasado → corre desde el pago; adelantado → se acumula.
 *  · paquete: suma las sesiones del plan; la vigencia corre desde el pago.
 *  · sesión individual: vigencia desde el pago; no lleva sesiones.
 */
export function applyPayment(plan: PlanRule, m: MembershipDates, paidOn: string): PaymentEffect {
  const prev_due_date = m.next_due_date;
  if (plan.kind === 'monthly') {
    return { prev_due_date, new_due_date: addDays(maxDate(m.next_due_date, paidOn), plan.period_days), prev_sessions: m.sessions_remaining, new_sessions: m.sessions_remaining };
  }
  if (plan.kind === 'package') {
    const prev = m.sessions_remaining ?? 0;
    return { prev_due_date, new_due_date: addDays(paidOn, plan.period_days), prev_sessions: prev, new_sessions: prev + (plan.sessions_count ?? 0) };
  }
  return { prev_due_date, new_due_date: addDays(paidOn, plan.period_days), prev_sessions: null, new_sessions: null };
}

/**
 * PAG-05 · Efecto de anular un pago: la fecha regresa a la que había antes de ese pago; en paquetes
 * se restan las sesiones que ese pago agregó (las ya consumidas no se devuelven: nunca baja de 0).
 */
export function revertPayment(
  p: { plan_kind: string; prev_due_date: string; prev_sessions: number | null; new_sessions: number | null },
  m: MembershipDates,
): MembershipDates {
  if (p.plan_kind !== 'package') return { next_due_date: p.prev_due_date, sessions_remaining: m.sessions_remaining };
  const added = Math.max(0, (p.new_sessions ?? 0) - (p.prev_sessions ?? 0));
  return { next_due_date: p.prev_due_date, sessions_remaining: Math.max(0, (m.sessions_remaining ?? 0) - added) };
}

/**
 * PAG-09 · Membresía nueva al cambiar de plan: si la anterior estaba al corriente conserva su fecha
 * (no se pierde lo pagado); si estaba vencida, el nuevo plan queda por pagar desde hoy.
 * Un paquete nuevo empieza con 0 sesiones: se cargan al registrar su pago.
 */
export function changePlanStart(
  prev: { next_due_date: string; state: string },
  newPlan: Pick<PlanRule, 'kind'>,
  today: string,
): MembershipDates {
  const overdue = prev.state === 'vencido' || prev.next_due_date < today;
  return { next_due_date: overdue ? today : prev.next_due_date, sessions_remaining: newPlan.kind === 'package' ? 0 : null };
}

/** PAG-09 · Al reanudar, la pausa recorre el vencimiento los días que duró. */
export function resumeDueDate(nextDue: string, pausedOn: string | null, today: string): string {
  if (!pausedOn) return nextDue;
  return addDays(nextDue, Math.max(0, diffDays(pausedOn, today)));
}

/** PAG-08 · Periodo que cubre un pago, para el recibo. */
export function coveredPeriod(p: { plan_kind: string; paid_on: string; prev_due_date: string; new_due_date: string; prev_sessions: number | null; new_sessions: number | null }): { from: string; to: string; sessions: number | null } {
  if (p.plan_kind === 'monthly') return { from: maxDate(p.prev_due_date, p.paid_on), to: p.new_due_date, sessions: null };
  if (p.plan_kind === 'package') return { from: p.paid_on, to: p.new_due_date, sessions: Math.max(0, (p.new_sessions ?? 0) - (p.prev_sessions ?? 0)) };
  return { from: p.paid_on, to: p.new_due_date, sessions: null };
}

/** Meses 'AAAA-MM' de `from` a `to`, ambos incluidos (PAG-10). */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length < 120) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** Mes 'AAAA-MM' desplazado `n` meses. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Celda de CSV: comillas cuando hace falta y sin fórmulas ejecutables en hojas de cálculo. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csvLine = (cells: unknown[]) => cells.map(csvCell).join(',');
