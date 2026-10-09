import { z } from 'zod';
import { route } from '@/lib/api';
import { badRequest } from '@/lib/errors';
import { PlanFields } from '@/modules/billing/plan-schema';

// PAG-01 / CFG-03 · Catálogo de planes con el número de pacientes que tiene cada uno. Activos primero.
export const GET = route({ auth: 'owner' }, async ({ db }) => {
  return db`
    select pl.id, pl.name, pl.kind, pl.price_cents, pl.period_days, pl.sessions_count, pl.position, pl.active,
           (select count(*)::int from memberships m join patients p on p.id = m.patient_id
             where m.plan_id = pl.id and m.status <> 'ended' and p.status = 'active') as patients,
           (select count(*)::int from memberships m where m.plan_id = pl.id) as memberships
    from membership_plans pl
    order by pl.active desc, pl.position, pl.name`;
});

const Body = z.object({ ...PlanFields, sessions_count: PlanFields.sessions_count.optional() });

// PAG-01 · Alta de plan (solo dueño). Un paquete exige número de sesiones.
export const POST = route({ auth: 'owner', body: Body }, async ({ db, body }) => {
  if (body.kind === 'package' && !body.sessions_count) {
    throw badRequest('Un paquete necesita el número de sesiones.', { sessions_count: 'Escribe el número de sesiones.' });
  }
  const sessions = body.kind === 'package' ? body.sessions_count! : null;
  const [row] = await db`
    insert into membership_plans (name, kind, price_cents, period_days, sessions_count, position)
    values (${body.name}, ${body.kind}, ${body.price_cents}, ${body.period_days}, ${sessions},
            (select coalesce(max(position), 0) + 1 from membership_plans))
    returning *`;
  return row;
});
