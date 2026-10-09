'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMeta } from '@/components/meta';
import { Button, Checkbox, Empty, ErrorNote, Field, Notice, Select, Sheet, Skeleton, useToast } from '@/components/ui';
import { api, ApiError, refresh, useApi } from '@/lib/client';
import { fmtDateTime } from '@/lib/dates';
import type { ReassignResult } from './types';

type PatientRow = { id: string; full_name: string; record_number?: string; location_name?: string };
type Props = { open: boolean; onClose: () => void; fromTherapistId?: string; onDone?: () => void };

/**
 * EQ-07 · Reasignación masiva de pacientes SIN desactivar a nadie: origen → pacientes (con casillas)
 * → destino → resultado. La hace `POST /api/patients/reassign`, que también pasa las citas futuras.
 */
export function ReassignSheet(props: Props) {
  // El contenido se monta al abrir: cada apertura empieza limpia.
  return (
    <Sheet open={props.open} onClose={props.onClose} title="Reasignar pacientes" wide>
      {props.open && <ReassignBody {...props} />}
    </Sheet>
  );
}

function ReassignBody({ onClose, fromTherapistId, onDone }: Props) {
  const toast = useToast();
  const { meta } = useMeta();
  const therapists = meta?.therapists ?? [];
  const [from, setFrom] = useState(fromTherapistId ?? '');
  const [to, setTo] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<ReassignResult | null>(null);

  const list = useApi<{ items: PatientRow[]; total: number }>(from ? `/api/patients?therapist_id=${from}&limit=200` : null, { keepPreviousData: false });
  const patients = useMemo(() => list.data?.items ?? [], [list.data]);
  // Al cambiar de origen (o al cargar) quedan todos seleccionados: el caso común es pasar la carga completa.
  useEffect(() => { setPicked(new Set(patients.map((p) => p.id))); }, [patients]);

  const fromName = therapists.find((t) => t.id === from)?.display_name ?? '';
  const toName = therapists.find((t) => t.id === to)?.display_name ?? '';
  const destinations = therapists.filter((t) => t.active && t.id !== from);
  const all = patients.length > 0 && picked.size === patients.length;
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.post<ReassignResult>('/api/patients/reassign', { patient_ids: [...picked], to_therapist_id: to });
      setResult(r);
      await refresh('/api/users', '/api/patients', '/api/appointments', '/api/dashboard', '/api/meta');
      toast(`${r.moved} paciente${r.moved === 1 ? '' : 's'} reasignado${r.moved === 1 ? '' : 's'}`);
      onDone?.();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'error', 'No se pudo reasignar. Intenta de nuevo.'));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="stack">
        <Notice tone="green">
          <b>{result.moved}</b> paciente{result.moved === 1 ? '' : 's'} {result.moved === 1 ? 'pasó' : 'pasaron'} a <b>{toName}</b>.{' '}
          {result.appointments_moved > 0 && <>También se {result.appointments_moved === 1 ? 'movió' : 'movieron'} <b>{result.appointments_moved}</b> cita{result.appointments_moved === 1 ? '' : 's'} futura{result.appointments_moved === 1 ? '' : 's'}.</>}
        </Notice>
        {result.appointments_conflict.length > 0 && (
          <div className="stack sm">
            <Notice tone="gold">
              {result.appointments_conflict.length === 1 ? 'Una cita no se pudo mover' : `${result.appointments_conflict.length} citas no se pudieron mover`} y
              {' '}sigue{result.appointments_conflict.length === 1 ? '' : 'n'} con {fromName || 'el fisioterapeuta anterior'}. Reprográmala{result.appointments_conflict.length === 1 ? '' : 's'} desde la Agenda.
            </Notice>
            {result.appointments_conflict.map((c) => (
              <div key={c.id} className="row">
                <div className="blue" style={{ font: '600 12px/1.2 var(--f-mono)', flex: 'none' }}>{fmtDateTime(c.starts_at)}</div>
                <div className="grow">
                  <div className="t-strong ellipsis">{c.patient_name}</div>
                  <div className="t-small">{c.reason}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="sheet-foot"><Button variant="primary" onClick={onClose}>Listo</Button></div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="grid-form">
        <Field label="De (fisioterapeuta actual)">
          <Select value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value === to) setTo(''); }} disabled={!!fromTherapistId}>
            <option value="">{meta ? 'Selecciona' : 'Cargando…'}</option>
            {therapists.map((t) => <option key={t.id} value={t.id}>{t.display_name}{t.active ? '' : ' (inactivo)'}</option>)}
          </Select>
        </Field>
        <Field label="A (nuevo fisioterapeuta)" error={error?.fields?.to_therapist_id}>
          <Select value={to} onChange={(e) => setTo(e.target.value)} disabled={!from} invalid={!!error?.fields?.to_therapist_id}>
            <option value="">Selecciona</option>
            {destinations.map((t) => <option key={t.id} value={t.id}>{t.display_name}{t.location_name ? ` · ${t.location_name}` : ''}</option>)}
          </Select>
        </Field>
      </div>

      {!from && <Empty>Elige de quién son los pacientes que quieres reasignar.</Empty>}
      {from && list.error && <ErrorNote error={list.error} retry={() => list.mutate()} />}
      {from && !list.data && !list.error && <Skeleton rows={3} height={44} />}
      {from && list.data && patients.length === 0 && <Empty>{fromName || 'Este fisioterapeuta'} no tiene pacientes activos asignados.</Empty>}

      {from && patients.length > 0 && (
        <div className="stack sm">
          <div className="hstack between wrap">
            <Checkbox label={<b>Seleccionar todos ({patients.length})</b>} checked={all} onChange={() => setPicked(all ? new Set() : new Set(patients.map((p) => p.id)))} />
            <span className="t-label">{picked.size} seleccionado{picked.size === 1 ? '' : 's'}</span>
          </div>
          <div className="stack sm" style={{ maxHeight: 300, overflowY: 'auto', paddingRight: 2 }}>
            {patients.map((p) => (
              <div key={p.id} className="row" style={{ padding: '8px 12px' }}>
                <Checkbox checked={picked.has(p.id)} onChange={() => toggle(p.id)}
                  label={<><span className="t-strong">{p.full_name}</span>{p.record_number && <span className="t-small"> · {p.record_number}</span>}</>} />
              </div>
            ))}
          </div>
          {list.data && list.data.total > patients.length && (
            <div className="t-small">Se muestran los primeros {patients.length} de {list.data.total}. Repite la operación para el resto.</div>
          )}
          <div className="t-small">
            Sus citas futuras pasan también al nuevo fisioterapeuta cuando su agenda está libre; las que se empalmen se quedan como están y se te avisa.
          </div>
        </div>
      )}

      {error && !error.fields?.to_therapist_id && <ErrorNote error={error} />}
      <div className="sheet-foot">
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={busy} disabled={!from || !to || picked.size === 0} onClick={submit}>
          {picked.size > 0 ? `Reasignar ${picked.size} paciente${picked.size === 1 ? '' : 's'}` : 'Reasignar'}
        </Button>
      </div>
    </div>
  );
}
