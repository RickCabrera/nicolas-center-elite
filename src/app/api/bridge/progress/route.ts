import { z } from 'zod';
import { route } from '@/lib/api';
import { notFound } from '@/lib/errors';
import { deviceByBridgeToken } from '@/modules/attendance/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  command_id: z.uuid(),
  stage: z.enum(['capturing', 'on_device']),
  employee_no: z.string().max(64).optional(),
  /** Lector USB: toque n de m al registrar la huella (HUE-20). */
  sample: z.number().int().min(1).max(20).optional(),
  samples: z.number().int().min(1).max(20).optional(),
});

/**
 * HUE-07 · Avance de una orden larga. Si el lector no permite capturar a distancia, la huella se
 * registra en la pantalla del lector y el agente avisa aquí (cada pocos segundos) mientras espera.
 * Cada aviso también mantiene viva la orden para que la cola no la dé por perdida.
 */
export const POST = route({ auth: 'public', body: Body }, async ({ req, db, body }) => {
  const device = await deviceByBridgeToken(db, req);
  const rows = await db`
    update device_commands
       set result = coalesce(result, '{}'::jsonb) || ${db.json({ stage: body.stage, ...(body.employee_no ? { employee_no: body.employee_no } : {}), ...(body.sample ? { sample: body.sample, samples: body.samples ?? null } : {}) })},
           started_at = now()
     where id = ${body.command_id} and device_id = ${device.id} and status = 'running'
     returning id`;
  if (!rows.length) throw notFound('Orden no encontrada o ya cerrada.');
  return { ok: true };
});
