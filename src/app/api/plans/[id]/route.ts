import { z } from 'zod';
import { route } from '@/lib/api';
import { badRequest, conflict, notFound } from '@/lib/errors';
import { PlanFields } from '@/modules/billing/plan-schema';

const Body = z.object({
  name: PlanFields.name.optional(),
  kind: PlanFields.kind.optional(),
  price_cents: PlanFields.price_cents.optional(),
  period_days: PlanFields.period_days.optional(),
  sessions_count: PlanFields.sessions_count.optional(),
  position: z.number().int().min(0).max(10000).optional(),
  active: z.boolean().optional(),
});

// PAG-01 / CFG-03 · Edita un plan. No se borra: se desactiva. Los pagos pasados no cambian (PAG-11:
// cada pago guarda copia del nombre y del monto).
export const PATCH = route({ auth: 'owner', body: Body }, async ({ db, params, body }) => {
  if (!z.uuid().safeParse(params.id).success) throw notFound('Plan no encontrado.');
  const [cur] = await db<{ id: string; kind: string; sessions_count: number | null }[]>`
    select id, kind, sessions_count from membership_plans where id = ${params.id} for update`;
  if (!cur) throw notFound('Plan no encontrado.');

  if (body.kind && body.kind !== cur.kind) {
    const [{ n }] = await db<{ n: number }[]>`select count(*)::int as n from memberships where plan_id = ${cur.id}`;
    if (n > 0) throw conflict('El tipo no se puede cambiar porque el plan ya tiene pacientes. Crea un plan nuevo y desactiva este.', 'kind_locked');
  }
  const kind = body.kind ?? cur.kind;
  const patch: Record<string, unknown> = {};
  for (const k of ['name', 'kind', 'price_cents', 'period_days', 'position', 'active'] as const) {
    if (body[k] !== undefined) patch[k] = body[k];
  }
  if (kind === 'package') {
    const sessions = body.sessions_count === undefined ? cur.sessions_count : body.sessions_count;
    if (!sessions) throw badRequest('Un paquete necesita el número de sesiones.', { sessions_count: 'Escribe el número de sesiones.' });
    if (body.sessions_count !== undefined) patch.sessions_count = sessions;
  } else if (body.sessions_count !== undefined || body.kind) {
    patch.sessions_count = null;
  }
  const keys = Object.keys(patch);
  if (!keys.length) throw badRequest('No hay cambios que guardar.');
  const [row] = await db`update membership_plans set ${db(patch, ...keys)} where id = ${cur.id} returning *`;
  return row;
});
