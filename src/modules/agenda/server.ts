import { z } from 'zod';
import { errorResponse, isFrontDesk } from '@/lib/api';
import type { SessionUser } from '@/lib/auth/session';
import type { Tx } from '@/lib/db';
import { addDays, localToInstant, parseDateInput, todayIso, weekday } from '@/lib/dates';
import { badRequest, conflict, forbidden, notFound } from '@/lib/errors';

/** Lógica de servidor de la agenda, compartida por las rutas de /api/appointments y /api/schedule. */

export const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida.').refine((s) => parseDateInput(s) !== null, 'Fecha inválida.');
export const TimeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida.');
export const Duration = z.coerce.number().int('Duración inválida.').min(5, 'La duración mínima es de 5 minutos.').max(480, 'La duración máxima es de 8 horas.');
export const TypeName = z.string().trim().min(1, 'Elige el tipo de sesión.').max(80);
export const Notes = z.string().trim().max(1000, 'Máximo 1000 caracteres.');

export const MAX_RANGE_DAYS = 62;
export const MAX_SERIES = 60;

export type AppointmentRow = {
  id: string; patient_id: string; therapist_id: string; location_id: string;
  starts_at: Date; ends_at: Date; duration_min: number; type_name: string; notes: string;
  status: 'scheduled' | 'attended' | 'no_show' | 'cancelled';
  cancel_reason: string | null; cancelled_at: Date | null; attended_at: Date | null; series_id: string | null;
  patient_name: string; therapist_name: string; therapist_short: string; location_name: string;
  date: string; time: string; has_note: boolean;
};

/** Columnas con las que la API devuelve una cita (AGE-01). Incluye el FROM: `select ${apptSelect(db)} where …`. */
export const apptSelect = (db: Tx) => db`
  a.id, a.patient_id, a.therapist_id, a.location_id, a.starts_at, a.ends_at, a.duration_min, a.type_name, a.notes,
  a.status, a.cancel_reason, a.cancelled_at, a.attended_at, a.series_id,
  coalesce(p.full_name, 'Paciente') as patient_name,
  trim(u.title || ' ' || u.full_name) as therapist_name,
  split_part(u.full_name, ' ', 1) as therapist_short,
  l.name as location_name,
  mx_date(a.starts_at) as date,
  to_char(a.starts_at at time zone 'America/Mexico_City', 'HH24:MI') as time,
  exists (select 1 from evolution_notes n where n.appointment_id = a.id) as has_note
  from appointments a
  left join patients p on p.id = a.patient_id
  join users u on u.id = a.therapist_id
  join locations l on l.id = a.location_id`;

export async function getAppointment(db: Tx, id: string): Promise<AppointmentRow> {
  if (!z.uuid().safeParse(id).success) throw notFound('Cita no encontrada.');
  const [row] = await db<AppointmentRow[]>`select ${apptSelect(db)} where a.id = ${id}`;   // RLS: si no es suya, no existe
  if (!row) throw notFound('Cita no encontrada.');
  return row;
}

/** Valida el rango ?from=&to= (máximo 62 días). */
export function checkRange(from: string, to: string) {
  if (to < from) throw badRequest('El rango de fechas está invertido.', { to: 'Debe ser igual o posterior al inicio.' });
  if (addDays(from, MAX_RANGE_DAYS - 1) < to) throw badRequest(`El rango máximo es de ${MAX_RANGE_DAYS} días.`, { to: `Máximo ${MAX_RANGE_DAYS} días.` });
}

type Who = { patient_id: string; therapist_id: string; location_id: string };

/**
 * Resuelve paciente, fisioterapeuta y sede de una cita (AGE-01).
 * El fisioterapeuta siempre agenda a su nombre, aunque el cliente mande otro; el dueño y recepción eligen
 * (por defecto, el asignado al paciente) (AUTH-10).
 */
