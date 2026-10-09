'use client';
import { useState } from 'react';
import { Button, Card, Empty, ErrorNote, Skeleton } from '@/components/ui';
import { useApi } from '@/lib/client';
import { fmtDateTime } from '@/lib/dates';
import { CONSENT_TITLE } from './consent-text';
import type { AccessEvent, AccessLog } from './types';

const PAGE = 50;

// [al crear, al modificar]
const TABLE_TEXT: Record<string, [string, string]> = {
  patients: ['Registró al paciente', 'Actualizó datos del paciente'],
  clinical_profiles: ['Guardó una versión del perfil clínico', 'Actualizó el perfil clínico'],
  exercises: ['Agregó un ejercicio', 'Actualizó un ejercicio'],
  evolution_notes: ['Creó nota de evolución', 'Actualizó nota de evolución'],
  consents: ['Registró un consentimiento firmado', 'Actualizó un consentimiento'],
  studies: ['Subió un estudio', 'Actualizó un estudio'],
  appointments: ['Agendó una cita', 'Actualizó una cita'],
  documents: ['Emitió una receta o indicación', 'Canceló una receta o indicación'],
  memberships: ['Asignó una membresía', 'Actualizó la membresía'],
  payments: ['Registró un pago', 'Anuló un pago'],
  attendance_events: ['Registró una asistencia manual', 'Actualizó una asistencia'],
};
const ACTION_TEXT: Record<string, string> = {
  view: 'Abrió el expediente', export: 'Exportó información', print: 'Imprimió un documento', download: 'Descargó un archivo',
};

/** Traduce el evento de la bitácora a una frase legible (EXP-08). */
export function describeEvent(e: AccessEvent): string {
  if (e.action === 'insert' || e.action === 'update' || e.action === 'delete') {
    if (e.action === 'delete') return 'Eliminó un registro';
    if (e.table_name === 'evolution_notes' && e.is_addendum) return 'Agregó adenda a una nota';
    if (e.table_name === 'consents' && e.consent_kind) return `Registró firma: ${CONSENT_TITLE[e.consent_kind]}`;
    const t = TABLE_TEXT[e.table_name];
    return t ? t[e.action === 'insert' ? 0 : 1] : e.action === 'insert' ? 'Creó un registro' : 'Actualizó un registro';
  }
  return e.summary || ACTION_TEXT[e.action] || e.action;
}

/** EXP-08 · Pestaña Accesos (solo dueño): quién abrió o modificó el expediente y cuándo. */
export function AccessTab({ patientId }: { patientId: string }) {
  const [offset, setOffset] = useState(0);
  const { data, error, isLoading, mutate } = useApi<AccessLog>(`/api/patients/${patientId}/access-log?limit=${PAGE}&offset=${offset}`);
  const from = data && data.total ? data.offset + 1 : 0;
  const to = data ? data.offset + data.items.length : 0;

  return (
    <Card title="Accesos al expediente" blue action={data ? <span className="t-label">{data.total} eventos</span> : undefined}>
      {isLoading && !data && <Skeleton rows={5} height={40} />}
      {!data && <ErrorNote error={error} retry={() => mutate()} />}
      {data && !data.items.length && <Empty>Todavía no hay accesos registrados para este expediente.</Empty>}
      {data && data.items.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Fecha y hora</th><th>Quién</th><th>Qué</th></tr></thead>
              <tbody>
                {data.items.map((e) => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: 'nowrap', fontFamily: 'var(--f-mono)', fontSize: 12 }}>{fmtDateTime(e.at)}</td>
                    <td style={{ minWidth: 130 }}>{e.actor_name}</td>
                    <td style={{ minWidth: 180 }}>{describeEvent(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.total > PAGE && (
            <div className="hstack between wrap" style={{ marginTop: 12 }}>
              <span className="t-small">Mostrando {from}-{to} de {data.total}</span>
              <div className="hstack">
                <Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Más recientes</Button>
                <Button size="sm" disabled={to >= data.total} onClick={() => setOffset(offset + PAGE)}>Anteriores</Button>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
