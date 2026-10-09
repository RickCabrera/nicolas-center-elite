// QA-01 · Unitarias de reglas de mensualidad (estado, pagos, anulación, pausa).
import { describe, expect, it } from 'vitest';
import { applyPayment, changePlanStart, coveredPeriod, csvCell, diffDays, monthRange, paidOnError, resumeDueDate, revertPayment, shiftMonth } from '@/modules/billing/rules';

const monthly = { kind: 'monthly' as const, period_days: 30, sessions_count: null };
const pack = { kind: 'package' as const, period_days: 60, sessions_count: 10 };
const single = { kind: 'single' as const, period_days: 1, sessions_count: 1 };

describe('PAG-04 · registrar pago', () => {
  it('mensual pagado por adelantado: el periodo se acumula sobre el vencimiento', () => {
    const fx = applyPayment(monthly, { next_due_date: '2026-10-20', sessions_remaining: null }, '2026-10-07');
    expect(fx).toEqual({ prev_due_date: '2026-10-20', new_due_date: '2026-11-19', prev_sessions: null, new_sessions: null });
  });
  it('mensual pagado con atraso: el periodo corre desde el día del pago', () => {
    const fx = applyPayment(monthly, { next_due_date: '2026-09-01', sessions_remaining: null }, '2026-10-07');
    expect(fx.prev_due_date).toBe('2026-09-01');
    expect(fx.new_due_date).toBe('2026-11-06');
  });
  it('mensual pagado el mismo día del vencimiento', () => {
    expect(applyPayment(monthly, { next_due_date: '2026-10-07', sessions_remaining: null }, '2026-10-07').new_due_date).toBe('2026-11-06');
  });
  it('paquete: suma sesiones a las que quedaban y la vigencia corre desde el pago', () => {
    const fx = applyPayment(pack, { next_due_date: '2026-12-01', sessions_remaining: 3 }, '2026-10-07');
    expect(fx).toEqual({ prev_due_date: '2026-12-01', new_due_date: '2026-12-06', prev_sessions: 3, new_sessions: 13 });
  });
  it('paquete nuevo (0 o sin sesiones) queda con las del plan', () => {
    expect(applyPayment(pack, { next_due_date: '2026-10-07', sessions_remaining: 0 }, '2026-10-07').new_sessions).toBe(10);
    expect(applyPayment(pack, { next_due_date: '2026-10-07', sessions_remaining: null }, '2026-10-07')).toMatchObject({ prev_sessions: 0, new_sessions: 10 });
  });
  it('sesión individual: vigencia desde el pago y sin sesiones', () => {
    const fx = applyPayment(single, { next_due_date: '2026-12-31', sessions_remaining: null }, '2026-10-07');
    expect(fx).toEqual({ prev_due_date: '2026-12-31', new_due_date: '2026-10-08', prev_sessions: null, new_sessions: null });
  });
  it('cruza fin de mes y de año sin desfasarse', () => {
    expect(applyPayment(monthly, { next_due_date: '2026-12-15', sessions_remaining: null }, '2026-12-10').new_due_date).toBe('2027-01-14');
    expect(applyPayment(monthly, { next_due_date: '2028-02-01', sessions_remaining: null }, '2028-02-01').new_due_date).toBe('2028-03-02');
  });
  it('la fecha de pago no puede ser futura', () => {
    expect(paidOnError('2026-10-08', '2026-10-07')).toMatch(/futura/);
    expect(paidOnError('2026-10-07', '2026-10-07')).toBeNull();
    expect(paidOnError('2026-09-30', '2026-10-07')).toBeNull();
  });
});

describe('PAG-05 · anular pago', () => {
  it('mensual: la fecha regresa a la anterior', () => {
    const m = { next_due_date: '2026-10-20', sessions_remaining: null };
    const fx = applyPayment(monthly, m, '2026-10-07');
    expect(revertPayment({ plan_kind: 'monthly', ...fx }, { next_due_date: fx.new_due_date, sessions_remaining: null })).toEqual(m);
  });
  it('paquete: resta las sesiones que agregó ese pago', () => {
    const fx = applyPayment(pack, { next_due_date: '2026-10-01', sessions_remaining: 2 }, '2026-10-07');
    expect(revertPayment({ plan_kind: 'package', ...fx }, { next_due_date: fx.new_due_date, sessions_remaining: 12 }))
      .toEqual({ next_due_date: '2026-10-01', sessions_remaining: 2 });
  });
  it('paquete con sesiones ya consumidas: nunca baja de 0', () => {
    const fx = applyPayment(pack, { next_due_date: '2026-10-01', sessions_remaining: 0 }, '2026-10-07');
    expect(revertPayment({ plan_kind: 'package', ...fx }, { next_due_date: fx.new_due_date, sessions_remaining: 4 }).sessions_remaining).toBe(0);
  });
});

