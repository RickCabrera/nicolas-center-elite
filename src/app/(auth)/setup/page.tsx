'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError, useApi } from '@/lib/client';
import { Button, Field, Input, Notice, Skeleton, useForm } from '@/components/ui';

// DEP-02 · Primer arranque: crea la cuenta del dueño. Deja de existir en cuanto hay un usuario.
export default function SetupPage() {
  const router = useRouter();
  const status = useApi<{ needed: boolean; token_required: boolean }>('/api/setup', { revalidateOnFocus: false });
  const f = useForm({ token: '', full_name: '', username: '', email: '', password: '', again: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (status.data && !status.data.needed) router.replace('/login'); }, [status.data, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.values.password !== f.values.again) return f.setErrors({ again: 'Las contraseñas no coinciden.' });
    setBusy(true); setError('');
    try {
      const { again: _a, ...body } = f.values;
      await api.post('/api/setup', body);
      router.replace('/inicio');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) { setError(err.message); f.setErrors(err.fields ?? {}); }
      setBusy(false);
    }
  };
  if (!status.data?.needed) return <div className="card lg"><Skeleton rows={4} /></div>;
  return (
    <form className="card lg stack" onSubmit={submit} style={{ padding: 20 }} noValidate>
      <h1 className="t-h3">Configuración inicial</h1>
      <div className="t-sub">Crea la cuenta del dueño. Con ella se administra todo lo demás: sedes, equipo, membresías y lector de huella.</div>
      {status.data.token_required && (
        <Field label="Token de configuración" hint="Es el valor de la variable SETUP_TOKEN del servidor." error={f.errors.token}><Input className="round" {...f.bind('token')} autoCapitalize="none" /></Field>
      )}
      <Field label="Nombre completo" error={f.errors.full_name}><Input className="round" {...f.bind('full_name')} autoComplete="name" /></Field>
      <Field label="Usuario" hint="Minúsculas, sin espacios. Ej. nicolas.h" error={f.errors.username}><Input className="round" {...f.bind('username')} autoCapitalize="none" autoComplete="username" /></Field>
      <Field label="Correo" error={f.errors.email}><Input className="round" type="email" {...f.bind('email')} autoComplete="email" /></Field>
      <Field label="Contraseña" hint="Mínimo 10 caracteres, con letras y números." error={f.errors.password}><Input className="round" type="password" {...f.bind('password')} autoComplete="new-password" /></Field>
      <Field label="Repite la contraseña" error={f.errors.again}><Input className="round" type="password" {...f.bind('again')} autoComplete="new-password" /></Field>
      {error && <Notice tone="red">{error}</Notice>}
      <Button type="submit" variant="primary" size="lg" block loading={busy}>Crear cuenta y entrar</Button>
    </form>
  );
}
