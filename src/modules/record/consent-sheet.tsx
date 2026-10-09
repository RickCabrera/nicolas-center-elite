'use client';
import { useEffect, useMemo, useState } from 'react';
import { Button, ErrorNote, Field, Input, Select, Sheet, Skeleton, useToast } from '@/components/ui';
import { ApiError, api, refresh, useApi } from '@/lib/client';
import { CONSENT_TITLE, RELATIONSHIPS, resolveSigner, type ConsentKind, type Relationship } from './consent-text';
import { SignaturePad } from './signature-pad';
import type { ConsentTemplate } from './types';

const BLANK = '____________';

/**
 * EXP-10 / PAC-08 · Firma en pantalla del aviso de privacidad o de un consentimiento.
 * Muestra el texto vigente, quién firma y el panel de firma. El texto que se guarda lo arma el servidor.
 */
export function ConsentSheet({ open, onClose, patientId, kind, onSigned }: { open: boolean; onClose: () => void; patientId: string; kind: ConsentKind; onSigned?: () => void }) {
  const toast = useToast();
  const tpl = useApi<ConsentTemplate>(open ? `/api/patients/${patientId}/consents?template=${kind}` : null, { revalidateOnFocus: false, keepPreviousData: false });
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState<Relationship>('Paciente');
  const [signature, setSignature] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const t = tpl.data && tpl.data.kind === kind ? tpl.data : undefined;

  // Prellenado: firma el paciente si es mayor de edad; si es menor, su madre, padre o tutor.
  useEffect(() => {
    if (!open || !t) return;
    setErrors({});
    setFailure(null);
    setSignature(null);
    if (t.is_minor) {
      setName(t.guardian_name);
      setRelationship(t.guardian_relationship === 'Madre' || t.guardian_relationship === 'Padre' ? t.guardian_relationship : 'Tutor');
    } else {
      setName(t.patient_name);
      setRelationship('Paciente');
    }
  }, [open, t]);

  const options = RELATIONSHIPS.filter((r) => !(t?.is_minor && r === 'Paciente'));
  const text = useMemo(
    () => (t ? resolveSigner(t.body, t.patient_name, name.trim() || BLANK, relationship) : ''),
    [t, name, relationship],
  );

  const save = async () => {
    const e: Record<string, string> = {};
    if (name.trim().length < 3) e.signer_name = 'Escribe el nombre completo de quien firma.';
    if (!signature) e.signature_png = 'Falta la firma. Pide a quien firma que la trace en el recuadro.';
    setErrors(e);
    setFailure(null);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      await api.post(`/api/patients/${patientId}/consents`, { kind, signer_name: name.trim(), signer_relationship: relationship, signature_png: signature });
      await refresh(`/api/patients/${patientId}`);
      toast(`${CONSENT_TITLE[kind]} firmado`);
      onSigned?.();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFailure(err instanceof Error ? err.message : 'No se pudo guardar. Intenta de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={CONSENT_TITLE[kind]} wide
      footer={t ? <>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={saving} onClick={save}>Firmar y guardar</Button>
      </> : undefined}>
      {!t && !tpl.error && <Skeleton rows={3} height={72} />}
      {!t && <ErrorNote error={tpl.error} retry={() => tpl.mutate()} />}
      {t && (
        <div className="stack md">
          <div className="paper" tabIndex={0} role="document" aria-label={`Texto de: ${CONSENT_TITLE[kind]}`}
            style={{ maxHeight: 'min(34vh, 320px)', overflowY: 'auto', padding: 16, font: '400 13.5px/1.55 var(--f-body)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {text}
          </div>
          <div className="grid-form">
            <Field label="Nombre de quien firma" error={errors.signer_name}>
              <Input value={name} onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, signer_name: '' })); }} invalid={!!errors.signer_name} autoComplete="off" maxLength={160} />
            </Field>
            <Field label="Parentesco" error={errors.signer_relationship}
              hint={t.is_minor ? `El paciente tiene ${t.patient_age} años: firma su madre, padre o tutor.` : undefined}>
              <Select value={relationship} onChange={(e) => { setRelationship(e.target.value as Relationship); setErrors((x) => ({ ...x, signer_relationship: '' })); }} invalid={!!errors.signer_relationship}>
                {options.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Field>
          </div>
          <div className="field">
            <span>Firma</span>
            <SignaturePad onChange={(d) => { setSignature(d); if (d) setErrors((x) => ({ ...x, signature_png: '' })); }} invalid={!!errors.signature_png} disabled={saving} />
            {errors.signature_png && <span className="err" role="alert">{errors.signature_png}</span>}
          </div>
          {failure && !Object.values(errors).some(Boolean) && <ErrorNote error={{ message: failure }} />}
          <div className="t-small">Al guardar, el documento queda firmado con fecha y hora y ya no puede modificarse.</div>
        </div>
      )}
    </Sheet>
  );
}
