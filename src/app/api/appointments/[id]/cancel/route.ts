import { z } from 'zod';
import { route } from '@/lib/api';
import { conflict } from '@/lib/errors';
import { getAppointment } from '@/modules/agenda/server';

const Body = z.object({
  reason: z.string({ error: 'Escribe el motivo de la cancelación.' }).trim().min(3, 'Escribe el motivo de la cancelación.').max(300),
  /** 'following': cancela también las siguientes citas programadas de la misma serie (AGE-08). */
  scope: z.enum(['one', 'following']).default('one'),
});

// AGE-04 · Cancelar con motivo. La cita no se borra: queda en el historial como cancelada y libera el horario.
export const POST = route({ auth: 'user', body: Body }, async ({ db, params, body }) => {
  const cur = await getAppointment(db, params.id);
  if (cur.status === 'cancelled') throw conflict('La cita ya estaba cancelada.', 'already_cancelled');
  if (cur.status !== 'scheduled') throw conflict('Solo se puede cancelar una cita programada.', 'not_scheduled');

  const following = body.scope === 'following' && cur.series_id;
  const rows = await db<{ id: string }[]>`
    update appointments set status = 'cancelled', cancel_reason = ${body.reason}, cancelled_at = now()
    where status = 'scheduled'
      and (id = ${cur.id} ${following ? db`or (series_id = ${cur.series_id} and starts_at >= ${cur.starts_at})` : db``})
    returning id`;
  return { appointment: await getAppointment(db, cur.id), cancelled: rows.length };
});
