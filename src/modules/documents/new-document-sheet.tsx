'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PatientPicker, usePatientOptions } from '@/components/meta';
import { Button, Checkbox, Field, Input, Notice, Select, Sheet, Textarea, useToast } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { ApiError, api, refresh, useApi } from '@/lib/client';
import { Portal } from './portal';
import {
  CONTROLLED_MSG, ITEM_LABEL, PHYSICIAN_ONLY, ROUTES, normText,
  type DocKind, type DocumentDetail, type ItemKind,
} from './shared';

type Row = { key: string; kind: ItemKind; name: string; presentation: string; dose: string; route: string; frequency: string; duration: string; instructions: string };
type RowField = 'name' | 'presentation' | 'dose' | 'route' | 'frequency' | 'duration' | 'instructions';
type PlanExercise = { id: string; name: string; dosage: string };

let seq = 0;
const blank = (kind: ItemKind, init: Partial<Row> = {}): Row =>
  ({ key: `r${++seq}`, kind, name: '', presentation: '', dose: '', route: kind === 'medication' ? 'Oral' : '', frequency: '', duration: '', instructions: '', ...init });
const isBlank = (r: Row) => !(r.name.trim() || r.presentation.trim() || r.dose.trim() || r.frequency.trim() || r.duration.trim() || r.instructions.trim());

const PLACEHOLDER: Record<Exclude<ItemKind, 'medication'>, { name: string; dose: string; instructions: string }> = {
  exercise: { name: 'Ej. Puente de glúteo', dose: '3 series de 12 repeticiones', instructions: 'Sin dolor; detener si aumenta la molestia.' },
  physical_agent: { name: 'Ej. Crioterapia local', dose: '15 minutos', instructions: 'Proteger la piel con un paño.' },
  home_care: { name: 'Ej. Elevar la pierna al descansar', dose: '', instructions: 'Detalles del cuidado.' },
};

/** La API del expediente puede devolver el arreglo directo o envuelto; solo se usan los activos. */
function planFrom(data: unknown): PlanExercise[] {
  const d = data as { items?: unknown; exercises?: unknown } | unknown[] | null | undefined;
  const list = Array.isArray(d) ? d : Array.isArray(d?.items) ? d.items : Array.isArray(d?.exercises) ? d.exercises : [];
  return (list as { id?: string; name?: string; dosage?: string; active?: boolean }[])
    .filter((e) => e && e.active !== false && typeof e.name === 'string' && e.name.trim())
    .map((e, i) => ({ id: String(e.id ?? i), name: e.name!.trim(), dosage: (e.dosage ?? '').trim() }));
}

/**
 * REC-03 · Hoja para emitir una receta médica o unas indicaciones fisioterapéuticas.
 * `duplicateFrom` (opcional) la abre prellenada para "Duplicar como nuevo": folio y firma nuevos.
 */
