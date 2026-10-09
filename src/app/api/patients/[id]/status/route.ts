import { z } from 'zod';
import { route } from '@/lib/api';
import { badRequest, notFound } from '@/lib/errors';
import { queuePersonRemoval } from '@/modules/attendance/server';

const Body = z.object({
  status: z.enum(['active', 'inactive'], 'Indica si es baja o reactivación.'),
  reason: z.string().trim().max(400, 'Máximo 400 caracteres.').optional(),
});

// PAC-05 · Baja con motivo y reactivación. Nunca se borra: el expediente se conserva y sigue accesible.
export const POST = route({ auth: 'user', body: Body }, async ({ db, params, body, system, user }) => {
  const [p] = z.uuid().safeParse(params.id).success
    ? await db<{ id: string; status: string }[]>`select id, status from patients where id = ${params.id}`
    : [];
  if (!p) throw notFound('Paciente no encontrado.');

  if (body.status === 'inactive') {
    const reason = body.reason ?? '';
    if (reason.length < 3) throw badRequest('Escribe el motivo de la baja.', { reason: 'Escribe el motivo de la baja.' });
    if (p.status !== 'inactive') {
      // HUE-13 · La baja y la orden de quitar a la persona del lector van en una sola transacción.
      // El acceso ya se validó arriba bajo RLS; la cola de órdenes solo es accesible como sistema
      // (la bitácora conserva al usuario como autor).
      await system(async (tx) => {
        await tx`update patients set status = 'inactive', deactivated_at = now(), deactivation_reason = ${reason} where id = ${p.id}`;
        await queuePersonRemoval(tx, { personType: 'patient', personId: p.id, createdBy: user.id });
      });
    }
  } else if (p.status !== 'active') {
    await db`update patients set status = 'active', deactivated_at = null, deactivation_reason = null where id = ${p.id}`;
  }

  const [row] = await db`select id, status, deactivated_at, deactivation_reason from patients where id = ${p.id}`;
  // Las citas futuras no se tocan aquí: se avisa cuántas quedan para cancelarlas en la agenda.
  const [{ n }] = await db<{ n: number }[]>`
    select count(*)::int as n from appointments where patient_id = ${p.id} and status = 'scheduled' and starts_at > now()`;
  return { ...row, future_appointments: n };
});
