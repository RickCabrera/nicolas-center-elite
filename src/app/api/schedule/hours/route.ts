import { z } from 'zod';
import { route } from '@/lib/api';
import type { Tx } from '@/lib/db';
import { badRequest, notFound } from '@/lib/errors';
import { weekdayLong } from '@/lib/dates';
import { assertScheduleOwner, TimeStr } from '@/modules/agenda/server';

type HourRow = { weekday: number; start_time: string; end_time: string };

const list = (db: Tx, userId: string) => db<HourRow[]>`
  select weekday, to_char(start_time, 'HH24:MI') as start_time, to_char(end_time, 'HH24:MI') as end_time
  from therapist_hours where user_id = ${userId} order by weekday, start_time`;

const Query = z.object({ user_id: z.uuid().optional() });

// AGE-07 · Horario laboral de un usuario (por defecto, el propio). Sin filas = la agenda no restringe.
export const GET = route({ auth: 'user', query: Query }, async ({ db, user, query }) => list(db, query.user_id ?? user.id));

const Body = z.object({
  user_id: z.uuid(),
  hours: z.array(z.object({ weekday: z.number().int().min(0).max(6), start_time: TimeStr, end_time: TimeStr })).max(28),
});

// AGE-07 · Reemplaza el horario completo. El dueño edita el de cualquiera; el fisioterapeuta solo el suyo.
export const PUT = route({ auth: 'user', body: Body }, async ({ db, user, body }) => {
  assertScheduleOwner(user, body.user_id);
  const [u] = await db`select id from users where id = ${body.user_id}`;
  if (!u) throw notFound('Usuario no encontrado.');

  const byDay = new Map<number, { start_time: string; end_time: string }[]>();
  for (const h of body.hours) {
    if (h.end_time <= h.start_time) throw badRequest(`${weekdayLong(h.weekday)}: la hora de fin debe ser posterior a la de inicio.`);
    byDay.set(h.weekday, [...(byDay.get(h.weekday) ?? []), h]);
  }
  for (const [day, spans] of byDay) {
    spans.sort((a, b) => a.start_time.localeCompare(b.start_time));
    for (let i = 1; i < spans.length; i++) {
      if (spans[i].start_time < spans[i - 1].end_time) throw badRequest(`${weekdayLong(day)}: los tramos del horario se traslapan.`);
    }
  }

  await db`delete from therapist_hours where user_id = ${body.user_id}`;       // configuración, no dato clínico
  if (body.hours.length) {
    const rows = body.hours.map((h) => ({ user_id: body.user_id, weekday: h.weekday, start_time: h.start_time, end_time: h.end_time }));
    await db`insert into therapist_hours ${db(rows, 'user_id', 'weekday', 'start_time', 'end_time')}`;
  }
  return list(db, body.user_id);
});
