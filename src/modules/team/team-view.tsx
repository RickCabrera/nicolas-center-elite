'use client';
import { useState } from 'react';
import { PageHeader } from '@/components/shell';
import { Badge, Button, Card, Chip, Empty, ErrorNote, Skeleton, useToast } from '@/components/ui';
import { api, ApiError, qs, refresh, useApi } from '@/lib/client';
import { addDays, fmtDate } from '@/lib/dates';
import { initials } from '@/lib/format';
import { DeactivateWizard } from './deactivate-wizard';
import { ReassignSheet } from './reassign-sheet';
import { TherapistSheet } from './therapist-sheet';
import type { Workload, WorkloadRow } from './types';
import { LoadBar, TeamAvatar } from './ui';

type Open =
  | { kind: 'new' } | { kind: 'edit'; id: string } | { kind: 'deactivate'; id: string } | { kind: 'reassign'; from?: string } | null;

const METRICS = [
  { key: 'appointments_week', label: 'Citas de la semana', unit: 'citas' },
  { key: 'patients_active', label: 'Pacientes', unit: 'pacientes' },
  { key: 'notes_week', label: 'Notas firmadas', unit: 'notas' },
] as const;
type MetricKey = (typeof METRICS)[number]['key'];

const tile = { padding: 10 } as const;
const big = { marginTop: 6, font: '800 20px/1 var(--f-head)' } as const;
const smallNum = { marginTop: 5, font: '700 15px/1 var(--f-head)' } as const;

