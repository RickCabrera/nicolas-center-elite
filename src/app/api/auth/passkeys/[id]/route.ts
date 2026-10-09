import { route } from '@/lib/api';
import { notFound } from '@/lib/errors';

// AUTH-04 · Revocar una passkey propia.
export const DELETE = route({ auth: 'user' }, async ({ user, params, system }) => {
  const gone = await system((tx) => tx`delete from passkeys where id = ${params.id} and user_id = ${user.id} returning id`);
  if (!gone.length) throw notFound('No se encontró ese dispositivo.');
  await system((tx) => tx`select log_event('security', 'Passkey revocada')`);
  return null;
});
