'use client';
import { useEffect, useState } from 'react';
import { Button, Card, Empty, ErrorNote, Field, Sheet, Skeleton, Textarea, useToast } from '@/components/ui';
import { ApiError, api, useApi } from '@/lib/client';
import { fmtDateTime } from '@/lib/dates';
import { Exercises } from './exercises';
import type { ClinicalProfile, ProfileData } from './types';

const FIELDS: { key: keyof Pick<ClinicalProfile, 'background' | 'condition' | 'examination' | 'diagnosis' | 'treatment_plan'>; label: string; placeholder: string }[] = [
  { key: 'background', label: 'Antecedentes', placeholder: 'Enfermedades, cirugías, alergias, medicamentos, actividad física...' },
  { key: 'condition', label: 'Padecimiento actual', placeholder: 'Inicio, evolución, mecanismo de lesión, síntomas...' },
  { key: 'examination', label: 'Exploración física', placeholder: 'Inspección, palpación, rangos de movimiento, fuerza, pruebas especiales...' },
  { key: 'diagnosis', label: 'Diagnóstico', placeholder: 'Diagnóstico fisioterapéutico o lesión' },
  { key: 'treatment_plan', label: 'Plan de tratamiento', placeholder: 'Objetivos, frecuencia de sesiones, modalidades...' },
];
type Values = Record<(typeof FIELDS)[number]['key'], string>;
const EMPTY: Values = { background: '', condition: '', examination: '', diagnosis: '', treatment_plan: '' };

const Text = ({ children, empty }: { children: string; empty: string }) =>
  children.trim()
    ? <p className="t-body" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{children}</p>
    : <p className="t-sub">{empty}</p>;

