import { z } from 'zod';
import { route } from '@/lib/api';
import { badRequest, notFound } from '@/lib/errors';
import { describeDevice } from '@/modules/team/server';

// CFG-08 · Sesiones abiertas del usuario (vigentes, no revocadas y dentro del tiempo de inactividad).
export const GET = route({ auth: 'user' }, async ({ user, system }) => {
  const rows = await system((tx) => tx<{ id: string; created_at: Date; last_seen_at: Date; method: string; user_agent: string | null }[]>`
    select id, created_at, last_seen_at, method, user_agent from sessions
    where user_id = ${user.id} and revoked_at is null and expires_at > now()
      and (id = ${user.session_id}
           or last_seen_at > now() - make_interval(mins => clinic_setting('idle_minutes', '30')::int))
    order by (id = ${user.session_id}) desc, last_seen_at desc`);
  return rows.map(({ user_agent, ...s }) => ({ ...s, device: describeDevice(user_agent), current: s.id === user.session_id }));
});

const Body = z.object({ revoke: z.union([z.literal('others'), z.uuid('Sesión inválida.')], 'Indica qué sesión cerrar.') });

// CFG-08 · Cierra una sesión propia o todas las demás. La actual se cierra con "Cerrar sesión".
export const POST = route({ auth: 'user', body: Body }, async ({ user, body, system }) => {
  if (body.revoke === user.session_id) throw badRequest('Para cerrar esta sesión usa "Cerrar sesión".');
  const revoked = await system(async (tx) => {
    const r = body.revoke === 'others'
      ? await tx`update sessions set revoked_at = now() where user_id = ${user.id} and id <> ${user.session_id} and revoked_at is null returning id`
      : await tx`update sessions set revoked_at = now() where user_id = ${user.id} and id = ${body.revoke} and revoked_at is null returning id`;
    if (r.length) await tx`select log_event('security', ${r.length === 1 ? 'Sesión cerrada desde Mi perfil' : `${r.length} sesiones cerradas desde Mi perfil`})`;
    return r.length;
  });
  if (!revoked && body.revoke !== 'others') throw notFound('Esa sesión ya no está abierta.');
  return { revoked };
});
