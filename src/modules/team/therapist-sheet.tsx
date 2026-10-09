'use client';
import { useState } from 'react';
import { useMeta } from '@/components/meta';
import { Badge, Button, Checkbox, Confirm, ErrorNote, Field, Input, Notice, Select, Sheet, Skeleton, useForm, useToast } from '@/components/ui';
import { api, ApiError, refresh, useApi } from '@/lib/client';
import { fmtDateTime } from '@/lib/dates';
import { HoursEditor } from '@/modules/agenda/hours-editor';
import { EnrollFingerprint } from '@/modules/attendance/enroll-fingerprint';
import type { InviteResult, TeamUserDetail } from './types';
import { InviteLinkBox, SectionTitle } from './ui';

export const TITLE_OPTIONS = [
  { value: '', label: 'Sin título' }, { value: 'L.F.T.', label: 'L.F.T.' }, { value: 'Lic.', label: 'Lic.' },
  { value: 'Dra.', label: 'Dra.' }, { value: 'Dr.', label: 'Dr.' },
];

type Form = {
  full_name: string; title: string; username: string; email: string; specialty: string; location_id: string; phone: string;
  license_number: string; license_institution: string; specialty_license: string; is_physician: boolean;
};
const EMPTY: Form = {
  full_name: '', title: 'L.F.T.', username: '', email: '', specialty: '', location_id: '', phone: '',
  license_number: '', license_institution: '', specialty_license: '', is_physician: false,
};
const toForm = (u: TeamUserDetail): Form => ({
  full_name: u.full_name, title: u.title, username: u.username, email: u.email, specialty: u.specialty,
  location_id: u.location_id ?? '', phone: u.phone, license_number: u.license_number ?? '',
  license_institution: u.license_institution ?? '', specialty_license: u.specialty_license ?? '', is_physician: u.is_physician,
});

/** Sugerencia de usuario a partir del nombre: "Karla Ocampo Ruiz" → "k.ocampo". */
function suggestUsername(name: string): string {
  const w = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
  if (w.length < 2) return w[0] ?? '';
  const surname = w.length === 2 ? w[1] : w.length === 3 ? w[1] : w[w.length - 2];
  return `${w[0][0]}.${surname}`.slice(0, 40);
}

const refreshTeam = () => refresh('/api/users', '/api/meta');

type Props = { open: boolean; onClose: () => void; userId?: string | null; onDeactivate?: (id: string) => void };

/** EQ-02 / EQ-03 / EQ-06 · Hoja de alta y edición de fisioterapeuta. */
export function TherapistSheet({ open, onClose, userId, onDeactivate }: Props) {
  return (
    <Sheet open={open} onClose={onClose} title={userId ? 'Editar fisioterapeuta' : 'Agregar fisioterapeuta'} wide>
      {open && (userId ? <EditBody userId={userId} onClose={onClose} onDeactivate={onDeactivate} /> : <CreateBody onClose={onClose} />)}
    </Sheet>
  );
}