export async function resolveWho(db: Tx, user: SessionUser, patientId: string, therapistId?: string | null): Promise<Who> {
  const [p] = await db<{ id: string; therapist_id: string; location_id: string; status: string }[]>`
    select id, therapist_id, location_id, status from patients where id = ${patientId}`;      // RLS: ajeno = no existe
  if (!p) throw notFound('Paciente no encontrado.');
  if (p.status !== 'active') throw badRequest('El paciente está dado de baja: reactívalo para agendarle.', { patient_id: 'Paciente dado de baja.' });
  const tid = isFrontDesk(user) ? (therapistId || p.therapist_id) : user.id;
  const [t] = await db<{ id: string; location_id: string | null; active: boolean; role: string }[]>`
    select id, location_id, active, role from users where id = ${tid}`;
  if (!t || t.role === 'reception') throw badRequest('Fisioterapeuta no encontrado.', { therapist_id: 'Fisioterapeuta no encontrado.' });
  if (!t.active) throw badRequest('Ese fisioterapeuta está desactivado.', { therapist_id: 'Fisioterapeuta desactivado.' });
  return { patient_id: p.id, therapist_id: t.id, location_id: t.location_id ?? p.location_id };
}

/** Una cita en el pasado solo se captura si es de hoy, o si la captura el dueño (retroactivo). */
export function checkNotPast(user: SessionUser, date: string, starts: Date) {
  if (starts.getTime() >= Date.now()) return;
  if (date === todayIso() || user.role === 'owner') return;
  throw badRequest('No se puede agendar en una fecha pasada.', { date: 'La fecha ya pasó.' });
}

/** Horario laboral y bloqueos (AGE-07): devuelve el motivo o null. Los empalmes los impide la base. */
export async function slotProblem(db: Tx, therapistId: string, starts: Date, duration: number): Promise<string | null> {
  const [r] = await db<{ problem: string | null }[]>`select appointment_slot_problem(${therapistId}, ${starts}, ${duration}) as problem`;
  return r?.problem ?? null;
}

export async function assertSlot(db: Tx, therapistId: string, starts: Date, duration: number) {
  const problem = await slotProblem(db, therapistId, starts, duration);
  if (problem) throw conflict(problem, 'outside_hours');
}

export type NewAppt = Who & { starts_at: Date; duration_min: number; type_name: string; notes: string; series_id?: string | null };

export async function insertAppointment(db: Tx, user: SessionUser, a: NewAppt): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    insert into appointments (patient_id, therapist_id, location_id, starts_at, ends_at, duration_min, type_name, notes, series_id, created_by)
    values (${a.patient_id}, ${a.therapist_id}, ${a.location_id}, ${a.starts_at}, ${a.starts_at}, ${a.duration_min},
            ${a.type_name}, ${a.notes}, ${a.series_id ?? null}, ${user.id})
    returning id`;
  return row.id;
}

/** Fechas de una serie (AGE-08): los días de la semana elegidos durante N semanas a partir de la fecha inicial. */
export function seriesDates(start: string, weekdays: number[], weeks: number): string[] {
  const set = new Set(weekdays);
  const out: string[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i);
    if (set.has(weekday(d))) out.push(d);
  }
  return out;
}

export type SeriesConflict = { date: string; time: string; reason: string };

/**
 * Inserta cada cita de la serie en su propio SAVEPOINT: la que choca (empalme, fuera de horario, bloqueo)
 * se reporta y no impide las demás.
 */
export async function insertSeries(db: Tx, user: SessionUser, base: Omit<NewAppt, 'starts_at'>, dates: string[], time: string) {
  const [{ id: seriesId }] = await db<{ id: string }[]>`select gen_random_uuid() as id`;
  const created: string[] = [];
  const conflicts: SeriesConflict[] = [];
  for (const date of dates) {
    const starts = localToInstant(date, time);
    const problem = await slotProblem(db, base.therapist_id, starts, base.duration_min);
    if (problem) { conflicts.push({ date, time, reason: problem }); continue; }
    try {
      const id = await db.savepoint((sp) => insertAppointment(sp as unknown as Tx, user, { ...base, starts_at: starts, series_id: seriesId })) as string;
      created.push(id);
    } catch (e) {
      if ((e as { code?: string })?.code !== '23P01') throw e;
      const j = (await errorResponse(e).json()) as { error: { message: string } };
      conflicts.push({ date, time, reason: j.error.message });
    }
  }
  return { series_id: seriesId, created, conflicts };
}

/** Permiso sobre el horario/bloqueos de un usuario: el dueño cualquiera; el fisioterapeuta solo el suyo. Recepción, ninguno (la ruta ya respondió 403). */
export function assertScheduleOwner(user: SessionUser, userId: string) {
  if (user.role !== 'owner' && userId !== user.id) throw forbidden('Solo puedes modificar tu propio horario.');
}
