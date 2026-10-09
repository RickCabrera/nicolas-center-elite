'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMeta } from '@/components/meta';
import { Button, Notice, Sheet, useForm, useToast } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { api, ApiError, refresh } from '@/lib/client';
import { clientErrors, EMPTY_PATIENT, focusFirstInvalid, PatientFormFields, patientPayload, valuesFromPatient, type PatientFormValues } from './patient-form';
import type { PatientDetail } from './types';

/**
 * PAC-05 · Hoja "Editar datos del paciente". `patient` es la respuesta de GET /api/patients/[id].
 * El fisioterapeuta asignado y la membresía no se cambian aquí.
 */
export function EditPatientSheet({ open, onClose, patient, onSaved }: { open: boolean; onClose: () => void; patient: PatientDetail; onSaved?: (p: PatientDetail) => void }) {
  const user = useUser();
  const { meta } = useMeta();
  const toast = useToast();
  const f = useForm<PatientFormValues>(EMPTY_PATIENT);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!open) return;
    f.reset(valuesFromPatient(patient));
    setFailure(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patient.id]);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (saving) return;
    const errs = clientErrors(f.values, { needTherapist: false });
    if (Object.keys(errs).length) { f.setErrors(errs); focusFirstInvalid(formRef); return; }
    setSaving(true);
    setFailure(null);
    try {
      const saved = await api.patch<PatientDetail>(`/api/patients/${patient.id}`, patientPayload(f.values));
      toast('Datos del paciente actualizados');
      refresh('/api/patients');
      onSaved?.(saved);
      onClose();
    } catch (err) {
      const e = err as ApiError;
      if (e.fields && Object.keys(e.fields).length) { f.setErrors(e.fields); focusFirstInvalid(formRef); }
      setFailure(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Editar datos del paciente">
      <form ref={formRef} onSubmit={submit} noValidate>
        <PatientFormFields f={f} meta={meta} clinical={user.isClinical} />
        {failure && <div style={{ marginTop: 12 }}><Notice tone="red"><span role="alert">{failure}</span></Notice></div>}
        <div className="sheet-foot">
          <Button size="lg" onClick={onClose}>Cancelar</Button>
          <Button size="lg" variant="primary" type="submit" loading={saving} style={{ flex: 2 }}>Guardar cambios</Button>
        </div>
      </form>
    </Sheet>
  );
}
