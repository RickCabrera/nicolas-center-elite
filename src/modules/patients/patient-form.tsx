'use client';
import type { RefObject } from 'react';
import type { Meta } from '@/components/meta';
import { Chip, Field, Input, Notice, Select, Textarea, type useForm } from '@/components/ui';
import { ageFrom, fmtDate, parseDateInput, todayIso } from '@/lib/dates';
import { money } from '@/lib/format';
import type { PatientDetail } from './types';

/** Valores del formulario de paciente (alta y edición). La fecha se escribe como DD/MM/AAAA. */
export type PatientFormValues = {
  full_name: string; birth_date: string; sex: string; phone: string; email: string; address: string; curp: string;
  emergency_name: string; emergency_phone: string; guardian_name: string; guardian_relationship: string; guardian_phone: string;
  location_id: string; therapist_id: string; plan_id: string; tags: string[]; reason: string;
};
export const EMPTY_PATIENT: PatientFormValues = {
  full_name: '', birth_date: '', sex: '', phone: '', email: '', address: '', curp: '', emergency_name: '', emergency_phone: '',
  guardian_name: '', guardian_relationship: '', guardian_phone: '', location_id: '', therapist_id: '', plan_id: '', tags: [], reason: '',
};
export const NO_PLAN = 'none';

export function valuesFromPatient(p: PatientDetail): PatientFormValues {
  return {
    ...EMPTY_PATIENT,
    full_name: p.full_name, birth_date: fmtDate(p.birth_date), sex: p.sex ?? '', phone: p.phone, email: p.email, address: p.address,
    curp: p.curp ?? '', emergency_name: p.emergency_name, emergency_phone: p.emergency_phone, guardian_name: p.guardian_name,
    guardian_relationship: p.guardian_relationship, guardian_phone: p.guardian_phone, location_id: p.location_id,
    tags: p.tags, reason: p.reason,
  };
}

/** Escribe las diagonales solas: 12041988 → 12/04/1988. */
export function maskDate(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/');
}

/** Edad calculada a partir de lo escrito (PAC-03: nunca se captura). null si la fecha aún no es válida. */
export function ageOf(birthText: string): number | null {
  const iso = birthText.trim().length >= 8 ? parseDateInput(birthText) : null;
  if (!iso || iso > todayIso() || iso < '1900-01-01') return null;
  return ageFrom(iso);
}
const ageText = (age: number | null) => (age === null ? '' : age < 1 ? 'Menor de 1 año' : age === 1 ? '1 año' : `${age} años`);

/** Datos generales listos para la API. */
export function patientPayload(v: PatientFormValues) {
  return {
    full_name: v.full_name.trim(), birth_date: v.birth_date.trim(), sex: v.sex || null, phone: v.phone.trim(), email: v.email.trim(),
    address: v.address.trim(), curp: v.curp.trim().toUpperCase() || null, emergency_name: v.emergency_name.trim(),
    emergency_phone: v.emergency_phone.trim(), guardian_name: v.guardian_name.trim(),
    guardian_relationship: v.guardian_relationship.trim(), guardian_phone: v.guardian_phone.trim(),
    location_id: v.location_id, tags: v.tags, reason: v.reason.trim(),
  };
}

/** Validación inmediata en el navegador; el servidor repite todas las reglas. */
export function clientErrors(v: PatientFormValues, opts: { needTherapist: boolean }): Record<string, string> {
  const e: Record<string, string> = {};
  if (v.full_name.trim().length < 2) e.full_name = 'Escribe el nombre completo.';
  const iso = parseDateInput(v.birth_date);
  if (!v.birth_date.trim()) e.birth_date = 'Escribe la fecha de nacimiento.';
  else if (!iso) e.birth_date = 'Fecha inválida. Usa el formato DD/MM/AAAA.';
  else if (iso > todayIso()) e.birth_date = 'La fecha de nacimiento no puede ser futura.';
  else if (iso < '1900-01-01') e.birth_date = 'Revisa el año de nacimiento.';
  if (!v.sex) e.sex = 'Selecciona el sexo.';
  if (v.curp.trim() && !/^[A-Za-z0-9]{18}$/.test(v.curp.trim())) e.curp = 'La CURP tiene 18 caracteres (letras y números).';
  if (!v.location_id) e.location_id = 'Selecciona la sede.';
  if (opts.needTherapist && !v.therapist_id) e.therapist_id = 'Selecciona el fisioterapeuta.';
  const age = ageOf(v.birth_date);
  if (age !== null && age < 18) {
    if (!v.guardian_name.trim()) e.guardian_name = 'Un paciente menor de edad requiere el nombre del padre, madre o tutor.';
    if (!v.guardian_relationship.trim()) e.guardian_relationship = 'Indica el parentesco del tutor.';
    if (!v.guardian_phone.trim()) e.guardian_phone = 'Escribe el teléfono del tutor.';
  }
  return e;
}

