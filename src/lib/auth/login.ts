import { NextRequest, NextResponse } from 'next/server';
import type { Tx } from '../db';
import { clientIp, ok } from '../api';
import { createSession, sessionCookie } from './session';

/** Abre sesión para un usuario ya verificado y devuelve la respuesta con la cookie puesta. */
export async function openSession(tx: Tx, req: NextRequest, userId: string, method: 'password' | 'passkey' | 'token'): Promise<NextResponse> {
  const { token, maxAge } = await createSession(tx, userId, { userAgent: req.headers.get('user-agent'), ip: clientIp(req), method });
  await tx`update users set failed_attempts = 0, locked_until = null, last_login_at = now() where id = ${userId}`;
  const [u] = await tx<{ full_name: string; title: string; role: string; must_change_password: boolean }[]>`
    select full_name, title, role, must_change_password from users where id = ${userId}`;
  await tx`insert into audit_log (actor_id, actor_name, action, summary)
           values (${userId}, ${`${u.title} ${u.full_name}`.trim()}, 'login', ${method === 'passkey' ? 'Inicio de sesión con huella del dispositivo' : 'Inicio de sesión'})`;
  const res = ok({ role: u.role, must_change_password: u.must_change_password });
  res.cookies.set(sessionCookie(token, maxAge));
  return res;
}
