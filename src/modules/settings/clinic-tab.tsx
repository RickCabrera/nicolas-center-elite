'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, Card, ErrorNote, Field, Input, Notice, Skeleton, useToast } from '@/components/ui';
import { api, ApiError, refresh, useApi } from '@/lib/client';
import type { UploadTicket } from '@/lib/storage';
import { uploadWithTicket } from '@/lib/upload-client';
import type { ClinicData } from './types';

type Form = { name: string; legal_name: string; tagline: string; phone: string; email: string };
const FIELDS: (keyof Form)[] = ['name', 'legal_name', 'tagline', 'phone', 'email'];
const LOGO_TYPES: Record<string, 'png' | 'jpg' | 'webp'> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX_LOGO = 2 * 1024 * 1024;

// CFG-01 · Datos de la clínica y logo.
export function ClinicTab() {
  const toast = useToast();
  const { data, error, mutate } = useApi<ClinicData>('/api/clinic');
  const [f, setF] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (data && !f) setF({ name: data.name, legal_name: data.legal_name, tagline: data.tagline, phone: data.phone, email: data.email });
  }, [data, f]);

  if (error && !data) return <ErrorNote error={error} retry={() => mutate()} />;
  if (!data || !f) return <Skeleton rows={4} />;

  const dirty = FIELDS.some((k) => f[k].trim() !== data[k]);
  const set = (k: keyof Form, v: string) => {
    setF((s) => (s ? { ...s, [k]: v } : s));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  const save = async () => {
    if (f.name.trim().length < 2) return setErrors({ name: 'Escribe el nombre de la clínica.' });
    setBusy(true); setFormError('');
    try {
      const saved = await api.patch<ClinicData>('/api/clinic', f);
      setF({ name: saved.name, legal_name: saved.legal_name, tagline: saved.tagline, phone: saved.phone, email: saved.email });
      await refresh('/api/clinic', '/api/meta');
      toast('Datos de la clínica guardados');
    } catch (e) {
      const ae = e as ApiError;
      setErrors(ae.fields ?? {});
      if (!ae.fields) setFormError(ae.message);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (picked: File | undefined) => {
    if (file.current) file.current.value = '';
    if (!picked) return;
    const ext = LOGO_TYPES[picked.type];
    if (!ext) return toast('El logo debe ser una imagen PNG, JPG o WEBP.', 'error');
    if (picked.size > MAX_LOGO) return toast('El logo no debe pesar más de 2 MB.', 'error');
    setLogoBusy(true);
    try {
      const { path, ticket } = await api.post<{ path: string; ticket: UploadTicket }>('/api/clinic', { logo: 'request', ext });
      await uploadWithTicket(ticket, picked);
      await api.patch('/api/clinic', { logo_path: path });
      await refresh('/api/clinic', '/api/meta');
      toast('Logo actualizado');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLogoBusy(false);
    }
  };
  const removeLogo = async () => {
    setLogoBusy(true);
    try {
      await api.patch('/api/clinic', { logo_path: null });
      await refresh('/api/clinic', '/api/meta');
      toast('Logo quitado');
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setLogoBusy(false);
    }
  };

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <Card title="Datos de la clínica" blue>
        <form className="stack md" onSubmit={(e) => { e.preventDefault(); save(); }}>
          {formError && <Notice tone="red">{formError}</Notice>}
          <Field label="Nombre" error={errors.name} hint="Aparece en el membrete de recetas, indicaciones, recibos y consentimientos que se emitan desde ahora.">
            <Input value={f.name} maxLength={120} invalid={!!errors.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Razón social" error={errors.legal_name}>
            <Input value={f.legal_name} maxLength={160} invalid={!!errors.legal_name} onChange={(e) => set('legal_name', e.target.value)} placeholder="Como aparece en tu constancia fiscal" />
          </Field>
          <Field label="Lema" error={errors.tagline}>
            <Input value={f.tagline} maxLength={160} invalid={!!errors.tagline} onChange={(e) => set('tagline', e.target.value)} placeholder="Fisioterapia y readaptación deportiva" />
          </Field>
          <div className="grid-form">
            <Field label="Teléfono" error={errors.phone}>
              <Input type="tel" inputMode="tel" value={f.phone} maxLength={40} invalid={!!errors.phone} onChange={(e) => set('phone', e.target.value)} placeholder="271 000 0000" />
            </Field>
            <Field label="Correo" error={errors.email}>
              <Input type="email" inputMode="email" autoCapitalize="none" value={f.email} maxLength={160} invalid={!!errors.email} onChange={(e) => set('email', e.target.value)} placeholder="contacto@tuclinica.mx" />
            </Field>
          </div>
          <div className="hstack wrap" style={{ marginTop: 4 }}>
            <Button type="submit" variant="primary" loading={busy} disabled={!dirty}>Guardar</Button>
            {dirty && <span className="t-small gold">Hay cambios sin guardar</span>}
          </div>
        </form>
      </Card>

      <Card title="Logo" blue>
        <div className="stack md">
          <div className="row" style={{ padding: 14, gap: 16 }}>
            { }
            <img src={data.logo_url ?? '/logo.png'} alt={data.logo_url ? `Logo de ${data.name}` : 'Logo de la aplicación'}
              style={{ width: 84, height: 84, flex: 'none', objectFit: 'contain', borderRadius: 14, background: 'rgba(255,255,255,.04)' }} />
            <div className="grow">
              <div className="t-strong" style={{ overflowWrap: 'anywhere' }}>{data.name}</div>
              <div className="t-small" style={{ marginTop: 4 }}>{data.logo_url ? 'Logo propio de la clínica' : 'Sin logo propio: se muestra el de la aplicación'}</div>
            </div>
          </div>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true"
            onChange={(e) => upload(e.target.files?.[0])} />
          <div className="hstack wrap">
            <Button loading={logoBusy} onClick={() => file.current?.click()}>{data.logo_url ? 'Cambiar logo' : 'Subir logo'}</Button>
            {data.logo_url && <Button variant="danger" disabled={logoBusy} onClick={removeLogo}>Quitar</Button>}
          </div>
          <p className="t-small">
            Imagen PNG, JPG o WEBP de hasta 2 MB, de preferencia cuadrada. El logo que subas se muestra en esta tarjeta y queda guardado
            para los documentos de la clínica. El logo de la barra lateral y de la pantalla de acceso es parte de la aplicación y no cambia desde aquí.
          </p>
        </div>
      </Card>
    </div>
  );
}
