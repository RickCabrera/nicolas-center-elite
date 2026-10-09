import type { Tx } from '../db';
import { randomToken, sha256 } from '../crypto';
import { env } from '../env';
import { sendEmail } from '../email';

/** Crea un enlace de un solo uso para definir contraseña (invitación o recuperación). */
export async function createAuthLink(tx: Tx, userId: string, kind: 'invite' | 'reset'): Promise<string> {
  const token = randomToken(32);
  const hours = kind === 'invite' ? 72 : 2;
  await tx`update auth_tokens set used_at = now() where user_id = ${userId} and kind = ${kind} and used_at is null`;
  await tx`insert into auth_tokens (user_id, kind, token_hash, expires_at)
           values (${userId}, ${kind}, ${sha256(token)}, now() + make_interval(hours => ${hours}))`;
  const path = kind === 'invite' ? 'invitacion' : 'restablecer';
  return `${env().APP_URL}/${path}?token=${token}`;
}

/** Invita a un usuario: genera el enlace y lo envía por correo (AUTH-03). Devuelve el enlace. */
export async function inviteUser(tx: Tx, user: { id: string; email: string; full_name: string }, clinicName: string) {
  const link = await createAuthLink(tx, user.id, 'invite');
  await sendEmail(tx, {
    to: user.email,
    subject: `Tu acceso a ${clinicName}`,
    text: `Hola ${user.full_name}:\n\nSe creó tu cuenta en el sistema de ${clinicName}.\nDefine tu contraseña en este enlace (vigente 72 horas):\n\n${link}\n\nSi no esperabas este correo, ignóralo.`,
  });
  return link;
}
