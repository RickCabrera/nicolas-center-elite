import { route } from '@/lib/api';
import { encrypt } from '@/lib/crypto';
import { badRequest, notFound } from '@/lib/errors';
import { DeviceUpdate } from '@/modules/attendance/device-schema';
import { listDevices } from '@/modules/attendance/server';

export const GET = route({ auth: 'owner' }, async ({ db, params }) => {
  const [device] = await listDevices(db, { id: params.id });
  if (!device) throw notFound('Lector no encontrado.');
  return device;
});

// HUE-01 · Edita un lector. La contraseña solo cambia si llega; `active: false` lo da de baja (no se borra).
export const PATCH = route({ auth: 'owner', body: DeviceUpdate }, async ({ db, params, body, system }) => {
  const [cur] = await db<{ id: string }[]>`select id from devices where id = ${params.id}`;
  if (!cur) throw notFound('Lector no encontrado.');
  if (body.location_id) {
    const [loc] = await db`select id from locations where id = ${body.location_id} and active`;
    if (!loc) throw badRequest('Selecciona una sede activa.', { location_id: 'Selecciona una sede activa.' });
  }
  const set: Record<string, unknown> = {};
  for (const k of ['name', 'location_id', 'model', 'serial', 'host', 'port', 'use_https', 'username', 'active'] as const) {
    if (body[k] !== undefined) set[k] = body[k];
  }
  if (body.password) set.password_enc = encrypt(body.password);
  if (Object.keys(set).length) {
    await db`update devices set ${db(set as never, ...(Object.keys(set) as never[]))} where id = ${params.id}`;
  }
  if (body.active === false) {
    // Lo que estaba en cola para este lector ya no se va a ejecutar.
    await system((tx) => tx`
      update device_commands set status = 'cancelled', error = 'cancelled', finished_at = now()
      where device_id = ${params.id} and status in ('pending','running')`);
  }
  const [device] = await listDevices(db, { id: params.id });
  return device;
});
