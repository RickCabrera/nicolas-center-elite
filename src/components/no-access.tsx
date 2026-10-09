import Link from 'next/link';
import type { ReactNode } from 'react';

/** AUTH-07 / AUTH-10 · Aviso de una sección que el rol de la sesión no puede abrir. La API responde 403 por su cuenta. */
export function NoAccess({ children }: { children: ReactNode }) {
  return (
    <div className="page" style={{ paddingTop: 40 }}>
      <div className="card lg stack" style={{ maxWidth: 480 }}>
        <h1 className="t-h3">Sin acceso</h1>
        <p className="t-body">{children}</p>
        <Link href="/inicio" className="btn primary">Ir a inicio</Link>
      </div>
    </div>
  );
}