/** EQ-01..07 · Pantalla de Equipo: fisioterapeutas, carga de trabajo y administración de cuentas. */
export function TeamView() {
  const toast = useToast();
  const [weekOf, setWeekOf] = useState<string | null>(null);
  const [metric, setMetric] = useState<MetricKey>('appointments_week');
  const [open, setOpen] = useState<Open>(null);
  const [showInactive, setShowInactive] = useState(true);
  const { data, error, mutate } = useApi<Workload>(`/api/users/workload${qs({ week_of: weekOf })}`, { refreshInterval: 60000 });

  const items = data?.items ?? [];
  const active = items.filter((t) => t.active);
  const inactive = items.filter((t) => !t.active);
  const maxWeek = Math.max(1, ...active.map((t) => t.appointments_week));
  const maxMetric = Math.max(1, ...active.map((t) => t[metric]));
  const m = METRICS.find((x) => x.key === metric)!;
  const thisWeek = !!data && data.today >= data.week_from && data.today <= data.week_to;
  const close = () => setOpen(null);

  const reactivate = async (t: WorkloadRow) => {
    try {
      await api.post(`/api/users/${t.id}/reactivate`);
      await refresh('/api/users', '/api/meta');
      toast(`${t.display_name} reactivado`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'No se pudo reactivar.', 'error');
    }
  };

  const actions = (
    <>
      <Button onClick={() => setOpen({ kind: 'reassign' })}>Reasignar pacientes</Button>
      <Button variant="primary" onClick={() => setOpen({ kind: 'new' })}>+ Agregar fisioterapeuta</Button>
    </>
  );

  return (
    <div className="page">
      <PageHeader title="Equipo" sub="Fisioterapeutas y carga de trabajo"
        action={<span className="only-desktop"><span className="hstack" style={{ display: 'inline-flex' }}>{actions}</span></span>} />
      <div className="only-mobile" style={{ display: 'block' }}><div className="hstack wrap">{actions}</div></div>

      <ErrorNote error={error} retry={() => mutate()} />
      {!data && !error && <><Skeleton rows={1} height={150} /><Skeleton rows={2} height={190} /></>}

      {data && items.length === 0 && (
        <Empty>Aún no hay fisioterapeutas. Usa «Agregar fisioterapeuta» para crear la primera cuenta; recibirá un enlace para definir su contraseña.</Empty>
      )}

      {data && active.length > 0 && (
        <Card title="Carga de trabajo" action={
          <div className="hstack" style={{ flex: 'none' }}>
            <button type="button" className="btn-icon" aria-label="Semana anterior" onClick={() => setWeekOf(addDays(data.week_from, -7))}>‹</button>
            <button type="button" className="btn-icon" aria-label="Semana siguiente" onClick={() => setWeekOf(addDays(data.week_from, 7))}>›</button>
          </div>}>
          <div className="stack md">
            <div className="hstack between wrap">
              <div className="t-label">
                Semana del {fmtDate(data.week_from).slice(0, 5)} al {fmtDate(data.week_to)}
                {!thisWeek && <button type="button" className="btn-link" style={{ marginLeft: 10 }} onClick={() => setWeekOf(null)}>Ir a esta semana</button>}
              </div>
              <div className="scroll-x" role="group" aria-label="Indicador">
                {METRICS.map((x) => <Chip key={x.key} on={metric === x.key} onClick={() => setMetric(x.key)}>{x.label}</Chip>)}
              </div>
            </div>
            <div className="stack sm" role="list" aria-label={`${m.label} por fisioterapeuta`}>
              {[...active].sort((a, b) => b[metric] - a[metric] || a.full_name.localeCompare(b.full_name, 'es')).map((t) => (
                <div key={t.id} role="listitem" style={{ display: 'grid', gridTemplateColumns: 'minmax(96px, 200px) 1fr auto', alignItems: 'center', gap: 12 }}>
                  <div className="t-strong ellipsis">{t.display_name}</div>
                  <LoadBar ratio={t[metric] / maxMetric} height={12} tone={metric === 'patients_active' ? 'gold' : metric === 'notes_week' ? 'green' : 'blue'}
                    label={`${t.display_name}: ${t[metric]} ${m.unit}`} />
                  <div style={{ font: '700 14px/1 var(--f-mono)', minWidth: 28, textAlign: 'right' }}>{t[metric]}</div>
                </div>
              ))}
            </div>
            {metric === 'appointments_week' && (
              <div className="t-small">
                Citas no canceladas de lunes a domingo. Asistidas: {active.reduce((s, t) => s + t.attended_week, 0)} · No asistió: {active.reduce((s, t) => s + t.no_show_week, 0)}.
              </div>
            )}
            {metric === 'patients_active' && <div className="t-small">Pacientes activos asignados hoy (no depende de la semana).</div>}
            {metric === 'notes_week' && <div className="t-small">Notas de evolución firmadas en la semana.</div>}
          </div>
        </Card>
      )}

      {data && items.length > 0 && (
        <div className="grid-cards">
          {[...active, ...(showInactive ? inactive : [])].map((t) => (
            <div key={t.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14, opacity: t.active ? 1 : 0.72 }}>
              <div className="hstack" style={{ gap: 12, alignItems: 'center' }}>
                <TeamAvatar text={initials(t.full_name)} dim={!t.active} />
                <div className="grow">
                  <div className="t-name" style={{ overflowWrap: 'anywhere' }}>{t.display_name}</div>
                  <div className="t-small" style={{ marginTop: 3 }}>{[t.specialty || 'Fisioterapeuta', t.location_name ?? 'Sin sede'].join(' · ')}</div>
                </div>
              </div>
              {(t.is_physician || t.invited_pending || !t.active || (!t.has_password && !t.invited_pending)) && (
                <div className="hstack wrap" style={{ gap: 6 }}>
                  {t.is_physician && <Badge tone="gold">Médico</Badge>}
                  {t.active && t.invited_pending && <Badge tone="blue">Invitación pendiente</Badge>}
                  {t.active && !t.has_password && !t.invited_pending && <Badge tone="red">Invitación vencida</Badge>}
                  {!t.active && <Badge>Inactivo</Badge>}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div className="kv" style={tile}><div className="t-label">Pacientes</div><div style={big}>{t.patients_active}</div></div>
                <div className="kv" style={tile}><div className="t-label">Citas hoy</div><div style={{ ...big, color: 'var(--blue)' }}>{t.appointments_today}</div></div>
              </div>
              <div className="stack sm">
                <div className="hstack between">
                  <span className="t-label">{thisWeek ? 'Esta semana' : `Semana del ${fmtDate(data.week_from).slice(0, 5)}`}</span>
                  <span className="t-small">{t.attendance_days_week} día{t.attendance_days_week === 1 ? '' : 's'} con entrada por huella</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  <div><div className="t-small">Citas</div><div style={smallNum}>{t.appointments_week}</div></div>
                  <div><div className="t-small">Asistidas</div><div style={{ ...smallNum, color: 'var(--green)' }}>{t.attended_week}</div></div>
                  <div><div className="t-small">Notas</div><div style={smallNum}>{t.notes_week}</div></div>
                </div>
                <LoadBar ratio={t.active ? t.appointments_week / maxWeek : 0} label={`Carga semanal de ${t.display_name}: ${t.appointments_week} de un máximo de ${maxWeek} citas en el equipo`} />
              </div>
              <div className="hstack wrap" style={{ marginTop: 'auto' }}>
                <Button size="sm" onClick={() => setOpen({ kind: 'edit', id: t.id })}>Editar</Button>
                {t.patients_active > 0 && <Button size="sm" onClick={() => setOpen({ kind: 'reassign', from: t.id })}>Reasignar pacientes</Button>}
                {!t.active && <Button size="sm" variant="success" onClick={() => reactivate(t)}>Reactivar</Button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {data && inactive.length > 0 && (
        <button type="button" className="btn-link dim" style={{ alignSelf: 'flex-start' }} onClick={() => setShowInactive((v) => !v)}>
          {showInactive ? `Ocultar inactivos (${inactive.length})` : `Mostrar inactivos (${inactive.length})`}
        </button>
      )}

      <TherapistSheet open={open?.kind === 'new' || open?.kind === 'edit'} onClose={close}
        userId={open?.kind === 'edit' ? open.id : null} onDeactivate={(id) => setOpen({ kind: 'deactivate', id })} />
      <DeactivateWizard open={open?.kind === 'deactivate'} onClose={close} userId={open?.kind === 'deactivate' ? open.id : null} onDone={() => mutate()} />
      <ReassignSheet open={open?.kind === 'reassign'} onClose={close} fromTherapistId={open?.kind === 'reassign' ? open.from : undefined} onDone={() => mutate()} />
    </div>
  );
}
