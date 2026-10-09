import { z } from 'zod';
import { route } from '@/lib/api';
import { logEvent } from '@/lib/audit';
import { badRequest } from '@/lib/errors';
import { addDays, fmtDate, fmtDateTime, todayIso } from '@/lib/dates';
import { buildStaffReport, csvLine, fmtMinutes, weekStart, type StaffReading } from '@/modules/attendance/hours';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida.');
const Query = z.object({
  from: day.optional(),
  to: day.optional(),
  location_id: z.uuid().optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

type PatientRow = { patient_id: string; person_name: string; record_number: string; location_name: string; visits: number; days: number; first_at: Date; last_at: Date };

/**
 * HUE-12 · Reporte de asistencia (solo dueño).
 *  · Personal: por persona y día, primera entrada, última salida y horas trabajadas (pares entrada→salida;
 *    un día con entrada sin salida sale como "incompleto" y esa entrada no suma), con total por semana.
 *  · Pacientes: asistencias por paciente en el periodo.
 * `format=csv` descarga el mismo contenido en CSV UTF-8 con BOM (abre bien en Excel).
 */
export const GET = route({ auth: 'owner', query: Query }, async ({ db, query }) => {
  const monday = weekStart(todayIso());
  const from = query.from ?? monday;
  const to = query.to ?? addDays(from, 6);
  if (from > to) throw badRequest('La fecha inicial no puede ser posterior a la final.', { from: 'Revisa el rango.' });
  if (addDays(from, 370) < to) throw badRequest('El rango máximo es de un año.', { to: 'El rango máximo es de un año.' });
  const loc = query.location_id ? db`and e.location_id = ${query.location_id}` : db``;

  const readings = await db<StaffReading[]>`
    select e.user_id, trim(u.title || ' ' || u.full_name) as person_name, coalesce(ul.name, l.name) as location_name,
           e.occurred_at, e.direction
    from attendance_events e
    join users u on u.id = e.user_id
    join locations l on l.id = e.location_id
    left join locations ul on ul.id = u.location_id
    where e.person_type = 'staff' and mx_date(e.occurred_at) between ${from}::date and ${to}::date ${loc}
    order by e.occurred_at`;
  const staff = buildStaffReport(readings);

  const patients = await db<PatientRow[]>`
    select e.patient_id, p.full_name as person_name, p.record_number, l.name as location_name,
           count(*) filter (where e.direction = 'in')::int as visits,
           count(distinct mx_date(e.occurred_at))::int as days,
           min(e.occurred_at) as first_at, max(e.occurred_at) as last_at
    from attendance_events e
    join patients p on p.id = e.patient_id
    join locations l on l.id = p.location_id
    where e.person_type = 'patient' and mx_date(e.occurred_at) between ${from}::date and ${to}::date ${loc}
    group by e.patient_id, p.full_name, p.record_number, l.name
    order by visits desc, p.full_name`;

  if (query.format === 'json') {
    return {
      from, to, location_id: query.location_id ?? null, staff, patients,
      totals: {
        staff_minutes: staff.reduce((s, r) => s + r.total_minutes, 0),
        incomplete_days: staff.reduce((s, r) => s + r.incomplete_days, 0),
        patient_visits: patients.reduce((s, r) => s + r.visits, 0),
      },
    };
  }

  // HUE-12 · CSV
  const lines: string[] = [];
  lines.push(csvLine(['Reporte de asistencia', `${fmtDate(from)} a ${fmtDate(to)}`]));
  lines.push('');
  lines.push(csvLine(['PERSONAL · HORAS POR DÍA']));
  lines.push(csvLine(['Persona', 'Sede', 'Fecha', 'Primera entrada', 'Última salida', 'Horas trabajadas', 'Minutos', 'Estado']));
  for (const s of staff) {
    for (const d of s.days) {
      lines.push(csvLine([s.person_name, s.location_name, fmtDate(d.date), d.first_in ?? '', d.last_out ?? '', fmtMinutes(d.minutes), d.minutes, d.incomplete ? 'Incompleto' : 'Completo']));
    }
  }
  lines.push('');
  lines.push(csvLine(['PERSONAL · TOTAL POR SEMANA']));
  lines.push(csvLine(['Persona', 'Sede', 'Semana del', 'Horas trabajadas', 'Minutos', 'Días incompletos']));
  for (const s of staff) {
    for (const w of s.weeks) lines.push(csvLine([s.person_name, s.location_name, fmtDate(w.week_start), fmtMinutes(w.minutes), w.minutes, w.incomplete_days]));
  }
  lines.push('');
  lines.push(csvLine(['PACIENTES · ASISTENCIAS EN EL PERIODO']));
  lines.push(csvLine(['Paciente', 'Expediente', 'Sede', 'Asistencias', 'Días con asistencia', 'Primera', 'Última']));
  for (const p of patients) {
    lines.push(csvLine([p.person_name, p.record_number, p.location_name, p.visits, p.days, fmtDateTime(p.first_at), fmtDateTime(p.last_at)]));
  }
  await logEvent(db, 'export', `Exportó el reporte de asistencia del ${fmtDate(from)} al ${fmtDate(to)}.`, { table: 'attendance_events' });
  return new Response('﻿' + lines.join('\r\n') + '\r\n', {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="asistencia_${from}_a_${to}.csv"`,
      'cache-control': 'no-store',
    },
  });
});
