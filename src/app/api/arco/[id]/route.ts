import { z } from 'zod';
import { route } from '@/lib/api';
import { badRequest, notFound } from '@/lib/errors';
import { ARCO_STATUSES } from '@/modules/settings/shared';

const Body = z.object({
  status: z.enum(ARCO_STATUSES, 'Estado inválido.'),
  resolution: z.string().trim().max(3000, 'Máximo 3,000 caracteres.').default(''),
});

// LEG-03 · El dueño da seguimiento a una solicitud ARCO: en proceso, resuelta o rechazada (con nota).
export const PATCH = route({ auth: 'owner', body: Body }, async ({ db, params, body }) => {
  if (!z.uuid().safeParse(params.id).success) throw notFound('Solicitud no encontrada.');
  const closed = body.status === 'resuelta' || body.status === 'rechazada';
  if (closed && body.resolution.length < 5) {
    const msg = 'Escribe cómo se resolvió o por qué se rechazó: es la constancia de la respuesta.';
    throw badRequest(msg, { resolution: msg });
  }
  const [row] = await db`
    update arco_requests
       set status = ${body.status}, resolution = ${body.resolution},
           resolved_at = case when ${closed} then coalesce(resolved_at, now()) else null end
     where id = ${params.id}
    returning id, requester_name, contact, kind, details, status, resolution, created_at, resolved_at`;
  if (!row) throw notFound('Solicitud no encontrada.');
  return row;
});
