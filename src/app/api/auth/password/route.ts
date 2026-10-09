import { z } from 'zod';
import { route } from '@/lib/api';
import { badRequest } from '@/lib/errors';
import { hashPassword, passwordProblem, verifyPassword } from '@/lib/auth/password';

const Body = z.object({ current: z.string().min(1), next: z.string().min(1).max(300) });

// AUTH-02 / CFG-08 · Cambio de contraseña del propio usuario. Cierra las demás sesiones.
export const POST = route({ auth: 'user', body: Body, allowPendingPassword: true }, async ({ user, body, system }) => {
  await system(async (tx) => {
    const [u] = await tx<{ password_hash: string | null }[]>`select password_hash from users where id = ${user.id}`;
    if (!(await verifyPassword(body.current, u?.password_hash))) throw badRequest('La contraseña actual no es correcta.', { current: 'No coincide.' });
    const problem = passwordProblem(body.next, user.username);
    if (problem) throw badRequest(problem, { next: problem });
    if (body.next === body.current) throw badRequest('La nueva contraseña debe ser distinta a la actual.', { next: 'Debe ser distinta.' });
    await tx`update users set password_hash = ${await hashPassword(body.next)}, must_change_password = false where id = ${user.id}`;
    await tx`update sessions set revoked_at = now() where user_id = ${user.id} and id <> ${user.session_id} and revoked_at is null`;
    await tx`select log_event('security', 'Cambio de contraseña')`;
  });
  return null;
});
