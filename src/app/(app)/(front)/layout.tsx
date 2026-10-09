import type { ReactNode } from 'react';
import { NoAccess } from '@/components/no-access';
import { requireUser } from '@/lib/auth/server';

// AUTH-10 · Mensualidades es del mostrador: dueño y recepción. El fisioterapeuta no entra;
// aunque escriba la URL a mano, la pantalla no se dibuja y la API responde 403.
export default async function FrontDeskOnly({ children }: { children: ReactNode }) {
  const user = await requireUser();
  if (user.role !== 'owner' && user.role !== 'reception') {
    return <NoAccess>Esta sección es para el dueño de la clínica y recepción.</NoAccess>;
  }
  return <>{children}</>;
}
