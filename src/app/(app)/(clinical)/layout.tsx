import type { ReactNode } from 'react';
import { NoAccess } from '@/components/no-access';
import { requireUser } from '@/lib/auth/server';

// AUTH-10 · Recetas y Estudios son información clínica (NOM-004-SSA3-2012): recepción no las abre.
// Aunque escriba la URL a mano, la pantalla no se dibuja y la API responde 403.
export default async function ClinicalOnly({ children }: { children: ReactNode }) {
  const user = await requireUser();
  if (user.role === 'reception') {
    return <NoAccess>Recepción no tiene acceso a la información clínica de los pacientes.</NoAccess>;
  }
  return <>{children}</>;
}
