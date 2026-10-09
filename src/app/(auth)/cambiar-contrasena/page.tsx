'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/client';
import { Button, Field, Input, Notice, useForm } from '@/components/ui';

// AUTH-02 · Cambio obligatorio de contraseña en el primer ingreso.
export default function ForcedPasswordPage() {
  const router = useRouter();
  const f = useForm({ current: '', next: '', again: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.values.next !== f.values.again) return f.setErrors({ again: 'Las contraseñas no coinciden.' });
    setBusy(true); setError('');
    try {
      await api.post('/api/auth/password', { current: f.values.current, next: f.values.next });
      router.replace('/inicio');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) { setError(err.fields ? '' : err.message); f.setErrors(err.fields ?? {}); }
      setBusy(false);
    }
  };
  return (
    <form className="card lg stack" onSubmit={submit} style={{ padding: 20 }} noValidate>
      <h1 className="t-h3">Cambia tu contraseña</h1>
      <div className="t-sub">Por seguridad debes definir una contraseña propia antes de continuar.</div>
      <Field label="Contraseña actual" error={f.errors.current}><Input className="round" type="password" {...f.bind('current')} autoComplete="current-password" /></Field>
      <Field label="Nueva contraseña" hint="Mínimo 10 caracteres, con letras y números." error={f.errors.next}><Input className="round" type="password" {...f.bind('next')} autoComplete="new-password" /></Field>
      <Field label="Repite la nueva contraseña" error={f.errors.again}><Input className="round" type="password" {...f.bind('again')} autoComplete="new-password" /></Field>
      {error && <Notice tone="red">{error}</Notice>}
      <Button type="submit" variant="primary" size="lg" block loading={busy}>Guardar</Button>
    </form>
  );
}
