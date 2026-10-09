'use client';
import { useEffect, useMemo, useState } from 'react';
import { PatientPicker, useMeta, usePatientOptions } from '@/components/meta';
import { Button, Checkbox, Chip, Field, Input, Notice, Select, Sheet, Textarea, useToast } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { api, ApiError, refresh } from '@/lib/client';
import { dayLabel, fmtDate, fmtTime, todayIso, weekday } from '@/lib/dates';
import { DURATIONS, type Appointment, type SeriesResult } from './types';

type Form = {
  patient_id: string; therapist_id: string; date: string; time: string; type_name: string; duration_min: number; notes: string;
  repeat: boolean; weekdays: number[]; weeks: number;
};
// Chips de días en el orden del mockup (lunes primero); el valor es el de la base (0 = domingo).
const WEEK_CHIPS: { n: number; label: string; name: string }[] = [
  { n: 1, label: 'L', name: 'Lunes' }, { n: 2, label: 'M', name: 'Martes' }, { n: 3, label: 'X', name: 'Miércoles' }, { n: 4, label: 'J', name: 'Jueves' },
  { n: 5, label: 'V', name: 'Viernes' }, { n: 6, label: 'S', name: 'Sábado' }, { n: 0, label: 'D', name: 'Domingo' },
];

/** Hora propuesta: la siguiente hora en punto si la cita es para hoy; 09:00 en otro día. */
function suggestTime(date: string): string {
  if (date !== todayIso()) return '09:00';
  const h = Math.min(Number(fmtTime(new Date()).slice(0, 2)) + 1, 23);
  return `${String(h).padStart(2, '0')}:00`;
}

type Props = {
  open: boolean; onClose: () => void; patientId?: string; date?: string; onSaved?: () => void;
  /** Uso interno de la pantalla de agenda: recibe el día de la cita guardada para saltar a él. */
  onSavedDate?: (date: string) => void;
  /** Uso interno: cita a editar / reprogramar (AGE-04). */
  appointment?: Appointment | null;
};

