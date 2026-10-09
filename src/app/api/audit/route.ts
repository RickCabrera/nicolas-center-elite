import { z } from 'zod';
import { paging, route } from '@/lib/api';
import { notFound } from '@/lib/errors';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida.');
const Q = z.object({
  id: z.string().regex(/^\d+$/).optional(),
  facets: z.string().optional(),
  from: day.optional(),
  to: day.optional(),
  actor_id: z.union([z.uuid(), z.literal('system')]).optional(),
  action: z.string().trim().max(40).optional(),
  table: z.string().trim().max(60).optional(),
  patient_id: z.uuid().optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
});

// Campos que cambian solos en cada guardado: no dicen nada a quien lee la bitácora.
const NOISE = ['updated_at'];

/**
 * CFG-09 · Bitácora de auditoría (solo dueño; además RLS la cierra a cualquier otro rol).
 *   · lista: { items, total } con `changed` = campos que cambiaron entre before y after
 *   · ?id=N: un evento con su before/after completo
 *   · ?facets=1: valores disponibles para los filtros (quién, acción, tabla)
 */
export const GET = route({ auth: 'owner', query: Q }, async ({ db, query }) => {
  if (query.id) {
    const [ev] = await db`
      select a.id::text as id, a.at, a.actor_id, a.actor_name, a.action, a.table_name, a.row_id, a.patient_id,
             p.full_name as patient_name, a.summary, a.before, a.after
      from audit_log a left join patients p on p.id = a.patient_id
      where a.id = ${query.id}::bigint`;
    if (!ev) throw notFound('Evento no encontrado.');
    return ev;
  }

  if (query.facets) {
    const actors = await db`
      select coalesce(actor_id::text, 'system') as id, max(actor_name) as name
      from audit_log group by actor_id order by 2`;
    const actions = await db<{ action: string }[]>`select distinct action from audit_log order by 1`;
    const tables = await db<{ table_name: string }[]>`select distinct table_name from audit_log where table_name <> '' order by 1`;
    return { actors, actions: actions.map((a) => a.action), tables: tables.map((t) => t.table_name) };
  }

  const { limit, offset } = paging(query, 200, 50);
  // El rango es en días de la clínica (America/Mexico_City), no en UTC.
  const where = db`
    where true
    ${query.from ? db`and a.at >= (${query.from}::date)::timestamp at time zone 'America/Mexico_City'` : db``}
    ${query.to ? db`and a.at < (${query.to}::date + 1)::timestamp at time zone 'America/Mexico_City'` : db``}
    ${query.actor_id === 'system' ? db`and a.actor_id is null` : query.actor_id ? db`and a.actor_id = ${query.actor_id}` : db``}
    ${query.action ? db`and a.action = ${query.action}` : db``}
    ${query.table ? db`and a.table_name = ${query.table}` : db``}
    ${query.patient_id ? db`and a.patient_id = ${query.patient_id}` : db``}
    ${query.q ? db`and norm(a.actor_name || ' ' || a.summary || ' ' || coalesce(p.full_name, '') || ' ' || coalesce(a.row_id, '') || ' ' ||
                          coalesce(a.after ->> 'full_name', a.after ->> 'name', a.after ->> 'folio', a.after ->> 'receipt_number', a.before ->> 'full_name', a.before ->> 'name', ''))
                     like '%' || norm(${query.q}) || '%'` : db``}`;

  const [{ total }] = await db<{ total: number }[]>`
    select count(*)::int as total from audit_log a left join patients p on p.id = a.patient_id ${where}`;
  const items = await db`
    select a.id::text as id, a.at, a.actor_id, a.actor_name, a.action, a.table_name, a.row_id, a.patient_id,
           p.full_name as patient_name, a.summary,
           coalesce(a.after ->> 'full_name', a.after ->> 'name', a.after ->> 'folio', a.after ->> 'receipt_number', a.after ->> 'title',
                    a.after ->> 'requester_name', a.before ->> 'full_name', a.before ->> 'name', a.before ->> 'folio',
                    a.before ->> 'receipt_number', a.before ->> 'title') as row_label,
           case when a.action = 'update' and a.before is not null and a.after is not null then
             (select coalesce(array_agg(k order by k), '{}')
                from jsonb_object_keys(a.before || a.after) k
               where (a.before -> k) is distinct from (a.after -> k) and k <> all(${NOISE}::text[]))
           else '{}'::text[] end as changed
    from audit_log a left join patients p on p.id = a.patient_id
    ${where}
    order by a.at desc, a.id desc
    limit ${limit} offset ${offset}`;
  return { items, total };
});
