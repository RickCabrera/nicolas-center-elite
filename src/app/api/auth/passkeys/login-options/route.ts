import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { route, ok } from '@/lib/api';
import { relyingParty, WA_COOKIE } from '@/lib/auth/passkeys';
import { env } from '@/lib/env';

// AUTH-04 · "Acceder con huella": el dispositivo elige la credencial (sin escribir usuario).
export const POST = route({ auth: 'public' }, async ({ db }) => {
  const { rpID } = relyingParty();
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
  const [ch] = await db<{ id: string }[]>`insert into webauthn_challenges (challenge, kind) values (${options.challenge}, 'login') returning id`;
  const res = ok(options);
  res.cookies.set({ name: WA_COOKIE, value: ch.id, httpOnly: true, sameSite: 'strict', secure: env().APP_URL.startsWith('https://'), path: '/api/auth/passkeys', maxAge: 300 });
  return res;
});
