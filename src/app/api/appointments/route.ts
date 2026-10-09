import { z } from 'zod';
import { route } from '@/lib/api';
import { localToInstant } from '@/lib/dates';
import { badRequest, conflict } from '@/lib/errors';
import {
  apptSelect, assertSlot, checkNotPast, checkRange, DateStr, Duration, insertAppointment, insertSeries, MAX_SERIES, Notes,
  resolveWho, seriesDates, TimeStr, TypeName, type AppointmentRow,
} from '@/modules/agenda/server';

const Query = z.object({
  from: DateStr,
  to: DateStr,
  therapist_id: z.uuid().optional(),
  patient_id: z.uuid().optional(),
  status: z.enum(['scheduled', 'attended', 'no_show', 'cancelled']).optional(),
  include_cancelled: z.enum(['0', '1']).optional(),
});

// AGE-01 / AGE-02 · Citas del rango, ordenadas por hora. RLS: el fisioterapeuta solo recibe las suyas.
export const GET = route({ auth: 'user', query: Query }, async ({ db, query }) => {
  checkRange(query.from, query.to);
  const withCancelled = query.include_cancelled === '1' || query.status === 'cancelled';
  return db<AppointmentRow[]>`
    select ${apptSelect(db)}
    where mx_date(a.starts_at) between ${query.from}::date and ${query.to}::date
      ${query.therapist_id ? db`and a.therapist_id = ${query.therapist_id}` : db``}
      ${query.patient_id ? db`and a.patient_id = ${query.patient_id}` : db``}
      ${query.status ? db`and a.status = ${query.status}` : db``}
      ${withCancelled ? db`` : db`and a.status <> 'cancelled'`}
    order by a.starts_at, a.created_at`;
});

const Body = z.object({
  patient_id: z.uuid('Selecciona un paciente.'),
  therapist_id: z.uuid().nullish(),
  date: DateStr,
  time: TimeStr,
  duration_min: Duration,
  type_name: TypeName,
  notes: Notes.default(''),
  // AGE-08 · Repetir: días de la semana (0 = domingo … 6 = sábado) durante N semanas.
  repeat: z.object({
    weekdays: z.array(z.number().int().min(0).max(6)).min(1, 'Elige al menos un día de la semana.').max(7),
    weeks: z.number().int().min(1, 'Mínimo 1 semana.').max(12, 'Máximo 12 semanas.'),
  }).nullish(),
});

// AGE-01 · Agenda una cita. Los empalmes los rechaza la base (23P01 → 409 overlap);
// aquí se valida antes el horario laboral y los bloqueos (409 outside_hours).
// AGE-08 · Con `repeat` crea la serie y devuelve { series_id, created, conflicts }.
export const POST = route({ auth: 'user', body: Body }, async ({ db, user, body }) => {
  const who = await resolveWho(db, user, body.patient_id, body.therapist_id);
  const base = { ...who, duration_min: body.duration_min, type_name: body.type_name, notes: body.notes };

  if (body.repeat) {
    const dates = seriesDates(body.date, body.repeat.weekdays, body.repeat.weeks);
    if (dates.length === 0) throw badRequest('Ningún día de la serie cae en los días elegidos.', { repeat: 'Elige al menos un día de la semana.' });
    if (dates.length > MAX_SERIES) throw badRequest(`Una serie admite máximo ${MAX_SERIES} citas; esta tendría ${dates.length}.`, { repeat: `Máximo ${MAX_SERIES} citas por serie.` });
    checkNotPast(user, dates[0], localToInstant(dates[0], body.time));
    const r = await insertSeries(db, user, base, dates, body.time);
    if (r.created.length === 0) {
      throw conflict(`No se pudo agendar ninguna cita de la serie: ${r.conflicts[0].reason}`, 'overlap');
    }
    const created = await db<AppointmentRow[]>`select ${apptSelect(db)} where a.id = any(${r.created}::uuid[]) order by a.starts_at`;
    return { series_id: r.series_id, created, conflicts: r.conflicts };
  }

  const starts = localToInstant(body.date, body.time);
  checkNotPast(user, body.date, starts);
  await assertSlot(db, who.therapist_id, starts, body.duration_min);
  const id = await insertAppointment(db, user, { ...base, starts_at: starts });
  const [row] = await db<AppointmentRow[]>`select ${apptSelect(db)} where a.id = ${id}`;
  return row;
});
