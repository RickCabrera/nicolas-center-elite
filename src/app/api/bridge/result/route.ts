import { z } from 'zod';
import { fail, route } from '@/lib/api';
import { notFound } from '@/lib/errors';
import { applyCommandResult, deviceByBridgeToken, stripBiometric, type CommandKind } from '@/modules/attendance/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Esquema abierto a propósito: se inspecciona TODO lo que mande el puente antes de guardar nada.
const Body = z.looseObject({
  command_id: z.uuid(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().max(500).nullish(),
});

type Row = {
  id: string; device_id: string; kind: CommandKind; status: string; payload: Record<string, unknown>;
  person_type: 'patient' | 'staff' | null; patient_id: string | null; user_id: string | null;
};

/**
 * HUE-05 / HUE-07 / HUE-13 · El puente reporta el resultado de una orden.
 * HUE-16 · Si la respuesta trae una plantilla de huella (`fingerData` o parecido) se RECHAZA, se descarta
 * el dato sin guardarlo y queda un incidente de seguridad en la bitácora.
 */
export const POST = route({ auth: 'public', body: Body }, async ({ req, db, body }) => {
  const device = await deviceByBridgeToken(db, req);
  const [cmd] = await db<Row[]>`
    select id, device_id, kind, status, payload, person_type, patient_id, user_id
    from device_commands where id = ${body.command_id} and device_id = ${device.id} for update`;
  if (!cmd) throw notFound('Orden no encontrada.');

  const scan = stripBiometric(body);
  if (scan.found) {
    await db`select log_event('security', ${`Incidente: el agente puente del lector "${device.name}" envió datos biométricos en el resultado de una orden (${cmd.kind}). Se descartaron sin guardarse.`}, ${cmd.patient_id}, 'device_commands', ${cmd.id})`;
    if (cmd.status === 'pending' || cmd.status === 'running') {
      await applyCommandResult(db, cmd, false, null, 'biometric_rejected');
    }
    // Se responde con Response (no con throw) para que el incidente quede confirmado en la base.
    return fail(400, 'biometric_rejected', 'La respuesta incluía datos biométricos y fue rechazada. La huella nunca debe salir del lector.');
  }

  // Una orden ya cerrada no se vuelve a aplicar (el puente puede reintentar el envío).
  if (cmd.status !== 'pending' && cmd.status !== 'running') return { status: cmd.status, already_closed: true };

  const result = body.result && typeof body.result === 'object' && !Array.isArray(body.result) ? (body.result as Record<string, unknown>) : null;
  // La lista de personas del lector puede ser larga (hasta 3,000); el resto de las órdenes trae poco.
  const limit = cmd.kind === 'list_persons' ? 600000 : 20000;
  if (result && JSON.stringify(result).length > limit) {
    await applyCommandResult(db, cmd, body.ok, { truncated: true }, body.error ?? null);
  } else {
    await applyCommandResult(db, cmd, body.ok, result, body.error ?? null);
  }
  return { status: body.ok ? 'done' : 'error' };
});
