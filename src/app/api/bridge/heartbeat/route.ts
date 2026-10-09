import { z } from 'zod';
import { route } from '@/lib/api';
import { deviceByBridgeToken } from '@/modules/attendance/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ version: z.string().max(40).optional(), device_reachable: z.boolean().optional() });

/** HUE-05 · Señal de vida del puente sin pedir órdenes (la usa `--check`). */
export const POST = route({ auth: 'public', body: Body }, async ({ req, db, body }) => {
  const device = await deviceByBridgeToken(db, req);
  await db`
    update devices set bridge_seen_at = now(),
      bridge_version = coalesce(${body.version ?? null}, bridge_version),
      device_reachable = coalesce(${body.device_reachable ?? null}::boolean, device_reachable),
      device_checked_at = case when ${body.device_reachable ?? null}::boolean is null then device_checked_at else now() end
    where id = ${device.id}`;
  return { device_name: device.name, server_time: new Date() };
});
