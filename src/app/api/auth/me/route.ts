import { route } from '@/lib/api';

export const GET = route({ auth: 'user', allowPendingPassword: true }, async ({ user }) => user);
