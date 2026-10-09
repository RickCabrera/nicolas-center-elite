import { z } from 'zod';
import { route } from '@/lib/api';
import { decrypt } from '@/lib/crypto';
import { badRequest, conflict, notFound } from '@/lib/errors';
import { addDays, localToInstant, todayIso } from '@/lib/dates';
import { connectionData, enqueueCommand, listDevices } from '@/modules/attendance/server';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida.');
const Body = z.object({
  kind: z.enum(['ping', 'sync_time', 'backfill_events', 'configure_listener']),
  payload: z.object({ from: day.optional(), to: day.optional() }).optional(),
});

/**
 * HUE-01 / HUE-06 · Encola una orden para el agente puente: probar conexión (ping), sincronizar hora,
 * recuperar eventos de un rango o configurar el aviso de eventos del lector.
 * La nube no puede llamar al lector: la orden se ejecuta cuando el puente pregunte.
 */
export const POST = route({ auth: 'owner', body: Body }, async ({ db, params, body, user, system }) => {
  const [device] = await listDevices(db, { id: params.id });
  if (!device) throw notFound('Lector no encontrado.');
  if (!device.active) throw conflict('El lector está dado de baja.');

  let payload: Record<string, unknown> = {};
  if (body.kind === 'backfill_events') {
    const today = todayIso();
    const from = body.payload?.from ?? addDays(today, -7);
    const to = body.payload?.to ?? today;
    if (from > to) throw badRequest('La fecha inicial no puede ser posterior a la final.', { from: 'Revisa el rango.' });
    if (addDays(from, 92) < to) throw badRequest('El rango máximo es de 3 meses.', { to: 'El rango máximo es de 3 meses.' });
    payload = {
      from: localToInstant(from, '00:00').toISOString(),
      to: new Date(localToInstant(addDays(to, 1), '00:00').getTime() - 1000).toISOString(),
    };
  }
  if (body.kind === 'configure_listener') {
    const [s] = await db<{ webhook_token_enc: string }[]>`select webhook_token_enc from devices where id = ${device.id}`;
    const c = connectionData(decrypt(s.webhook_token_enc), '');
    payload = { webhook_url: c.webhook_url, protocol: c.listener.protocol, host: c.listener.host, port: c.listener.port, path: c.listener.path };
  }

  const command_id = await system(async (tx) => {
    // Evita apilar la misma orden si el dueño pulsa varias veces.
    if (body.kind !== 'backfill_events') {
      const [dup] = await tx<{ id: string }[]>`
        select id from device_commands where device_id = ${device.id} and kind = ${body.kind} and status = 'pending' order by created_at limit 1`;
      if (dup) return dup.id;
    }
    return enqueueCommand(tx, { deviceId: device.id, kind: body.kind, payload, createdBy: user.id });
  });
  return { command_id, device_name: device.name, bridge_online: device.bridge_online };
});
