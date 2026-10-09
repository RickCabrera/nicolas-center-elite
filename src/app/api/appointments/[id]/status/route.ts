import { z } from 'zod';
import { route } from '@/lib/api';
import { todayIso } from '@/lib/dates';
import { badRequest, conflict } from '@/lib/errors';
import { getAppointment } from '@/modules/agenda/server';

const Body = z.object({ status: z.enum(['attended', 'no_show', 'scheduled'], 'Estado no válido.') });

// AGE-05 · Marca manual: asistió / no asistió / deshacer. (La marca por huella la hace register_attendance en la base.)
export const POST = route({ auth: 'user', body: Body }, async ({ db, params, body }) => {
  const cur = await getAppointment(db, params.id);
  if (cur.status === 'cancelled') throw conflict('La cita está cancelada: no se puede cambiar su estado.', 'cancelled');
  if (body.status !== 'scheduled' && cur.date > todayIso()) {
    throw badRequest('La cita aún no ocurre: no se puede marcar asistencia por adelantado.');
  }
  if (body.status === 'attended') {
    await db`update appointments set status = 'attended', attended_at = coalesce(attended_at, now()) where id = ${cur.id}`;
  } else {
    await db`update appointments set status = ${body.status}, attended_at = null where id = ${cur.id}`;
  }
  return getAppointment(db, cur.id);
});
