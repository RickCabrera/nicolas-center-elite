'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader, ROLE_LABEL } from '@/components/shell';
import { Badge, Button, Card, Checkbox, ErrorNote, Field, Input, KV, Select, Skeleton, useForm, useToast } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { api, ApiError, refresh, useApi } from '@/lib/client';
import { HoursEditor } from '@/modules/agenda/hours-editor';
import { EnrollFingerprint } from '@/modules/attendance/enroll-fingerprint';
import { TITLE_OPTIONS } from '@/modules/team/therapist-sheet';
import { PasskeysCard, PasswordCard, SessionsCard } from './security-cards';
import type { Profile } from './types';

/** CFG-08 · Mi perfil: datos propios, cédula, contraseña, passkeys, sesiones, horario y huella. */
export function ProfileView() {
  const user = useUser();
  const router = useRouter();
  const { data, error, mutate } = useApi<Profile>('/api/profile', { revalidateOnFocus: false });
  const [leaving, setLeaving] = useState(false);

  const logout = async () => {
    setLeaving(true);
    try { await api.post('/api/auth/logout'); } catch { /* la cookie se limpia igual */ }
    router.replace('/login');
    router.refresh();
  };
  // Tras guardar: refresca la lectura, los catálogos y el nombre que muestra el menú (viene del servidor).
  const saved = async (p: Profile) => {
    await mutate(p, { revalidate: false });
    await refresh('/api/meta', '/api/users');
    router.refresh();
  };

  return (
    <div className="page">
      <PageHeader title="Mi perfil" sub={user.username} />
      <ErrorNote error={error} retry={() => mutate()} />
      {!data && !error && <Skeleton rows={3} height={160} />}
      {data && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <DataCard key={`d-${data.id}`} profile={data} onSaved={saved} />
          {/* AUTH-10 · Recepción no emite documentos clínicos: no captura cédula. */}
          {data.role !== 'reception' && <LicenseCard key={`l-${data.id}`} profile={data} onSaved={saved} />}
          <PasswordCard />
          <PasskeysCard />
          <SessionsCard />
          {data.role === 'therapist' && (
            <Card title="Mi horario" blue>
              <div className="stack md">
                <div className="t-small">La agenda solo acepta tus citas dentro de este horario.</div>
                <HoursEditor userId={data.id} />
              </div>
            </Card>
          )}
          <Card title="Mi huella en el lector de recepción" blue>
            <div className="stack md">
              <div className="t-small">Con ella registras tu entrada y salida en recepción. La huella se guarda solo dentro del lector; el sistema nunca la ve.</div>
              <EnrollFingerprint personType="staff" personId={data.id} enrolledAt={data.fingerprint_enrolled_at} onDone={() => mutate()} />
            </div>
          </Card>
        </div>
      )}
      <Button onClick={logout} loading={leaving} style={{ alignSelf: 'flex-start' }}>Cerrar sesión</Button>
    </div>
  );
}

function useSave<T extends Record<string, unknown>>(f: ReturnType<typeof useForm<T>>, onSaved: (p: Profile) => Promise<void>) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (body: Record<string, unknown>, done = 'Cambios guardados') => {
    setBusy(true); setError('');
    try {
      const p = await api.patch<Profile>('/api/profile', body);
      await onSaved(p);
      toast(done);
    } catch (e) {
      const a = e instanceof ApiError ? e : null;
      if (a?.fields) f.setErrors(a.fields);
      setError(a?.message ?? 'No se pudo guardar. Intenta de nuevo.');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, save, setError };
}

function DataCard({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => Promise<void> }) {
  const f = useForm({ title: profile.title, full_name: profile.full_name, email: profile.email, phone: profile.phone, specialty: profile.specialty });
  const { busy, error, save, setError } = useSave(f, onSaved);
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const v = f.values;
    const e: Record<string, string> = {};
    if (v.full_name.trim().length < 3) e.full_name = 'Escribe tu nombre completo.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email.trim())) e.email = 'Escribe un correo válido.';
    if (Object.keys(e).length) { f.setErrors(e); setError(''); return; }
    void save({ ...v });
  };
  return (
    <Card title="Mis datos" blue>
      <form className="stack md" onSubmit={submit} noValidate>
        <div className="grid-form">
          <Field label="Título" error={f.errors.title}>
            <Select {...f.bind('title')}>{TITLE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>
          </Field>
          <Field label="Nombre completo" error={f.errors.full_name} className="col-span">
            <Input {...f.bind('full_name')} autoComplete="name" />
          </Field>
          <Field label="Correo" error={f.errors.email} hint="Ahí llegan los enlaces para recuperar tu contraseña.">
            <Input {...f.bind('email')} type="email" inputMode="email" autoCapitalize="none" autoComplete="email" />
          </Field>
          <Field label="Teléfono" error={f.errors.phone}>
            <Input {...f.bind('phone')} type="tel" inputMode="tel" placeholder="10 dígitos" autoComplete="tel" />
          </Field>
          {profile.role !== 'reception' && (
            <Field label="Especialidad" error={f.errors.specialty} className="col-span">
              <Input {...f.bind('specialty')} placeholder="Deportiva, pediátrica, neurológica…" />
            </Field>
          )}
        </div>
        <div className="grid-kv">
          <KV label="Usuario">{profile.username}</KV>
          <KV label="Rol">{ROLE_LABEL[profile.role]}</KV>
          <KV label="Sede">{profile.location_name ?? (profile.role === 'owner' ? 'Todas' : 'Sin asignar')}</KV>
        </div>
        {profile.role !== 'owner' && <div className="t-small">El usuario y la sede los cambia el dueño de la clínica desde Equipo.</div>}
        {error && <div className="notice red" role="alert">{error}</div>}
        <Button type="submit" variant="primary" loading={busy} style={{ alignSelf: 'flex-start' }}>Guardar datos</Button>
      </form>
    </Card>
  );
}

