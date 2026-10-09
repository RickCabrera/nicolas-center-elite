import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { route } from '@/lib/api';
import { simulatorEnabled } from '@/lib/env';
import { conflict, notFound } from '@/lib/errors';
import { attendanceSelect, type AttendanceItem } from '@/modules/attendance/server';

const Body = z.object({ patient_id: z.uuid().optional() });

/**
 * HUE-14 · Simulador de lectura para demostraciones y pruebas. NO existe en producción: si
 * `simulatorEnabled()` es falso la ruta responde 404 como cualquier ruta inexistente.
 */
export const POST = route({ auth: 'user', body: Body }, async ({ db, body, system }) => {
  if (!simulatorEnabled()) throw notFound();
  const [p] = body.patient_id
    ? await db<{ id: string; location_id: string }[]>`select id, location_id from patients where id = ${body.patient_id} and status = 'active'`
    : await db<{ id: string; location_id: string }[]>`select id, location_id from patients where status = 'active' order by random() limit 1`;
  if (!p) {
    if (body.patient_id) throw notFound('Paciente no encontrado.');
    throw conflict('No hay pacientes activos para simular una lectura.');
  }
  const [ev] = await system((tx) => tx<{ id: string }[]>`
    select (r).id as id from (
      select register_attendance(null, null, now(), 'simulator', ${`sim:${randomUUID()}`}, 'simulator', ${p.id}, null, ${p.location_id}, null, null) as r) x`);
  const [item] = await db<AttendanceItem[]>`${attendanceSelect(db)} where e.id = ${ev.id}`;
  return item;
});
