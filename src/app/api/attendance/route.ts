import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { isFrontDesk, route } from '@/lib/api';
import { badRequest, conflict, forbidden, notFound } from '@/lib/errors';
import { localToInstant, todayIso } from '@/lib/dates';
import { attendanceSelect, type AttendanceItem } from '@/modules/attendance/server';

const Query = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida.').optional(),
  location_id: z.uuid().optional(),
  role: z.enum(['all', 'patient', 'staff', 'unknown']).default('all'),
  patient_id: z.uuid().optional(),
  user_id: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

/**
 * HUE-10 / HUE-15 · Asistencias de un día (hoy por defecto) o el historial de una persona.
 * RLS: el fisioterapeuta ve las de su sede y las de sus pacientes. Los "no reconocidos" son del dueño y de recepción.
 * AUTH-10 · Recepción ve el día en vivo de todas las sedes, pero no el historial de asistencia de otra persona del
 * equipo (eso es el reporte de horas del personal, que es del dueño).
 * Cada asistencia de paciente trae `billing_state` para avisar de una membresía vencida.
 */
export const GET = route({ auth: 'user', query: Query }, async ({ db, user, query }) => {
  if (user.role === 'reception' && query.user_id && query.user_id !== user.id) {
    throw forbidden('El historial de asistencia del personal es solo para el dueño.');
  }
  const byPerson = !!(query.patient_id || query.user_id);
  const date = query.date ?? (byPerson ? null : todayIso());
  const where = db`
    where true
      ${date ? db`and mx_date(e.occurred_at) = ${date}::date` : db``}
      ${query.location_id ? db`and e.location_id = ${query.location_id}` : db``}
      ${query.role !== 'all' ? db`and e.person_type = ${query.role}` : db``}
      ${query.patient_id ? db`and e.patient_id = ${query.patient_id}` : db``}
      ${query.user_id ? db`and e.user_id = ${query.user_id}` : db``}
      ${isFrontDesk(user) ? db`` : db`and e.person_type <> 'unknown'`}`;
  const items = await db<AttendanceItem[]>`${attendanceSelect(db)} ${where} order by e.occurred_at desc, e.created_at desc limit ${query.limit}`;
  const [{ total }] = await db<{ total: number }[]>`select count(*)::int as total from attendance_events e ${where}`;
  return { date, total, items };
});

const Body = z.object({
  person_type: z.enum(['patient', 'staff']),
  person_id: z.uuid('Selecciona a la persona.'),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM).').optional(),
  reason: z.string({ error: 'Escribe el motivo del registro manual.' }).trim().min(3, 'Escribe el motivo del registro manual.').max(300),
  location_id: z.uuid().optional(),
});

/**
 * HUE-11 · Registro manual de asistencia (el lector falló, la persona no tiene huella…).
 * Motivo obligatorio y queda en la bitácora. El dueño registra a cualquiera; recepción, a cualquier paciente
 * en cualquier sede (AUTH-10); el fisioterapeuta solo a sus pacientes y solo en su sede.
 */
export const POST = route({ auth: 'user', body: Body }, async ({ db, user, body, system }) => {
  const owner = user.role === 'owner';
  const front = isFrontDesk(user);
  let location: string | null;
  if (body.person_type === 'patient') {
    const [p] = await db<{ id: string; location_id: string; status: string }[]>`select id, location_id, status from patients where id = ${body.person_id}`;
    if (!p) throw notFound('Paciente no encontrado.');
    if (p.status !== 'active') throw conflict('El paciente está dado de baja.');
    location = front ? (body.location_id ?? p.location_id) : (user.location_id ?? p.location_id);
  } else {
    if (!owner) throw forbidden('Solo el dueño puede registrar a mano la asistencia del personal.');
    const [u] = await db<{ id: string; location_id: string | null; active: boolean }[]>`select id, location_id, active from users where id = ${body.person_id}`;
    if (!u) throw notFound('Persona no encontrada.');
    if (!u.active) throw conflict('La persona está dada de baja.');
    location = body.location_id ?? u.location_id;
  }

  const at = body.time ? localToInstant(todayIso(), body.time) : new Date();
  if (at.getTime() > Date.now() + 5 * 60 * 1000) throw badRequest('La hora no puede ser futura.', { time: 'La hora no puede ser futura.' });

  const key = `manual:${randomUUID()}`;
  const [ev] = await system((tx) => tx<{ id: string; dedupe_key: string }[]>`
    select (r).id as id, (r).dedupe_key as dedupe_key from (
      select register_attendance(null, null, ${at}, 'manual', ${key}, 'manual',
        ${body.person_type === 'patient' ? body.person_id : null}, ${body.person_type === 'staff' ? body.person_id : null},
        ${location}, ${body.reason}, ${user.id}) as r) x`);
  if (ev.dedupe_key !== key) {
    throw conflict('Esa persona ya tiene una asistencia registrada a esa hora (menos de un minuto de diferencia).', 'duplicate');
  }
  // La transacción de sistema ya confirmó: se puede leer bajo RLS con los datos para la pantalla.
  const [item] = await db<AttendanceItem[]>`${attendanceSelect(db)} where e.id = ${ev.id}`;
  return item ?? { id: ev.id };
});
