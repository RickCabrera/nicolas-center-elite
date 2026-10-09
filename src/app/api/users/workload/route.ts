import { z } from 'zod';
import { route } from '@/lib/api';
import { weekRange } from '@/modules/team/server';
import type { WorkloadRow } from '@/modules/team/types';

const Query = z.object({ week_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida.').optional() });

// EQ-01 / EQ-05 · Carga de trabajo por fisioterapeuta. Mismas definiciones que Pacientes y Agenda:
// pacientes con status = 'active'; citas no canceladas contadas por día LOCAL de la clínica.
export const GET = route({ auth: 'owner', query: Query }, async ({ query, system }) =>
  system(async (tx) => {
    const [{ today }] = await tx<{ today: string }[]>`select mx_today() as today`;
    const { from, to } = weekRange(query.week_of ?? today);
    const items = await tx<WorkloadRow[]>`
      select u.id, trim(u.title || ' ' || u.full_name) as display_name, u.title, u.full_name, u.username, u.email, u.specialty,
             u.location_id, l.name as location_name, u.is_physician, u.license_number, u.active,
             u.fingerprint_enrolled_at, u.last_login_at, (u.password_hash is not null) as has_password,
             (u.password_hash is null and exists (
                select 1 from auth_tokens t where t.user_id = u.id and t.kind = 'invite' and t.used_at is null and t.expires_at > now()
             )) as invited_pending,
             (select count(*)::int from patients p where p.therapist_id = u.id and p.status = 'active') as patients_active,
             coalesce(a.today, 0) as appointments_today, coalesce(a.week, 0) as appointments_week,
             coalesce(a.attended, 0) as attended_week, coalesce(a.no_show, 0) as no_show_week,
             (select count(distinct mx_date(e.occurred_at))::int from attendance_events e
               where e.user_id = u.id and e.direction = 'in'
                 and mx_date(e.occurred_at) between ${from}::date and ${to}::date) as attendance_days_week,
             (select count(*)::int from evolution_notes n
               where n.author_id = u.id and mx_date(n.noted_at) between ${from}::date and ${to}::date) as notes_week
      from users u
      left join locations l on l.id = u.location_id
      left join lateral (
        select count(*) filter (where mx_date(ap.starts_at) = ${today}::date)::int as today,
               count(*) filter (where mx_date(ap.starts_at) between ${from}::date and ${to}::date)::int as week,
               count(*) filter (where ap.status = 'attended' and mx_date(ap.starts_at) between ${from}::date and ${to}::date)::int as attended,
               count(*) filter (where ap.status = 'no_show' and mx_date(ap.starts_at) between ${from}::date and ${to}::date)::int as no_show
        from appointments ap
        where ap.therapist_id = u.id and ap.status <> 'cancelled'
          and mx_date(ap.starts_at) between least(${today}::date, ${from}::date) and greatest(${today}::date, ${to}::date)
      ) a on true
      where u.role = 'therapist'
      order by u.active desc, norm(u.full_name)`;
    return { today, week_from: from, week_to: to, items };
  }),
);
