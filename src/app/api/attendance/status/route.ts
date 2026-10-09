import { route } from '@/lib/api';
import { listDevices } from '@/modules/attendance/server';

/**
 * HUE-10 · Estado real de los lectores para la pantalla de asistencia.
 * Fisioterapeuta: el lector de su sede. Dueño: todos los activos. Sin datos de red ni secretos.
 */
export const GET = route({ auth: 'user' }, async ({ user, system }) => {
  const owner = user.role === 'owner';
  if (!owner && !user.location_id) return { devices: [] };
  return system(async (tx) => {
    const devices = await listDevices(tx, { onlyActive: true, locationId: owner ? null : user.location_id });
    const out = [];
    for (const d of devices) {
      const [last] = await tx<{ person_name: string; occurred_at: Date; direction: string; person_type: string }[]>`
        select coalesce(nullif(person_name, ''), 'No reconocido') as person_name, occurred_at, direction, person_type
        from attendance_events
        where location_id = ${d.location_id} and (device_id = ${d.id} or device_id is null)
          ${owner ? tx`` : tx`and person_type <> 'unknown'`}
        order by occurred_at desc limit 1`;
      out.push({
        id: d.id, name: d.name, location_id: d.location_id, location_name: d.location_name,
        online: d.online, bridge_online: d.bridge_online,
        last_event_at: d.last_event_at, last_sync_at: d.last_sync_at,
        last_error: owner ? d.last_error : null,
        last_read: last ?? null,
      });
    }
    return { devices: out };
  });
});
