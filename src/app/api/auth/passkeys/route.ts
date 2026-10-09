import { route } from '@/lib/api';

// CFG-08 · Passkeys registradas del usuario actual.
export const GET = route({ auth: 'user' }, async ({ user, system }) =>
  system((tx) => tx`select id, name, created_at, last_used_at from passkeys where user_id = ${user.id} order by created_at desc`),
);
