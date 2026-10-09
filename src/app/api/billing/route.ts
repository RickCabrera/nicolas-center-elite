import { z } from 'zod';
import { route } from '@/lib/api';

const dropEmpty = (v: unknown) =>
  v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '')) : v;

const STATES = ['pagado', 'por_vencer', 'vencido', 'pausado', 'sin_plan'] as const;
const Query = z.preprocess(dropEmpty, z.object({
  state: z.enum(STATES).optional(),
  location_id: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
}));

// PAG-06 · Tablero de mensualidades: estado de pago por paciente activo. El estado lo calcula la base (PAG-03).
export const GET = route({ auth: 'owner', query: Query }, async ({ db, query }) => {
  const like = query.q ? '%' + query.q.replace(/[\\%_]/g, '\\$&') + '%' : null;
  const fLoc = query.location_id ? db`and p.location_id = ${query.location_id}` : db``;
  const fSearch = like ? db`and norm(p.full_name || ' ' || p.record_number) like norm(${like})` : db``;

  const all = await db<{ state: (typeof STATES)[number] }[]>`
    select p.id as patient_id, p.full_name, p.record_number, p.location_id, l.name as location_name,
           b.membership_id, b.plan_id, b.plan_name, b.plan_kind, b.price_cents, b.period_days, b.sessions_count,
           b.started_on, b.next_due_date, b.sessions_remaining, b.membership_status, coalesce(b.state, 'sin_plan') as state
    from patients p
    join locations l on l.id = p.location_id
    left join patient_billing b on b.patient_id = p.id
    where p.status = 'active' ${fLoc} ${fSearch}
    order by case coalesce(b.state, 'sin_plan') when 'vencido' then 0 when 'por_vencer' then 1 when 'sin_plan' then 2 when 'pagado' then 3 else 4 end,
             b.next_due_date nulls last, norm(p.full_name)`;

  // Los contadores no llevan el filtro de estado: sirven para elegirlo.
  const stats = { pagado: 0, por_vencer: 0, vencido: 0, pausado: 0, sin_plan: 0 };
  for (const r of all) stats[r.state]++;
  return { stats, rows: query.state ? all.filter((r) => r.state === query.state) : all };
});
