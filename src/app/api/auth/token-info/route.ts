import { route } from '@/lib/api';
import { sha256 } from '@/lib/crypto';
import { notFound } from '@/lib/errors';

// Datos mínimos para la pantalla de invitación / restablecimiento.
export const GET = route({ auth: 'public' }, async ({ db, query }) => {
  const token = (query as Record<string, string>).token ?? '';
  const [t] = await db<{ kind: string; full_name: string; username: string }[]>`
    select t.kind, u.full_name, u.username from auth_tokens t join users u on u.id = t.user_id
    where t.token_hash = ${sha256(token)} and t.used_at is null and t.expires_at > now() and u.active`;
  if (!t) throw notFound('El enlace ya no es válido. Solicita uno nuevo.');
  return t;
});
