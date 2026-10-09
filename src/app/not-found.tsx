import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="auth-wrap">
      <div className="card lg stack" style={{ maxWidth: 420 }}>
        <h1 className="t-h3">Página no encontrada</h1>
        <p className="t-body">La dirección no existe o ya no está disponible.</p>
        <Link href="/inicio" className="btn primary">Ir a inicio</Link>
      </div>
    </div>
  );
}
