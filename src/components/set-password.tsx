'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError, useApi } from '@/lib/client';
import { Button, Field, Input, Notice, Skeleton } from './ui';

/** Pantalla compartida por invitación (AUTH-03) y restablecimiento (AUTH-02). */
export function SetPassword({ mode }: { mode: 'invite' | 'reset' }) {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const info = useApi<{ full_name: string; username: string }>(token ? `/api/auth/token-info?token=${encodeURIComponent(token)}` : null, { revalidateOnFocus: false });
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== again) return setError('Las contraseñas no coinciden.');
    setBusy(true); setError('');
    try {
      await api.post('/api/auth/reset', { token, password });
      router.replace('/inicio');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar.');
      setBusy(false);
    }
  };

  if (!token || info.error) {
    return (
      <div className="card lg stack" style={{ padding: 20 }}>
        <Notice tone="red">{info.error?.message ?? 'El enlace no es válido.'}</Notice>
        <Link href={mode === 'invite' ? '/login' : '/recuperar'} className="btn block">{mode === 'invite' ? 'Ir a iniciar sesión' : 'Solicitar un enlace nuevo'}</Link>
      </div>
    );
  }
  if (!info.data) return <div className="card lg"><Skeleton rows={3} /></div>;
  return (
    <form className="card lg stack" onSubmit={submit} style={{ padding: 20 }} noValidate>
      <h1 className="t-h3">{mode === 'invite' ? 'Activa tu cuenta' : 'Nueva contraseña'}</h1>
      <div className="t-sub">
        {mode === 'invite' ? `Hola ${info.data.full_name}. ` : ''}Tu usuario es <b className="blue">{info.data.username}</b>. Define una contraseña de al menos 10 caracteres con letras y números.
      </div>
      <Field label="Contraseña"><Input className="round" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      <Field label="Repite la contraseña" error={error}><Input className="round" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} invalid={!!error} /></Field>
      <Button type="submit" variant="primary" size="lg" block loading={busy}>Guardar y entrar</Button>
    </form>
  );
}