export function NewDocumentSheet({ open, onClose, patientId, duplicateFrom }: { open: boolean; onClose: () => void; patientId?: string; duplicateFrom?: DocumentDetail | null }) {
  const user = useUser();
  const router = useRouter();
  const toast = useToast();
  const hasLicense = !!user.license_number?.trim();
  const canPrescribe = user.is_physician && hasLicense;

  const [patient, setPatient] = useState(patientId ?? '');
  const [kind, setKind] = useState<DocKind>('indications');
  const [diagnosis, setDiagnosis] = useState('');
  const [general, setGeneral] = useState('');
  const [rows, setRows] = useState<Record<DocKind, Row[]>>({ prescription: [], indications: [] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const diagTouched = useRef(false);

  // Al abrir: estado limpio, o copia del documento de origen si se está duplicando.
  useEffect(() => {
    if (!open) return;
    const src = duplicateFrom ?? null;
    const srcKind: DocKind = src && (src.kind === 'indications' || canPrescribe) ? src.kind : 'indications';
    const copied = src && src.kind === srcKind
      ? src.items.map((i) => blank(i.kind, { name: i.name, presentation: i.presentation, dose: i.dose, route: i.route, frequency: i.frequency, duration: i.duration, instructions: i.instructions }))
      : [];
    setPatient(src?.patient_id ?? patientId ?? '');
    setKind(srcKind);
    setDiagnosis(src?.diagnosis ?? '');
    setGeneral(src?.general_indications ?? '');
    setRows({
      prescription: srcKind === 'prescription' && copied.length ? copied : [blank('medication')],
      indications: srcKind === 'indications' && copied.length ? copied : [blank('exercise')],
    });
    setErrors({}); setFormError(''); setConfirming(false); setBusy(false); setPlanOpen(false);
    diagTouched.current = !!src;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Diagnóstico actual del paciente como punto de partida; si el expediente no responde, queda vacío.
  useEffect(() => {
    if (!open || !patient || diagTouched.current) return;
    let alive = true;
    api.get<{ current?: { diagnosis?: string | null } | null }>(`/api/patients/${patient}/profile`)
      .then((p) => { if (alive && !diagTouched.current) setDiagnosis(p?.current?.diagnosis?.trim() ?? ''); })
      .catch(() => { if (alive && !diagTouched.current) setDiagnosis(''); });
    return () => { alive = false; };
  }, [open, patient]);

  const { data: patients } = usePatientOptions();
  const patientName = patients?.find((p) => p.id === patient)?.full_name ?? duplicateFrom?.patient_name ?? '';
  const fixedPatient = !!(patientId || duplicateFrom);

  // REC-07 · Ejercicios activos del plan del paciente. Si el expediente no responde, el botón no aparece.
  const plan = useApi<unknown>(open && patient && kind === 'indications' ? `/api/patients/${patient}/exercises` : null, { shouldRetryOnError: false, revalidateOnFocus: false, keepPreviousData: false });
  const exercises = useMemo(() => planFrom(plan.data), [plan.data]);
  const planAvailable = !!patient && kind === 'indications' && !plan.error && plan.data !== undefined;

  // REC-06 · Aviso en vivo de medicamento controlado (la base lo vuelve a validar al emitir).
  const controlled = useApi<{ names: string[] }>(open && canPrescribe ? '/api/documents/controlled' : null, { revalidateOnFocus: false });
  const list = rows[kind];
  const controlledAt = (r: Row) => {
    if (r.kind !== 'medication' || !r.name.trim()) return null;
    const n = normText(r.name);
    return controlled.data?.names.find((c) => n.includes(c)) ?? null;
  };
  const anyControlled = kind === 'prescription' && list.some((r) => controlledAt(r));

  const setList = (fn: (l: Row[]) => Row[]) => setRows((s) => ({ ...s, [kind]: fn(s[kind]) }));
  const clearErr = (k: string) => setErrors((e) => (e[k] ? { ...e, [k]: '' } : e));
  const edit = (i: number, f: RowField, v: string) => {
    setList((l) => l.map((r, j) => (j === i ? { ...r, [f]: v } : r)));
    clearErr(`items.${i}.${f}`);
    setConfirming(false);
  };
  const add = (k: ItemKind) => { setList((l) => (l.length >= 20 ? l : [...l, blank(k)])); clearErr('items'); setConfirming(false); };
  const remove = (i: number) => { setList((l) => l.filter((_, j) => j !== i)); setErrors({}); setConfirming(false); };

  const openPlan = () => { setPicked(new Set(exercises.map((e) => e.id))); setPlanOpen(true); };
  const addFromPlan = () => {
    const chosen = exercises.filter((e) => picked.has(e.id)).map((e) => blank('exercise', { name: e.name, dose: e.dosage }));
    setList((l) => [...l.filter((r) => !isBlank(r)), ...chosen].slice(0, 20));
    setErrors({}); setPlanOpen(false);
  };

  /** Mismas reglas que el servidor, para marcar el campo antes de pedir la confirmación. */
  const validate = (): { ok: boolean; clean: Row[] } => {
    const clean = list.filter((r) => !isBlank(r));
    const e: Record<string, string> = {};
    if (!patient) e.patient_id = 'Selecciona un paciente.';
    if (!clean.length) e.items = kind === 'prescription' ? 'Agrega al menos un medicamento.' : 'Agrega al menos una indicación.';
    clean.forEach((r, i) => {
      if (!r.name.trim()) e[`items.${i}.name`] = kind === 'prescription' ? 'Escribe la denominación genérica.' : 'Escribe la indicación.';
      if (kind === 'prescription') {
        if (!r.dose.trim()) e[`items.${i}.dose`] = 'Escribe la dosis.';
        if (!r.route.trim()) e[`items.${i}.route`] = 'Elige la vía de administración.';
        if (!r.frequency.trim()) e[`items.${i}.frequency`] = 'Escribe la frecuencia.';
        if (!r.duration.trim()) e[`items.${i}.duration`] = 'Escribe la duración del tratamiento.';
      }
    });
    if (clean.length !== list.length) setList(() => (clean.length ? clean : [blank(kind === 'prescription' ? 'medication' : 'exercise')]));
    setErrors(e);
    return { ok: !Object.keys(e).length, clean };
  };

  const review = () => {
    setFormError('');
    if (validate().ok) setConfirming(true);
  };

  const submit = async () => {
    const { ok, clean } = validate();
    if (!ok) { setConfirming(false); return; }
    setBusy(true); setFormError('');
    try {
      const doc = await api.post<DocumentDetail>('/api/documents', {
        kind, patient_id: patient, diagnosis, general_indications: general,
        items: clean.map(({ key: _key, ...r }) => r),
        duplicated_from: duplicateFrom?.id ?? undefined,
      });
      await refresh('/api/documents');
      toast(`${doc.kind === 'prescription' ? 'Receta médica emitida' : 'Indicaciones emitidas'} · folio ${doc.folio}`);
      onClose();
      router.push(`/recetas/${doc.id}`);
    } catch (err) {
      const e = err as ApiError;
      setErrors(e.fields ?? {});
      setFormError(e.message);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  const blocked = !hasLicense || anyControlled;
  const itemsLabel = kind === 'prescription' ? 'Medicamentos' : 'Indicaciones';

  if (!open) return null;
  return (
    <Portal>
    <Sheet open={open} onClose={onClose} wide title={duplicateFrom ? 'Duplicar como nuevo' : 'Nuevo documento'}
      footer={confirming ? (
        <>
          <Button onClick={() => setConfirming(false)} disabled={busy}>Volver</Button>
          <Button variant="primary" loading={busy} onClick={submit} style={{ flex: 2 }}>Confirmar y emitir</Button>
        </>
      ) : (
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={blocked} onClick={review} style={{ flex: 2 }}>Emitir documento</Button>
        </>
      )}>
      <div className="stack">
        {fixedPatient ? (
          <div className="t-sub">Paciente: <b style={{ color: 'var(--ink)' }}>{patientName || '…'}</b>{duplicateFrom && <> · copia de <span className="t-mono blue">{duplicateFrom.folio}</span></>}</div>
        ) : (
          <Field label="Paciente" error={errors.patient_id}>
            <PatientPicker value={patient} invalid={!!errors.patient_id}
              onChange={(id) => { setPatient(id); clearErr('patient_id'); setPlanOpen(false); setConfirming(false); }} />
          </Field>
        )}

        <div className="stack sm">
          <div className="t-label">Tipo de documento</div>
          <div className="hstack wrap" role="tablist" aria-label="Tipo de documento">
            <button type="button" role="tab" className="tab" aria-selected={kind === 'indications'} disabled={!!duplicateFrom && kind !== 'indications'}
              onClick={() => { setKind('indications'); setErrors({}); setConfirming(false); }}>Indicaciones fisioterapéuticas</button>
            <button type="button" role="tab" className="tab" aria-selected={kind === 'prescription'} disabled={!canPrescribe || (!!duplicateFrom && kind !== 'prescription')}
              style={!canPrescribe ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
              onClick={() => { setKind('prescription'); setErrors({}); setPlanOpen(false); setConfirming(false); }}>Receta médica</button>
          </div>
          {!canPrescribe && <div className="t-small" style={{ lineHeight: 1.45 }}>{PHYSICIAN_ONLY}</div>}
        </div>

        {!hasLicense && (
          <Notice tone="gold">
            Para emitir documentos necesitas registrar tu cédula profesional. <Link href="/perfil" onClick={onClose}>Ir a Mi perfil</Link>
          </Notice>
        )}

        <Field label="Diagnóstico" error={errors.diagnosis}>
          <Input value={diagnosis} maxLength={500} placeholder="Ej. Esguince de tobillo grado I" invalid={!!errors.diagnosis}
            onChange={(e) => { diagTouched.current = true; setDiagnosis(e.target.value); clearErr('diagnosis'); }} />
        </Field>

        <div className="stack md">
          <div className="hstack between wrap">
            <div className="t-h3 blue">{itemsLabel}</div>
            {planAvailable && !planOpen && <button type="button" className="btn-link" onClick={openPlan}>Tomar del plan del paciente</button>}
          </div>

          {planOpen && (
            <div className="notice stack sm">
              <div className="t-strong">Ejercicios activos del plan</div>
              {exercises.length === 0 ? <div className="t-sub">El plan del paciente no tiene ejercicios activos.</div> : exercises.map((e) => (
                <Checkbox key={e.id} checked={picked.has(e.id)}
                  onChange={(ev) => setPicked((s) => { const n = new Set(s); if (ev.target.checked) n.add(e.id); else n.delete(e.id); return n; })}
                  label={<><b style={{ fontWeight: 600 }}>{e.name}</b>{e.dosage && <span className="dim"> · {e.dosage}</span>}</>} />
              ))}
              <div className="hstack wrap" style={{ marginTop: 4 }}>
                <Button size="sm" onClick={() => setPlanOpen(false)}>Cerrar</Button>
                {exercises.length > 0 && <Button size="sm" variant="primary" disabled={!picked.size} onClick={addFromPlan}>Agregar seleccionados</Button>}
              </div>
            </div>
          )}

          {list.map((r, i) => {
            const err = (f: string) => errors[`items.${i}.${f}`] || undefined;
            const ctrl = controlledAt(r);
            const number = list.slice(0, i + 1).filter((x) => x.kind === r.kind).length;
            return (
              <div key={r.key} className="row" style={{ display: 'block', padding: 12 }}>
                <div className="hstack between" style={{ marginBottom: 10 }}>
                  <div className="t-label" style={{ color: 'var(--gold)' }}>{ITEM_LABEL[r.kind]} {number}</div>
                  {list.length > 1 && <button type="button" className="btn-link dim" onClick={() => remove(i)} aria-label={`Quitar ${ITEM_LABEL[r.kind].toLowerCase()} ${number}`}>Quitar</button>}
                </div>
                {r.kind === 'medication' ? (
                  <div className="grid-form">
                    <Field label="Denominación genérica" error={err('name')}>
                      <Input value={r.name} maxLength={160} placeholder="Ej. Naproxeno" invalid={!!err('name') || !!ctrl} onChange={(e) => edit(i, 'name', e.target.value)} />
                    </Field>
                    <Field label="Presentación" error={err('presentation')}>
                      <Input value={r.presentation} maxLength={160} placeholder="Tabletas 500 mg, caja con 20" onChange={(e) => edit(i, 'presentation', e.target.value)} />
                    </Field>
                    <Field label="Dosis" error={err('dose')}>
                      <Input value={r.dose} maxLength={160} placeholder="500 mg" invalid={!!err('dose')} onChange={(e) => edit(i, 'dose', e.target.value)} />
                    </Field>
                    <Field label="Vía de administración" error={err('route')}>
                      <Select value={r.route} invalid={!!err('route')} onChange={(e) => edit(i, 'route', e.target.value)}>
                        {!ROUTES.includes(r.route) && <option value={r.route}>{r.route || 'Selecciona'}</option>}
                        {ROUTES.map((x) => <option key={x} value={x}>{x}</option>)}
                      </Select>
                    </Field>
                    <Field label="Frecuencia" error={err('frequency')}>
                      <Input value={r.frequency} maxLength={160} placeholder="Cada 12 h" invalid={!!err('frequency')} onChange={(e) => edit(i, 'frequency', e.target.value)} />
                    </Field>
                    <Field label="Duración" error={err('duration')}>
                      <Input value={r.duration} maxLength={160} placeholder="7 días" invalid={!!err('duration')} onChange={(e) => edit(i, 'duration', e.target.value)} />
                    </Field>
                    <Field label="Indicaciones" error={err('instructions')} className="col-span">
                      <Textarea value={r.instructions} maxLength={800} rows={2} style={{ minHeight: 68 }} placeholder="Tomar con alimentos. Suspender si hay molestia gástrica." onChange={(e) => edit(i, 'instructions', e.target.value)} />
                    </Field>
                    {ctrl && <div className="col-span"><Notice tone="red"><span role="alert">{CONTROLLED_MSG}</span></Notice></div>}
                  </div>
                ) : (
                  <div className="grid-form">
                    <Field label={ITEM_LABEL[r.kind]} error={err('name') ?? err('kind')}>
                      <Input value={r.name} maxLength={160} placeholder={PLACEHOLDER[r.kind].name} invalid={!!err('name')} onChange={(e) => edit(i, 'name', e.target.value)} />
                    </Field>
                    {r.kind !== 'home_care' && (
                      <Field label={r.kind === 'exercise' ? 'Dosificación' : 'Tiempo / dosificación'} error={err('dose')}>
                        <Input value={r.dose} maxLength={160} placeholder={PLACEHOLDER[r.kind].dose} onChange={(e) => edit(i, 'dose', e.target.value)} />
                      </Field>
                    )}
                    <Field label="Frecuencia" error={err('frequency')}>
                      <Input value={r.frequency} maxLength={160} placeholder="2 veces al día" onChange={(e) => edit(i, 'frequency', e.target.value)} />
                    </Field>
                    <Field label="Duración" error={err('duration')}>
                      <Input value={r.duration} maxLength={160} placeholder="4 semanas" onChange={(e) => edit(i, 'duration', e.target.value)} />
                    </Field>
                    <Field label="Detalles" error={err('instructions')} className="col-span">
                      <Textarea value={r.instructions} maxLength={800} rows={2} style={{ minHeight: 68 }} placeholder={PLACEHOLDER[r.kind].instructions} onChange={(e) => edit(i, 'instructions', e.target.value)} />
                    </Field>
                  </div>
                )}
              </div>
            );
          })}

          {errors.items && <div className="field"><span className="err" role="alert">{errors.items}</span></div>}

          {list.length < 20 ? (
            <div className="hstack wrap">
              {kind === 'prescription' ? <Button size="sm" onClick={() => add('medication')}>+ Medicamento</Button> : (
                <>
                  <Button size="sm" onClick={() => add('exercise')}>+ Ejercicio</Button>
                  <Button size="sm" onClick={() => add('physical_agent')}>+ Agente físico</Button>
                  <Button size="sm" onClick={() => add('home_care')}>+ Cuidado en casa</Button>
                </>
              )}
            </div>
          ) : <div className="t-small">Máximo 20 renglones por documento.</div>}
        </div>

        <Field label="Indicaciones generales" error={errors.general_indications}>
          <Textarea value={general} maxLength={2000} placeholder={kind === 'prescription' ? 'Reposo relativo, hidratación, cita de control…' : 'Recomendaciones generales, señales de alarma, próxima cita…'}
            onChange={(e) => { setGeneral(e.target.value); clearErr('general_indications'); }} />
        </Field>

        {formError && <Notice tone="red"><span role="alert">{formError}</span></Notice>}
        {confirming && (
          <Notice tone="gold">
            <b>Una vez emitido no podrá modificarse.</b> Se firma con tu nombre y cédula profesional y recibe el folio consecutivo de la sede. Si hay un error, se cancela y se emite uno nuevo.
          </Notice>
        )}
      </div>
    </Sheet>
    </Portal>
  );
}