/** Lleva el foco al primer campo con error (el formulario cabe en varias pantallas en móvil). */
export function focusFirstInvalid(ref: RefObject<HTMLElement | null>) {
  requestAnimationFrame(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    el?.focus();
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}

type Form = ReturnType<typeof useForm<PatientFormValues>>;

/**
 * Campos del paciente compartidos por "Nuevo paciente" y "Editar datos" (PAC-03, PAC-05).
 * `assign` agrega fisioterapeuta (solo dueño) y membresía, que solo se eligen en el alta.
 */
export function PatientFormFields({ f, meta, assign }: { f: Form; meta: Meta | undefined; assign?: { therapist: boolean } }) {
  const { values: v, errors: e, bind, set } = f;
  const age = ageOf(v.birth_date);
  const minor = age !== null && age < 18;
  const showGuardian = minor || !!(v.guardian_name || v.guardian_relationship || v.guardian_phone);
  const locations = (meta?.locations ?? []).filter((l) => l.active || l.id === v.location_id);
  const tags = [...new Set([...(meta?.tags ?? []).filter((t) => t.active).map((t) => t.name), ...v.tags])];
  const toggleTag = (t: string) => set('tags', v.tags.includes(t) ? v.tags.filter((x) => x !== t) : [...v.tags, t]);

  return (
    <div className="grid-form">
      <Field label="Nombre completo" error={e.full_name} className="col-span">
        <Input {...bind('full_name')} placeholder="Ej. Ana López Hernández" autoComplete="off" maxLength={120} />
      </Field>
      <Field label="Fecha de nacimiento" error={e.birth_date}>
        <Input value={v.birth_date} onChange={(ev) => set('birth_date', maskDate(ev.target.value))} invalid={!!e.birth_date}
          placeholder="DD/MM/AAAA" inputMode="numeric" autoComplete="off" maxLength={10} />
      </Field>
      <Field label="Edad (se calcula sola)">
        <Input value={ageText(age)} placeholder="—" disabled readOnly />
      </Field>
      <Field label="Sexo" error={e.sex}>
        <Select {...bind('sex')}>
          <option value="">Selecciona</option>
          <option value="F">Femenino</option>
          <option value="M">Masculino</option>
          <option value="X">Otro / no especifica</option>
        </Select>
      </Field>
      <Field label="Teléfono" error={e.phone}>
        <Input {...bind('phone')} placeholder="271 000 0000" type="tel" inputMode="tel" autoComplete="off" maxLength={30} />
      </Field>
      <Field label="Correo (opcional)" error={e.email}>
        <Input {...bind('email')} placeholder="nombre@correo.com" type="email" inputMode="email" autoComplete="off" maxLength={120} />
      </Field>
      <Field label="CURP (opcional)" error={e.curp}>
        <Input value={v.curp} onChange={(ev) => set('curp', ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} invalid={!!e.curp}
          placeholder="18 caracteres" autoComplete="off" autoCapitalize="characters" maxLength={18} style={{ fontFamily: 'var(--f-mono)', fontSize: 14 }} />
      </Field>
      <Field label="Domicilio" error={e.address} className="col-span">
        <Input {...bind('address')} placeholder="Calle, número, colonia y ciudad" autoComplete="off" maxLength={240} />
      </Field>

      {showGuardian && (
        <>
          {minor && <div className="col-span"><Notice tone="gold">Es menor de edad: registra al padre, madre o tutor que firmará por el paciente.</Notice></div>}
          <Field label="Padre, madre o tutor" error={e.guardian_name} className="col-span">
            <Input {...bind('guardian_name')} placeholder="Nombre completo del tutor" autoComplete="off" maxLength={120} />
          </Field>
          <Field label="Parentesco" error={e.guardian_relationship}>
            <Input {...bind('guardian_relationship')} placeholder="Madre, padre, tutor legal…" list="nce-parentescos" autoComplete="off" maxLength={60} />
            <datalist id="nce-parentescos">
              <option value="Madre" /><option value="Padre" /><option value="Tutor legal" /><option value="Abuela" /><option value="Abuelo" />
            </datalist>
          </Field>
          <Field label="Teléfono del tutor" error={e.guardian_phone}>
            <Input {...bind('guardian_phone')} placeholder="271 000 0000" type="tel" inputMode="tel" autoComplete="off" maxLength={30} />
          </Field>
        </>
      )}

      <Field label="Contacto de emergencia" error={e.emergency_name}>
        <Input {...bind('emergency_name')} placeholder="Nombre" autoComplete="off" maxLength={120} />
      </Field>
      <Field label="Teléfono de emergencia" error={e.emergency_phone}>
        <Input {...bind('emergency_phone')} placeholder="271 000 0000" type="tel" inputMode="tel" autoComplete="off" maxLength={30} />
      </Field>

      <Field label="Sede" error={e.location_id}>
        <Select {...bind('location_id')}>
          <option value="">{meta ? 'Selecciona' : 'Cargando…'}</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      </Field>
      {assign?.therapist && (
        <Field label="Fisioterapeuta asignado" error={e.therapist_id}>
          <Select {...bind('therapist_id')}>
            <option value="">{meta ? 'Selecciona' : 'Cargando…'}</option>
            {(meta?.therapists ?? []).filter((t) => t.active).map((t) => (
              <option key={t.id} value={t.id}>{t.display_name}{t.location_name ? ` · ${t.location_name}` : ''}</option>
            ))}
          </Select>
        </Field>
      )}
      {assign && (
        <Field label="Tipo de membresía" error={e.plan_id}>
          <Select {...bind('plan_id')}>
            {(meta?.plans ?? []).filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name} · {money(p.price_cents)}</option>)}
            <option value={NO_PLAN}>Sin membresía por ahora</option>
          </Select>
        </Field>
      )}

      {tags.length > 0 && (
        <div className="field col-span" role="group" aria-label="Etiquetas">
          <span>Etiquetas (opcional)</span>
          <div className="hstack wrap">
            {tags.map((t) => <Chip key={t} on={v.tags.includes(t)} onClick={() => toggleTag(t)}>{t}</Chip>)}
          </div>
          {e.tags && <span className="err" role="alert">{e.tags}</span>}
        </div>
      )}

      <Field label="Motivo de consulta / lesión" error={e.reason} className="col-span">
        <Textarea {...bind('reason')} rows={3} placeholder="Ej. Esguince de tobillo grado II, dolor al apoyar" maxLength={600} />
      </Field>
    </div>
  );
}
