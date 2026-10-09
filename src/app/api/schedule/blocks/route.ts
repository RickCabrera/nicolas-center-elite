import { z } from 'zod';
import { route } from '@/lib/api';
import { fmtDate, localToInstant } from '@/lib/dates';
import { badRequest, forbidden, notFound } from '@/lib/errors';
import { assertScheduleOwner, DateStr, TimeStr } from '@/modules/agenda/server';
import { NextResponse } from 'next/server';

const Query = z.object({ user_id: z.uuid().optional(), from: DateStr.optional(), to: DateStr.optional() });

// AGE-07 · Bloqueos (vacaciones, permisos…) de un usuario que tocan el rango. Sin rango: los vigentes y futuros.
export const GET = route({ auth: 'user', query: Query }, async ({ db, user, query }) => {
  const userId = query.user_id ?? (user.role === 'owner' ? null : user.id);
  if (user.role !== 'owner' && userId !== user.id) throw forbidden('Solo puedes ver tus propios bloqueos.');
  const from = query.from ? localToInstant(query.from) : null;
  const to = query.to ? localToInstant(query.to, '23:59') : null;
  return db`
    select b.id, b.user_id, trim(u.title || ' ' || u.full_name) as user_name, b.starts_at, b.ends_at, b.reason, b.created_at
    from time_blocks b join users u on u.id = b.user_id
    where true
      ${userId ? db`and b.user_id = ${userId}` : db``}
      ${from ? db`and b.ends_at > ${from}` : to ? db`` : db`and b.ends_at > now()`}
      ${to ? db`and b.starts_at <= ${to}` : db``}
    order by b.starts_at`;
});

const Body = z.object({
  user_id: z.uuid(),
  from_date: DateStr,
  from_time: TimeStr.default('00:00'),
  to_date: DateStr,
  to_time: TimeStr.default('00:00'),
  reason: z.string().trim().max(200).default(''),
  force: z.boolean().default(false),
});

// AGE-07 · Crea un bloqueo. Si dentro ya hay citas programadas responde 409 con la lista, salvo `force: true`.
export const POST = route({ auth: 'user', body: Body }, async ({ db, user, body }) => {
  assertScheduleOwner(user, body.user_id);
  const [u] = await db`select id from users where id = ${body.user_id}`;
  if (!u) throw notFound('Usuario no encontrado.');
  const starts = localToInstant(body.from_date, body.from_time);
  const ends = localToInstant(body.to_date, body.to_time);
  if (ends.getTime() <= starts.getTime()) throw badRequest('El bloqueo debe terminar después de que empieza.', { to_date: 'Debe ser posterior al inicio.' });

  if (!body.force) {
    const inside = await db<{ id: string; starts_at: Date; patient_name: string; date: string; time: string }[]>`
      select a.id, a.starts_at, coalesce(p.full_name, 'Paciente') as patient_name, mx_date(a.starts_at) as date,
             to_char(a.starts_at at time zone 'America/Mexico_City', 'HH24:MI') as time
      from appointments a left join patients p on p.id = a.patient_id
      where a.therapist_id = ${body.user_id} and a.status = 'scheduled'
        and tstzrange(a.starts_at, a.ends_at) && tstzrange(${starts}, ${ends})
      order by a.starts_at`;
    if (inside.length) {
      const shown = inside.slice(0, 5).map((a) => `${fmtDate(a.date)} ${a.time} ${a.patient_name}`).join('; ');
      const message = `Hay ${inside.length} ${inside.length === 1 ? 'cita programada' : 'citas programadas'} dentro del bloqueo: ${shown}${inside.length > 5 ? '…' : ''}. Reprográmalas o confirma el bloqueo de todos modos.`;
      return NextResponse.json({ ok: false, error: { code: 'has_appointments', message, appointments: inside } }, { status: 409 });
    }
  }
  const [row] = await db`
    insert into time_blocks (user_id, starts_at, ends_at, reason, created_by)
    values (${body.user_id}, ${starts}, ${ends}, ${body.reason}, ${user.id})
    returning id, user_id, starts_at, ends_at, reason, created_at`;
  return row;
});
