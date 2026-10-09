// QA-02 · Integración de la API probada como dueño y como fisioterapeuta.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays } from '@/lib/dates';
import { GET as boardGET } from '@/app/api/billing/route';
import { GET as membershipGET, PATCH as membershipPATCH } from '@/app/api/billing/memberships/[patientId]/route';
import { GET as receiptGET } from '@/app/api/billing/payments/[id]/receipt/route';
import { POST as voidPOST } from '@/app/api/billing/payments/[id]/void/route';
import { GET as paymentsGET, POST as paymentsPOST } from '@/app/api/billing/payments/route';
import { GET as reportGET } from '@/app/api/billing/report/route';
import { PATCH as planPATCH } from '@/app/api/plans/[id]/route';
import { GET as plansGET, POST as plansPOST } from '@/app/api/plans/route';
import { call, fixtures, sqlAs, sqlSystem, type Fixtures } from '../helpers';

// tests/helpers.ts hace `set local session_replication_role = replica` dentro de la transacción de
// resetData(); el rol de la base local no es superusuario, la sentencia falla y aborta la transacción
// (el .catch no la rescata). TRUNCATE no dispara los triggers por fila, así que basta con omitirla.
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

let fx: Fixtures;
let today: string;

const pay = (patient_id: string, extra: Record<string, unknown> = {}, as = fx.owner) =>
  call(paymentsPOST, { as, body: { patient_id, method: 'cash', ...extra } });
const voidIt = (id: string, reason: unknown = 'Captura duplicada', as = fx.owner) =>
  call(voidPOST, { as, params: { id }, body: { reason } });
const membership = (patientId: string, as = fx.owner) => call(membershipGET, { as, params: { patientId } });
const patch = (patientId: string, body: unknown, as = fx.owner) => call(membershipPATCH, { as, params: { patientId }, method: 'PATCH', body });
const stateOf = async (patientId: string) =>
  (await sqlSystem((tx) => tx<{ state: string }[]>`select state from patient_billing where patient_id = ${patientId}`))[0].state;
const current = async (patientId: string) =>
  (await sqlSystem((tx) => tx<{ id: string; next_due_date: string; sessions_remaining: number | null; status: string; paused_on: string | null }[]>`
    select id, next_due_date, sessions_remaining, status, paused_on from memberships where patient_id = ${patientId} and status <> 'ended'`))[0];
const setDue = (patientId: string, days: number) =>
  sqlSystem((tx) => tx`update memberships set next_due_date = mx_today() + ${days}::int where patient_id = ${patientId} and status <> 'ended'`);

beforeEach(async () => {
  fx = await fixtures();
  today = (await sqlSystem((tx) => tx<{ d: string }[]>`select mx_today()::text as d`))[0].d;
  // Los planes sobreviven a resetData(): se dejan como en los datos base.
  await sqlSystem(async (tx) => {
    await tx`delete from membership_plans where name not in ('Mensual Elite','Mensual Básica','Paquete 10 sesiones','Sesión individual','Plan Senior')`;
    await tx`update membership_plans set active = true, price_cents = 240000 where name = 'Mensual Elite'`;
    await tx`update membership_plans set active = true`;
    await tx`update clinic set settings = settings || '{"due_soon_days": 7}'::jsonb`;
  });
});

