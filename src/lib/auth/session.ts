import { SignJWT, jwtVerify } from 'jose';
import { asSystem, type Role, type Tx } from '../db';
import { env } from '../env';

export const SESSION_COOKIE = 'nce_session';
const MAX_AGE_DAYS = 14;

/** Usuario autenticado tal como lo ven las rutas y las pantallas. */
export type SessionUser = {
  id: string;
  session_id: string;
  role: Role;
  username: string;
  email: string;
  full_name: string;
  title: string;
  display_name: string; // "L.F.T. Karla Ocampo"
  specialty: string;
  location_id: string | null;
  location_name: string | null;
  is_physician: boolean;
  license_number: string | null;
  must_change_password: boolean;
};

const secret = () => new TextEncoder().encode(env().SESSION_SECRET);

export async function createSession(
  tx: Tx,
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null; method?: string },
): Promise<{ token: string; maxAge: number }> {
  const maxAge = MAX_AGE_DAYS * 24 * 3600;
  const [s] = await tx<{ id: string }[]>`
    insert into sessions (user_id, expires_at, user_agent, ip, method)
    values (${userId}, now() + make_interval(days => ${MAX_AGE_DAYS}), ${meta.userAgent ?? null}, ${meta.ip ?? null}, ${meta.method ?? 'password'})
    returning id`;
  const token = await new SignJWT({ sid: s.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_DAYS}d`)
    .sign(secret());
  return { token, maxAge };
}

/**
 * Valida el token de sesión contra la base: sesión vigente, no revocada, usuario activo y sin
 * exceder el tiempo de inactividad configurado (AUTH-08). Devuelve null si no es válida.
 */
export async function readSession(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  let sid: string, uid: string;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    sid = String(payload.sid ?? '');
    uid = String(payload.sub ?? '');
    if (!sid || !uid) return null;
  } catch {
    return null;
  }
  return asSystem(async (tx) => {
    const [r] = await tx<(SessionUser & { idle_seconds: number; idle_limit: number })[]>`
      select u.id, s.id as session_id, u.role, u.username, u.email, u.full_name, u.title,
             trim(u.title || ' ' || u.full_name) as display_name, u.specialty,
             u.location_id, l.name as location_name, u.is_physician, u.license_number, u.must_change_password,
             extract(epoch from (now() - s.last_seen_at))::int as idle_seconds,
             clinic_setting('idle_minutes', '30')::int * 60 as idle_limit
      from sessions s
      join users u on u.id = s.user_id
      left join locations l on l.id = u.location_id
      where s.id = ${sid} and s.user_id = ${uid} and s.revoked_at is null and s.expires_at > now() and u.active`;
    if (!r) return null;
    if (r.idle_seconds > r.idle_limit) {
      await tx`update sessions set revoked_at = now() where id = ${sid}`;
      return null;
    }
    if (r.idle_seconds > 60) await tx`update sessions set last_seen_at = now() where id = ${sid}`;
    const { idle_seconds: _i, idle_limit: _l, ...user } = r;
    return user as SessionUser;
  });
}

export async function revokeSession(sessionId: string) {
  await asSystem((tx) => tx`update sessions set revoked_at = now() where id = ${sessionId}`);
}

export function sessionCookie(token: string, maxAge: number) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env().APP_URL.startsWith('https://'),
    path: '/',
    maxAge,
  };
}
