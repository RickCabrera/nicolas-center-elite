import { route, ok } from '@/lib/api';
import { readSession, SESSION_COOKIE } from '@/lib/auth/session';

export const POST = route({ auth: 'public' }, async ({ req, db }) => {
  const u = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (u) await db`update sessions set revoked_at = now() where id = ${u.session_id}`;
  const res = ok(null);
  res.cookies.set({ name: SESSION_COOKIE, value: '', path: '/', maxAge: 0 });
  return res;
});
