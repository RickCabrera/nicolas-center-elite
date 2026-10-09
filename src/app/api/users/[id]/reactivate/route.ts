import { route } from '@/lib/api';
import { loadUser } from '@/modules/team/server';

// EQ-04 · Reactiva una cuenta desactivada. No le devuelve pacientes: se reasignan desde Equipo.
export const POST = route({ auth: 'owner' }, async ({ params, system }) =>
  system(async (tx) => {
    const u = await loadUser(tx, params.id);
    if (!u.active) await tx`update users set active = true, deactivated_at = null, failed_attempts = 0, locked_until = null where id = ${u.id}`;
    return loadUser(tx, u.id);
  }),
);
