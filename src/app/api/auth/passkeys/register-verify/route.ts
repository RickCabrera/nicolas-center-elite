import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { z } from 'zod';
import { route } from '@/lib/api';
import { badRequest } from '@/lib/errors';
import { relyingParty } from '@/lib/auth/passkeys';

const Body = z.object({ response: z.any(), name: z.string().trim().max(60).optional() });

// AUTH-04 · Paso 2: valida la respuesta del dispositivo y guarda la llave pública.
export const POST = route({ auth: 'user', body: Body }, async ({ user, body, system }) => {
  const { rpID, origin } = relyingParty();
  return system(async (tx) => {
    const [ch] = await tx<{ id: string; challenge: string }[]>`
      select id, challenge from webauthn_challenges where user_id = ${user.id} and kind = 'register' and expires_at > now()`;
    if (!ch) throw badRequest('El registro caducó. Intenta de nuevo.');
    let result;
    try {
      result = await verifyRegistrationResponse({
        response: body.response, expectedChallenge: ch.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      });
    } catch {
      throw badRequest('No se pudo verificar el dispositivo. Intenta de nuevo.');
    }
    await tx`delete from webauthn_challenges where id = ${ch.id}`;
    if (!result.verified) throw badRequest('No se pudo verificar el dispositivo.');
    const c = result.registrationInfo.credential;
    const [row] = await tx`
      insert into passkeys (user_id, credential_id, public_key, counter, transports, name)
      values (${user.id}, ${c.id}, ${Buffer.from(c.publicKey)}, ${c.counter}, ${c.transports ?? []}, ${body.name || 'Dispositivo'})
      returning id, name, created_at`;
    await tx`select log_event('security', 'Passkey registrada')`;
    return row;
  });
});
