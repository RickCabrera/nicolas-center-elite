import { z } from 'zod';
import { route } from '@/lib/api';
import { createAuthLink } from '@/lib/auth/tokens';
import { sendEmail } from '@/lib/email';

const Body = z.object({ identifier: z.string().trim().min(1).max(200) });

// AUTH-02 · Recuperación de contraseña. Responde igual exista o no la cuenta.
export const POST = route({ auth: 'public', body: Body }, async ({ db, body }) => {
  const id = body.identifier.toLowerCase();
  const [u] = await db<{ id: string; email: string; full_name: string }[]>`
    select id, email, full_name from users where active and (lower(username) = ${id} or lower(email) = ${id}) limit 1`;
  if (u) {
    const [recent] = await db<{ n: number }[]>`
      select count(*)::int as n from auth_tokens where user_id = ${u.id} and kind = 'reset' and created_at > now() - interval '15 minutes'`;
    if (recent.n < 3) {
      const link = await createAuthLink(db, u.id, 'reset');
      await sendEmail(db, {
        to: u.email,
        subject: 'Restablece tu contraseña · Nicolas Center Elite',
        text: `Hola ${u.full_name}:\n\nRecibimos una solicitud para restablecer tu contraseña.\nUsa este enlace (vigente 2 horas):\n\n${link}\n\nSi no fuiste tú, ignora este correo; tu contraseña no cambia.`,
      });
    }
  }
  return null;
});
