'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMeta } from '@/components/meta';
import { Button, ErrorNote, Notice, Sheet, useForm, useToast } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { api, ApiError, refresh } from '@/lib/client';
import { clientErrors, EMPTY_PATIENT, focusFirstInvalid, NO_PLAN, PatientFormFields, patientPayload, type PatientFormValues } from './patient-form';

/**
 * PAC-03 · Hoja "Nuevo paciente". PAC-04: el dueño y recepción eligen fisioterapeuta; el fisioterapeuta se autoasigna.
 * AUTH-10: recepción no captura motivo de consulta ni etiquetas.
 * PAC-06: se elige la membresía. PAC-07/08: al guardar abre el expediente con el checklist de alta.
 */
export function NewPatientSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const user = useUser();
  const { meta, error: metaError, reload } = useMeta();
  const router = useRouter();
  const toast = useToast();
  const f = useForm<PatientFormValues>(EMPTY_PATIENT);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const opened = useRef(false);
  const ready = !!meta;

  // Cada vez que se abre: formulario limpio con la sede del usuario y el primer plan activo.
  useEffect(() => {
    if (!open) { opened.current = false; return; }
    const active = (meta?.locations ?? []).filter((l) => l.active);
    const own = active.find((l) => l.id === user.location_id)?.id;
    const defaults = {
      location_id: own ?? (active.length === 1 ? active[0].id : ''),
      plan_id: (meta?.plans ?? []).find((p) => p.active)?.id ?? NO_PLAN,
    };
    if (opened.current) {
      // Los catálogos llegaron con la hoja ya abierta: completa sede y plan sin borrar lo que ya se escribió.
      f.setValues((s) => ({
        ...s,
        location_id: s.location_id || defaults.location_id,
        plan_id: s.plan_id && s.plan_id !== NO_PLAN ? s.plan_id : defaults.plan_id,
      }));
      return;
    }
    opened.current = true;
    f.reset({ ...EMPTY_PATIENT, ...defaults });
    setFailure(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ready]);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (saving) return;
    const errs = clientErrors(f.values, { needTherapist: user.isFront });
    if (Object.keys(errs).length) { f.setErrors(errs); focusFirstInvalid(formRef); return; }
    setSaving(true);
    setFailure(null);
    try {
      const body = {
        ...patientPayload(f.values),
        ...(user.isFront ? { therapist_id: f.values.therapist_id } : {}),
        plan_id: f.values.plan_id && f.values.plan_id !== NO_PLAN ? f.values.plan_id : null,
      };
      const created = await api.post<{ id: string }>('/api/patients', body);
      toast(`Paciente registrado · ${body.full_name}`);
      refresh('/api/patients');
      onClose();
      router.push(`/pacientes/${created.id}?alta=1`);
    } catch (err) {
      const e = err as ApiError;
      if (e.fields && Object.keys(e.fields).length) { f.setErrors(e.fields); focusFirstInvalid(formRef); }
      setFailure(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Nuevo paciente">
      <form ref={formRef} onSubmit={submit} noValidate>
        {metaError && !meta && <div style={{ marginBottom: 10 }}><ErrorNote error={metaError} retry={() => reload()} /></div>}
        <PatientFormFields f={f} meta={meta} assign={{ therapist: user.isFront }} clinical={user.isClinical} />
        <div className="stack sm" style={{ marginTop: 12 }}>
          {!user.isFront && <div className="t-small">Quedará asignado a ti: {user.display_name}.</div>}
          <Notice>Al guardar podrás firmar el aviso de privacidad y el consentimiento, y registrar la huella.</Notice>
          {failure && <Notice tone="red"><span role="alert">{failure}</span></Notice>}
        </div>
        <div className="sheet-foot">
          <Button size="lg" onClick={onClose}>Cancelar</Button>
          <Button size="lg" variant="primary" type="submit" loading={saving} disabled={!ready} style={{ flex: 2 }}>Guardar paciente</Button>
        </div>
      </form>
    </Sheet>
  );
}
