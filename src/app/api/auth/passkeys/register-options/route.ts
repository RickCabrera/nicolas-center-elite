import { generateRegistrationOptions } from '@simplewebauthn/server';
import { route } from '@/lib/api';
import { relyingParty } from '@/lib/auth/passkeys';

// AUTH-04 · Paso 1 de registrar la huella/rostro del dispositivo como passkey.
export const POST = route({ auth: 'user' }, async ({ user, system }) => {
  const { rpID, rpName } = relyingParty();
  return system(async (tx) => {
    const existing = await tx<{ credential_id: string }[]>`select credential_id from passkeys where user_id = ${user.id}`;
    const options = await generateRegistrationOptions({
      rpName, rpID,
      userName: user.username,
      userDisplayName: user.display_name,
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({ id: c.credential_id })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    await tx`delete from webauthn_challenges where user_id = ${user.id} and kind = 'register'`;
    await tx`insert into webauthn_challenges (user_id, challenge, kind) values (${user.id}, ${options.challenge}, 'register')`;
    return options;
  });
});
