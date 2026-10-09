import { z } from 'zod';
import { route } from '@/lib/api';
import { logEvent } from '@/lib/audit';
import { fmtDate } from '@/lib/dates';
import { badRequest } from '@/lib/errors';
import { PAYMENT_METHOD_LABEL } from '@/lib/format';
import { csvLine, monthRange, shiftMonth } from '@/modules/billing/rules';

const dropEmpty = (v: unknown) =>
  v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '')) : v;
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mes inválido (AAAA-MM).');
const Query = z.preprocess(dropEmpty, z.object({ from: Month.optional(), to: Month.optional(), format: z.enum(['json', 'csv']).default('json') }));

type Agg = { payments: number; total_cents: number };
function group<K extends string>(rows: (Agg & Record<K, string>)[], key: K): (Agg & Record<K, string>)[] {
  const map = new Map<string, Agg & Record<K, string>>();
  for (const r of rows) {
    const cur = map.get(r[key]) ?? ({ [key]: r[key], payments: 0, total_cents: 0 } as Agg & Record<K, string>);
    cur.payments += r.payments;
    cur.total_cents += r.total_cents;
    map.set(r[key], cur);
  }
  return [...map.values()];
}

// PAG-10 · Ingresos por mes × sede × plan (pagos no anulados) y exportación del detalle en CSV.
export const GET = route({ auth: 'owner', query: Query }, async ({ db, query }) => {
  const [{ month }] = await db<{ month: string }[]>`select to_char(mx_today(), 'YYYY-MM') as month`;
  const to = query.to ?? month;
  const from = query.from ?? shiftMonth(to, -5);
  if (from > to) throw badRequest('El mes inicial no puede ser posterior al final.', { from: 'El mes inicial no puede ser posterior al final.' });
  const months = monthRange(from, to);
  if (months.length > 60) throw badRequest('El rango máximo es de 60 meses.', { from: 'El rango máximo es de 60 meses.' });
  const first = `${from}-01`;
  const end = `${shiftMonth(to, 1)}-01`; // exclusivo

  if (query.format === 'csv') {
    const rows = await db`
      select y.paid_on, y.receipt_number, p.full_name, p.record_number, l.name as location_name, y.plan_name, y.method,
             y.reference, y.amount_cents, y.voided_at
      from payments y join patients p on p.id = y.patient_id join locations l on l.id = p.location_id
      where y.paid_on >= ${first} and y.paid_on < ${end}
      order by y.paid_on, y.created_at`;
    const lines = [csvLine(['Fecha', 'Recibo', 'Paciente', 'Expediente', 'Sede', 'Plan', 'Método', 'Referencia', 'Monto', 'Estado'])];
    for (const r of rows) {
      lines.push(csvLine([fmtDate(r.paid_on), r.receipt_number, r.full_name, r.record_number, r.location_name, r.plan_name,
        PAYMENT_METHOD_LABEL[r.method] ?? r.method, r.reference, (r.amount_cents / 100).toFixed(2), r.voided_at ? 'Anulado' : 'Vigente']));
    }
    await logEvent(db, 'export', `Exportación de pagos ${from} a ${to} (${rows.length} renglones)`, { table: 'payments' });
    return new Response('﻿' + lines.join('\r\n') + '\r\n', {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="pagos_${from}_${to}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }

  // La sede es la del paciente (el pago no guarda sede propia).
  const cube = await db<{ month: string; location_name: string; plan_name: string; method: string; payments: number; total_cents: number }[]>`
    select to_char(y.paid_on, 'YYYY-MM') as month, l.name as location_name, y.plan_name, y.method,
           count(*)::int as payments, sum(y.amount_cents)::int as total_cents
    from payments y join patients p on p.id = y.patient_id join locations l on l.id = p.location_id
    where y.voided_at is null and y.paid_on >= ${first} and y.paid_on < ${end}
    group by 1, 2, 3, 4
    order by 1, 2, 3, 4`;

  const rowsMap = new Map<string, { month: string; location_name: string; plan_name: string; payments: number; total_cents: number }>();
  for (const c of cube) {
    const k = `${c.month}|${c.location_name}|${c.plan_name}`;
    const cur = rowsMap.get(k) ?? { month: c.month, location_name: c.location_name, plan_name: c.plan_name, payments: 0, total_cents: 0 };
    cur.payments += c.payments;
    cur.total_cents += c.total_cents;
    rowsMap.set(k, cur);
  }
  const byMonth = new Map(group(cube, 'month').map((m) => [m.month, m]));
  const desc = <T extends Agg>(a: T, b: T) => b.total_cents - a.total_cents;
  return {
    from, to, months,
    rows: [...rowsMap.values()],
    totals: {
      total_cents: cube.reduce((s, c) => s + c.total_cents, 0),
      payments: cube.reduce((s, c) => s + c.payments, 0),
      by_month: months.map((m) => ({ month: m, payments: byMonth.get(m)?.payments ?? 0, total_cents: byMonth.get(m)?.total_cents ?? 0 })),
      by_location: group(cube, 'location_name').map(({ location_name, payments, total_cents }) => ({ location_name, payments, total_cents })).sort(desc),
      by_plan: group(cube, 'plan_name').map(({ plan_name, payments, total_cents }) => ({ plan_name, payments, total_cents })).sort(desc),
      by_method: group(cube, 'method').map(({ method, payments, total_cents }) => ({ method, payments, total_cents })).sort(desc),
    },
  };
});
