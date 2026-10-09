import { route } from '@/lib/api';
import { encrypt, randomToken, sha256 } from '@/lib/crypto';
import { badRequest } from '@/lib/errors';
import { DeviceCreate } from '@/modules/attendance/device-schema';
import { listDevices } from '@/modules/attendance/server';

// HUE-01 / CFG-04 · Lectores con su estado calculado. Solo el dueño; nunca se devuelven secretos.
// (El fisioterapeuta consulta el estado de su sede en GET /api/attendance/status.)
export const GET = route({ auth: 'owner' }, async ({ db }) => listDevices(db));

// HUE-01 · Alta de lector: genera los dos tokens (solo se guarda su hash y su copia cifrada).
export const POST = route({ auth: 'owner', body: DeviceCreate }, async ({ db, body }) => {
  const [loc] = await db`select id from locations where id = ${body.location_id} and active`;
  if (!loc) throw badRequest('Selecciona una sede activa.', { location_id: 'Selecciona una sede activa.' });
  const webhook = randomToken();
  const bridge = randomToken();
  const [row] = await db<{ id: string }[]>`
    insert into devices (name, location_id, model, serial, host, port, use_https, username, password_enc,
                         webhook_token_hash, webhook_token_enc, bridge_token_hash, bridge_token_enc)
    values (${body.name}, ${body.location_id}, ${body.model}, ${body.serial}, ${body.host},
            ${body.port ?? (body.use_https ? 443 : 80)}, ${body.use_https}, ${body.username},
            ${body.password ? encrypt(body.password) : null},
            ${sha256(webhook)}, ${encrypt(webhook)}, ${sha256(bridge)}, ${encrypt(bridge)})
    returning id`;
  const [device] = await listDevices(db, { id: row.id });
  return device;
});
