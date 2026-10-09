'use client';
import { useEffect, useState } from 'react';
import { Button, Checkbox, ErrorNote, Field, Select, Sheet, useToast } from '@/components/ui';
import { useMeta } from '@/components/meta';
import { ApiError, api, refresh } from '@/lib/client';

/** EXP-01 / PAC-04 · El dueño reasigna a este paciente con otro fisioterapeuta (usa POST /api/patients/[id]/assign). */
export function ReassignPatientSheet({ open, onClose, patientId, patientName, therapistId, onDone }: {
  open: boolean; onClose: () => void; patientId: string; patientName: string; therapistId: string; onDone?: () => void;
}) {
  const toast = useToast();
  const { meta, error } = useMeta();
  const [to, setTo] = useState('');
  const [move, setMove] = useState(true);
  const [fieldError, setFieldError] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setTo(''); setMove(true); setFieldError(''); setFailure(null); } }, [open]);

  const options = (meta?.therapists ?? []).filter((t) => t.active && t.id !== therapistId);
  const current = meta?.therapists.find((t) => t.id === therapistId);

  const save = async () => {
    if (!to) { setFieldError('Selecciona el fisioterapeuta.'); return; }
    setSaving(true);
    setFailure(null);
    try {
      const r = await api.post<{ appointments_conflict?: unknown[] }>(`/api/patients/${patientId}/assign`, { therapist_id: to, move_appointments: move });
      await refresh('/api/patients', '/api/appointments');
      const kept = r?.appointments_conflict?.length ?? 0;
      toast(`Paciente reasignado a ${options.find((t) => t.id === to)?.display_name ?? 'otro fisioterapeuta'}` +
        (kept ? `. ${kept} ${kept === 1 ? 'cita no se pudo pasar' : 'citas no se pudieron pasar'} por su agenda: revísalas.` : ''));
      onDone?.();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.fields?.therapist_id) setFieldError(e.fields.therapist_id);
      else setFailure(e instanceof Error ? e.message : 'No se pudo reasignar. Intenta de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Reasignar paciente"
      footer={<>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={saving} onClick={save}>Reasignar</Button>
      </>}>
      <div className="stack md">
        <div className="t-sub">
          {patientName} está con {current?.display_name ?? 'su fisioterapeuta actual'}. El nuevo fisioterapeuta verá el expediente completo; el cambio queda en el historial.
        </div>
        <ErrorNote error={error} />
        <Field label="Nuevo fisioterapeuta" error={fieldError}>
          <Select value={to} onChange={(e) => { setTo(e.target.value); setFieldError(''); }} invalid={!!fieldError}>
            <option value="">{meta ? 'Selecciona un fisioterapeuta' : 'Cargando…'}</option>
            {options.map((t) => <option key={t.id} value={t.id}>{t.display_name}{t.location_name ? ` · ${t.location_name}` : ''}</option>)}
          </Select>
        </Field>
        <Checkbox label="Pasar también sus citas futuras al nuevo fisioterapeuta" checked={move} onChange={(e) => setMove(e.target.checked)} />
        {failure && <ErrorNote error={{ message: failure }} />}
      </div>
    </Sheet>
  );
}