/** Campos comunes del alta y la edición: Datos + Cédula y facultades. */
function Fields({ f, isNew, onName, onUsername }: { f: ReturnType<typeof useForm<Form>>; isNew: boolean; onName?: (v: string) => void; onUsername?: () => void }) {
  const { meta } = useMeta();
  const v = f.values;
  const e = f.errors;
  const locations = (meta?.locations ?? []).filter((l) => l.active || l.id === v.location_id);
  const noLicense = v.license_number.trim() === '';
  return (
    <>
      <SectionTitle>Datos</SectionTitle>
      <div className="grid-form">
        <Field label="Título" error={e.title}>
          <Select {...f.bind('title')}>{TITLE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>
        </Field>
        <Field label="Nombre completo" error={e.full_name} className="col-span">
          <Input {...f.bind('full_name')} onChange={(ev) => { f.set('full_name', ev.target.value); onName?.(ev.target.value); }}
            placeholder="Nombre y apellidos" autoComplete="off" />
        </Field>
        <Field label="Usuario" error={e.username} hint="Con él inicia sesión. Minúsculas, números, punto o guion.">
          <Input {...f.bind('username')} onChange={(ev) => { f.set('username', ev.target.value.toLowerCase().replace(/\s/g, '')); onUsername?.(); }}
            placeholder="k.ocampo" autoCapitalize="none" autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Correo" error={e.email} hint={isNew ? 'Ahí recibe la invitación para definir su contraseña.' : undefined}>
          <Input {...f.bind('email')} type="email" inputMode="email" placeholder="nombre@correo.com" autoCapitalize="none" autoComplete="off" />
        </Field>
        <Field label="Especialidad" error={e.specialty}>
          <Input {...f.bind('specialty')} placeholder="Deportiva, pediátrica, neurológica…" />
        </Field>
        <Field label="Sede" error={e.location_id}>
          <Select {...f.bind('location_id')}>
            <option value="">{meta ? 'Selecciona la sede' : 'Cargando…'}</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
        <Field label="Teléfono (opcional)" error={e.phone}>
          <Input {...f.bind('phone')} type="tel" inputMode="tel" placeholder="10 dígitos" />
        </Field>
      </div>

      <SectionTitle>Cédula y facultades</SectionTitle>
      <div className="grid-form">
        <Field label="Cédula profesional" error={e.license_number} hint="Aparece en las indicaciones y recetas que emite.">
          <Input {...f.bind('license_number')} inputMode="numeric" placeholder="Número de cédula" autoComplete="off" />
        </Field>
        <Field label="Institución que expidió el título" error={e.license_institution}>
          <Input {...f.bind('license_institution')} placeholder="Universidad" />
        </Field>
        <Field label="Cédula de especialidad (opcional)" error={e.specialty_license}>
          <Input {...f.bind('specialty_license')} inputMode="numeric" autoComplete="off" />
        </Field>
      </div>
      <div className="row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 8, padding: 12 }}>
        <Checkbox checked={v.is_physician} disabled={noLicense && !v.is_physician} onChange={(ev) => f.set('is_physician', ev.target.checked)}
          label={<b>Es médico con cédula (puede emitir recetas médicas)</b>} />
        <div className="t-small">
          Conforme al artículo 28 Bis de la Ley General de Salud, solo los médicos con cédula profesional pueden prescribir medicamentos.
          Un fisioterapeuta emite indicaciones fisioterapéuticas, no recetas. Actívalo únicamente para médicos titulados.
          {isNew ? '' : ' Quitar esta facultad no afecta las recetas que ya emitió.'}
        </div>
        {noLicense && <div className="t-small gold">{v.is_physician ? 'Un médico habilitado no puede quedar sin cédula.' : 'Para activarlo, primero captura su cédula profesional.'}</div>}
      </div>
    </>
  );
}

const payload = (v: Form) => ({ ...v, full_name: v.full_name.trim(), username: v.username.trim(), email: v.email.trim() });

/** Validación previa en el navegador (el servidor repite todo). */
function localErrors(v: Form): Record<string, string> {
  const e: Record<string, string> = {};
  if (v.full_name.trim().length < 3) e.full_name = 'Escribe el nombre completo.';
  if (!/^[a-z0-9._-]{3,40}$/.test(v.username.trim())) e.username = 'Usa de 3 a 40 caracteres: minúsculas, números, punto, guion o guion bajo.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email.trim())) e.email = 'Escribe un correo válido.';
  if (!v.location_id) e.location_id = 'Selecciona la sede.';
  if (v.is_physician && !v.license_number.trim()) e.license_number = 'Escribe la cédula profesional para marcarlo como médico.';
  return e;
}

function CreateBody({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const f = useForm<Form>(EMPTY);
  const [touchedUser, setTouchedUser] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<(InviteResult & { user: TeamUserDetail }) | null>(null);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const le = localErrors(f.values);
    if (Object.keys(le).length) { f.setErrors(le); setError(null); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.post<InviteResult & { user: TeamUserDetail }>('/api/users', payload(f.values));
      setDone(r);
      await refreshTeam();
      toast('Fisioterapeuta agregado');
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, 'error', 'No se pudo guardar. Intenta de nuevo.');
      if (err.fields) f.setErrors(err.fields);
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="stack">
        <div className="t-body"><b>{done.user.display_name}</b> ya aparece en el equipo y en los selectores de fisioterapeuta. Podrá entrar en cuanto defina su contraseña.</div>
        <InviteLinkBox result={done} email={done.user.email} />
        <div className="sheet-foot"><Button variant="primary" onClick={onClose}>Listo</Button></div>
      </div>
    );
  }
  return (
    <form className="stack" onSubmit={submit} noValidate>
      {/* El usuario se sugiere a partir del nombre hasta que alguien lo escribe a mano. */}
      <Fields f={f} isNew onUsername={() => setTouchedUser(true)}
        onName={(name) => { if (!touchedUser) f.set('username', suggestUsername(name)); }} />
      <Notice>No se captura contraseña: al guardar se crea un enlace de invitación para que la persona defina la suya.</Notice>
      {error && !error.fields && <ErrorNote error={error} />}
      {error?.fields && <div className="notice red" role="alert">Revisa los campos marcados.</div>}
      <div className="sheet-foot">
        <Button onClick={onClose}>Cancelar</Button>
        <Button type="submit" variant="primary" loading={busy}>Guardar e invitar</Button>
      </div>
    </form>
  );
}

