'use client';
import { useEffect, useState } from 'react';
import { Button, Chip, ErrorNote, Field, Input, Notice, Sheet, Textarea, useToast } from '@/components/ui';
import { ApiError, api, refresh } from '@/lib/client';
import { fmtDateTime } from '@/lib/dates';

export type AddendumTarget = { id: string; noted_at: string; author_name: string };

/**
 * EXP-04 · Nota de evolución. Al guardar, la base la firma con el usuario de la sesión y queda inmutable.
 * Con `addendumOf` trabaja en modo adenda: la corrección se cuelga de la nota original.
 */
export function NoteSheet({ open, onClose, patientId, appointmentId, onSaved, addendumOf }: {
  open: boolean; onClose: () => void; patientId: string; appointmentId?: string; onSaved?: () => void; addendumOf?: AddendumTarget | null;
}) {
  const toast = useToast();
  const [body, setBody] = useState('');
  const [pain, setPain] = useState<number | null>(null);
  const [rom, setRom] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBody(''); setPain(null); setRom(''); setErrors({}); setFailure(null);
  }, [open, addendumOf?.id]);

  const save = async () => {
    if (!body.trim()) {
      setErrors({ body: addendumOf ? 'Escribe la adenda.' : 'Escribe la nota.' });
      return;
    }
    setSaving(true);
    setFailure(null);
    try {
      await api.post(`/api/patients/${patientId}/notes`, addendumOf
        ? { body: body.trim(), addendum_of: addendumOf.id }
        : { body: body.trim(), pain_level: pain, range_of_motion: rom.trim(), appointment_id: appointmentId ?? null });
      await refresh(`/api/patients/${patientId}/notes`);
      toast(addendumOf ? 'Adenda firmada y guardada' : 'Nota firmada y guardada');
      onSaved?.();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFailure(err instanceof Error ? err.message : 'No se pudo guardar la nota. Intenta de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={addendumOf ? 'Adenda a la nota' : 'Nota de evolución'}>
      <div className="stack md">
        {addendumOf && (
          <div className="t-sub">Corrige o precisa la nota del {fmtDateTime(addendumOf.noted_at)} de {addendumOf.author_name}. La nota original se conserva tal como se firmó.</div>
        )}
        <Field label={addendumOf ? 'Adenda' : 'Nota'} error={errors.body}>
          <Textarea rows={5} value={body} onChange={(e) => { setBody(e.target.value); setErrors((x) => ({ ...x, body: '' })); }} invalid={!!errors.body} maxLength={8000}
            placeholder={addendumOf ? 'Qué se corrige o se agrega a la nota original...' : 'Avance de la sesión, tolerancia al ejercicio, dolor referido...'} />
        </Field>
        {!addendumOf && (
          <>
            <div className="field" role="group" aria-label="Dolor de 0 a 10, opcional">
              <span>Dolor 0-10 (opcional){pain !== null ? ` · ${pain}/10` : ''}</span>
              <div className="hstack wrap" style={{ gap: 6 }}>
                {Array.from({ length: 11 }, (_, n) => (
                  <Chip key={n} on={pain === n} onClick={() => setPain(pain === n ? null : n)} aria-label={`Dolor ${n} de 10`}
                    style={{ minWidth: 40, padding: 0, fontSize: 12 }}>{n}</Chip>
                ))}
              </div>
              <span className="hint">0 = sin dolor · 10 = el peor dolor. Toca de nuevo el número para quitarlo.</span>
              {errors.pain_level && <span className="err" role="alert">{errors.pain_level}</span>}
            </div>
            <Field label="Rango de movimiento (opcional)" error={errors.range_of_motion}>
              <Input value={rom} onChange={(e) => setRom(e.target.value)} invalid={!!errors.range_of_motion} maxLength={200} placeholder="Ej. Flexión de rodilla 110°" />
            </Field>
          </>
        )}
        <Notice tone="gold">Al guardar, la nota queda firmada y ya no puede editarse; las correcciones se hacen por adenda.</Notice>
        {failure && !errors.body && <ErrorNote error={{ message: failure }} />}
        <Button variant="primary" size="lg" block loading={saving} onClick={save}>Firmar y guardar</Button>
      </div>
    </Sheet>
  );
}