/** Las tres tarjetas del perfil. `exercises` solo se pasa para la versión vigente. */
function ProfileCards({ profile, reason, patientId }: { profile: ClinicalProfile | null; reason: string; patientId?: string }) {
  return (
    <div className="stack">
      <div className="grid-2">
        <Card title="Diagnóstico / lesión" blue>
          <Text empty="Sin diagnóstico capturado.">{profile?.diagnosis ?? ''}</Text>
          {reason.trim() && <div className="t-sub" style={{ marginTop: 12, lineHeight: 1.5, overflowWrap: 'anywhere' }}>Motivo de consulta: {reason}</div>}
        </Card>
        <Card title="Plan de tratamiento" blue>
          <Text empty="Sin plan de tratamiento capturado.">{profile?.treatment_plan ?? ''}</Text>
          {patientId && <Exercises patientId={patientId} />}
        </Card>
      </div>
      <Card title="Valoración inicial" blue>
        <div className="grid-2">
          {FIELDS.slice(0, 3).map((f) => (
            <div key={f.key} style={{ minWidth: 0 }}>
              <div className="t-label" style={{ marginBottom: 6 }}>{f.label}</div>
              <Text empty="Sin registro.">{profile?.[f.key] ?? ''}</Text>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/** EXP-02 · Perfil clínico versionado: vista, edición (cada guardado es una versión nueva) e historial de solo lectura. */
export function ProfileTab({ patientId, reason, data, error, loading, reload }: {
  patientId: string; reason: string; data: ProfileData | undefined; error: { message: string } | undefined; loading: boolean; reload: () => Promise<unknown>;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const old = useApi<ClinicalProfile>(history && viewing ? `/api/patients/${patientId}/profile?version=${viewing}` : null, { revalidateOnFocus: false, keepPreviousData: false });
  const current = data?.current ?? null;

  useEffect(() => {
    if (!editing) return;
    setValues(current ? { background: current.background, condition: current.condition, examination: current.examination, diagnosis: current.diagnosis, treatment_plan: current.treatment_plan } : EMPTY);
    setErrors({});
    setFailure(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const save = async () => {
    if (!Object.values(values).some((v) => v.trim())) {
      setErrors({ diagnosis: 'Captura al menos un campo del perfil clínico.' });
      return;
    }
    setSaving(true);
    setFailure(null);
    try {
      const saved = await api.post<ClinicalProfile>(`/api/patients/${patientId}/profile`, values);
      await reload();
      toast(`Versión ${saved.version} guardada`);
      setEditing(false);
    } catch (e) {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      setFailure(e instanceof Error ? e.message : 'No se pudo guardar. Intenta de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  if (!data) {
    return error ? <ErrorNote error={error} retry={reload} /> : loading ? <Skeleton rows={2} height={140} /> : null;
  }

  return (
    <div className="stack">
      <div className="hstack between wrap" style={{ rowGap: 10 }}>
        <div className="t-small" style={{ minWidth: 0 }}>
          {current
            ? <>Versión {current.version} · {fmtDateTime(current.created_at)} · {current.created_by_name || 'Sistema'}</>
            : 'Aún no se captura el perfil clínico.'}
        </div>
        <div className="hstack" style={{ gap: 14 }}>
          {data.versions.length > 0 && (
            <button type="button" className="btn-link" onClick={() => { setViewing(null); setHistory(true); }}>Historial de versiones</button>
          )}
          <Button size="sm" variant={current ? 'default' : 'primary'} onClick={() => setEditing(true)}>{current ? 'Editar' : 'Capturar perfil'}</Button>
        </div>
      </div>

      <ProfileCards profile={current} reason={reason} patientId={patientId} />

      <Sheet open={editing} onClose={() => setEditing(false)} title="Perfil clínico" wide
        footer={<>
          <Button onClick={() => setEditing(false)}>Cancelar</Button>
          <Button variant="primary" loading={saving} onClick={save}>Guardar versión</Button>
        </>}>
        <div className="stack md">
          {FIELDS.map((f) => (
            <Field key={f.key} label={f.label} error={errors[f.key]}>
              <Textarea rows={3} value={values[f.key]} placeholder={f.placeholder} invalid={!!errors[f.key]} maxLength={f.key === 'diagnosis' ? 4000 : 6000}
                onChange={(e) => { setValues({ ...values, [f.key]: e.target.value }); setErrors({}); }} />
            </Field>
          ))}
          {failure && !Object.values(errors).some(Boolean) && <ErrorNote error={{ message: failure }} />}
          <div className="t-small">
            {current ? `Se guardará como versión ${current.version + 1}. ` : ''}Las versiones anteriores se conservan en el historial.
          </div>
        </div>
      </Sheet>

      <Sheet open={history} onClose={() => setHistory(false)} title={viewing ? `Perfil clínico · versión ${viewing}` : 'Historial de versiones'} wide>
        {!viewing ? (
          <div className="stack sm">
            {!data.versions.length && <Empty>Todavía no hay versiones guardadas.</Empty>}
            {data.versions.map((v, i) => (
              <button key={v.id} type="button" className="row" onClick={() => setViewing(v.version)}>
                <span className="t-mono blue" style={{ flex: 'none' }}>V{v.version}</span>
                <span className="grow">
                  <span className="t-strong" style={{ display: 'block' }}>{fmtDateTime(v.created_at)}</span>
                  <span className="t-small ellipsis" style={{ display: 'block' }}>{v.created_by_name || 'Sistema'}</span>
                </span>
                {i === 0 && <span className="badge blue">Vigente</span>}
              </button>
            ))}
          </div>
        ) : (
          <div className="stack">
            <button type="button" className="btn-link dim" style={{ alignSelf: 'flex-start' }} onClick={() => setViewing(null)}>← Historial de versiones</button>
            {!old.data && !old.error && <Skeleton rows={2} height={110} />}
            <ErrorNote error={old.error} retry={() => old.mutate()} />
            {old.data && (
              <>
                <div className="t-small">
                  Solo lectura · guardada el {fmtDateTime(old.data.created_at)} por {old.data.created_by_name || 'Sistema'}
                </div>
                <ProfileCards profile={old.data} reason="" />
              </>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
