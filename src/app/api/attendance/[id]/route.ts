import { z } from 'zod';
import { isFrontDesk, route } from '@/lib/api';
import { forbidden, notFound } from '@/lib/errors';
import { attendanceSelect, type AttendanceItem } from '@/modules/attendance/server';

const Body = z.object({
  reason: z.string({ error: 'Escribe el motivo de la anulación.' }).trim().min(3, 'Escribe el motivo de la anulación.').max(300, 'Máximo 300 caracteres.'),
});

/**
 * HUE-18 · Anula una lectura de asistencia (puso el dedo dos veces, se reconoció a la persona equivocada…).
 * La lectura no se borra: queda tachada con motivo, autor y fecha, y deja de contar para horas, sesiones,
 * citas y entrada/salida. Si había consumido una sesión del paquete, se devuelve.
 * El dueño anula cualquiera; recepción solo las de pacientes (las horas del personal son del dueño).
 */
export const DELETE = route({ auth: 'user', body: Body }, async ({ db, user, params, body, system }) => {
  if (!isFrontDesk(user)) throw forbidden('Solo el dueño y recepción pueden anular asistencias.');
  if (!z.uuid().safeParse(params.id).success) throw notFound('Asistencia no encontrada.');
  // Bajo RLS: si no la puede ver, no existe.
  const [item] = await db<AttendanceItem[]>`${attendanceSelect(db)} where e.id = ${params.id}`;
  if (!item) throw notFound('Asistencia no encontrada.');
  if (user.role !== 'owner' && item.person_type === 'staff') throw forbidden('Solo el dueño puede anular asistencias del personal.');
  if (item.voided_at) return item;
  await system((tx) => tx`select void_attendance(${params.id}, ${user.id}, ${body.reason})`);
  const [updated] = await db<AttendanceItem[]>`${attendanceSelect(db)} where e.id = ${params.id}`;
  return updated ?? { ...item, voided_at: new Date(), void_reason: body.reason };
});
