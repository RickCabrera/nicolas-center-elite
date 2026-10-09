'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, Button, Checkbox, Confirm, KV, Notice, Sheet, useToast } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { api, ApiError, refresh } from '@/lib/client';
import { fmtDateTime, fmtTime, longDate, todayIso } from '@/lib/dates';
import { APPT_STATUS_LABEL } from '@/lib/format';
import { NoteSheet } from '@/modules/record/note-sheet';
import { EditAppointmentSheet } from './new-appointment-sheet';
import { STATUS_TONE, type Appointment } from './types';

type Mode = 'detail' | 'edit' | 'cancel' | 'note';

/**
 * AGE-04 / AGE-05 / AGE-09 · Detalle y acciones de una cita: asistencia manual, reprogramar, cancelar,
 * abrir expediente y escribir la nota de evolución ligada a la cita.
 */
export function AppointmentSheet({ appointment: a, onClose, onMoved }: { appointment: Appointment | null; onClose: () => void; onMoved?: (date: string) => void }) {
  const user = useUser();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('detail');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [following, setFollowing] = useState(false);
  useEffect(() => { setMode('detail'); setError(''); setBusy(''); setFollowing(false); }, [a?.id]);
  if (!a) return null;

  const mark = async (status: 'attended' | 'no_show' | 'scheduled') => {
    setBusy(status); setError('');
    try {
      await api.post(`/api/appointments/${a.id}/status`, { status });
      await refresh('/api/appointments');
      toast(status === 'attended' ? 'Asistencia registrada' : status === 'no_show' ? 'Marcada como no asistió' : 'Marca deshecha: la cita vuelve a programada');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ocurrió un error. Intenta de nuevo.');
    } finally { setBusy(''); }
  };
  const cancel = async (reason: string) => {
    try {
      const r = await api.post<{ cancelled: number }>(`/api/appointments/${a.id}/cancel`, { reason, scope: following ? 'following' : 'one' });
      await refresh('/api/appointments');
      toast(r.cancelled > 1 ? `Se cancelaron ${r.cancelled} citas de la serie` : 'Cita cancelada');
      onClose();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'No se pudo cancelar la cita.', 'error');
    }
  };

  const scheduled = a.status === 'scheduled';
  const canMark = a.date <= todayIso();

  return (
    <>
      <Sheet open={mode === 'detail'} onClose={onClose} title="Cita">
        <div className="stack md">
          <div className="hstack between" style={{ alignItems: 'flex-start', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div className="t-h2" style={{ fontSize: 20, overflowWrap: 'anywhere' }}>{a.patient_name}</div>
              <div className="t-sub" style={{ marginTop: 4 }}>{longDate(a.date)}</div>
            </div>
            <Badge tone={STATUS_TONE[a.status]}>{APPT_STATUS_LABEL[a.status]}</Badge>
          </div>
          <div className="grid-kv">
            <KV label="Horario" tone="blue"><span style={{ fontFamily: 'var(--f-mono)' }}>{a.time} – {fmtTime(a.ends_at)}</span></KV>
            <KV label="Duración">{a.duration_min} min</KV>
            <KV label="Tipo de sesión">{a.type_name}</KV>
            <KV label="Fisioterapeuta" tone="gold">{a.therapist_name}</KV>
            <KV label="Sede">{a.location_name}</KV>
            {a.status === 'attended' && a.attended_at && <KV label="Asistencia">{fmtDateTime(a.attended_at)}</KV>}
          </div>
          {a.notes && <KV label="Notas"><span style={{ whiteSpace: 'pre-wrap' }}>{a.notes}</span></KV>}
          {a.series_id && <div className="t-small">Forma parte de una serie de citas recurrentes.</div>}
          {a.status === 'cancelled' && (
            <Notice tone="red">Cancelada{a.cancelled_at ? ` el ${fmtDateTime(a.cancelled_at)}` : ''}. Motivo: {a.cancel_reason || 'sin motivo registrado'}</Notice>
          )}
          {a.has_note && <Notice tone="green">Nota registrada</Notice>}
          {error && <Notice tone="red">{error}</Notice>}

          {scheduled && canMark && (
            <div className="hstack">
              <Button variant="success" style={{ flex: 1 }} loading={busy === 'attended'} disabled={!!busy} onClick={() => mark('attended')}>Asistió</Button>
              <Button variant="danger" style={{ flex: 1 }} loading={busy === 'no_show'} disabled={!!busy} onClick={() => mark('no_show')}>No asistió</Button>
            </div>
          )}
          {(a.status === 'attended' || a.status === 'no_show') && (
            <Button block loading={busy === 'scheduled'} onClick={() => mark('scheduled')}>Deshacer: volver a programada</Button>
          )}
          {/* AUTH-10 · La nota de evolución es clínica: recepción gestiona la cita, no la escribe. */}
          {a.status !== 'cancelled' && user.isClinical && (
            <Button block variant="primary" onClick={() => setMode('note')}>{a.has_note ? 'Escribir otra nota de evolución' : 'Escribir nota de evolución'}</Button>
          )}
          <Link href={`/pacientes/${a.patient_id}`} className="btn block">{user.isClinical ? 'Abrir expediente' : 'Abrir ficha del paciente'}</Link>
          {scheduled && (
            <div className="hstack wrap">
              <Button style={{ flex: '1 1 180px' }} onClick={() => setMode('edit')}>Reprogramar / editar</Button>
              <Button variant="danger" style={{ flex: '1 1 180px' }} onClick={() => setMode('cancel')}>Cancelar cita</Button>
            </div>
          )}
        </div>
      </Sheet>

      <EditAppointmentSheet open={mode === 'edit'} appointment={a} onClose={() => setMode('detail')} onSavedDate={onMoved} />

      <Confirm open={mode === 'cancel'} onClose={() => setMode('detail')} onConfirm={cancel} danger reason="required"
        title="Cancelar cita" confirmLabel="Cancelar cita" reasonLabel="Motivo de la cancelación"
        message={
          <div className="stack sm">
            <div>{a.patient_name} · {longDate(a.date)} a las {a.time}. La cita queda en el historial como cancelada y el horario se libera.</div>
            {a.series_id && <Checkbox label="Cancelar esta y las siguientes de la serie" checked={following} onChange={(e) => setFollowing(e.target.checked)} />}
          </div>
        } />

      {/* AGE-09 · La nota queda ligada a la cita; al guardar, la lista se refresca y muestra "Nota registrada". */}
      {user.isClinical && <NoteSheet open={mode === 'note'} onClose={() => setMode('detail')} patientId={a.patient_id} appointmentId={a.id}
        onSaved={() => { void refresh('/api/appointments'); setMode('detail'); }} />}
    </>
  );
}
