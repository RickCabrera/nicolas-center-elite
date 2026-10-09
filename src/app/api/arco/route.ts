import { z } from 'zod';
import { clientIp, route } from '@/lib/api';
import { hmac } from '@/lib/crypto';
import { AppError } from '@/lib/errors';
import { ARCO_KINDS, ARCO_RESPONSE_DAYS, ARCO_STATUSES } from '@/modules/settings/shared';

const MAX_PER_HOUR = 5;
const LIMIT_ACTION = 'arco_submit';

const Create = z.object({
  requester_name: z.string().trim().min(3, 'Escribe tu nombre completo.').max(120, 'Máximo 120 caracteres.'),
  contact: z.string().trim().min(6, 'Escribe un teléfono o correo donde podamos responderte.').max(160, 'Máximo 160 caracteres.'),
  kind: z.enum(ARCO_KINDS, 'Elige el tipo de solicitud.'),
  details: z.string().trim().min(10, 'Describe tu solicitud (al menos 10 caracteres).').max(3000, 'Máximo 3,000 caracteres.'),
  /** Campo trampa: las personas no lo ven; los robots lo llenan. */
  website: z.string().max(200).optional(),
});

/**
 * LEG-03 · Solicitud de derechos ARCO desde la página pública /privacidad (sin sesión).
 * Anti-abuso: máximo 5 solicitudes por hora desde la misma IP. La cuenta se lleva en la bitácora
 * (acción `arco_submit`, con la IP convertida en una huella HMAC: la IP en claro no se guarda).
 */
export const POST = route({ auth: 'public', body: Create }, async ({ db, req, body }) => {
  const reply = { received: true, response_days: ARCO_RESPONSE_DAYS };
  if (body.website) return reply; // robot: se le responde igual, sin guardar nada

  const ipKey = hmac(`arco:${clientIp(req) ?? 'sin-ip'}`).slice(0, 32);
  // Candado por IP para que dos envíos simultáneos no brinquen el límite.
  await db`select pg_advisory_xact_lock(hashtext(${ipKey}))`;
  const [{ recent }] = await db<{ recent: number }[]>`
    select count(*)::int as recent from audit_log
    where action = ${LIMIT_ACTION} and row_id = ${ipKey} and at > now() - interval '1 hour'`;
  if (recent >= MAX_PER_HOUR) {
    throw new AppError(429, 'rate_limited', 'Recibimos varias solicitudes desde esta conexión. Intenta de nuevo en una hora o preséntala en recepción.');
  }

  const [row] = await db<{ id: string; created_at: Date }[]>`
    insert into arco_requests (requester_name, contact, kind, details)
    values (${body.requester_name}, ${body.contact}, ${body.kind}, ${body.details})
    returning id, created_at`;
  await db`select log_event(${LIMIT_ACTION}, 'Solicitud ARCO recibida desde la página pública', null, 'arco_requests', ${ipKey})`;
  return { ...reply, id: row.id, created_at: row.created_at };
});

const Q = z.object({ status: z.enum(ARCO_STATUSES).optional() });

// LEG-03 · Bandeja de solicitudes ARCO (solo dueño) con el contador de pendientes.
export const GET = route({ auth: 'owner', query: Q }, async ({ db, query }) => {
  const items = await db`
    select id, requester_name, contact, kind, details, status, resolution, created_at, resolved_at
    from arco_requests
    ${query.status ? db`where status = ${query.status}` : db``}
    order by (status in ('recibida', 'en_proceso')) desc, created_at desc
    limit 500`;
  const [{ pending }] = await db<{ pending: number }[]>`
    select count(*)::int as pending from arco_requests where status in ('recibida', 'en_proceso')`;
  return { items, pending };
});
