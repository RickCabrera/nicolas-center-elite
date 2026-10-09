import { z } from 'zod';
import { isFrontDesk, route } from '@/lib/api';
import { localToInstant } from '@/lib/dates';
import { badRequest, conflict } from '@/lib/errors';
import { assertSlot, checkNotPast, DateStr, Duration, getAppointment, Notes, TimeStr, TypeName } from '@/modules/agenda/server';

// AGE-04 · Detalle de una cita.
export const GET = route({ auth: 'user' }, async ({ db, params }) => getAppointment(db, params.id));

const Body = z.object({
  date: DateStr.optional(),
  time: TimeStr.optional(),
  duration_min: Duration.optional(),
  type_name: TypeName.optional(),
  notes: Notes.optional(),
  therapist_id: z.uuid().optional(),
});

// AGE-04 · Reprogramar / editar. Solo citas programadas; mismas validaciones que al crear.
export const PATCH = route({ auth: 'user', body: Body }, async ({ db, user, params, body }) => {
  const cur = await getAppointment(db, params.id);
  if (cur.status !== 'scheduled') throw conflict('Solo se puede editar una cita programada.', 'not_scheduled');

  const date = body.date ?? cur.date;
  const time = body.time ?? cur.time;
  const duration = body.duration_min ?? cur.duration_min;
  const starts = localToInstant(date, time);

  // Solo el dueño y recepción cambian de fisioterapeuta; lo que mande un fisioterapeuta se ignora.
  let therapistId = cur.therapist_id;
  let locationId = cur.location_id;
  if (isFrontDesk(user) && body.therapist_id && body.therapist_id !== cur.therapist_id) {
    const [t] = await db<{ id: string; location_id: string | null; active: boolean; role: string }[]>`
      select id, location_id, active, role from users where id = ${body.therapist_id}`;
    if (!t || !t.active || t.role === 'reception') throw badRequest('Ese fisioterapeuta no está disponible.', { therapist_id: 'Fisioterapeuta no disponible.' });
    therapistId = t.id;
    locationId = t.location_id ?? cur.location_id;
  }

  const moved = starts.getTime() !== new Date(cur.starts_at).getTime() || duration !== cur.duration_min || therapistId !== cur.therapist_id;
  if (moved) {
    if (starts.getTime() !== new Date(cur.starts_at).getTime()) checkNotPast(user, date, starts);
    await assertSlot(db, therapistId, starts, duration);
  }

  await db`
    update appointments set starts_at = ${starts}, duration_min = ${duration}, therapist_id = ${therapistId}, location_id = ${locationId},
           type_name = ${body.type_name ?? cur.type_name}, notes = ${body.notes ?? cur.notes}
    where id = ${cur.id}`;                                   // empalme → 23P01 → 409 overlap
  return getAppointment(db, cur.id);
});
