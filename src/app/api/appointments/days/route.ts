import { z } from 'zod';
import { route } from '@/lib/api';
import { checkRange, DateStr } from '@/modules/agenda/server';

const Query = z.object({ from: DateStr, to: DateStr, therapist_id: z.uuid().optional() });

// AGE-02 · Conteo de citas no canceladas por día LOCAL de la clínica, según lo que el usuario ve (RLS). Alimenta la tira de días.
export const GET = route({ auth: 'user', query: Query }, async ({ db, query }) => {
  checkRange(query.from, query.to);
  return db<{ date: string; count: number }[]>`
    select mx_date(starts_at) as date, count(*)::int as count
    from appointments
    where status <> 'cancelled' and mx_date(starts_at) between ${query.from}::date and ${query.to}::date
      ${query.therapist_id ? db`and therapist_id = ${query.therapist_id}` : db``}
    group by 1 order by 1`;
});
