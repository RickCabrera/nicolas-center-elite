import Link from 'next/link';
import type { ReactNode } from 'react';

/** Marco de las páginas públicas de pago (el paciente llega aquí desde Stripe, sin sesión). */
export function PayShell({ name, children }: { name: string; children: ReactNode }) {
  const [first, ...rest] = name.split(' ');
  return (
    <main style={{ minHeight: '100vh', padding: 'clamp(24px, 6vw, 72px) 16px 64px' }}>
      <div className="stack lg" style={{ maxWidth: 520, margin: '0 auto' }}>
        <header style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
          { }
          <img src="/logo.png" alt="" className="auth-logo" style={{ width: 88, height: 88 }} />
          <div className="auth-name"><span className="blue">{first}</span> {rest.join(' ')}</div>
        </header>
        <article className="card lg" lang="es" style={{ textAlign: 'center' }}>{children}</article>
        <footer className="t-small" style={{ textAlign: 'center' }}>
          {name} · <Link href="/privacidad">Aviso de privacidad</Link>
        </footer>
      </div>
    </main>
  );
}
