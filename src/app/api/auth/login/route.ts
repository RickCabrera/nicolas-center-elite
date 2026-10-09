import { z } from 'zod';
import { route } from '@/lib/api';
import { AppError } from '@/lib/errors';
import { verifyPassword } from '@/lib/auth/password';
import { openSession } from '@/lib/auth/login';

const Body = z.object({ username: z.string().trim().min(1).max(200), password: z.string().min(1).max(300) });
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

// AUTH-01 · Inicio de sesión con usuario (o correo) y contraseña. El rol lo define la cuenta.
export const POST = route({ auth: 'public', body: Body }, async ({ db, body, req }) => {
  const id = body.username.toLowerCase();
  const [u] = await db<{ id: string; password_hash: string | null; active: boolean; failed_attempts: number; locked_until: Date | null }[]>`
    select id, password_hash, active, failed_attempts, locked_until from users
    where lower(username) = ${id} or lower(email) = ${id} limit 1`;
  const invalid = new AppError(401, 'invalid_credentials', 'Usuario o contraseña incorrectos.');

  if (!u) {
    await verifyPassword(body.password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$' + 'A'.repeat(86)); // tiempo constante
    throw invalid;
  }
  if (u.locked_until && u.locked_until > new Date()) {
    const mins = Math.ceil((u.locked_until.getTime() - Date.now()) / 60000);
    throw new AppError(429, 'locked', `Demasiados intentos. La cuenta está bloqueada ${mins} min.`);
  }
  const good = u.active && (await verifyPassword(body.password, u.password_hash));
  if (!good) {
    const attempts = u.failed_attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await db`update users set failed_attempts = 0, locked_until = now() + make_interval(mins => ${LOCK_MINUTES}) where id = ${u.id}`;
      await db`insert into audit_log (actor_id, action, summary) values (${u.id}, 'security', 'Cuenta bloqueada por intentos fallidos')`;
      // La transacción debe confirmarse para que el bloqueo persista: se responde sin lanzar.
      return new Response(JSON.stringify({ ok: false, error: { code: 'locked', message: `Demasiados intentos. La cuenta está bloqueada ${LOCK_MINUTES} min.` } }),
        { status: 429, headers: { 'Content-Type': 'application/json' } });
    }
    await db`update users set failed_attempts = ${attempts} where id = ${u.id}`;
    return new Response(JSON.stringify({ ok: false, error: { code: 'invalid_credentials', message: invalid.message } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  return openSession(db, req, u.id, 'password');
});