describe('PAG-09 · cambio de plan, pausa y reanudación', () => {
  it('al corriente: conserva la fecha pagada', () => {
    expect(changePlanStart({ next_due_date: '2026-10-27', state: 'pagado' }, { kind: 'monthly' }, '2026-10-07'))
      .toEqual({ next_due_date: '2026-10-27', sessions_remaining: null });
    expect(changePlanStart({ next_due_date: '2026-10-09', state: 'por_vencer' }, { kind: 'single' }, '2026-10-07').next_due_date).toBe('2026-10-09');
  });
  it('vencido: el plan nuevo queda por pagar desde hoy', () => {
    expect(changePlanStart({ next_due_date: '2026-09-01', state: 'vencido' }, { kind: 'monthly' }, '2026-10-07').next_due_date).toBe('2026-10-07');
    // paquete sin sesiones: vencido aunque la vigencia no haya pasado
    expect(changePlanStart({ next_due_date: '2026-11-01', state: 'vencido' }, { kind: 'monthly' }, '2026-10-07').next_due_date).toBe('2026-10-07');
  });
  it('si el plan nuevo es paquete empieza con 0 sesiones', () => {
    expect(changePlanStart({ next_due_date: '2026-10-27', state: 'pagado' }, { kind: 'package' }, '2026-10-07').sessions_remaining).toBe(0);
  });
  it('reanudar recorre el vencimiento los días de pausa', () => {
    expect(resumeDueDate('2026-10-20', '2026-10-01', '2026-10-11')).toBe('2026-10-30');
    expect(resumeDueDate('2026-10-20', '2026-10-07', '2026-10-07')).toBe('2026-10-20');
    expect(resumeDueDate('2026-10-20', null, '2026-10-07')).toBe('2026-10-20');
  });
});

describe('utilidades', () => {
  it('diffDays', () => {
    expect(diffDays('2026-10-01', '2026-10-11')).toBe(10);
    expect(diffDays('2026-12-31', '2027-01-01')).toBe(1);
    expect(diffDays('2026-10-11', '2026-10-01')).toBe(-10);
  });
  it('monthRange y shiftMonth', () => {
    expect(monthRange('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(monthRange('2026-05', '2026-05')).toEqual(['2026-05']);
    expect(monthRange('2026-06', '2026-05')).toEqual([]);
    expect(shiftMonth('2026-10', -5)).toBe('2026-05');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
  it('coveredPeriod para el recibo', () => {
    expect(coveredPeriod({ plan_kind: 'monthly', paid_on: '2026-10-07', prev_due_date: '2026-10-20', new_due_date: '2026-11-19', prev_sessions: null, new_sessions: null }))
      .toEqual({ from: '2026-10-20', to: '2026-11-19', sessions: null });
    expect(coveredPeriod({ plan_kind: 'monthly', paid_on: '2026-10-07', prev_due_date: '2026-09-01', new_due_date: '2026-11-06', prev_sessions: null, new_sessions: null }).from).toBe('2026-10-07');
    expect(coveredPeriod({ plan_kind: 'package', paid_on: '2026-10-07', prev_due_date: '2026-09-01', new_due_date: '2026-12-06', prev_sessions: 2, new_sessions: 12 }).sessions).toBe(10);
  });
  it('csvCell escapa comillas, comas y fórmulas', () => {
    expect(csvCell('Ana "La Güera", Pérez')).toBe('"Ana ""La Güera"", Pérez"');
    expect(csvCell('=SUMA(A1)')).toBe("'=SUMA(A1)");
    expect(csvCell(null)).toBe('');
    expect(csvCell('2400.00')).toBe('2400.00');
  });
});
