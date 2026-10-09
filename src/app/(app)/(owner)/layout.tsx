import type { ReactNode } from 'react';
import { NoAccess } from '@/components/no-access';
import { requireUser } from '@/lib/auth/server';

// AUTH-07 · Equipo y Configuración son solo del dueño (Mensualidades vive en el grupo (front): dueño y recepción).
// Aunque alguien escriba la URL a mano, la pantalla no se dibuja y la API responde 403.
export default async function OwnerOnly({ children }: { children: ReactNode }) {
  const user = await requireUser();
  if (user.role !== 'owner') return <NoAccess>Esta sección es exclusiva del dueño de la clínica.</NoAccess>;
  return <>{children}</>;
}
