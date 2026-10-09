import { z } from 'zod';
import { route } from '@/lib/api';
import { parseHikDate, type HikEvent } from '@/modules/attendance/hik-parser';
import { deviceByBridgeToken, ingestEvents } from '@/modules/attendance/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Ev = z.object({
  employee_no: z.union([z.string(), z.number()]).nullish(),
  time: z.string().max(40),
  serial_no: z.union([z.number(), z.string()]).nullish(),
  major: z.coerce.number().int().optional(),
  minor: z.coerce.number().int(),
  verify_mode: z.string().max(60).nullish(),
});
const Body = z.object({ events: z.array(Ev).max(500, 'Máximo 500 eventos por envío.') });

/**
 * HUE-05 / HUE-08 · Eventos que el puente leyó del historial del lector (AcsEvent).
 * Mismo camino y MISMA llave de idempotencia que el webhook: lo que ya llegó no se duplica,
 * y lo que el webhook perdió (corte de internet, lector sin configurar) se recupera.
 */
export const POST = route({ auth: 'public', body: Body }, async ({ req, db, body }) => {
  const device = await deviceByBridgeToken(db, req);
  await db`update devices set bridge_seen_at = now(), device_reachable = true, device_checked_at = now() where id = ${device.id}`;
  const events: HikEvent[] = body.events.map((e) => {
    const serial = e.serial_no === null || e.serial_no === undefined || e.serial_no === '' ? null : Number(e.serial_no);
    return {
      kind: 'access',
      employeeNo: e.employee_no === null || e.employee_no === undefined ? null : String(e.employee_no).trim().slice(0, 64) || null,
      occurredAt: parseHikDate(e.time),
      serialNo: serial !== null && Number.isFinite(serial) ? Math.trunc(serial) : null,
      verifyMode: e.verify_mode ?? '',
      major: e.major ?? 5,
      minor: e.minor,
      deviceName: '',
      eventType: 'AccessControllerEvent',
    };
  });
  const r = await ingestEvents(db, device, events, 'bridge');
  return { received: r.received, created: r.created, ignored: r.ignored };
});
