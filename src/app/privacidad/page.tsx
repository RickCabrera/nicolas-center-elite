import type { Metadata } from 'next';
import Link from 'next/link';
import { asSystem } from '@/lib/db';
import { ArcoForm } from '@/modules/settings/arco-form';
import { loadPrivacy } from '@/modules/settings/server';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Aviso de privacidad' };

// LEG-03 · Página pública (sin sesión): aviso de privacidad integral vigente y formulario de derechos ARCO.
export default async function PrivacidadPage() {
  let privacy: Awaited<ReturnType<typeof loadPrivacy>> | null = null;
  try {
    privacy = await asSystem((tx) => loadPrivacy(tx));
  } catch (e) {
    console.error('[privacidad] no se pudo cargar el aviso:', e);
  }
  const name = privacy?.clinic_name ?? 'Nicolas Center Elite';
  const [first, ...rest] = name.split(' ');
  // La primera línea del aviso es su título; el resto son párrafos separados por líneas en blanco.
  const blocks = (privacy?.notice ?? '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const hasTitle = blocks.length > 1 && blocks[0].length <= 80 && blocks[0] === blocks[0].toUpperCase();
  const title = hasTitle ? blocks[0] : 'AVISO DE PRIVACIDAD';
  const paragraphs = hasTitle ? blocks.slice(1) : blocks;

  return (
    <main style={{ minHeight: '100vh', padding: 'clamp(24px, 5vw, 56px) 16px 64px' }}>
      <div className="stack lg" style={{ maxWidth: 720, margin: '0 auto' }}>
        <header style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
          { }
          <img src="/logo.png" alt="" className="auth-logo" style={{ width: 88, height: 88 }} />
          <div className="auth-name"><span className="blue">{first}</span> {rest.join(' ')}</div>
        </header>

        <article className="card lg" lang="es">
          <h1 className="t-h2" style={{ textTransform: 'none', lineHeight: 1.2 }}>{title.charAt(0) + title.slice(1).toLowerCase()}</h1>
          {privacy ? (
            <div className="stack" style={{ marginTop: 16, gap: 14 }}>
              {paragraphs.map((p, i) => (
                <p key={i} className="t-body" style={{ fontSize: 16, lineHeight: 1.65, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{p}</p>
              ))}
            </div>
          ) : (
            <div className="notice red" role="alert" style={{ marginTop: 16 }}>
              No pudimos cargar el aviso de privacidad en este momento. Intenta de nuevo en unos minutos o solicítalo en recepción.
            </div>
          )}
        </article>

        <section className="card lg" aria-labelledby="arco-titulo">
          <h2 id="arco-titulo" className="t-h2" style={{ fontSize: 19 }}>Ejercer mis derechos ARCO</h2>
          <p className="t-sub" style={{ margin: '8px 0 16px', fontSize: 14 }}>
            Puedes pedir Acceso a tus datos, su Rectificación, su Cancelación u Oponerte a un uso específico. Llena este formulario o preséntalo en recepción.
          </p>
          <ArcoForm clinicName={name} />
        </section>

        <footer className="t-small" style={{ textAlign: 'center' }}>
          {name} · <Link href="/login">Acceso del personal</Link>
        </footer>
      </div>
    </main>
  );
}