describe('PAG-04 · registrar pago', () => {
  it('mensual vencido: el periodo corre desde el pago y el estado pasa a pagado', async () => {
    expect(await stateOf(fx.patientB1)).toBe('vencido');
    const r = await pay(fx.patientB1, { method: 'transfer', reference: 'SPEI 123' });
    expect(r.status).toBe(200);
    expect(r.data.state).toBe('pagado');
    expect(r.data.payment).toMatchObject({
      plan_name: 'Plan Senior', plan_kind: 'monthly', amount_cents: 120000, method: 'transfer', paid_on: today, reference: 'SPEI 123',
      prev_due_date: addDays(today, -5), new_due_date: addDays(today, 30), recorded_by: fx.owner.id, recorded_by_name: 'Nicolas Herrera',
    });
    expect(r.data.payment.receipt_number).toMatch(/^R-\d{6}$/);
    expect((await current(fx.patientB1)).next_due_date).toBe(addDays(today, 30));
    expect(await stateOf(fx.patientB1)).toBe('pagado');
  });

  it('mensual adelantado: el periodo se acumula sobre el vencimiento', async () => {
    const r = await pay(fx.patientA1);
    expect(r.data.payment.new_due_date).toBe(addDays(today, 50));
    const r2 = await pay(fx.patientA1);
    expect(r2.data.payment).toMatchObject({ prev_due_date: addDays(today, 50), new_due_date: addDays(today, 80) });
  });

  it('paquete: suma sesiones y la vigencia corre desde el pago', async () => {
    const r = await pay(fx.patientA2, { method: 'card' });
    expect(r.status).toBe(200);
    expect(r.data.payment).toMatchObject({ plan_kind: 'package', prev_sessions: 10, new_sessions: 20, new_due_date: addDays(today, 60), amount_cents: 320000 });
    expect(r.data.billing.sessions_remaining).toBe(20);
    expect((await current(fx.patientA2)).sessions_remaining).toBe(20);
  });

  it('sesión individual: vigencia desde el pago, sin sesiones', async () => {
    await patch(fx.patientA1, { action: 'change_plan', plan_id: fx.plans['Sesión individual'] });
    const r = await pay(fx.patientA1);
    expect(r.data.payment).toMatchObject({ plan_kind: 'single', new_due_date: addDays(today, 1), prev_sessions: null, new_sessions: null });
  });

  it('monto distinto al precio exige nota; con nota se guarda el descuento', async () => {
    const bad = await pay(fx.patientA1, { amount_cents: 200000 });
    expect(bad.status).toBe(400);
    expect(bad.error?.fields?.note).toBeTruthy();
    const ok = await pay(fx.patientA1, { amount_cents: 200000, note: 'Descuento por pronto pago' });
    expect(ok.status).toBe(200);
    expect(ok.data.payment).toMatchObject({ amount_cents: 200000, note: 'Descuento por pronto pago' });
  });

  it('valida: fecha futura, método, monto negativo, paciente inexistente', async () => {
    const future = await pay(fx.patientA1, { paid_on: addDays(today, 1) });
    expect(future.status).toBe(400);
    expect(future.error?.fields?.paid_on).toMatch(/futura/);
    expect((await pay(fx.patientA1, { method: 'bitcoin' })).status).toBe(400);
    expect((await pay(fx.patientA1, { amount_cents: -1, note: 'x' })).status).toBe(400);
    expect((await pay('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    const [{ n }] = await sqlSystem((tx) => tx<{ n: number }[]>`select count(*)::int as n from payments`);
    expect(n).toBe(0);
  });

  it('pago con fecha pasada: el mensual vencido corre desde esa fecha', async () => {
    const r = await pay(fx.patientB1, { paid_on: addDays(today, -2) });
    expect(r.data.payment).toMatchObject({ paid_on: addDays(today, -2), new_due_date: addDays(today, 28) });
  });

  it('sin plan o en pausa responde 409', async () => {
    await sqlSystem((tx) => tx`update memberships set status = 'ended', ended_on = mx_today() where patient_id = ${fx.patientA1}`);
    const r = await pay(fx.patientA1);
    expect(r.status).toBe(409);
    expect(r.error?.code).toBe('no_plan');
    await patch(fx.patientB1, { action: 'pause' });
    expect((await pay(fx.patientB1)).error?.code).toBe('paused');
  });

  it('un pago registrado no puede modificarse (trigger)', async () => {
    const r = await pay(fx.patientA1);
    await expect(sqlAs(fx.owner, (tx) => tx`update payments set amount_cents = 1 where id = ${r.data.payment.id}`)).rejects.toThrow(/no puede modificarse/);
  });
});

describe('PAG-05 · anular pago', () => {
  it('revierte la fecha y marca quién y por qué', async () => {
    const before = await current(fx.patientB1);
    const p = (await pay(fx.patientB1)).data.payment;
    const r = await voidIt(p.id, 'Se cobró al paciente equivocado');
    expect(r.status).toBe(200);
    expect(r.data.reverted).toBe(true);
    expect(r.data.payment).toMatchObject({ voided_by: fx.owner.id, void_reason: 'Se cobró al paciente equivocado' });
    expect(r.data.payment.voided_at).toBeTruthy();
    expect(r.data.state).toBe('vencido');
    expect((await current(fx.patientB1)).next_due_date).toBe(before.next_due_date);
  });

  it('exige motivo', async () => {
    const p = (await pay(fx.patientA1)).data.payment;
    expect((await voidIt(p.id, '')).status).toBe(400);
    expect((await voidIt(p.id, '  ')).status).toBe(400);
    expect((await call(voidPOST, { as: fx.owner, params: { id: p.id }, body: {} })).status).toBe(400);
    expect((await current(fx.patientA1)).next_due_date).toBe(addDays(today, 50));
  });

  it('no se puede anular un pago que no es el más reciente; sí en orden inverso', async () => {
    const p1 = (await pay(fx.patientA1)).data.payment;
    const p2 = (await pay(fx.patientA1)).data.payment;
    const r = await voidIt(p1.id);
    expect(r.status).toBe(409);
    expect(r.error?.code).toBe('not_latest');
    expect(r.error?.message).toContain(p2.receipt_number);
    expect((await voidIt(p2.id)).status).toBe(200);
    expect((await current(fx.patientA1)).next_due_date).toBe(addDays(today, 50));
    expect((await voidIt(p1.id)).status).toBe(200);
    expect((await current(fx.patientA1)).next_due_date).toBe(addDays(today, 20));
  });

  it('no se anula dos veces; inexistente 404', async () => {
    const p = (await pay(fx.patientA1)).data.payment;
    expect((await voidIt(p.id)).status).toBe(200);
    expect((await voidIt(p.id)).status).toBe(409);
    expect((await voidIt('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await voidIt('no-es-uuid')).status).toBe(404);
  });

  it('paquete: resta las sesiones del pago sin bajar de 0', async () => {
    const p = (await pay(fx.patientA2)).data.payment; // 10 → 20
    await sqlSystem((tx) => tx`update memberships set sessions_remaining = 4 where patient_id = ${fx.patientA2}`); // ya se consumieron 16
    const r = await voidIt(p.id);
    expect(r.status).toBe(200);
    const m = await current(fx.patientA2);
    expect(m.sessions_remaining).toBe(0);
    expect(m.next_due_date).toBe(addDays(today, 40));
  });

  it('pago de una membresía anterior (el plan cambió): se anula sin tocar el plan actual', async () => {
    const p = (await pay(fx.patientA1)).data.payment;
    await patch(fx.patientA1, { action: 'change_plan', plan_id: fx.plans['Mensual Básica'] });
    const r = await voidIt(p.id);
    expect(r.status).toBe(200);
    expect(r.data.reverted).toBe(false);
    expect((await current(fx.patientA1)).next_due_date).toBe(addDays(today, 50));
  });
});

describe('permisos por rol', () => {
  it('fisioterapeuta: 403 en pagos, planes, tablero y reporte', async () => {
    const t = fx.therapistA;
    expect((await pay(fx.patientA1, {}, t)).status).toBe(403);
    expect((await call(paymentsGET, { as: t, url: '/api/billing/payments' })).status).toBe(403);
    const p = (await pay(fx.patientA1)).data.payment;
    expect((await voidIt(p.id, 'motivo', t)).status).toBe(403);
    expect((await call(receiptGET, { as: t, params: { id: p.id } })).status).toBe(403);
    expect((await call(boardGET, { as: t, url: '/api/billing' })).status).toBe(403);
    expect((await call(reportGET, { as: t, url: '/api/billing/report' })).status).toBe(403);
    expect((await call(plansGET, { as: t })).status).toBe(403);
    expect((await call(plansPOST, { as: t, body: { name: 'X', kind: 'monthly', price_cents: 1, period_days: 30 } })).status).toBe(403);
    expect((await call(planPATCH, { as: t, method: 'PATCH', params: { id: fx.plans['Plan Senior'] }, body: { price_cents: 1 } })).status).toBe(403);
    expect((await patch(fx.patientA1, { action: 'pause' }, t)).status).toBe(403);
    expect((await call(paymentsGET, { url: '/api/billing/payments' })).status).toBe(401);
  });

  it('fisioterapeuta: ve el estado de SU paciente sin pagos; el ajeno es 404', async () => {
    await pay(fx.patientA1);
    const mine = await membership(fx.patientA1, fx.therapistA);
    expect(mine.status).toBe(200);
    expect(mine.data.state).toBe('pagado');
    expect(mine.data.membership).toMatchObject({ plan_name: 'Mensual Elite', next_due_date: addDays(today, 50) });
    expect(mine.data).not.toHaveProperty('payments');
    expect(JSON.stringify(mine.data)).not.toContain('amount_cents');
    expect((await membership(fx.patientB1, fx.therapistA)).status).toBe(404);

    const own = await membership(fx.patientA1);
    expect(own.data.payments).toHaveLength(1);
  });

  it('RLS: el fisioterapeuta no lee pagos ni directo en la base', async () => {
    await pay(fx.patientA1);
    const rows = await sqlAs(fx.therapistA, (tx) => tx`select id from payments`);
    expect(rows).toHaveLength(0);
  });
});

describe('PAG-02 / PAG-09 · membresía: asignar, cambiar, pausar', () => {
  it('detalle del dueño: pagos con el anulable marcado y los anulados incluidos', async () => {
    const p1 = (await pay(fx.patientA1)).data.payment;
    const p2 = (await pay(fx.patientA1)).data.payment;
    const p3 = (await pay(fx.patientA1)).data.payment;
    await voidIt(p3.id);
    const r = await membership(fx.patientA1);
    expect(r.data.patient.full_name).toBe('Ana Prueba Uno');
    const byId = Object.fromEntries(r.data.payments.map((p: any) => [p.id, p]));
    expect(r.data.payments.map((p: any) => p.id)).toEqual([p3.id, p2.id, p1.id]);
    expect(byId[p3.id]).toMatchObject({ voidable: false, void_reason: 'Captura duplicada', voided_by_name: 'Nicolas Herrera' });
    expect(byId[p2.id].voidable).toBe(true);
    expect(byId[p1.id].voidable).toBe(false);
  });

  it('cambio de plan al corriente: conserva la fecha y deja una sola membresía vigente', async () => {
    const r = await patch(fx.patientA1, { action: 'change_plan', plan_id: fx.plans['Mensual Básica'] });
    expect(r.status).toBe(200);
    expect(r.data.membership).toMatchObject({ plan_name: 'Mensual Básica', next_due_date: addDays(today, 20), started_on: today });
    expect(r.data.history).toHaveLength(1);
    expect(r.data.history[0]).toMatchObject({ plan_name: 'Mensual Elite', ended_on: today });
    const rows = await sqlSystem((tx) => tx<{ status: string }[]>`select status from memberships where patient_id = ${fx.patientA1}`);
    expect(rows.map((x) => x.status).sort()).toEqual(['active', 'ended']);
  });

  it('cambio de plan vencido: el nuevo queda por pagar desde hoy; a paquete empieza en 0 sesiones', async () => {
    const r = await patch(fx.patientB1, { action: 'change_plan', plan_id: fx.plans['Paquete 10 sesiones'] });
    expect(r.data.membership).toMatchObject({ plan_kind: 'package', next_due_date: today, sessions_remaining: 0 });
    expect(r.data.state).toBe('vencido');
    const paid = await pay(fx.patientB1);
    expect(paid.data.payment).toMatchObject({ prev_sessions: 0, new_sessions: 10 });
    expect(paid.data.state).toBe('pagado');
  });

  it('cambio de plan: mismo plan, plan inactivo o inexistente se rechazan sin tocar nada', async () => {
    expect((await patch(fx.patientA1, { action: 'change_plan', plan_id: fx.plans['Mensual Elite'] })).status).toBe(400);
    await sqlSystem((tx) => tx`update membership_plans set active = false where name = 'Plan Senior'`);
    expect((await patch(fx.patientA1, { action: 'change_plan', plan_id: fx.plans['Plan Senior'] })).status).toBe(400);
    expect((await patch(fx.patientA1, { action: 'change_plan', plan_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    expect((await patch(fx.patientA1, { action: 'volar' })).status).toBe(400);
    const rows = await sqlSystem((tx) => tx`select 1 from memberships where patient_id = ${fx.patientA1}`);
    expect(rows).toHaveLength(1);
    // quien ya tiene el plan inactivo lo conserva
    expect((await membership(fx.patientB1)).data.membership).toMatchObject({ plan_name: 'Plan Senior', plan_active: false });
  });

  it('asignar: solo cuando no tiene plan', async () => {
    expect((await patch(fx.patientA1, { action: 'assign', plan_id: fx.plans['Plan Senior'] })).status).toBe(409);
    await sqlSystem((tx) => tx`update memberships set status = 'ended', ended_on = mx_today() where patient_id = ${fx.patientA1}`);
    expect((await membership(fx.patientA1)).data).toMatchObject({ membership: null, state: 'sin_plan' });
    expect((await patch(fx.patientA1, { action: 'change_plan', plan_id: fx.plans['Plan Senior'] })).status).toBe(409);
    const r = await patch(fx.patientA1, { action: 'assign', plan_id: fx.plans['Plan Senior'] });
    expect(r.status).toBe(200);
    expect(r.data.membership).toMatchObject({ plan_name: 'Plan Senior', next_due_date: today });
    expect(r.data.state).toBe('por_vencer');
  });

  it('pausa y reanudación recorren la fecha de vencimiento', async () => {
    const r = await patch(fx.patientA1, { action: 'pause' });
    expect(r.status).toBe(200);
    expect(r.data.state).toBe('pausado');
    expect(r.data.membership).toMatchObject({ membership_status: 'paused', paused_on: today });
    expect((await patch(fx.patientA1, { action: 'pause' })).status).toBe(409);
    expect((await patch(fx.patientA1, { action: 'change_plan', plan_id: fx.plans['Plan Senior'] })).status).toBe(409);
    // la pausa empezó hace 9 días
    await sqlSystem((tx) => tx`update memberships set paused_on = mx_today() - 9 where patient_id = ${fx.patientA1}`);
    const back = await patch(fx.patientA1, { action: 'resume' });
    expect(back.status).toBe(200);
    expect(back.data.membership).toMatchObject({ membership_status: 'active', paused_on: null, next_due_date: addDays(today, 29) });
    expect(back.data.state).toBe('pagado');
    expect((await patch(fx.patientA1, { action: 'resume' })).status).toBe(409);
  });
});

describe('PAG-03 · el estado se calcula al leer', () => {
  it('pagado → por_vencer → vencido al moverse el vencimiento', async () => {
    await setDue(fx.patientA1, 8);
    expect(await stateOf(fx.patientA1)).toBe('pagado');
    await setDue(fx.patientA1, 7);
    expect(await stateOf(fx.patientA1)).toBe('por_vencer');
    await setDue(fx.patientA1, 0);
    expect(await stateOf(fx.patientA1)).toBe('por_vencer');
    await setDue(fx.patientA1, -1);
    expect(await stateOf(fx.patientA1)).toBe('vencido');
    expect((await membership(fx.patientA1, fx.therapistA)).data.state).toBe('vencido');
  });

  it('due_soon_days de la clínica cambia el umbral', async () => {
    await setDue(fx.patientA1, 10);
    expect(await stateOf(fx.patientA1)).toBe('pagado');
    await sqlSystem((tx) => tx`update clinic set settings = settings || '{"due_soon_days": 15}'::jsonb`);
    expect(await stateOf(fx.patientA1)).toBe('por_vencer');
    await sqlSystem((tx) => tx`update clinic set settings = settings || '{"due_soon_days": 3}'::jsonb`);
    expect(await stateOf(fx.patientA1)).toBe('pagado');
  });
});

describe('PAG-07 · la asistencia descuenta sesiones del paquete', () => {
  const attend = (patientId: string, at: string, key: string) =>
    sqlSystem((tx) => tx`select register_attendance(null, null, ${at}::timestamptz, 'manual', ${key}, '', ${patientId}::uuid)`);

  it('10 → 9; la segunda del mismo día no descuenta; en 0 queda vencido', async () => {
    await attend(fx.patientA2, `${today}T10:00:00-06:00`, 'pag07-a');
    expect((await current(fx.patientA2)).sessions_remaining).toBe(9);
    await attend(fx.patientA2, `${today}T17:00:00-06:00`, 'pag07-b');
    expect((await current(fx.patientA2)).sessions_remaining).toBe(9);
    await attend(fx.patientA2, `${today}T10:00:00-06:00`, 'pag07-a'); // misma lectura repetida
    expect((await current(fx.patientA2)).sessions_remaining).toBe(9);

    expect(await stateOf(fx.patientA2)).toBe('pagado');
    await sqlSystem((tx) => tx`update memberships set sessions_remaining = 1 where patient_id = ${fx.patientA2}`);
    expect(await stateOf(fx.patientA2)).toBe('por_vencer');
    await attend(fx.patientA2, `${addDays(today, -1)}T10:00:00-06:00`, 'pag07-c');
    expect((await current(fx.patientA2)).sessions_remaining).toBe(0);
    expect(await stateOf(fx.patientA2)).toBe('vencido');
    await attend(fx.patientA2, `${addDays(today, -2)}T10:00:00-06:00`, 'pag07-d');
    expect((await current(fx.patientA2)).sessions_remaining).toBe(0);
    // el pago vuelve a cargar sesiones
    expect((await pay(fx.patientA2)).data.state).toBe('pagado');
  });
});

describe('PAG-01 / PAG-11 · planes', () => {
  it('lista todos con activos primero y conteo de pacientes', async () => {
    await sqlSystem((tx) => tx`update membership_plans set active = false where name = 'Mensual Elite'`);
    const r = await call(plansGET, { as: fx.owner });
    expect(r.status).toBe(200);
    expect(r.data).toHaveLength(5);
    expect(r.data[r.data.length - 1]).toMatchObject({ name: 'Mensual Elite', active: false, patients: 1 });
    expect(r.data.find((p: any) => p.name === 'Mensual Básica').patients).toBe(0);
  });

  it('alta: paquete exige sesiones; nombre duplicado 409; validaciones', async () => {
    const noSessions = await call(plansPOST, { as: fx.owner, body: { name: 'Paquete 5', kind: 'package', price_cents: 180000, period_days: 45 } });
    expect(noSessions.status).toBe(400);
    expect(noSessions.error?.fields?.sessions_count).toBeTruthy();
    const ok = await call(plansPOST, { as: fx.owner, body: { name: 'Paquete 5', kind: 'package', price_cents: 180000, period_days: 45, sessions_count: 5 } });
    expect(ok.status).toBe(200);
    expect(ok.data).toMatchObject({ name: 'Paquete 5', sessions_count: 5, active: true, position: 6 });
    expect((await call(plansPOST, { as: fx.owner, body: { name: 'Paquete 5', kind: 'monthly', price_cents: 1, period_days: 30 } })).status).toBe(409);
    expect((await call(plansPOST, { as: fx.owner, body: { name: '', kind: 'monthly', price_cents: 1, period_days: 30 } })).status).toBe(400);
    expect((await call(plansPOST, { as: fx.owner, body: { name: 'Z', kind: 'monthly', price_cents: -5, period_days: 30 } })).status).toBe(400);
    expect((await call(plansPOST, { as: fx.owner, body: { name: 'Z', kind: 'monthly', price_cents: 100, period_days: 0 } })).status).toBe(400);
    const monthly = await call(plansPOST, { as: fx.owner, body: { name: 'Mensual Z', kind: 'monthly', price_cents: 100, period_days: 30, sessions_count: 8 } });
    expect(monthly.data.sessions_count).toBeNull();
  });

  it('edición: el tipo no cambia si ya tiene membresías; sin membresías sí', async () => {
    const locked = await call(planPATCH, { as: fx.owner, method: 'PATCH', params: { id: fx.plans['Mensual Elite'] }, body: { kind: 'package', sessions_count: 5 } });
    expect(locked.status).toBe(409);
    const free = await call(planPATCH, { as: fx.owner, method: 'PATCH', params: { id: fx.plans['Mensual Básica'] }, body: { kind: 'package' } });
    expect(free.status).toBe(400); // paquete sin sesiones
    const ok = await call(planPATCH, { as: fx.owner, method: 'PATCH', params: { id: fx.plans['Mensual Básica'] }, body: { kind: 'package', sessions_count: 8 } });
    expect(ok.data).toMatchObject({ kind: 'package', sessions_count: 8 });
    await sqlSystem((tx) => tx`update membership_plans set kind = 'monthly', sessions_count = null where name = 'Mensual Básica'`);
    expect((await call(planPATCH, { as: fx.owner, method: 'PATCH', params: { id: '00000000-0000-4000-8000-000000000000' }, body: { name: 'x' } })).status).toBe(404);
    expect((await call(planPATCH, { as: fx.owner, method: 'PATCH', params: { id: fx.plans['Mensual Básica'] }, body: {} })).status).toBe(400);
    expect((await call(planPATCH, { as: fx.owner, method: 'PATCH', params: { id: fx.plans['Mensual Básica'] }, body: { name: 'Plan Senior' } })).status).toBe(409);
  });

  it('un plan inactivo no se asigna, pero se sigue cobrando a quien ya lo tiene', async () => {
    const off = await call(planPATCH, { as: fx.owner, method: 'PATCH', params: { id: fx.plans['Mensual Elite'] }, body: { active: false } });
    expect(off.data.active).toBe(false);
    expect((await patch(fx.patientB1, { action: 'change_plan', plan_id: fx.plans['Mensual Elite'] })).status).toBe(400);
    expect((await pay(fx.patientA1)).status).toBe(200);
  });

  it('PAG-11 · cambiar precio o nombre del plan no altera pagos pasados', async () => {
    const p = (await pay(fx.patientA1)).data.payment;
    expect(p).toMatchObject({ plan_name: 'Mensual Elite', amount_cents: 240000 });
    const upd = await call(planPATCH, { as: fx.owner, method: 'PATCH', params: { id: fx.plans['Mensual Elite'] }, body: { name: 'Mensual Elite Plus', price_cents: 300000 } });
    expect(upd.status).toBe(200);
    try {
      const list = await call(paymentsGET, { as: fx.owner, url: `/api/billing/payments?patient_id=${fx.patientA1}` });
      expect(list.data.items[0]).toMatchObject({ id: p.id, plan_name: 'Mensual Elite', amount_cents: 240000 });
      const next = (await pay(fx.patientA1)).data.payment; // el siguiente pago sí usa el precio nuevo
      expect(next).toMatchObject({ plan_name: 'Mensual Elite Plus', amount_cents: 300000 });
      const report = await call(reportGET, { as: fx.owner, url: '/api/billing/report' });
      expect(report.data.totals.total_cents).toBe(540000);
      expect(report.data.totals.by_plan.map((x: any) => x.plan_name).sort()).toEqual(['Mensual Elite', 'Mensual Elite Plus']);
    } finally {
      await sqlSystem((tx) => tx`update membership_plans set name = 'Mensual Elite', price_cents = 240000 where id = ${fx.plans['Mensual Elite']}`);
    }
  });
});

describe('PAG-06 · tablero', () => {
  it('contadores sin el filtro de estado; filtros por estado, sede y nombre', async () => {
    const all = await call(boardGET, { as: fx.owner, url: '/api/billing' });
    expect(all.status).toBe(200);
    expect(all.data.stats).toEqual({ pagado: 2, por_vencer: 0, vencido: 1, pausado: 0, sin_plan: 0 });
    expect(all.data.rows).toHaveLength(3);
    expect(all.data.rows[0]).toMatchObject({ full_name: 'Carmen Prueba Tres', state: 'vencido', plan_name: 'Plan Senior', price_cents: 120000, location_name: 'Orizaba' });

    const overdue = await call(boardGET, { as: fx.owner, url: '/api/billing?state=vencido' });
    expect(overdue.data.rows.map((r: any) => r.patient_id)).toEqual([fx.patientB1]);
    expect(overdue.data.stats.pagado).toBe(2);

    const cor = await call(boardGET, { as: fx.owner, url: `/api/billing?location_id=${fx.cordoba}` });
    expect(cor.data.rows).toHaveLength(2);
    expect(cor.data.stats).toMatchObject({ pagado: 2, vencido: 0 });

    const q = await call(boardGET, { as: fx.owner, url: '/api/billing?q=' + encodeURIComponent('cármen') });
    expect(q.data.rows.map((r: any) => r.patient_id)).toEqual([fx.patientB1]);
    expect((await call(boardGET, { as: fx.owner, url: '/api/billing?state=otro' })).status).toBe(400);
  });

  it('solo pacientes activos; sin plan y pausado se cuentan aparte', async () => {
    await sqlSystem(async (tx) => {
      await tx`update patients set status = 'inactive', deactivated_at = now() where id = ${fx.patientB1}`;
      await tx`update memberships set status = 'ended', ended_on = mx_today() where patient_id = ${fx.patientA2}`;
    });
    await patch(fx.patientA1, { action: 'pause' });
    const r = await call(boardGET, { as: fx.owner, url: '/api/billing' });
    expect(r.data.stats).toEqual({ pagado: 0, por_vencer: 0, vencido: 0, pausado: 1, sin_plan: 1 });
    expect(r.data.rows).toHaveLength(2);
  });
});

describe('PAG-04 · listado de pagos', () => {
  it('filtra por paciente, método, fechas y anulados', async () => {
    const a = (await pay(fx.patientA1, { method: 'cash' })).data.payment;
    await pay(fx.patientA2, { method: 'card' });
    await pay(fx.patientB1, { method: 'transfer', paid_on: addDays(today, -3) });
    await voidIt(a.id);
    const list = (url: string) => call(paymentsGET, { as: fx.owner, url });
    const def = await list('/api/billing/payments');
    expect(def.data.total).toBe(2);
    expect(def.data.total_cents).toBe(320000 + 120000);
    expect(def.data.items[0]).toHaveProperty('patient_name');
    const withVoid = await list('/api/billing/payments?include_voided=true');
    expect(withVoid.data.total).toBe(3);
    expect(withVoid.data.total_cents).toBe(320000 + 120000);
    expect((await list('/api/billing/payments?method=card')).data.items).toHaveLength(1);
    expect((await list(`/api/billing/payments?patient_id=${fx.patientB1}`)).data.items).toHaveLength(1);
    expect((await list(`/api/billing/payments?from=${today}`)).data.items).toHaveLength(1);
    expect((await list(`/api/billing/payments?to=${addDays(today, -1)}`)).data.items).toHaveLength(1);
    expect((await list('/api/billing/payments?from=ayer')).status).toBe(400);
  });
});

describe('PAG-10 · reporte de ingresos', () => {
  it('cuadra con la suma de pagos no anulados, por mes × sede × plan y por método', async () => {
    await pay(fx.patientA1, { method: 'cash' });
    await pay(fx.patientA1, { method: 'transfer', amount_cents: 200000, note: 'Promoción' });
    await pay(fx.patientA2, { method: 'card' });
    await pay(fx.patientB1, { method: 'cash' });
    const voided = (await pay(fx.patientB1, { method: 'cash' })).data.payment;
    await voidIt(voided.id);

    const r = await call(reportGET, { as: fx.owner, url: '/api/billing/report' });
    expect(r.status).toBe(200);
    const [{ sum, n }] = await sqlSystem((tx) => tx<{ sum: number; n: number }[]>`
      select sum(amount_cents)::int as sum, count(*)::int as n from payments where voided_at is null`);
    expect(sum).toBe(240000 + 200000 + 320000 + 120000);
    const t = r.data.totals;
    expect(t.total_cents).toBe(sum);
    expect(t.payments).toBe(n);
    const add = (xs: { total_cents: number }[]) => xs.reduce((s, x) => s + x.total_cents, 0);
    expect(add(r.data.rows)).toBe(sum);
    expect(add(t.by_month)).toBe(sum);
    expect(add(t.by_location)).toBe(sum);
    expect(add(t.by_plan)).toBe(sum);
    expect(add(t.by_method)).toBe(sum);

    const month = today.slice(0, 7);
    expect(r.data.months).toHaveLength(6);
    expect(r.data.to).toBe(month);
    expect(r.data.rows).toContainEqual({ month, location_name: 'Córdoba', plan_name: 'Mensual Elite', payments: 2, total_cents: 440000 });
    expect(r.data.rows).toContainEqual({ month, location_name: 'Orizaba', plan_name: 'Plan Senior', payments: 1, total_cents: 120000 });
    expect(t.by_location).toContainEqual({ location_name: 'Córdoba', payments: 3, total_cents: 760000 });
    expect(t.by_method).toContainEqual({ method: 'cash', payments: 2, total_cents: 360000 });
    expect(t.by_month.find((m: any) => m.month === month)).toMatchObject({ payments: 4, total_cents: sum });
  });

  it('respeta el rango de meses y valida el formato', async () => {
    await pay(fx.patientA1);
    const month = today.slice(0, 7);
    const past = await call(reportGET, { as: fx.owner, url: '/api/billing/report?from=2020-01&to=2020-03' });
    expect(past.data.months).toEqual(['2020-01', '2020-02', '2020-03']);
    expect(past.data.totals.total_cents).toBe(0);
    expect(past.data.rows).toEqual([]);
    const one = await call(reportGET, { as: fx.owner, url: `/api/billing/report?from=${month}&to=${month}` });
    expect(one.data.totals.total_cents).toBe(240000);
    expect((await call(reportGET, { as: fx.owner, url: '/api/billing/report?from=2026-13' })).status).toBe(400);
    expect((await call(reportGET, { as: fx.owner, url: '/api/billing/report?from=2026-05&to=2026-01' })).status).toBe(400);
  });

  it('CSV: UTF-8 con BOM, encabezados y un renglón por pago (anulados marcados)', async () => {
    await pay(fx.patientA1, { method: 'transfer', reference: 'SPEI, folio "77"' });
    const v = (await pay(fx.patientB1)).data.payment;
    await voidIt(v.id);
    const r = await call(reportGET, { as: fx.owner, url: '/api/billing/report?format=csv' });
    expect(r.status).toBe(200);
    expect(r.res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(r.res.headers.get('content-disposition')).toMatch(/attachment; filename="pagos_\d{4}-\d{2}_\d{4}-\d{2}\.csv"/);
    const bytes = new Uint8Array(await r.res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes).replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('Fecha,Recibo,Paciente,Expediente,Sede,Plan,Método,Referencia,Monto,Estado');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('Ana Prueba Uno');
    expect(lines[1]).toContain('"SPEI, folio ""77"""');
    expect(lines[1]).toMatch(/,2400\.00,Vigente$/);
    expect(lines[2]).toMatch(/,1200\.00,Anulado$/);
    const [log] = await sqlSystem((tx) => tx<{ action: string }[]>`select action from audit_log where action = 'export'`);
    expect(log).toBeTruthy();
  });
});

describe('PAG-08 · recibo', () => {
  it('responde un PDF; también de un pago anulado; 404 si no existe', async () => {
    const p = (await pay(fx.patientA2, { method: 'card', reference: 'Terminal 4521' })).data.payment;
    const r = await call(receiptGET, { as: fx.owner, params: { id: p.id } });
    expect(r.status).toBe(200);
    expect(r.res.headers.get('content-type')).toBe('application/pdf');
    expect(r.res.headers.get('content-disposition')).toContain(encodeURIComponent(`Recibo ${p.receipt_number}.pdf`));
    const bytes = new Uint8Array(await r.res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1500);

    await voidIt(p.id);
    const v = await call(receiptGET, { as: fx.owner, params: { id: p.id } });
    expect(v.res.headers.get('content-type')).toBe('application/pdf');
    expect((await call(receiptGET, { as: fx.owner, params: { id: '00000000-0000-4000-8000-000000000000' } })).status).toBe(404);
  });
});

describe('auditoría', () => {
  it('registrar y anular un pago quedan en la bitácora a nombre del dueño', async () => {
    const p = (await pay(fx.patientA1)).data.payment;
    await voidIt(p.id);
    const rows = await sqlSystem((tx) => tx<{ action: string; actor_id: string }[]>`
      select action, actor_id from audit_log where table_name = 'payments' and row_id = ${p.id} order by at`);
    expect(rows.map((r) => r.action)).toEqual(['insert', 'update']);
    expect(rows.every((r) => r.actor_id === fx.owner.id)).toBe(true);
  });
});
