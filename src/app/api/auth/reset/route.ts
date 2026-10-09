import { z } from 'zod';
import { route } from '@/lib/api';
import { sha256 } from '@/lib/crypto';
import { badRequest, notFound } from '@/lib/errors';
import { hashPassword, passwordProblem } from '@/lib/auth/password';
import { openSession } from '@/lib/auth/login';

const Body = z.object({ token: z.string().min(10), password: z.string().min(1).max(300) });

// AUTH-02 / AUTH-03 · Define la contraseña con un enlace de invitación o de recuperación e inicia sesión.
export const POST = route({ auth: 'public', body: Body }, async ({ db, body, req }) => {
  const [t] = await db<{ id: string; user_id: string; username: string }[]>`
    select t.id, t.user_id, u.username from auth_tokens t join users u on u.id = t.user_id
    where t.token_hash = ${sha256(body.token)} and t.used_at is null and t.expires_at > now() and u.active
    for update of t`;
  if (!t) throw notFound('El enlace ya no es válido. Solicita uno nuevo.');
  const problem = passwordProblem(body.password, t.username);
  if (problem) throw badRequest(problem, { password: problem });
  await db`update users set password_hash = ${await hashPassword(body.password)}, must_change_password = false,
                            failed_attempts = 0, locked_until = null where id = ${t.user_id}`;
  await db`update auth_tokens set used_at = now() where id = ${t.id}`;
  await db`update sessions set revoked_at = now() where user_id = ${t.user_id} and revoked_at is null`;
  return openSession(db, req, t.user_id, 'token');
});
