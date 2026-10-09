import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireUser } from '@/lib/auth/server';
import { AppShell } from '@/components/shell';

export const dynamic = 'force-dynamic';

// Toda pantalla de la app pasa por aquí: sesión válida o se va al login.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  if (user.must_change_password) redirect('/cambiar-contrasena');
  return <AppShell user={user}>{children}</AppShell>;
}
