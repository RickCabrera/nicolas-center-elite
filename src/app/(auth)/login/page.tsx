'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { api, ApiError } from '@/lib/client';
import { Button, Input, Notice, ScanOverlay } from '@/components/ui';
import { FingerRings } from '@/components/icons';

function LoginForm() {
  const router = useRouter();
  const expired = useSearchParams().get('expirada');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  // Primer arranque: si aún no existe ninguna cuenta, lleva a crear la del dueño.
  useEffect(() => {
    api.get<{ needed: boolean }>('/api/setup').then((r) => r.needed && router.replace('/setup')).catch(() => {});
  }, [router]);

  const enter = (r: { must_change_password: boolean }) => {
    router.replace(r.must_change_password ? '/cambiar-contrasena' : '/inicio');
    router.refresh();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return setError('Escribe tu usuario y contraseña.');
    setBusy(true);
    setError('');
    try {
      enter(await api.post('/api/auth/login', { username, password }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo iniciar sesión.');
      setBusy(false);
    }
  };

  // AUTH-04 · Usa la huella o el rostro del propio celular/computadora (passkey).
  const passkey = async () => {
    setError('');
    if (typeof window === 'undefined' || !window.PublicKeyCredential) {
      return setError('Este navegador no permite acceso con huella. Entra con tu usuario y contraseña.');
    }
    setScanning(true);
    try {
      const options = await api.post<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/api/auth/passkeys/login-options');
      const response = await startAuthentication({ optionsJSON: options });
      enter(await api.post('/api/auth/passkeys/login-verify', { response }));
    } catch (err) {
      setScanning(false);
      if (err instanceof ApiError) setError(err.message);
      else if ((err as Error)?.name === 'NotAllowedError') setError('Acceso con huella cancelado. Si aún no la registras, entra con tu contraseña y actívala en "Mi perfil".');
      else setError('No se pudo usar la huella de este dispositivo.');
    }
  };

  return (
    <>
      <form className="card lg" onSubmit={submit} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }} noValidate>
        {expired && !error && <Notice tone="gold">Tu sesión se cerró por inactividad. Vuelve a entrar.</Notice>}
        <div className="stack md">
          <label className="sr-only" htmlFor="u">Usuario</label>
          <Input id="u" className="round" placeholder="Usuario o correo" autoComplete="username" autoCapitalize="none" spellCheck={false}
            value={username} onChange={(e) => setUsername(e.target.value)} />
          <label className="sr-only" htmlFor="p">Contraseña</label>
          <Input id="p" className="round" type="password" placeholder="Contraseña" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <div className="notice red" role="alert">{error}</div>}
        <Button type="submit" variant="primary" size="lg" block loading={busy}>Iniciar sesión</Button>
        <div className="or">O</div>
        <button type="button" className="btn block" style={{ minHeight: 56, fontWeight: 600, fontSize: 13, letterSpacing: '.06em', gap: 12 }} onClick={passkey}>
          <FingerRings size={24} />Acceder con huella
        </button>
        <Link href="/recuperar" className="btn-link dim" style={{ alignSelf: 'center', display: 'inline-flex', alignItems: 'center' }}>¿Olvidaste tu contraseña?</Link>
      </form>
      <div className="t-small" style={{ textAlign: 'center', color: 'var(--ink-5)' }}>
        Acceso exclusivo para personal autorizado · <Link href="/privacidad">Aviso de privacidad</Link>
      </div>
      {scanning && <ScanOverlay title="Leyendo huella" sub="Usa el lector de huella o rostro de este dispositivo" />}
    </>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
