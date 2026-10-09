import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireUser } from '@/lib/auth/server';

// AUTH-07 · Mensualidades, Equipo y Configuración son solo del dueño.
// Aunque alguien escriba la URL a mano, la pantalla no se dibuja y la API responde 403.
export default async function OwnerOnly({ children }: { children: ReactNode }) {
  const user = await requireUser();
  if (user.role !== 'owner') {
    return (
      <div className="page" style={{ paddingTop: 40 }}>
        <div className="card lg stack" style={{ maxWidth: 480 }}>
          <h1 className="t-h3">Sin acceso</h1>
          <p className="t-body">Esta sección es exclusiva del dueño de la clínica.</p>
          <Link href="/inicio" className="btn primary">Ir a inicio</Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
