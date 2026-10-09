'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, ApiError } from '@/lib/client';
import { Button, Field, Input, Notice } from '@/components/ui';

export default function RecoverPage() {
  const [identifier, setIdentifier] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) return setError('Escribe tu usuario o correo.');
    setBusy(true); setError('');
    try { await api.post('/api/auth/forgot', { identifier }); setSent(true); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'No se pudo enviar.'); }
    finally { setBusy(false); }
  };
  return (
    <form className="card lg stack" onSubmit={submit} style={{ padding: 20 }} noValidate>
      <h1 className="t-h3">Recuperar contraseña</h1>
      {sent ? (
        <Notice tone="green">Si la cuenta existe, enviamos un enlace a su correo. Es válido por 2 horas.</Notice>
      ) : (
        <>
          <Field label="Usuario o correo" error={error}>
            <Input className="round" autoCapitalize="none" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} invalid={!!error} />
          </Field>
          <Button type="submit" variant="primary" size="lg" block loading={busy}>Enviar enlace</Button>
        </>
      )}
      <Link href="/login" className="btn-link dim" style={{ alignSelf: 'center', display: 'inline-flex', alignItems: 'center' }}>← Volver a iniciar sesión</Link>
    </form>
  );
}
