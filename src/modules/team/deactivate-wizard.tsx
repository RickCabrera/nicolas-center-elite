'use client';
import { useMemo, useState } from 'react';
import { useMeta } from '@/components/meta';
import { Button, Chip, Empty, ErrorNote, Field, KV, Notice, Select, Sheet, Skeleton } from '@/components/ui';
import { api, ApiError, refresh, useApi } from '@/lib/client';
import { fmtDateTime } from '@/lib/dates';
import { shortName } from '@/lib/format';
import type { DeactivateAppointment, DeactivateResult, TeamUserDetail } from './types';

type PatientRow = { id: string; full_name: string; record_number?: string };
type Props = { open: boolean; onClose: () => void; userId: string | null; onDone?: () => void };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * EQ-04 / AUTH-09 · Asistente para dar de baja a un fisioterapeuta en tres pasos:
 * qué pasa → a quién pasan sus pacientes (todos a uno, o uno por uno) → confirmación y resumen.
 */
export function DeactivateWizard(props: Props) {
  return (
    <Sheet open={props.open && !!props.userId} onClose={props.onClose} title="Desactivar fisioterapeuta" wide>
      {props.open && props.userId && <WizardBody key={props.userId} {...props} userId={props.userId} />}
    </Sheet>
  );
}

function WizardBody({ userId, onClose, onDone }: Props & { userId: string }) {
  const { meta } = useMeta();
  const detail = useApi<TeamUserDetail>(`/api/users/${userId}`, { revalidateOnFocus: false });
  const u = detail.data;
  const nPatients = u?.patients_active ?? 0;
  const nAppts = u?.future_appointments ?? 0;
  const needsDest = nPatients > 0 || nAppts > 0;
  const list = useApi<{ items: PatientRow[]; total: number }>(u && nPatients > 0 ? `/api/patients?therapist_id=${userId}&limit=500` : null, { revalidateOnFocus: false });
  const patients = useMemo(() => list.data?.items ?? [], [list.data]);
  const others = (meta?.therapists ?? []).filter((t) => t.active && t.id !== userId);
  const nameOf = (id: string) => others.find((t) => t.id === id)?.display_name ?? '';

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [mode, setMode] = useState<'all' | 'each'>('all');
  const [dest, setDest] = useState('');
  const [each, setEach] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<DeactivateResult | null>(null);

  if (detail.error) return <ErrorNote error={detail.error} retry={() => detail.mutate()} />;
  if (!u) return <Skeleton rows={4} height={44} />;

  const first = shortName(u.display_name);
  const perPatient = mode === 'each' && nPatients > 0;
  const missing = perPatient ? patients.filter((p) => !each[p.id]).length : 0;
  const step2Ready = !needsDest || (perPatient ? patients.length > 0 && missing === 0 : !!dest);

  // Resumen por destino para la confirmación.
  const summary = new Map<string, number>();
  if (perPatient) for (const p of patients) summary.set(each[p.id], (summary.get(each[p.id]) ?? 0) + 1);
  else if (dest) summary.set(dest, nPatients);
  // En el reparto uno por uno, lo que no esté en la lista (p. ej. una cita suya con un paciente
  // sin fisioterapeuta activo) pasa al destino más usado.
  const fallback = perPatient ? [...summary.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null : dest || null;

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const body = !needsDest ? { reassign_to: null } : perPatient ? { reassign_to: fallback, patients: each } : { reassign_to: dest };
      const r = await api.post<DeactivateResult>(`/api/users/${userId}/deactivate`, body);
      setResult(r);
      await refresh('/api/users', '/api/meta', '/api/patients', '/api/appointments', '/api/dashboard');
      onDone?.();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'error', 'No se pudo desactivar. Intenta de nuevo.'));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="stack">
        <Notice tone="green">
          <b>{u.display_name}</b> quedó desactivado: {plural(result.patients_moved, 'paciente reasignado', 'pacientes reasignados')},{' '}
          {plural(result.appointments_moved, 'cita movida', 'citas movidas')},{' '}
          {plural(result.appointments_cancelled.length, 'cancelada por empalme', 'canceladas por empalme')}.
        </Notice>
        <div className="grid-kv">
          <KV label="Pacientes reasignados">{result.patients_moved}</KV>
          <KV label="Citas movidas" tone="blue">{result.appointments_moved}</KV>
          <KV label="Canceladas por empalme" tone={result.appointments_cancelled.length ? 'gold' : undefined}>{result.appointments_cancelled.length}</KV>
          <KV label="Sesiones cerradas">{result.sessions_revoked}</KV>
        </div>
        <ApptList tone="red" title="Citas canceladas (el nuevo fisioterapeuta ya tenía cita a esa hora). Avisa al paciente y reprográmalas en la Agenda:" items={result.appointments_cancelled} />
        <ApptList tone="gold" title="Citas movidas que conviene revisar (quedaron fuera del horario o en un bloqueo del nuevo fisioterapeuta):" items={result.appointments_review} />
        {result.fingerprint_removal === 'queued' && <div className="t-small">Su huella se está dando de baja del lector de recepción.</div>}
        <div className="t-small">Sus notas, recetas, indicaciones y firmas se conservan intactas. Puedes reactivar la cuenta cuando quieras desde su tarjeta.</div>
        <div className="sheet-foot"><Button variant="primary" onClick={onClose}>Listo</Button></div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="hstack" aria-label={`Paso ${step} de 3`}>
        {[1, 2, 3].map((n) => (
          <div key={n} style={{ flex: 1, height: 4, borderRadius: 2, background: n <= step ? 'var(--blue)' : 'rgba(255,255,255,.14)' }} />
        ))}
      </div>
      <div className="t-label">Paso {step} de 3 · {step === 1 ? 'Qué pasa al desactivar' : step === 2 ? 'A quién pasan sus pacientes' : 'Confirmación'}</div>

      {step === 1 && (
        <div className="stack md">
          <div className="t-body">Vas a desactivar la cuenta de <b>{u.display_name}</b>. Esto es lo que ocurre:</div>
          <ul className="t-body" style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li>Ya no podrá entrar al sistema y sus sesiones abiertas se cierran en ese momento.</li>
            <li>{nPatients > 0
              ? <>Sus <b>{plural(nPatients, 'paciente activo', 'pacientes activos')}</b> {nPatients === 1 ? 'pasa' : 'pasan'} al fisioterapeuta que elijas. Queda registro en el historial de asignación de cada uno.</>
              : 'No tiene pacientes activos asignados.'}</li>
            <li>{nAppts > 0
              ? <>Sus <b>{plural(nAppts, 'cita futura', 'citas futuras')}</b> {nAppts === 1 ? 'se pasa' : 'se pasan'} al nuevo fisioterapeuta. Si alguna se empalma con su agenda, se cancela con el motivo «Fisioterapeuta dado de baja» y te la mostramos para reprogramarla.</>
              : 'No tiene citas futuras programadas.'}</li>
            <li>Sus notas de evolución, recetas, indicaciones y firmas <b>no se tocan</b>: siguen en cada expediente con su nombre y cédula.</li>
            <li>Su huella se da de baja del lector de recepción y sus invitaciones pendientes dejan de servir.</li>
            <li>No se borra nada: puedes reactivar la cuenta más adelante.</li>
          </ul>
        </div>
      )}

      {step === 2 && !needsDest && <Empty>{first} no tiene pacientes activos ni citas futuras: no hay nada que reasignar. Continúa para confirmar.</Empty>}
      {step === 2 && needsDest && others.length === 0 && (
        <Notice tone="red">No hay otro fisioterapeuta activo que reciba a sus pacientes. Agrega o reactiva a alguien antes de desactivar a {first}.</Notice>
      )}
      {step === 2 && needsDest && others.length > 0 && (
        <div className="stack md">
          {nPatients > 1 && (
            <div className="hstack wrap" role="group" aria-label="Forma de reasignar">
              <Chip on={mode === 'all'} onClick={() => setMode('all')}>Todos a un fisioterapeuta</Chip>
              <Chip on={mode === 'each'} onClick={() => setMode('each')}>Uno por uno</Chip>
            </div>
          )}
          {!perPatient && (
            <Field label={nPatients > 0 ? `¿Quién recibe a sus ${plural(nPatients, 'paciente', 'pacientes')}?` : `¿Quién recibe sus ${plural(nAppts, 'cita', 'citas')}?`}>
              <Select value={dest} onChange={(e) => setDest(e.target.value)}>
                <option value="">Selecciona un fisioterapeuta</option>
                {others.map((t) => <option key={t.id} value={t.id}>{t.display_name}{t.location_name ? ` · ${t.location_name}` : ''}</option>)}
              </Select>
            </Field>
          )}
          {perPatient && list.error && <ErrorNote error={list.error} retry={() => list.mutate()} />}
          {perPatient && !list.data && !list.error && <Skeleton rows={3} height={48} />}
          {perPatient && list.data && (
            <div className="stack sm">
              <div className="hstack between wrap">
                <span className="t-label">{missing > 0 ? `Faltan ${missing} por asignar` : 'Todos asignados'}</span>
                <label className="hstack t-small">
                  Asignar los que faltan a
                  <Select aria-label="Asignar los que faltan a" value="" style={{ minHeight: 38, width: 'auto', maxWidth: 220 }}
                    onChange={(e) => { const d = e.target.value; if (d) setEach((m) => Object.fromEntries(patients.map((p) => [p.id, m[p.id] || d]))); }}>
                    <option value="">Elegir…</option>
                    {others.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}
                  </Select>
                </label>
              </div>
              <div className="stack sm" style={{ maxHeight: 320, overflowY: 'auto', paddingRight: 2 }}>
                {patients.map((p) => (
                  <div key={p.id} className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                    <div className="grow" style={{ minWidth: 150 }}>
                      <div className="t-strong ellipsis">{p.full_name}</div>
                      {p.record_number && <div className="t-small">{p.record_number}</div>}
                    </div>
                    <Select aria-label={`Fisioterapeuta para ${p.full_name}`} value={each[p.id] ?? ''} invalid={!each[p.id] && !!error}
                      onChange={(e) => setEach((m) => ({ ...m, [p.id]: e.target.value }))} style={{ flex: '1 1 200px', minHeight: 42, width: 'auto' }}>
                      <option value="">Selecciona</option>
                      {others.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}
          {nAppts > 0 && <div className="t-small">Las citas futuras de cada paciente se van con él a su nuevo fisioterapeuta.</div>}
        </div>
      )}

      {step === 3 && (
        <div className="stack md">
          <div className="t-body">Revisa antes de confirmar la baja de <b>{u.display_name}</b>:</div>
          {needsDest ? (
            <div className="stack sm">
              {[...summary.entries()].filter(([, n]) => n > 0).map(([id, n]) => (
                <div key={id} className="row">
                  <div className="grow t-strong ellipsis">{nameOf(id)}</div>
                  <span className="pill blue">recibe {plural(n, 'paciente', 'pacientes')}</span>
                </div>
              ))}
              {nPatients === 0 && dest && (
                <div className="row"><div className="grow t-strong ellipsis">{nameOf(dest)}</div><span className="pill blue">recibe {plural(nAppts, 'cita', 'citas')}</span></div>
              )}
              {nAppts > 0 && nPatients > 0 && (
                <div className="t-small">{plural(nAppts, 'cita futura se mueve', 'citas futuras se mueven')} con su paciente; las que se empalmen se cancelan y se listan al terminar.</div>
              )}
            </div>
          ) : (
            <div className="t-small">No hay pacientes ni citas que reasignar.</div>
          )}
          <Notice tone="gold">Al confirmar, {first} pierde el acceso de inmediato. Su trabajo clínico firmado se conserva.</Notice>
          <ErrorNote error={error} />
        </div>
      )}

      <div className="sheet-foot">
        {step === 1 && <Button onClick={onClose}>Cancelar</Button>}
        {step > 1 && <Button onClick={() => { setError(null); setStep((s) => (s - 1) as 1 | 2); }} disabled={busy}>Atrás</Button>}
        {step === 1 && <Button variant="primary" onClick={() => setStep(2)}>Continuar</Button>}
        {step === 2 && <Button variant="primary" disabled={!step2Ready} onClick={() => setStep(3)}>Continuar</Button>}
        {step === 3 && <Button variant="danger" loading={busy} onClick={run}>Desactivar a {first}</Button>}
      </div>
    </div>
  );
}

function ApptList({ title, items, tone }: { title: string; items: DeactivateAppointment[]; tone: 'red' | 'gold' }) {
  if (!items.length) return null;
  return (
    <div className="stack sm">
      <Notice tone={tone}>{title}</Notice>
      {items.map((a) => (
        <div key={a.id} className="row">
          <div className="blue" style={{ font: '600 12px/1.2 var(--f-mono)', flex: 'none' }}>{fmtDateTime(a.starts_at)}</div>
          <div className="grow">
            <div className="t-strong ellipsis">{a.patient_name}</div>
            <div className="t-small">{a.reason ?? `Ahora con ${a.to_name}`}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
