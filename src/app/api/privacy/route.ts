import { route } from '@/lib/api';
import { loadPrivacy } from '@/modules/settings/server';

// LEG-03 · Aviso de privacidad vigente con los marcadores resueltos. Público: lo lee cualquier persona sin sesión.
export const GET = route({ auth: 'public' }, async ({ db }) => loadPrivacy(db));
