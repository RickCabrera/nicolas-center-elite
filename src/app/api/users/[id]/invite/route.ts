import { z } from 'zod';
import { route } from '@/lib/api';
import { conflict } from '@/lib/errors';
import { createAuthLink, inviteUser } from '@/lib/auth/tokens';
import { sendEmail } from '@/lib/email';
import { lastEmailStatus, loadUser } from '@/modules/team/server';

const Body = z.object({ force_reset: z.boolean().default(false) });

// EQ-02 / AUTH-03 · Reenvía la invitación (enlace nuevo; el anterior deja de servir). Si la cuenta ya tiene
// contraseña, el dueño puede forzar un restablecimiento: se envía un enlace de recuperación.
export const POST = route({ auth: 'owner', body: Body }, async ({ params, body, system }) =>
  system(async (tx) => {
    const u = await loadUser(tx, params.id);
    if (!u.active) throw conflict('La cuenta está desactivada. Reactívala antes de enviar un enlace de acceso.', 'inactive');
    const [clinic] = await tx<{ name: string }[]>`select name from clinic`;
    const clinicName = clinic?.name ?? 'la clínica';

    if (!u.has_password) {
      const link = await inviteUser(tx, { id: u.id, email: u.email, full_name: u.full_name }, clinicName);
      return { kind: 'invite' as const, email: u.email, invite_link: link, email_status: await lastEmailStatus(tx, u.email), expires_hours: 72 };
    }
    if (!body.force_reset) {
      throw conflict('Esta cuenta ya definió su contraseña. Para darle un enlace nuevo, usa "Restablecer contraseña".', 'has_password');
    }
    const link = await createAuthLink(tx, u.id, 'reset');
    const email_status = await sendEmail(tx, {
      to: u.email,
      subject: `Restablece tu contraseña de ${clinicName}`,
      text: `Hola ${u.full_name}:\n\nLa dirección de ${clinicName} solicitó que definas una contraseña nueva.\nHazlo en este enlace (vigente 2 horas):\n\n${link}\n\nMientras no lo uses, tu contraseña actual sigue funcionando.`,
    });
    await tx`select log_event('security', ${'Enlace de restablecimiento enviado a ' + u.display_name}, null, 'users', ${u.id})`;
    return { kind: 'reset' as const, email: u.email, invite_link: link, email_status, expires_hours: 2 };
  }),
);
