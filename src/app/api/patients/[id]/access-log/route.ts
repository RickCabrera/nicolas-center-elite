import { paging, route } from '@/lib/api';
import { requirePatient } from '@/modules/record/server';

// EXP-08 · Quién abrió o modificó el expediente de este paciente (solo el dueño), del más reciente al más antiguo.
export const GET = route({ auth: 'owner' }, async ({ db, params, query }) => {
  const patient = await requirePatient(db, params.id);
  const { limit, offset } = paging(query, 200, 50);
  const [{ total }] = await db<{ total: number }[]>`select count(*)::int as total from audit_log where patient_id = ${patient.id}`;
  const items = await db`
    select id::text as id, action, at, actor_name, table_name, summary,
           case when action = 'insert' and table_name = 'evolution_notes' then (after ->> 'addendum_of') is not null else false end as is_addendum,
           case when action = 'insert' and table_name = 'consents' then after ->> 'kind' end as consent_kind
    from audit_log where patient_id = ${patient.id}
    order by at desc, id desc
    limit ${limit} offset ${offset}`;
  return { items, total, limit, offset };
});
