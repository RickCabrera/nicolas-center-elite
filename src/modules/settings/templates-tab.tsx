'use client';
import { useEffect, useRef, useState } from 'react';
import { useMeta } from '@/components/meta';
import { Badge, Button, Card, Chip, ErrorNote, Notice, Skeleton, useToast } from '@/components/ui';
import { api, ApiError, refresh, useApi } from '@/lib/client';
import { DEFAULT_TEMPLATES, type TemplateKey } from './default-templates';
import { fillTemplate, locationAddress, MARKER_HELP, TEMPLATE_INFO, TEMPLATE_KEYS, unknownMarkers } from './shared';
import type { ClinicData } from './types';

const SAMPLE = { paciente: 'Regina Solís Martínez', firmante: 'Laura Martínez Ruiz', parentesco: 'madre' };

// CFG-07 · Plantillas de los textos legales, con vista previa.
export function TemplatesTab() {
  const toast = useToast();
  const { meta } = useMeta();
  const { data, error, mutate } = useApi<ClinicData>('/api/clinic');
  const [key, setKey] = useState<TemplateKey>('privacy_notice');
  const [drafts, setDrafts] = useState<Partial<Record<TemplateKey, string>>>({});
  const [fieldError, setFieldError] = useState('');
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setFieldError(''), [key]);

  if (error && !data) return <ErrorNote error={error} retry={() => mutate()} />;
  if (!data) return <Skeleton rows={3} height={120} />;

  const info = TEMPLATE_INFO[key];
  const saved = data[key];
  const value = drafts[key] ?? saved;
  const isDirty = (k: TemplateKey) => drafts[k] !== undefined && drafts[k]!.trim() !== data[k];
  const dirty = isDirty(key);
  const setValue = (v: string) => { setDrafts((d) => ({ ...d, [key]: v })); setFieldError(''); };
  const bad = unknownMarkers(value, info.markers);

  const loc = meta?.locations.find((l) => l.active);
  const vars = {
    clinica: data.name,
    domicilio: (loc && locationAddress(loc)) || 'Av. 1 No. 123, Centro, 94500 Córdoba, Veracruz',
    ...SAMPLE,
  };

  const insert = (marker: string) => {
    const token = `{{${marker}}}`;
    const el = area.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    setValue(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + token.length, start + token.length); });
  };

  const save = async () => {
    if (info.required && value.trim().length < 20) return setFieldError('Este texto no puede quedar vacío: se usa en documentos que se firman.');
    if (bad.length) return setFieldError(`Este marcador no existe para este texto: ${bad.map((b) => `{{${b}}}`).join(', ')}. Corrígelo o quítalo.`);
    setBusy(true);
    try {
      await api.patch('/api/clinic', { [key]: value });
      await refresh('/api/clinic', '/api/privacy');
      setDrafts((d) => { const n = { ...d }; delete n[key]; return n; });
      toast(`${info.label}: guardado`);
    } catch (e) {
      const ae = e as ApiError;
      setFieldError(ae.fields?.[key] ?? ae.message);
    } finally {
      setBusy(false);
    }
  };
  const isOriginal = value.trim() === DEFAULT_TEMPLATES[key];

  return (
    <div className="stack">
      <Notice tone="gold">Estos textos son un punto de partida. Pide a tu abogado o responsable sanitario que los revise antes de usarlos.</Notice>
      <div className="scroll-x" role="group" aria-label="Plantilla">
        {TEMPLATE_KEYS.map((k) => (
          <Chip key={k} on={k === key} onClick={() => setKey(k)}>{TEMPLATE_INFO[k].label}{isDirty(k) ? ' •' : ''}</Chip>
        ))}
      </div>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Card title={info.label} blue action={dirty ? <Badge tone="gold">Sin guardar</Badge> : undefined}>
          <div className="stack md">
            <p className="t-small">{info.where}</p>
            {info.markers.length > 0 ? (
              <div>
                <div className="t-label">Marcadores disponibles · toca uno para insertarlo donde está el cursor</div>
                <div className="hstack wrap" style={{ marginTop: 8, gap: 6 }}>
                  {info.markers.map((m) => (
                    <button key={m} type="button" className="pill blue" style={{ cursor: 'pointer', minHeight: 32 }} title={MARKER_HELP[m]} onClick={() => insert(m)}>
                      {`{{${m}}}`}<span className="sr-only"> · {MARKER_HELP[m]}</span>
                    </button>
                  ))}
                </div>
                <div className="t-small" style={{ marginTop: 8 }}>
                  {info.markers.map((m) => `{{${m}}} = ${MARKER_HELP[m].toLowerCase()}`).join(' · ')}. Se sustituyen solos al mostrar o firmar el documento.
                </div>
              </div>
            ) : <p className="t-small">Este texto se imprime tal cual, sin marcadores.</p>}
            <label className="sr-only" htmlFor="tpl-editor">{info.label}</label>
            <textarea id="tpl-editor" ref={area} className="input" value={value} aria-invalid={!!fieldError || undefined} spellCheck lang="es"
              style={{ minHeight: key === 'rx_footer' || key === 'privacy_notice_short' ? 160 : 420, fontSize: 14 }}
              onChange={(e) => setValue(e.target.value)} />
            {fieldError && <div className="t-small red" role="alert">{fieldError}</div>}
            {!fieldError && bad.length > 0 && <div className="t-small gold">Marcador desconocido: {bad.map((b) => `{{${b}}}`).join(', ')}</div>}
            <div className="hstack wrap">
              <Button variant="primary" loading={busy} disabled={!dirty} onClick={save}>Guardar</Button>
              {dirty && <Button disabled={busy} onClick={() => setDrafts((d) => { const n = { ...d }; delete n[key]; return n; })}>Descartar</Button>}
              <Button disabled={busy || isOriginal} onClick={() => { setValue(DEFAULT_TEMPLATES[key]); toast('Texto original cargado. Revísalo y presiona Guardar.'); }}>Restaurar texto original</Button>
            </div>
            <p className="t-small">{value.length.toLocaleString('es-MX')} caracteres. Los documentos ya firmados conservan el texto con el que se firmaron.</p>
          </div>
        </Card>

        <div className="stack sm">
          <div className="t-label">Vista previa con datos de ejemplo</div>
          <div className="paper" lang="es">
            <div className="p-head">
              { }
              <img src={data.logo_url ?? '/logo.png'} alt="" />
              <div style={{ minWidth: 0 }}>
                <div className="p-brand" style={{ overflowWrap: 'anywhere' }}>{data.name}</div>
                <div className="p-sub">{info.label}</div>
              </div>
            </div>
            <div style={{ marginTop: 18, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: `400 ${key === 'rx_footer' ? 12 : 14}px/1.6 var(--f-body)`, color: key === 'rx_footer' ? '#4a4f57' : undefined }}>
              {fillTemplate(value, vars) || 'Sin texto.'}
            </div>
            {(key === 'consent_template' || key === 'biometric_consent') && (
              <div className="p-sign"><div>{SAMPLE.firmante}<small>Firma · {SAMPLE.parentesco} de {SAMPLE.paciente}</small></div></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