function EditBody({ userId, onClose, onDeactivate }: { userId: string; onClose: () => void; onDeactivate?: (id: string) => void }) {
  const { data, error, mutate } = useApi<TeamUserDetail>(`/api/users/${userId}`, { revalidateOnFocus: false });
  if (error) return <ErrorNote error={error} retry={() => mutate()} />;
  if (!data) return <Skeleton rows={5} height={48} />;
  return <EditForm key={data.id} user={data} onClose={onClose} onDeactivate={onDeactivate} reload={() => mutate()} />;
}

function EditForm({ user, onClose, onDeactivate, reload }: { user: TeamUserDetail; onClose: () => void; onDeactivate?: (id: string) => void; reload: () => void }) {
  const toast = useToast();
  const f = useForm<Form>(toForm(user));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [invite, setInvite] = useState<InviteResult | null>(null);
  const [inviting, setInviting] = useState(false);
  const [askReset, setAskReset] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const isTherapist = user.role === 'therapist';

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const le = localErrors(f.values);
    if (Object.keys(le).length) { f.setErrors(le); setError(null); return; }
    setBusy(true); setError(null);
    try {
      await api.patch(`/api/users/${user.id}`, payload(f.values));
      await refreshTeam();
      reload();
      toast('Cambios guardados');
      onClose();
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, 'error', 'No se pudo guardar. Intenta de nuevo.');
      if (err.fields) f.setErrors(err.fields);
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const sendLink = async (force: boolean) => {
    setInviting(true);
    try {
      setInvite(await api.post<InviteResult>(`/api/users/${user.id}/invite`, { force_reset: force }));
      await refreshTeam();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'No se pudo generar el enlace.', 'error');
    } finally {
      setInviting(false);
    }
  };

  const reactivate = async () => {
    setReactivating(true);
    try {
      await api.post(`/api/users/${user.id}/reactivate`);
      await refreshTeam();
      reload();
      toast('Cuenta reactivada');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'No se pudo reactivar.', 'error');
    } finally {
      setReactivating(false);
    }
  };

  return (
    <div className="stack lg">
      {!user.active && (
        <Notice tone="gold">
          Cuenta desactivada{user.deactivated_at ? ` el ${fmtDateTime(user.deactivated_at)}` : ''}. No puede iniciar sesión ni recibir pacientes.{' '}
          <Button size="sm" loading={reactivating} onClick={reactivate} style={{ marginLeft: 6 }}>Reactivar</Button>
        </Notice>
      )}

      <form className="stack" onSubmit={save} noValidate>
        <Fields f={f} isNew={false} />
        {error && !error.fields && <ErrorNote error={error} />}
        {error?.fields && <div className="notice red" role="alert">{error.message}</div>}
        <div className="hstack" style={{ justifyContent: 'flex-end' }}>
          <Button type="submit" variant="primary" loading={busy}>Guardar cambios</Button>
        </div>
      </form>

      <hr className="divider" />
      <div className="stack md">
        <SectionTitle>Acceso</SectionTitle>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div className="grow" style={{ minWidth: 180 }}>
            <div className="t-strong">
              {user.has_password ? 'Contraseña definida' : user.invited_pending ? 'Invitación pendiente' : 'Sin contraseña · la invitación venció'}
            </div>
            <div className="t-small">{user.last_login_at ? `Último acceso: ${fmtDateTime(user.last_login_at)}` : 'Aún no ha iniciado sesión'}</div>
          </div>
          {!user.has_password && <Badge tone="gold">{user.invited_pending ? 'Invitación pendiente' : 'Sin acceso'}</Badge>}
          {user.active && (user.has_password
            ? <Button size="sm" loading={inviting} onClick={() => setAskReset(true)}>Restablecer contraseña</Button>
            : <Button size="sm" loading={inviting} onClick={() => sendLink(false)}>Reenviar invitación</Button>)}
        </div>
        {invite && <InviteLinkBox result={invite} email={user.email} />}
      </div>

      {isTherapist && (
        <>
          <hr className="divider" />
          <div className="stack md">
            <SectionTitle>Horario laboral</SectionTitle>
            <div className="t-small">La agenda solo permite citas dentro de este horario. Sin horario capturado, acepta cualquier hora.</div>
            <HoursEditor userId={user.id} />
          </div>
        </>
      )}

      <hr className="divider" />
      <div className="stack md">
        <SectionTitle>Huella en el lector</SectionTitle>
        <div className="t-small">Con su huella registra entrada y salida en el lector de recepción. La huella se guarda solo dentro del lector.</div>
        <EnrollFingerprint personType="staff" personId={user.id} enrolledAt={user.fingerprint_enrolled_at} onDone={() => { reload(); void refreshTeam(); }} />
      </div>

      {isTherapist && user.active && (
        <>
          <hr className="divider" />
          <div className="stack md">
            <SectionTitle tone="red">Zona de riesgo</SectionTitle>
            <div className="row" style={{ flexWrap: 'wrap', borderColor: 'rgba(255,107,107,.35)' }}>
              <div className="grow" style={{ minWidth: 200 }}>
                <div className="t-strong">Desactivar cuenta</div>
                <div className="t-small">
                  Pierde el acceso y sus pacientes pasan a otro fisioterapeuta. Sus notas, recetas y firmas se conservan.
                  {(user.patients_active ?? 0) > 0 && ` Tiene ${user.patients_active} paciente${user.patients_active === 1 ? '' : 's'} activo${user.patients_active === 1 ? '' : 's'}.`}
                </div>
              </div>
              <Button variant="danger" size="sm" onClick={() => onDeactivate?.(user.id)}>Desactivar</Button>
            </div>
          </div>
        </>
      )}

      <Confirm open={askReset} onClose={() => setAskReset(false)} title="Restablecer contraseña" confirmLabel="Generar enlace"
        message={<>Se enviará a <b>{user.email}</b> un enlace para definir una contraseña nueva (vigente 2 horas). Su contraseña actual sigue funcionando hasta que lo use.</>}
        onConfirm={async () => { setAskReset(false); await sendLink(true); }} />
    </div>
  );
}
