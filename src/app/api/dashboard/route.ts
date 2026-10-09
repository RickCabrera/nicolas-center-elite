import { z } from 'zod';
import { route } from '@/lib/api';
import { fmtTime, longDate } from '@/lib/dates';
import { shortName } from '@/lib/format';
import { badRequest } from '@/lib/errors';

const Query = z.object({
  location_id: z.preprocess((v) => (v === '' ? undefined : v), z.uuid('Sede inválida.').optional()),
});

/**
 * DASH-01..04 · Panel de inicio en una sola lectura. Corre bajo RLS: el fisioterapeuta solo cuenta
 * sus pacientes y sus citas. Definiciones idénticas a las pantallas de detalle:
 *   · pacientes activos      → patients.status = 'active'
 *   · citas de hoy           → no canceladas, por día LOCAL de la clínica (igual que la tira de la Agenda)
 *   · mensualidades          → patient_billing.state en (por_vencer, vencido) de pacientes activos
 *   · asistencias por huella → registros de hoy de personas identificadas (pacientes y personal)
 * El filtro por sede es solo del dueño (DASH-03); el fisioterapeuta ve las asistencias de SU sede.
 */
export const GET = route({ auth: 'user', query: Query }, async ({ db, user, query }) => {
  const owner = user.role === 'owner';
  const loc = owner ? query.location_id ?? null : null;
  let location_name = owner ? null : user.location_name;
  if (loc) {
    const [l] = await db<{ name: string }[]>`select name from locations where id = ${loc}`;
    if (!l) throw badRequest('La sede no existe.', { location_id: 'La sede no existe.' });
    location_name = l.name;
  }
  const [{ today }] = await db<{ today: string }[]>`select mx_today() as today`;

  const pLoc = loc ? db`and p.location_id = ${loc}` : db``;
  const aLoc = loc ? db`and a.location_id = ${loc}` : db``;
  const attLoc = owner ? (loc ? db`and e.location_id = ${loc}` : db``)
    : user.location_id ? db`and e.location_id = ${user.location_id}` : db``;

  const [stats] = await db<{ patients_active: number; appointments_today: number; due: number; attendance_today: number }[]>`
    select
      (select count(*)::int from patients p where p.status = 'active' ${pLoc}) as patients_active,
      (select count(*)::int from appointments a
        where a.status <> 'cancelled' and mx_date(a.starts_at) = ${today}::date ${aLoc}) as appointments_today,
      (select count(*)::int from patients p join patient_billing b on b.patient_id = p.id
        where p.status = 'active' and b.state in ('por_vencer', 'vencido') ${pLoc}) as due,
      (select count(*)::int from attendance_events e
        where mx_date(e.occurred_at) = ${today}::date and e.person_type <> 'unknown' ${attLoc}) as attendance_today`;

  const appts = await db<{ id: string; starts_at: Date; patient_id: string; patient_name: string; type_name: string; therapist: string; status: 'scheduled' | 'attended' | 'no_show' }[]>`
    select a.id, a.starts_at, a.patient_id, p.full_name as patient_name, a.type_name,
           trim(u.title || ' ' || u.full_name) as therapist, a.status
    from appointments a
    join patients p on p.id = a.patient_id
    join users u on u.id = a.therapist_id
    where a.status <> 'cancelled' and mx_date(a.starts_at) = ${today}::date ${aLoc}
    order by a.starts_at, p.full_name limit 6`;

  const attendance = await db<{ id: string; person_name: string; person_type: 'patient' | 'staff'; patient_id: string | null; location_name: string; occurred_at: Date; direction: 'in' | 'out' }[]>`
    select e.id, e.person_name, e.person_type, e.patient_id, l.name as location_name, e.occurred_at, e.direction
    from attendance_events e join locations l on l.id = e.location_id
    where mx_date(e.occurred_at) = ${today}::date and e.person_type <> 'unknown' ${attLoc}
    order by e.occurred_at desc limit 5`;

  // Los pagos son del dueño: el fisioterapeuta recibe solo el conteo de SUS pacientes, sin el detalle.
  const due_payments = owner
    ? await db`
        select p.id as patient_id, p.full_name, b.plan_name, b.next_due_date, b.state
        from patients p join patient_billing b on b.patient_id = p.id
        where p.status = 'active' and b.state in ('por_vencer', 'vencido') ${pLoc}
        order by (b.state = 'vencido') desc, b.next_due_date, norm(p.full_name) limit 6`
    : undefined;

  return {
    today,
    date_label: longDate(today),
    location_id: owner ? loc : user.location_id,
    location_name,
    stats,
    today_appointments: appts.map(({ therapist, ...a }) => ({ ...a, time: fmtTime(a.starts_at), therapist_name: shortName(therapist) })),
    recent_attendance: attendance.map((e) => ({
      ...e, time: fmtTime(e.occurred_at), role_label: e.person_type === 'patient' ? 'Paciente' : 'Fisioterapeuta',
    })),
    ...(owner ? { due_payments } : {}),
  };
});
