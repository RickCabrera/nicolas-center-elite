import { z } from 'zod';
import { route } from '@/lib/api';
import { notFound } from '@/lib/errors';
import { translateDeviceError } from '@/modules/attendance/server';

type Row = {
  id: string; kind: string; status: 'pending' | 'running' | 'done' | 'error' | 'cancelled';
  result: Record<string, unknown> | null; error: string | null; created_by: string | null;
  created_at: Date; started_at: Date | null; finished_at: Date | null;
  device_id: string; device_name: string; bridge_online: boolean;
};

const Params = z.uuid();

async function load(system: <T>(fn: (tx: import('@/lib/db').Tx) => Promise<T>) => Promise<T>, id: string, user: { id: string; role: string }) {
  if (!Params.safeParse(id).success) throw notFound('Orden no encontrada.');
  const [c] = await system((tx) => tx<Row[]>`
    select c.id, c.kind, c.status, c.result, c.error, c.created_by, c.created_at, c.started_at, c.finished_at,
           d.id as device_id, d.name as device_name, coalesce(d.bridge_seen_at > now() - interval '90 seconds', false) as bridge_online
    from device_commands c join devices d on d.id = c.device_id where c.id = ${id}`);
  // Solo quien la creó o el dueño; para los demás la orden no existe.
  if (!c || (user.role !== 'owner' && c.created_by !== user.id)) throw notFound('Orden no encontrada.');
  return c;
}

/**
 * HUE-06 / HUE-07 · Estado de una orden enviada al agente puente (enrolamiento, prueba de conexión,
 * sincronización…). La pantalla la consulta cada 1.5 s mientras espera.
 */
export const GET = route({ auth: 'user' }, async ({ params, user, system }) => {
  const c = await load(system, params.commandId, user);
  const status = c.status === 'cancelled' ? 'error' : c.status;
  const { attempts: _attempts, ...result } = (c.result ?? {}) as Record<string, unknown>;
  return {
    id: c.id, kind: c.kind, status,
    error: status === 'error' ? translateDeviceError(c.error) : null,
    error_code: status === 'error' ? (c.error ?? 'error').split(':')[0].trim() : null,
    result: c.status === 'done' ? result : null,
    // Avance de una orden larga (por ejemplo, la huella se está registrando en la pantalla del lector).
    progress: c.status === 'running' && typeof result.stage === 'string'
      ? { stage: result.stage, employee_no: typeof result.employee_no === 'string' ? result.employee_no : null } : null,
    device_id: c.device_id, device_name: c.device_name, bridge_online: c.bridge_online,
    created_at: c.created_at, started_at: c.started_at, finished_at: c.finished_at,
  };
});

// Cancela una orden que el puente todavía no toma (por ejemplo, un enrolamiento en cola con el puente apagado).
export const DELETE = route({ auth: 'user' }, async ({ params, user, system }) => {
  const c = await load(system, params.commandId, user);
  const cancelled = await system(async (tx) => {
    const rows = await tx<{ kind: string; device_id: string; patient_id: string | null; user_id: string | null }[]>`
      update device_commands set status = 'cancelled', error = 'cancelled', finished_at = now()
      where id = ${c.id} and status = 'pending' returning kind, device_id, patient_id, user_id`;
    for (const r of rows) {
      if (r.kind !== 'enroll_fingerprint') continue;
      await tx`
        update enrollments set status = 'failed'
        where device_id = ${r.device_id} and status = 'pending'
          and (patient_id = ${r.patient_id}::uuid or user_id = ${r.user_id}::uuid)`;
    }
    return rows.length > 0;
  });
  return { cancelled };
});
