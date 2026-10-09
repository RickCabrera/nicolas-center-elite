'use client';
import { useState } from 'react';
import { Button, Field, Input, Notice, Select, Textarea } from '@/components/ui';
import { api, ApiError } from '@/lib/client';
import { ARCO_KIND_HELP, ARCO_KIND_LABEL, ARCO_KINDS, ARCO_RESPONSE_DAYS, type ArcoKind } from './shared';

type Form = { requester_name: string; contact: string; kind: ArcoKind | ''; details: string; website: string };
const EMPTY: Form = { requester_name: '', contact: '', kind: '', details: '', website: '' };

// LEG-03 · Formulario público "Ejercer mis derechos ARCO" (sin sesión).
export function ArcoForm({ clinicName }: { clinicName: string }) {
  const [f, setF] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ days: number } | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((s) => ({ ...s, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  const send = async () => {
    const e: Record<string, string> = {};
    if (f.requester_name.trim().length < 3) e.requester_name = 'Escribe tu nombre completo.';
    if (f.contact.trim().length < 6) e.contact = 'Escribe un teléfono o correo donde podamos responderte.';
    if (!f.kind) e.kind = 'Elige el tipo de solicitud.';
    if (f.details.trim().length < 10) e.details = 'Describe tu solicitud (al menos 10 caracteres).';
    setErrors(e); setFormError('');
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const r = await api.post<{ response_days: number }>('/api/arco', f);
      setDone({ days: r.response_days ?? ARCO_RESPONSE_DAYS });
      setF(EMPTY);
    } catch (err) {
      const ae = err as ApiError;
      if (ae.fields) setErrors(ae.fields);
      else setFormError(ae.message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="stack md" role="status" aria-live="polite">
        <Notice tone="green">
          <b style={{ display: 'block', font: '700 15px/1.3 var(--f-head)', marginBottom: 6 }}>Recibimos tu solicitud</b>
          {clinicName} te responderá por el medio de contacto que indicaste en un plazo máximo de {done.days} días hábiles.
          Para proteger tus datos, es posible que antes te pidamos acreditar tu identidad.
        </Notice>
        <Button onClick={() => setDone(null)} style={{ alignSelf: 'flex-start' }}>Enviar otra solicitud</Button>
      </div>
    );
  }

  return (
    <form className="stack md" noValidate onSubmit={(e) => { e.preventDefault(); send(); }}>
      {formError && <Notice tone="red">{formError}</Notice>}
      <div className="grid-form">
        <Field label="Nombre completo" error={errors.requester_name}>
          <Input value={f.requester_name} maxLength={120} autoComplete="name" invalid={!!errors.requester_name} onChange={(e) => set('requester_name', e.target.value)} />
        </Field>
        <Field label="Teléfono o correo para responderte" error={errors.contact}>
          <Input value={f.contact} maxLength={160} autoCapitalize="none" invalid={!!errors.contact} onChange={(e) => set('contact', e.target.value)} />
        </Field>
      </div>
      <Field label="Tipo de solicitud" error={errors.kind} hint={f.kind ? ARCO_KIND_HELP[f.kind] : undefined}>
        <Select value={f.kind} invalid={!!errors.kind} onChange={(e) => set('kind', e.target.value as ArcoKind | '')}>
          <option value="">Selecciona una opción</option>
          {ARCO_KINDS.map((k) => <option key={k} value={k}>{ARCO_KIND_LABEL[k]}</option>)}
        </Select>
      </Field>
      <Field label="Descripción" error={errors.details} hint="Explica qué datos o qué uso quieres consultar, corregir, cancelar o limitar. No incluyas información médica que no sea necesaria.">
        <Textarea value={f.details} maxLength={3000} invalid={!!errors.details} style={{ minHeight: 130 }} onChange={(e) => set('details', e.target.value)} />
      </Field>
      {/* Campo trampa contra robots: las personas no lo ven ni llegan a él con el teclado. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: -9999, width: 1, height: 1, overflow: 'hidden' }}>
        <label>Sitio web<input type="text" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set('website', e.target.value)} /></label>
      </div>
      <Button type="submit" variant="primary" size="lg" loading={busy} style={{ alignSelf: 'flex-start' }}>Enviar solicitud</Button>
      <p className="t-small">Responderemos en un plazo máximo de {ARCO_RESPONSE_DAYS} días hábiles. Tus datos de contacto se usan solo para atender esta solicitud.</p>
    </form>
  );
}