function LicenseCard({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => Promise<void> }) {
  const toast = useToast();
  const isOwner = profile.role === 'owner';
  const f = useForm({
    license_number: profile.license_number ?? '', license_institution: profile.license_institution ?? '',
    specialty_license: profile.specialty_license ?? '', is_physician: profile.is_physician,
  });
  const { busy, error, save, setError } = useSave(f, onSaved);
  const [toggling, setToggling] = useState(false);
  const noLicense = f.values.license_number.trim() === '';

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const { is_physician, ...body } = f.values;
    if (profile.is_physician && noLicense && !(isOwner && !is_physician)) {
      f.setErrors({ license_number: 'La cédula es obligatoria para un médico habilitado.' }); setError(''); return;
    }
    // La facultad de recetar no pasa por /api/profile: solo el dueño la cambia, por la ruta de Equipo.
    if (isOwner && is_physician !== profile.is_physician) {
      setToggling(true);
      try {
        await api.patch(`/api/users/${profile.id}`, { ...body, is_physician });
      } catch (e) {
        const a = e instanceof ApiError ? e : null;
        if (a?.fields) f.setErrors(a.fields);
        setError(a?.message ?? 'No se pudo guardar.');
        setToggling(false);
        return;
      }
      setToggling(false);
      toast('Cambios guardados');
      await onSaved({ ...profile, ...body, license_number: body.license_number || null, license_institution: body.license_institution || null,
        specialty_license: body.specialty_license || null, is_physician });
      return;
    }
    void save(body);
  };

  return (
    <Card title="Cédula profesional" blue action={profile.is_physician ? <Badge tone="gold">Médico</Badge> : undefined}>
      <form className="stack md" onSubmit={submit} noValidate>
        <div className="t-small">Tu cédula aparece en las indicaciones y recetas que emites. Sin cédula no puedes emitir documentos.</div>
        <div className="grid-form">
          <Field label="Cédula profesional" error={f.errors.license_number}>
            <Input {...f.bind('license_number')} inputMode="numeric" autoComplete="off" placeholder="Número de cédula" />
          </Field>
          <Field label="Institución que expidió el título" error={f.errors.license_institution}>
            <Input {...f.bind('license_institution')} placeholder="Universidad" />
          </Field>
          <Field label="Cédula de especialidad (opcional)" error={f.errors.specialty_license}>
            <Input {...f.bind('specialty_license')} inputMode="numeric" autoComplete="off" />
          </Field>
        </div>
        <div className="row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8, padding: 12 }}>
          {isOwner ? (
            <Checkbox checked={f.values.is_physician} disabled={noLicense && !f.values.is_physician}
              onChange={(e) => f.set('is_physician', e.target.checked)} label={<b>Soy médico con cédula (puedo emitir recetas médicas)</b>} />
          ) : (
            <div className="t-strong">{profile.is_physician ? 'Habilitado para emitir recetas médicas' : 'Emites indicaciones fisioterapéuticas'}</div>
          )}
          <div className="t-small">
            Solo un médico con cédula profesional puede prescribir medicamentos (art. 28 Bis de la Ley General de Salud).{' '}
            {isOwner
              ? 'Actívalo únicamente si eres médico titulado; para tu equipo se habilita desde Equipo.'
              : profile.is_physician
                ? 'Esta facultad la habilitó el dueño de la clínica; por eso tu cédula no puede quedar vacía.'
                : 'Esta facultad la habilita el dueño de la clínica desde Equipo, solo para médicos.'}
          </div>
        </div>
        {error && <div className="notice red" role="alert">{error}</div>}
        <Button type="submit" variant="primary" loading={busy || toggling} style={{ alignSelf: 'flex-start' }}>Guardar cédula</Button>
      </form>
    </Card>
  );
}
