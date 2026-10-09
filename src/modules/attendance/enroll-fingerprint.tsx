'use client';
import { useEffect, useRef, useState } from 'react';
import { FingerRings } from '@/components/icons';
import { Button, Confirm, Notice, ScanOverlay, useToast } from '@/components/ui';
import { api, ApiError, refresh, useApi } from '@/lib/client';
import { fmtDate } from '@/lib/dates';
import { ConsentSheet } from '@/modules/record/consent-sheet';
import type { EnrollInfo } from './types';
import { waitForCommand } from './use-command';

type Scan = { commandId: string; deviceName: string; bridgeOnline: boolean; started: boolean; onDevice: string | null };

/**
 * HUE-07 / HUE-13 · Botón para registrar (o eliminar) la huella de un paciente o de un miembro del equipo.
 * La captura ocurre en el lector de recepción a través del agente puente; aquí solo se pide, se espera
 * y se muestra el resultado. La huella nunca pasa por el navegador ni por la nube (HUE-16).
 */
export function EnrollFingerprint({ personType, personId, enrolledAt, onDone }: {
  personType: 'patient' | 'staff'; personId: string; enrolledAt?: string | null; onDone?: () => void;
}) {
  const toast = useToast();
  const key = `/api/enrollments?person_type=${personType}&person_id=${personId}`;
  const info = useApi<EnrollInfo>(personId ? key : null, { revalidateOnFocus: false });
  const [starting, setStarting] = useState(false);
  const [scan, setScan] = useState<Scan | null>(null);
  const [message, setMessage] = useState<{ tone: 'red' | 'gold'; text: string; consent?: boolean } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const aborted = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; aborted.current = true; }; }, []);

  const enrolled = info.data ? info.data.enrolled_at : (enrolledAt ?? null);
  const label = personType === 'patient' ? 'Registrar huella del paciente' : 'Registrar huella';

  const finish = async () => {
    await info.mutate();
    void refresh('/api/patients', '/api/users', '/api/profile', '/api/enrollments');
    onDone?.();
  };

  const start = async () => {
    setMessage(null);
    setStarting(true);
    aborted.current = false;
    try {
      const r = await api.post<{ command_id: string; device_name: string; bridge_online: boolean }>('/api/enrollments', { person_type: personType, person_id: personId });
      if (!alive.current) return;
      setScan({ commandId: r.command_id, deviceName: r.device_name, bridgeOnline: r.bridge_online, started: false, onDevice: null });
      setStarting(false);
      const res = await waitForCommand(r.command_id, {
        // Hasta 5 min: si el lector no captura a distancia, la huella se registra en su pantalla y eso toma más.
        timeoutMs: 300000, intervalMs: 1500, isAborted: () => aborted.current,
        onTick: (c) => alive.current && setScan((s) => (s ? {
          ...s, bridgeOnline: c.bridge_online, started: c.status === 'running',
          onDevice: c.progress?.stage === 'on_device' ? (c.progress.employee_no ?? '') : s.onDevice,
        } : s)),
      });
      if (!alive.current || res.outcome === 'aborted') return;
      setScan(null);
      if (res.outcome === 'done') {
        toast(res.command.result?.mode === 'on_device' ? 'Huella registrada en el lector' : 'Huella registrada');
        await finish();
      } else if (res.outcome === 'error') {
        setMessage({ tone: 'red', text: res.message });
        toast(res.message, 'error');
      } else {
        setMessage({
          tone: 'gold',
          text: res.command?.status === 'pending'
            ? 'El agente puente del lector no respondió. La orden queda en cola 10 minutos; si el lector pide el dedo, colócalo y actualiza esta pantalla.'
            : 'El lector no confirmó a tiempo. Actualiza la pantalla en unos segundos para ver si quedó registrada.',
        });
      }
    } catch (e) {
      if (!alive.current) return;
      setScan(null);
      const err = e as ApiError;
      setMessage({ tone: err.code === 'consent_required' ? 'gold' : 'red', text: err.message, consent: err.code === 'consent_required' });
    } finally {
      if (alive.current) setStarting(false);
    }
  };

  /** Cierra la espera. Si la orden aún no llega al lector se puede cancelar; si no, sigue su curso. */
  const closeScan = async (cancelOrder: boolean) => {
    const s = scan;
    aborted.current = true;
    setScan(null);
    if (!s) return;
    if (cancelOrder) {
      try {
        const r = await api.del<{ cancelled: boolean }>(`/api/enrollments/${s.commandId}`);
        setMessage(r.cancelled
          ? { tone: 'gold', text: 'Registro de huella cancelado.' }
          : { tone: 'gold', text: 'El lector ya había recibido la orden: puede pedir el dedo durante unos segundos más.' });
      } catch { /* la orden caduca sola */ }
    } else {
      setMessage({ tone: 'gold', text: 'La orden queda en cola 10 minutos. Cuando el agente puente vuelva, el lector pedirá el dedo.' });
    }
    void info.mutate();
  };

  const remove = async () => {
    setRemoving(true);
    try {
      const r = await api.del<{ command_id: string | null; removed_now: boolean; bridge_online: boolean }>('/api/enrollments', { person_type: personType, person_id: personId });
      setConfirmRemove(false);
      if (r.removed_now || !r.command_id) {
        toast('Huella eliminada');
        await finish();
        return;
      }
      const res = await waitForCommand(r.command_id, { timeoutMs: 20000, isAborted: () => !alive.current });
      if (!alive.current) return;
      if (res.outcome === 'done') {
        toast('Huella eliminada del lector');
        await finish();
      } else if (res.outcome === 'error') {
        setMessage({ tone: 'red', text: res.message });
      } else {
        setMessage({ tone: 'gold', text: 'El agente puente no está conectado; la huella se eliminará del lector cuando vuelva.' });
      }
    } catch (e) {
      setMessage({ tone: 'red', text: (e as ApiError).message });
      setConfirmRemove(false);
    } finally {
      if (alive.current) setRemoving(false);
    }
  };

  const noDevice = info.data && !info.data.device;

  return (
    <div className="stack sm" style={{ minWidth: 0 }}>
      {enrolled ? (
        <>
          <div className="btn success block" role="status" style={{ cursor: 'default', minHeight: 50, gap: 10 }}>
            <FingerRings size={20} color="var(--green)" />
            <span>Huella registrada</span>
            <span className="t-mono" style={{ opacity: 0.85 }}>{fmtDate(enrolled)}</span>
          </div>
          <div className="hstack wrap" style={{ gap: 14 }}>
            <button type="button" className="btn-link" onClick={start} disabled={starting || !!scan}>Volver a registrar</button>
            <button type="button" className="btn-link dim" onClick={() => setConfirmRemove(true)} disabled={removing}>Eliminar huella</button>
          </div>
        </>
      ) : (
        <Button block onClick={start} loading={starting} disabled={!!scan || !!noDevice} style={{ minHeight: 50, gap: 10, color: 'var(--blue)' }}>
          {!starting && <FingerRings size={20} />}
          {label}
        </Button>
      )}

      {noDevice && !enrolled && <div className="t-small">No hay un lector activo en la sede. El dueño puede agregarlo en Configuración → Lectores.</div>}
      {info.error && !info.data && <div className="t-small">{info.error.message}</div>}

      {message && (
        <Notice tone={message.tone}>
          {message.text}
          {message.consent && personType === 'patient' && (
            <button type="button" className="btn-link" style={{ marginLeft: 10 }} onClick={() => setConsentOpen(true)}>Firmar consentimiento</button>
          )}
        </Notice>
      )}

      {scan && (
        <ScanOverlay
          title={scan.onDevice !== null ? 'Registra la huella en el lector' : 'Registrando huella'}
          sub={scan.onDevice !== null ? `Este lector no permite capturar desde la app`
            : scan.bridgeOnline || scan.started ? `Coloca el dedo en el lector de ${scan.deviceName}` : `Esperando al lector de ${scan.deviceName}`}
          onCancel={scan.bridgeOnline || scan.started ? () => closeScan(!scan.started) : undefined}
        >
          {scan.onDevice !== null && (
            <div className="notice" style={{ maxWidth: 420, textAlign: 'left' }}>
              En la pantalla del lector de {scan.deviceName}:
              <ol style={{ margin: '8px 0 0', paddingLeft: 20, lineHeight: 1.6 }}>
                <li>Entra al menú con la cuenta de administrador.</li>
                <li><b>Gestión de usuarios</b> (User / Person Management) → busca el número <b className="t-mono blue">{scan.onDevice || '—'}</b>.</li>
                <li>Editar → <b>Huella</b> (Fingerprint) → coloca el dedo las veces que pida y guarda.</li>
              </ol>
              <div className="t-small" style={{ marginTop: 8 }}>Esta pantalla se actualiza sola en cuanto el lector tenga la huella (hasta 4 minutos).</div>
            </div>
          )}
          {!scan.bridgeOnline && !scan.started && (
            <div className="stack md" style={{ maxWidth: 380, alignItems: 'center' }}>
              <Notice tone="gold">
                El agente puente del lector no está conectado. Revisa que la PC de recepción esté encendida y con internet.
                La orden queda en cola 10 minutos.
              </Notice>
              <div className="hstack wrap" style={{ justifyContent: 'center' }}>
                <Button onClick={() => closeScan(false)}>Dejar en cola</Button>
                <Button variant="danger" onClick={() => closeScan(true)}>Cancelar registro</Button>
              </div>
            </div>
          )}
        </ScanOverlay>
      )}

      <Confirm
        open={confirmRemove} onClose={() => setConfirmRemove(false)} onConfirm={remove} danger
        title="Eliminar huella" confirmLabel="Eliminar huella"
        message="Se borrará a la persona y su huella del lector. Su asistencia tendrá que registrarse a mano hasta que vuelva a registrar la huella."
      />
      {personType === 'patient' && (
        <ConsentSheet open={consentOpen} onClose={() => setConsentOpen(false)} patientId={personId} kind="biometric"
          onSigned={() => { setConsentOpen(false); setMessage(null); void refresh(`/api/patients/${personId}`); }} />
      )}
    </div>
  );
}
