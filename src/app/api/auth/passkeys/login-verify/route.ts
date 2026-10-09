import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { z } from 'zod';
import { route } from '@/lib/api';
import { AppError } from '@/lib/errors';
import { relyingParty, WA_COOKIE } from '@/lib/auth/passkeys';
import { openSession } from '@/lib/auth/login';

const Body = z.object({ response: z.any() });
const denied = () => new AppError(401, 'passkey_failed', 'No se reconoció la huella de este dispositivo. Entra con tu usuario y contraseña.');

export const POST = route({ auth: 'public', body: Body }, async ({ db, body, req }) => {
  const { rpID, origin } = relyingParty();
  const chId = req.cookies.get(WA_COOKIE)?.value;
  if (!chId || !/^[0-9a-f-]{36}$/.test(chId)) throw denied();
  const [ch] = await db<{ challenge: string }[]>`
    delete from webauthn_challenges where id = ${chId} and kind = 'login' and expires_at > now() returning challenge`;
  if (!ch) throw denied();
  const credId = String(body.response?.id ?? '');
  const [pk] = await db<{ id: string; user_id: string; credential_id: string; public_key: Buffer; counter: string; transports: string[]; active: boolean }[]>`
    select p.id, p.user_id, p.credential_id, p.public_key, p.counter, p.transports, u.active
    from passkeys p join users u on u.id = p.user_id where p.credential_id = ${credId}`;
  if (!pk || !pk.active) throw denied();
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response: body.response, expectedChallenge: ch.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: { id: pk.credential_id, publicKey: new Uint8Array(pk.public_key), counter: Number(pk.counter), transports: pk.transports as never },
    });
  } catch {
    throw denied();
  }
  if (!result.verified) throw denied();
  await db`update passkeys set counter = ${result.authenticationInfo.newCounter}, last_used_at = now() where id = ${pk.id}`;
  return openSession(db, req, pk.user_id, 'passkey');
});
