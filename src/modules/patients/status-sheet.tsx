'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, Field, Notice, Sheet, Textarea, useToast } from '@/components/ui';
import { api, ApiError, refresh } from '@/lib/client';

type Result = { id: string; status: 'active' | 'inactive'; future_appointments: number };

/**
 * PAC-05 · Baja con motivo o reactivación de un paciente. `status` es el estado ACTUAL:
 * con 'active' la hoja da de baja; con 'inactive' reactiva. Nunca se borra el expediente.
 */
export function PatientStatusSheet({ open, onClose, patientId, status, onDone }: { open: boolean; onClose: () => void; patientId: string; status: 'active' | 'inactive'; onDone?: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const deactivate = status === 'active';
  useEffect(() => { if (open) { setReason(''); setError(''); } }, [open]);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    if (deactivate && reason.trim().length < 3) { setError('Escribe el motivo de la baja.'); return; }
    setBusy(true);
    try {
      const r = await api.post<Result>(`/api/patients/${patientId}/status`, deactivate ? { status: 'inactive', reason: reason.trim() } : { status: 'active' });
      const n = r.future_appointments;
      toast(deactivate
        ? n > 0 ? `Paciente dado de baja. Tiene ${n} ${n === 1 ? 'cita futura' : 'citas futuras'}: cancélalas en la agenda.` : 'Paciente dado de baja'
        : 'Paciente reactivado', deactivate && n > 0 ? 'error' : 'ok');
      refresh('/api/patients');
      onDone?.();
      onClose();
    } catch (err) {
      const e = err as ApiError;
      setError(e.fields?.reason ?? e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={deactivate ? 'Dar de baja al paciente' : 'Reactivar paciente'}>
      <form onSubmit={submit} noValidate>
        <div className="stack md">
          {deactivate ? (
            <>
              <div className="t-body">El paciente dejará de aparecer en las listas. Su expediente se conserva completo y puede reactivarse en cualquier momento.</div>
              <Field label="Motivo de la baja" error={error}>
                <Textarea value={reason} onChange={(e) => { setReason(e.target.value); setError(''); }} invalid={!!error}
                  placeholder="Ej. Alta médica, cambio de ciudad, dejó de asistir" maxLength={400} />
              </Field>
            </>
          ) : (
            <>
              <div className="t-body">El paciente volverá a aparecer en las listas con su expediente y su historial intactos.</div>
              {error && <Notice tone="red"><span role="alert">{error}</span></Notice>}
            </>
          )}
        </div>
        <div className="sheet-foot">
          <Button onClick={onClose}>Volver</Button>
          <Button type="submit" variant={deactivate ? 'danger' : 'primary'} loading={busy}>{deactivate ? 'Dar de baja' : 'Reactivar'}</Button>
        </div>
      </form>
    </Sheet>
  );
}