/** AGE-03 / AGE-08 · Hoja "Nueva cita" (y, con `appointment`, "Reprogramar / editar"). */
export function NewAppointmentSheet({ open, onClose, patientId, date, onSaved, onSavedDate, appointment }: Props) {
  const user = useUser();
  const toast = useToast();
  const { meta } = useMeta();
  const { data: patients } = usePatientOptions();
  const editing = !!appointment;

  const types = useMemo(() => {
    const list = (meta?.session_types ?? []).filter((t) => t.active).map((t) => ({ name: t.name, duration: t.default_duration_min }));
    if (appointment && !list.some((t) => t.name === appointment.type_name)) list.unshift({ name: appointment.type_name, duration: appointment.duration_min });
    return list;
  }, [meta, appointment]);
  const therapists = useMemo(
    () => (meta?.therapists ?? []).filter((t) => t.active || t.id === appointment?.therapist_id),
    [meta, appointment],
  );

  const blank = (): Form => {
    const d = date ?? todayIso();
    return {
      patient_id: patientId ?? '', therapist_id: '', date: d, time: suggestTime(d), type_name: '', duration_min: 50, notes: '',
      repeat: false, weekdays: [weekday(d)], weeks: 4,
    };
  };
  const [f, setF] = useState<Form>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<SeriesResult | null>(null);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((s) => ({ ...s, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: '' } : e));
    setProblem('');
  };

  // Cada vez que se abre, la hoja arranca limpia (o con los datos de la cita a editar).
  useEffect(() => {
    if (!open) return;
    setErrors({}); setProblem(''); setSummary(null); setBusy(false);
    if (appointment) {
      setF({
        patient_id: appointment.patient_id, therapist_id: appointment.therapist_id, date: appointment.date, time: appointment.time,
        type_name: appointment.type_name, duration_min: appointment.duration_min, notes: appointment.notes,
        repeat: false, weekdays: [weekday(appointment.date)], weeks: 4,
      });
    } else setF(blank());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, appointment?.id]);

  // Valores por defecto que dependen de catálogos que pueden llegar después de abrir.
  useEffect(() => {
    if (!open || editing) return;
    setF((s) => {
      let n = s;
      if (!s.type_name && types[0]) n = { ...n, type_name: types[0].name, duration_min: types[0].duration };
      if (user.isOwner && !s.therapist_id && s.patient_id) {
        const p = patients?.find((x) => x.id === s.patient_id);
        if (p && therapists.some((t) => t.id === p.therapist_id)) n = { ...n, therapist_id: p.therapist_id };
      }
      return n;
    });
  }, [open, editing, types, patients, therapists, user.isOwner, f.patient_id]);

  const pickPatient = (id: string) => {
    const p = patients?.find((x) => x.id === id);
    setF((s) => ({ ...s, patient_id: id, therapist_id: p && therapists.some((t) => t.id === p.therapist_id) ? p.therapist_id : s.therapist_id }));
    setErrors((e) => ({ ...e, patient_id: '' }));
    setProblem('');
  };
  const pickType = (name: string) => {
    const t = types.find((x) => x.name === name);
    setF((s) => ({ ...s, type_name: name, duration_min: t ? t.duration : s.duration_min }));   // propone la duración del tipo
    setErrors((e) => ({ ...e, type_name: '' }));
    setProblem('');
  };
  const pickDate = (d: string) => {
    setF((s) => ({ ...s, date: d, weekdays: s.repeat || !d ? s.weekdays : [weekday(d)] }));
    setErrors((e) => ({ ...e, date: '' }));
    setProblem('');
  };
  const toggleDay = (n: number) => set('weekdays', f.weekdays.includes(n) ? f.weekdays.filter((x) => x !== n) : [...f.weekdays, n]);

  const durations = DURATIONS.includes(f.duration_min) ? DURATIONS : [...DURATIONS, f.duration_min].sort((a, b) => a - b);
  const fixedPatient = editing ? appointment!.patient_name : patientId ? (patients?.find((p) => p.id === patientId)?.full_name ?? 'Cargando…') : null;
  const seriesCount = f.repeat ? f.weekdays.length * f.weeks : 1;

  const save = async () => {
    const e: Record<string, string> = {};
    if (!f.patient_id) e.patient_id = 'Selecciona un paciente.';
    if (!f.date) e.date = 'Indica la fecha.';
    if (!f.time) e.time = 'Indica la hora.';
    if (!f.type_name) e.type_name = 'Elige el tipo de sesión.';
    if (f.repeat && f.weekdays.length === 0) e.repeat = 'Elige al menos un día de la semana.';
    if (f.repeat && seriesCount > 60) e.repeat = `Una serie admite máximo 60 citas; esta tendría ${seriesCount}.`;
    setErrors(e); setProblem('');
    if (Object.keys(e).length) return;

    setBusy(true);
    try {
      const common = { date: f.date, time: f.time, duration_min: f.duration_min, type_name: f.type_name, notes: f.notes, ...(user.isOwner && f.therapist_id ? { therapist_id: f.therapist_id } : {}) };
      if (editing) {
        await api.patch<Appointment>(`/api/appointments/${appointment!.id}`, common);
        toast(`Cita actualizada · ${dayLabel(f.date)} ${f.time}`);
      } else if (f.repeat) {
        const r = await api.post<SeriesResult>('/api/appointments', { ...common, patient_id: f.patient_id, repeat: { weekdays: f.weekdays, weeks: f.weeks } });
        await refresh('/api/appointments');
        onSaved?.();
        onSavedDate?.(r.created[0]?.date ?? f.date);
        if (r.conflicts.length) { setSummary(r); return; }                 // la hoja queda abierta con el resumen
        toast(`Se agendaron ${r.created.length} citas · desde ${dayLabel(r.created[0].date)} ${f.time}`);
        onClose();
        return;
      } else {
        await api.post<Appointment>('/api/appointments', { ...common, patient_id: f.patient_id });
        toast(`Cita agendada · ${dayLabel(f.date)} ${f.time}`);
      }
      await refresh('/api/appointments');
      onSaved?.();
      onSavedDate?.(f.date);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = { ...(err.fields ?? {}) };
        for (const k of Object.keys(fields)) if (k.startsWith('repeat.')) { fields.repeat = fields[k]; }
        setErrors(fields);
        // Empalme / fuera de horario / bloqueo (409) y cualquier error sin campo: visible arriba del botón.
        if (err.status === 409 || !err.fields || !Object.keys(err.fields).length) setProblem(err.message);
      } else setProblem('Ocurrió un error. Intenta de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  if (summary) {
    const n = summary.created.length, m = summary.conflicts.length;
    return (
      <Sheet open={open} onClose={onClose} title="Citas recurrentes" footer={<Button variant="primary" onClick={onClose}>Entendido</Button>}>
        <div className="stack md">
          <Notice tone="gold">
            Se {n === 1 ? 'agendó 1 cita' : `agendaron ${n} citas`}; {m === 1 ? '1 no se pudo' : `${m} no se pudieron`}:
          </Notice>
          <div className="stack sm">
            {summary.conflicts.map((c) => (
              <div key={c.date} className="row" style={{ alignItems: 'flex-start' }}>
                <span className="t-mono blue" style={{ lineHeight: 1.4, flex: 'none' }}>{fmtDate(c.date)} {c.time}</span>
                <span className="t-sub grow">{c.reason}</span>
              </div>
            ))}
          </div>
          <div className="t-small">Puedes agendar esas fechas a mano en otro horario.</div>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title={editing ? 'Reprogramar / editar cita' : 'Nueva cita'}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
        <div className="grid-form">
          <Field label="Paciente" error={errors.patient_id}>
            {fixedPatient !== null
              ? <Input value={fixedPatient} disabled readOnly />
              : <PatientPicker value={f.patient_id} onChange={pickPatient} invalid={!!errors.patient_id} />}
          </Field>
          {user.isOwner && (
            <Field label="Fisioterapeuta" error={errors.therapist_id}>
              <Select value={f.therapist_id} onChange={(e) => set('therapist_id', e.target.value)} invalid={!!errors.therapist_id}>
                <option value="">{meta ? 'El asignado al paciente' : 'Cargando…'}</option>
                {therapists.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Fecha" error={errors.date}>
            <Input type="date" value={f.date} onChange={(e) => pickDate(e.target.value)} invalid={!!errors.date} />
          </Field>
          <Field label="Hora" error={errors.time}>
            <Input type="time" step={300} value={f.time} onChange={(e) => set('time', e.target.value)} invalid={!!errors.time} />
          </Field>
          <Field label="Tipo de sesión" error={errors.type_name}>
            <Select value={f.type_name} onChange={(e) => pickType(e.target.value)} invalid={!!errors.type_name}>
              {!f.type_name && <option value="">{meta ? 'Selecciona' : 'Cargando…'}</option>}
              {types.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Duración" error={errors.duration_min}>
            <Select value={String(f.duration_min)} onChange={(e) => set('duration_min', Number(e.target.value))} invalid={!!errors.duration_min}>
              {durations.map((d) => <option key={d} value={d}>{d} min</option>)}
            </Select>
          </Field>
        </div>
        <div style={{ marginTop: 10 }}>
          <Field label="Notas (opcional)" error={errors.notes}>
            <Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} invalid={!!errors.notes}
              placeholder="Ej. traer vendaje, revisar carga de la semana" style={{ minHeight: 72 }} />
          </Field>
        </div>

        {!editing && (
          <div className="stack sm" style={{ marginTop: 12 }}>
            <Checkbox label="Repetir cada semana" checked={f.repeat} onChange={(e) => set('repeat', e.target.checked)} />
            {f.repeat && (
              <div className="kv stack sm">
                <div className="t-label">Días de la semana</div>
                <div className="hstack wrap" role="group" aria-label="Días de la semana">
                  {WEEK_CHIPS.map((d) => (
                    <Chip key={d.n} square on={f.weekdays.includes(d.n)} onClick={() => toggleDay(d.n)} aria-label={d.name} title={d.name}
                      style={{ minWidth: 40, padding: 0 }}>{d.label}</Chip>
                  ))}
                </div>
                <Field label="Durante" error={errors.repeat} hint={`Se intentará agendar ${seriesCount} ${seriesCount === 1 ? 'cita' : 'citas'} a las ${f.time || '--:--'}. Las que choquen con otra cita, el horario o un bloqueo se reportan y no impiden las demás.`}>
                  <Select value={String(f.weeks)} onChange={(e) => set('weeks', Number(e.target.value))} style={{ maxWidth: 200 }}>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((w) => <option key={w} value={w}>{w} {w === 1 ? 'semana' : 'semanas'}</option>)}
                  </Select>
                </Field>
              </div>
            )}
          </div>
        )}

        {problem && <div style={{ marginTop: 14 }} role="alert"><Notice tone="red">{problem}</Notice></div>}
        <div className="sheet-foot" style={{ marginTop: problem ? 12 : 16 }}>
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" loading={busy} style={{ flex: 2 }}>{editing ? 'Guardar cambios' : f.repeat ? 'Agendar citas' : 'Agendar cita'}</Button>
        </div>
      </form>
    </Sheet>
  );
}

/** AGE-04 · La misma hoja, para reprogramar o editar una cita programada. */
export function EditAppointmentSheet({ open, onClose, appointment, onSaved, onSavedDate }: {
  open: boolean; onClose: () => void; appointment: Appointment | null; onSaved?: () => void; onSavedDate?: (date: string) => void;
}) {
  if (!appointment) return null;
  return <NewAppointmentSheet open={open} onClose={onClose} appointment={appointment} onSaved={onSaved} onSavedDate={onSavedDate} />;
}
