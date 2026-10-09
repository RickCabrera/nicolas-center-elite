import { z } from 'zod';
import { route } from '@/lib/api';
import { decrypt } from '@/lib/crypto';
import { deviceByBridgeToken, maintainQueue, translateDeviceError } from '@/modules/attendance/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Info = z.object({
  model: z.string().max(120).optional(),
  serial: z.string().max(120).optional(),
  firmware: z.string().max(120).optional(),
}).optional();

const Body = z.object({
  version: z.string().max(40).default(''),
  device_reachable: z.boolean().optional(),
  device_info: Info,
  device_error: z.string().max(200).optional(),
  /** `--check` del puente: devuelve la configuración sin tomar órdenes. */
  dry_run: z.boolean().optional(),
});

type Cmd = { id: string; kind: string; payload: Record<string, unknown>; created_at: Date };

/**
 * HUE-05 / HUE-06 · El agente puente pregunta por órdenes (solo conexiones de salida desde la clínica).
 * Marca al puente como visto, guarda lo que reporta del lector y entrega hasta 5 órdenes pendientes.
 * Sin espera larga: responde de inmediato y el puente vuelve a preguntar cada `poll_seconds`.
 */
export const POST = route({ auth: 'public', body: Body }, async ({ req, db, body }) => {
  const device = await deviceByBridgeToken(db, req);
  const info = body.device_info ?? {};
  const [d] = await db<{ host: string; port: number; use_https: boolean; username: string; password_enc: string | null; last_event_at: Date | null }[]>`
    update devices set
      bridge_seen_at = now(),
      bridge_version = ${body.version || null},
      device_reachable = coalesce(${body.device_reachable ?? null}::boolean, device_reachable),
      device_checked_at = case when ${body.device_reachable ?? null}::boolean is null then device_checked_at else now() end,
      model = case when ${info.model ?? ''} <> '' then ${info.model ?? ''} else model end,
      serial = case when ${info.serial ?? ''} <> '' then ${info.serial ?? ''} else serial end,
      firmware = case when ${info.firmware ?? ''} <> '' then ${info.firmware ?? ''} else firmware end
    where id = ${device.id}
    returning host, port, use_https, username, password_enc, last_event_at`;

  if (body.device_reachable === false && body.device_error) {
    await db`update devices set last_error = ${translateDeviceError(body.device_error)} where id = ${device.id}`;
  }

  await maintainQueue(db, device.id);

  const commands = body.dry_run ? [] : await db<Cmd[]>`
    update device_commands c set status = 'running', started_at = now(),
           result = jsonb_build_object('attempts', coalesce((c.result ->> 'attempts')::int, 0) + 1)
    where c.id in (select id from device_commands where device_id = ${device.id} and status = 'pending'
                   order by created_at limit 5 for update skip locked)
    returning c.id, c.kind, c.payload, c.created_at`;

  let password = '';
  if (d.password_enc) {
    try { password = decrypt(d.password_enc); } catch { password = ''; }
  }
  return {
    commands: [...commands].sort((a, b) => a.created_at.getTime() - b.created_at.getTime()).map(({ id, kind, payload }) => ({ id, kind, payload })),
    config: {
      host: d.host, port: d.port, use_https: d.use_https, username: d.username, password,
      poll_seconds: 2,
      backfill_since: d.last_event_at,
    },
    server_time: new Date(),
  };
});
