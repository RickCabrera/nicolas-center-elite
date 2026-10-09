import { z } from 'zod';
import { route } from '@/lib/api';
import { safeEqual } from '@/lib/crypto';
import { env } from '@/lib/env';
import { badRequest, forbidden } from '@/lib/errors';
import { hashPassword, passwordProblem } from '@/lib/auth/password';
import { openSession } from '@/lib/auth/login';

// DEP-02 · Primer arranque: crea la cuenta del dueño. Solo funciona mientras no exista ningún usuario.
export const GET = route({ auth: 'public' }, async ({ db }) => {
  const [r] = await db<{ n: number }[]>`select count(*)::int as n from users`;
  return { needed: r.n === 0, token_required: !!env().SETUP_TOKEN || env().APP_ENV === 'production' };
});

const Body = z.object({
  token: z.string().optional().default(''),
  full_name: z.string().trim().min(3).max(120),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, 'Usa de 3 a 40 letras minúsculas, números, punto o guion.'),
  email: z.string().trim().toLowerCase().email('Correo inválido.'),
  password: z.string().min(1).max(300),
});

export const POST = route({ auth: 'public', body: Body }, async ({ db, body, req }) => {
  await db`select pg_advisory_xact_lock(727275)`;
  const [r] = await db<{ n: number }[]>`select count(*)::int as n from users`;
  if (r.n > 0) throw forbidden('El sistema ya fue configurado. Inicia sesión.');
  const expected = env().SETUP_TOKEN;
  if (env().APP_ENV === 'production' && !expected) throw forbidden('Falta la variable SETUP_TOKEN en el servidor.');
  if (expected && !safeEqual(expected, body.token)) throw forbidden('El token de configuración no es correcto.');
  const problem = passwordProblem(body.password, body.username);
  if (problem) throw badRequest(problem, { password: problem });
  const [u] = await db<{ id: string }[]>`
    insert into users (username, email, password_hash, role, full_name, specialty)
    values (${body.username}, ${body.email}, ${await hashPassword(body.password)}, 'owner', ${body.full_name}, 'Dueño / Director')
    returning id`;
  return openSession(db, req, u.id, 'password');
});
