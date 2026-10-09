'use client';
import { useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { Badge, Button, Card, Confirm, Empty, ErrorNote, Field, Input, Notice, ScanOverlay, Skeleton, useForm, useToast } from '@/components/ui';
import { api, ApiError, refresh, useApi } from '@/lib/client';
import { fmtDateTime } from '@/lib/dates';
import type { Passkey, SessionRow } from './types';

/** CFG-08 / AUTH-02 · Cambio de contraseña del propio usuario. */
export function PasswordCard() {
  const toast = useToast();
  const f = useForm({ current: '', next: '', repeat: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const { current, next, repeat } = f.values;
    const e: Record<string, string> = {};
    if (!current) e.current = 'Escribe tu contraseña actual.';
    if (next.length < 10) e.next = 'La contraseña debe tener al menos 10 caracteres.';
    else if (!/[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(next) || !/\d/.test(next)) e.next = 'La contraseña debe incluir letras y números.';
    if (repeat !== next) e.repeat = 'No coincide con la nueva contraseña.';
    if (Object.keys(e).length) { f.setErrors(e); setError(''); return; }
    setBusy(true); setError('');
    try {
      await api.post('/api/auth/password', { current, next });
      f.reset({ current: '', next: '', repeat: '' });
      await refresh('/api/profile/sessions');
      toast('Contraseña actualizada');
    } catch (err) {
      const a = err instanceof ApiError ? err : null;
      if (a?.fields) f.setErrors(a.fields);
      setError(a?.message ?? 'No se pudo cambiar la contraseña.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Contraseña" blue>
      <form className="stack md" onSubmit={submit} noValidate>
        <Field label="Contraseña actual" error={f.errors.current}>
          <Input {...f.bind('current')} type="password" autoComplete="current-password" />
        </Field>
        <Field label="Nueva contraseña" error={f.errors.next}>
          <Input {...f.bind('next')} type="password" autoComplete="new-password" />
        </Field>
        <Field label="Repite la nueva contraseña" error={f.errors.repeat}>
          <Input {...f.bind('repeat')} type="password" autoComplete="new-password" />
        </Field>
        <div className="t-small">Mínimo 10 caracteres, con letras y números, y sin incluir tu nombre de usuario. Al cambiarla se cierran tus demás sesiones.</div>
        {error && <div className="notice red" role="alert">{error}</div>}
        <Button type="submit" variant="primary" loading={busy} style={{ alignSelf: 'flex-start' }}>Cambiar contraseña</Button>
      </form>
    </Card>
  );
}

/** AUTH-04 · Passkeys: entrar con la huella o el rostro del propio celular o computadora. */
export function PasskeysCard() {
  const toast = useToast();
  const { data, error, mutate } = useApi<Passkey[]>('/api/auth/passkeys');
  const [supported, setSupported] = useState<boolean | null>(null);
  const [name, setName] = useState('');
  const [scanning, setScanning] = useState(false);
  const [problem, setProblem] = useState('');
  const [removing, setRemoving] = useState<Passkey | null>(null);
  useEffect(() => { setSupported(typeof window !== 'undefined' && !!window.PublicKeyCredential); }, []);

  const register = async () => {
    setProblem('');
    setScanning(true);
    try {
      const options = await api.post<Parameters<typeof startRegistration>[0]['optionsJSON']>('/api/auth/passkeys/register-options');
      const response = await startRegistration({ optionsJSON: options });
      await api.post('/api/auth/passkeys/register-verify', { response, name: name.trim() || undefined });
      setName('');
      await mutate();
      toast('Dispositivo registrado');
    } catch (err) {
      const n = (err as Error)?.name;
      if (err instanceof ApiError) setProblem(err.message);
      else if (n === 'NotAllowedError') setProblem('Registro cancelado. Puedes intentarlo de nuevo cuando quieras.');
      else if (n === 'InvalidStateError') setProblem('Este dispositivo ya está registrado en tu cuenta.');
      else setProblem('No se pudo registrar este dispositivo. Revisa que tenga huella, rostro o PIN configurado.');
    } finally {
      setScanning(false);
    }
  };

  return (
    <Card title="Acceso con huella de este dispositivo" blue>
      <div className="stack md">
        <div className="t-small">
          Registra el lector de huella o de rostro de tu celular o computadora para entrar sin escribir la contraseña.
          Es independiente del lector de recepción: aquí la huella nunca sale de tu dispositivo.
        </div>
        <ErrorNote error={error} retry={() => mutate()} />
        {!data && !error && <Skeleton rows={1} height={48} />}
        {data && data.length === 0 && <Empty>Aún no registras ningún dispositivo.</Empty>}
        {data?.map((k) => (
          <div key={k.id} className="row" style={{ flexWrap: 'wrap' }}>
            <div className="grow" style={{ minWidth: 160 }}>
              <div className="t-strong ellipsis">{k.name}</div>
              <div className="t-small">Alta: {fmtDateTime(k.created_at)} · {k.last_used_at ? `Último uso: ${fmtDateTime(k.last_used_at)}` : 'Sin usar todavía'}</div>
            </div>
            <Button size="sm" variant="danger" onClick={() => setRemoving(k)}>Quitar</Button>
          </div>
        ))}
        {supported === false && (
          <Notice tone="gold">Este navegador no permite acceso con huella (WebAuthn). Usa un navegador actualizado y abre el sistema con https.</Notice>
        )}
        {supported && (
          <div className="hstack wrap" style={{ alignItems: 'flex-end' }}>
            <Field label="Nombre del dispositivo (opcional)" className="grow">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Mi celular, Laptop de recepción…" />
            </Field>
            <Button variant="primary" onClick={register} loading={scanning}>Registrar este dispositivo</Button>
          </div>
        )}
        {problem && <div className="notice red" role="alert">{problem}</div>}
      </div>
      {scanning && <ScanOverlay title="Registrando dispositivo" sub="Confirma con la huella, el rostro o el PIN de este dispositivo" />}
      <Confirm open={!!removing} onClose={() => setRemoving(null)} title="Quitar dispositivo" danger confirmLabel="Quitar"
        message={<>«{removing?.name}» ya no podrá entrar a tu cuenta con huella. Tu contraseña sigue funcionando.</>}
        onConfirm={async () => {
          try {
            await api.del(`/api/auth/passkeys/${removing!.id}`);
            await mutate();
            toast('Dispositivo quitado');
          } catch (e) {
            toast(e instanceof ApiError ? e.message : 'No se pudo quitar.', 'error');
          }
          setRemoving(null);
        }} />
    </Card>
  );
}

const METHOD: Record<string, string> = { password: 'Contraseña', passkey: 'Huella del dispositivo', token: 'Enlace de acceso' };

/** CFG-08 · Sesiones abiertas: dónde está iniciada la cuenta y cierre remoto. */
export function SessionsCard() {
  const toast = useToast();
  const { data, error, mutate } = useApi<SessionRow[]>('/api/profile/sessions');
  const [busy, setBusy] = useState('');
  const others = data?.filter((s) => !s.current) ?? [];

  const revoke = async (target: string) => {
    setBusy(target);
    try {
      const r = await api.post<{ revoked: number }>('/api/profile/sessions', { revoke: target });
      await mutate();
      toast(r.revoked === 1 ? 'Sesión cerrada' : `${r.revoked} sesiones cerradas`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'No se pudo cerrar la sesión.', 'error');
      await mutate();
    } finally {
      setBusy('');
    }
  };

  return (
    <Card title="Sesiones abiertas" blue action={others.length > 0
      ? <button type="button" className="btn-link" disabled={busy === 'others'} onClick={() => revoke('others')}>Cerrar las demás</button> : undefined}>
      <div className="stack sm">
        <ErrorNote error={error} retry={() => mutate()} />
        {!data && !error && <Skeleton rows={1} height={48} />}
        {data?.map((s) => (
          <div key={s.id} className="row" style={{ flexWrap: 'wrap' }}>
            <div className={`dot ${s.current ? 'green' : ''}`} />
            <div className="grow" style={{ minWidth: 160 }}>
              <div className="t-strong ellipsis">{s.device}</div>
              <div className="t-small">Inicio: {fmtDateTime(s.created_at)} · Última actividad: {fmtDateTime(s.last_seen_at)} · {METHOD[s.method] ?? s.method}</div>
            </div>
            {s.current ? <Badge tone="green">Esta sesión</Badge>
              : <Button size="sm" loading={busy === s.id} onClick={() => revoke(s.id)}>Cerrar</Button>}
          </div>
        ))}
        {data && others.length === 0 && <div className="t-small">No tienes sesiones abiertas en otros dispositivos.</div>}
      </div>
    </Card>
  );
}
