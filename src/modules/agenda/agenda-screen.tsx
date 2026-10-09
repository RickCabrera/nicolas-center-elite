'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMeta } from '@/components/meta';
import { PageHeader } from '@/components/shell';
import { Badge, Button, Chip, Empty, ErrorNote, Sheet, Skeleton, Tabs } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { qs, useApi } from '@/lib/client';
import { addDays, dayLabel, fmtTime, isoDate, longDate, parseDateInput, todayIso, weekday } from '@/lib/dates';
import { APPT_STATUS_LABEL, shortName } from '@/lib/format';
import { AppointmentSheet } from './appointment-sheet';
import { blockRange, HoursEditor } from './hours-editor';
import { NewAppointmentSheet } from './new-appointment-sheet';
import { STATUS_TONE, type Appointment, type TimeBlock } from './types';

type View = 'dia' | 'semana';
const STRIP_DAYS = 14;
const mondayOf = (d: string) => addDays(d, -((weekday(d) + 6) % 7));
const nCitas = (n: number) => `${n} ${n === 1 ? 'cita' : 'citas'}`;
const live = (list: Appointment[]) => list.filter((a) => a.status !== 'cancelled').length;

const CSS = `
.ag-week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; align-items: start; }
.ag-col { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.ag-colhead { width: 100%; min-height: 48px; padding: 6px 8px; }
.ag-item { display: block; width: 100%; padding: 8px 9px; text-align: left; cursor: pointer; color: inherit; min-width: 0;
  background: var(--glass-row); border: 1px solid rgba(255,255,255,.11); border-top-color: rgba(255,255,255,.3); border-left: 3px solid var(--blue);
  border-radius: 9px; transition: border-color .15s; }
.ag-item:hover { border-color: var(--blue); }
.ag-item.attended { border-left-color: var(--green); } .ag-item.no_show { border-left-color: var(--red); }
.ag-item.cancelled { border-left-color: rgba(255,255,255,.3); opacity: .6; }
.ag-item.cancelled .ag-name { text-decoration: line-through; }
.ag-none { padding: 10px 8px; border: 1px dashed var(--line); border-radius: 9px; font: 400 12px/1.3 var(--f-body); color: var(--ink-5); text-align: center; }
.ag-weeklist { display: none; }
button.card.ag-card { display: flex; gap: 12px; align-items: center; padding: 14px; }
button.card.ag-card.cancelled { opacity: .62; }
.ag-nav .input { width: auto; min-height: 40px; }
@media (max-width: 1099px) { .ag-week { display: none; } .ag-weeklist { display: flex; } }
`;

/** Tarjeta de una cita, como en el mockup: hora en mono azul, duración, paciente, tipo, fisioterapeuta · sede, notas y estado. */
function ApptCard({ a, onOpen }: { a: Appointment; onOpen: (a: Appointment) => void }) {
  return (
    <button type="button" className={`card ag-card ${a.status}`} onClick={() => onOpen(a)}
      aria-label={`${a.time}, ${a.patient_name}, ${a.type_name}, ${APPT_STATUS_LABEL[a.status]}`}>
      <div style={{ flex: 'none', textAlign: 'center', minWidth: 58 }}>
        <div style={{ font: '700 15px/1 var(--f-mono)', color: 'var(--blue)' }}>{a.time}</div>
        <div style={{ marginTop: 4, font: '600 10px/1 var(--f-mono)', letterSpacing: '.1em', color: 'var(--ink-4)' }}>{a.duration_min} MIN</div>
      </div>
      <div style={{ width: 1, alignSelf: 'stretch', background: '#23272e', flex: 'none' }} />
      <div className="grow">
        <div className="t-name ellipsis">{a.patient_name}</div>
        <div className="t-sub ellipsis" style={{ marginTop: 3, lineHeight: 1.3 }}>{a.type_name}</div>
        <div className="ellipsis" style={{ marginTop: 6, font: '600 10px/1.2 var(--f-mono)', letterSpacing: '.1em', color: 'var(--gold)', textTransform: 'uppercase' }}>
          {a.therapist_short} · {a.location_name}
        </div>
        {a.notes && <div className="t-small" style={{ marginTop: 6, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{a.notes}</div>}
        <div className="hstack wrap" style={{ marginTop: 9, gap: 6 }}>
          <Badge tone={STATUS_TONE[a.status]}>{APPT_STATUS_LABEL[a.status]}</Badge>
          {a.has_note && <span className="pill">Nota registrada</span>}
          {a.series_id && <span className="pill">Serie</span>}
        </div>
      </div>
    </button>
  );
}

export function AgendaScreen() {
  const user = useUser();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { meta } = useMeta();
  const today = todayIso();

  const fecha = parseDateInput(params.get('fecha') ?? '') ?? today;
  const view: View = params.get('vista') === 'semana' ? 'semana' : 'dia';
  const go = useCallback((next: { fecha?: string; vista?: View }) => {
    const f = next.fecha ?? fecha, v = next.vista ?? view;
    router.replace(pathname + qs({ fecha: f === todayIso() ? '' : f, vista: v === 'semana' ? 'semana' : '' }), { scroll: false });
  }, [router, pathname, fecha, view]);

  // La tira arranca en hoy y cubre 14 días; se recorre por semanas y sigue a la fecha elegida.
  const [stripStart, setStripStart] = useState(() => (fecha >= today && fecha <= addDays(today, STRIP_DAYS - 1) ? today : fecha));
  useEffect(() => {
    // Solo reacciona a un cambio de fecha (selector, enlace, atrás/adelante): si quedó fuera de la tira, la tira la sigue.
    setStripStart((s) => (fecha >= s && fecha <= addDays(s, STRIP_DAYS - 1)
      ? s
      : fecha >= today && fecha <= addDays(today, STRIP_DAYS - 1) ? today : fecha));
  }, [fecha, today]);
  const shift = (n: number) => { setStripStart((s) => addDays(s, n)); go({ fecha: addDays(fecha, n) }); };
  const goToday = () => { setStripStart(today); go({ fecha: today }); };

  const [therapist, setTherapist] = useState('');          // filtro del dueño
  const [showCancelled, setShowCancelled] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [selected, setSelected] = useState<Appointment | null>(null);

  const stripDays = useMemo(() => Array.from({ length: STRIP_DAYS }, (_, i) => addDays(stripStart, i)), [stripStart]);
  const weekStart = mondayOf(fecha);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const from = view === 'semana' ? weekStart : fecha;
  const to = view === 'semana' ? addDays(weekStart, 6) : fecha;
  const tFilter = user.isOwner ? therapist : '';

  const counts = useApi<{ date: string; count: number }[]>(
    '/api/appointments/days' + qs({ from: stripStart, to: addDays(stripStart, STRIP_DAYS - 1), therapist_id: tFilter }), { refreshInterval: 30000 });
  // Se refresca sola cada 30 s: las asistencias por huella cambian el estado de las citas.
  const appts = useApi<Appointment[]>(
    '/api/appointments' + qs({ from, to, therapist_id: tFilter, include_cancelled: showCancelled ? 1 : '' }), { refreshInterval: 30000 });
  const blocks = useApi<TimeBlock[]>('/api/schedule/blocks' + qs({ from, to, user_id: tFilter }), { refreshInterval: 120000 });

  const countOf = (d: string) => counts.data?.find((c) => c.date === d)?.count ?? 0;
  const byDay = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of appts.data ?? []) m.set(a.date, [...(m.get(a.date) ?? []), a]);
    return m;
  }, [appts.data]);
  const blocksOf = (d: string) => (blocks.data ?? []).filter((b) => isoDate(b.starts_at) <= d && b.ends_at > b.starts_at && isoDate(new Date(new Date(b.ends_at).getTime() - 1)) >= d);
  // La hoja de detalle sigue a la versión más reciente de la cita (estado, nota registrada…).
  const current = selected ? (appts.data?.find((a) => a.id === selected.id) ?? selected) : null;

  const therapists = (meta?.therapists ?? []).filter((t) => t.active);
  const hoursUser = user.isOwner ? therapists.find((t) => t.id === therapist) : null;
  const loading = appts.isLoading && !appts.data;
  const dayList = byDay.get(fecha) ?? [];

  const blockRows = (d: string) => blocksOf(d).map((b) => (
    <div key={b.id + d} className="notice gold" style={{ padding: '10px 12px' }}>
      <span className="t-label" style={{ color: 'var(--gold)' }}>Bloqueo</span>
      <span style={{ marginLeft: 8 }}>{user.isOwner && b.user_name ? `${b.user_name} · ` : ''}{blockRange(b)}{b.reason ? ` · ${b.reason}` : ''}</span>
    </div>
  ));

  return (
    <div className="page">
      <style>{CSS}</style>
      <PageHeader title={user.isOwner ? 'Agenda de la clínica' : 'Mi agenda'} sub={user.isOwner ? 'Todos los fisioterapeutas' : 'Solo tus citas'} />

      <div className="hstack wrap between">
        <div className="hstack wrap">
          <Button variant="primary" size="lg" style={{ minWidth: 180 }} onClick={() => setNewOpen(true)}>+ Nueva cita</Button>
          {!user.isOwner && <Button size="lg" onClick={() => setHoursOpen(true)}>Mi horario</Button>}
          {hoursUser && <Button size="lg" onClick={() => setHoursOpen(true)}>Horario de {shortName(hoursUser.full_name)}</Button>}
        </div>
        <Tabs<View> tabs={[{ key: 'dia', label: 'Día' }, { key: 'semana', label: 'Semana' }]} value={view} onChange={(v) => go({ vista: v })} />
      </div>

      <div className="hstack wrap ag-nav">
        <button type="button" className="btn-icon" onClick={() => shift(-7)} aria-label="Semana anterior" title="Semana anterior">‹</button>
        <input type="date" className="input" value={fecha} aria-label="Ir a una fecha"
          onChange={(e) => { const d = parseDateInput(e.target.value); if (d) go({ fecha: d }); }} />
        <button type="button" className="btn-icon" onClick={() => shift(7)} aria-label="Semana siguiente" title="Semana siguiente">›</button>
        <Button size="sm" onClick={goToday} disabled={fecha === today && stripStart === today} style={{ minHeight: 40 }}>Hoy</Button>
        <Chip on={showCancelled} onClick={() => setShowCancelled((v) => !v)}>Ver canceladas</Chip>
      </div>

      <div className="scroll-x" role="group" aria-label="Días">
        {stripDays.map((d) => {
          const n = countOf(d);
          return (
            <button key={d} type="button" className="daybtn" aria-pressed={view === 'dia' ? d === fecha : d >= weekStart && d <= addDays(weekStart, 6)}
              aria-current={d === fecha ? 'date' : undefined} onClick={() => go({ fecha: d })}>
              {dayLabel(d, today)}<small>{nCitas(n)}</small>
            </button>
          );
        })}
      </div>

      {user.isOwner && therapists.length > 0 && (
        <div className="scroll-x" role="group" aria-label="Filtrar por fisioterapeuta">
          <Chip square on={!therapist} onClick={() => setTherapist('')}>Todos</Chip>
          {therapists.map((t) => <Chip key={t.id} square on={therapist === t.id} onClick={() => setTherapist(therapist === t.id ? '' : t.id)}>{shortName(t.full_name)}</Chip>)}
        </div>
      )}

      {appts.error && !appts.data ? <ErrorNote error={appts.error} retry={() => appts.mutate()} />
        : loading ? <Skeleton rows={3} height={92} />
        : view === 'dia' ? (
          <>
            <div className="hstack between wrap">
              <h2 className="t-h3">{fecha === today ? 'Hoy · ' : ''}{longDate(fecha)}</h2>
              <span className="t-label">{nCitas(live(dayList))}</span>
            </div>
            {blockRows(fecha)}
            {dayList.length === 0 ? <Empty>Sin citas para este día.</Empty> : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))', gap: 'clamp(10px, 1vw, 16px)' }}>
                {dayList.map((a) => <ApptCard key={a.id} a={a} onOpen={setSelected} />)}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="hstack between wrap">
              <h2 className="t-h3">Semana del {dayLabel(weekStart, '').split(' · ')[1]} al {dayLabel(addDays(weekStart, 6), '').split(' · ')[1]}</h2>
              <span className="t-label">{nCitas(live(appts.data ?? []))}</span>
            </div>

            {/* Escritorio: 7 columnas, lunes a domingo */}
            <div className="ag-week">
              {weekDays.map((d) => {
                const list = byDay.get(d) ?? [];
                return (
                  <div key={d} className="ag-col">
                    <button type="button" className="daybtn ag-colhead" aria-pressed={d === fecha} onClick={() => go({ fecha: d, vista: 'dia' })} title="Ver el día">
                      {dayLabel(d, today)}
                    </button>
                    {blocksOf(d).map((b) => (
                      <div key={b.id} className="ag-none" style={{ borderColor: 'rgba(216,180,92,.5)', color: 'var(--gold)' }} title={`${blockRange(b)}${b.reason ? ' · ' + b.reason : ''}`}>
                        Bloqueo{user.isOwner && b.user_name ? ` · ${shortName(b.user_name)}` : ''}{b.reason ? ` · ${b.reason}` : ''}
                      </div>
                    ))}
                    {list.length === 0 ? <div className="ag-none">Sin citas</div> : list.map((a) => (
                      <button key={a.id} type="button" className={`ag-item ${a.status}`} onClick={() => setSelected(a)}
                        aria-label={`${a.time}, ${a.patient_name}, ${a.type_name}, ${APPT_STATUS_LABEL[a.status]}`}>
                        <div className="hstack between" style={{ gap: 4 }}>
                          <span style={{ font: '700 12px/1 var(--f-mono)', color: 'var(--blue)' }}>{a.time}</span>
                          <span style={{ font: '600 9px/1 var(--f-mono)', letterSpacing: '.08em', color: 'var(--ink-5)' }}>{fmtTime(a.ends_at)}</span>
                        </div>
                        <div className="ag-name ellipsis" style={{ marginTop: 5, font: '700 13px/1.2 var(--f-head)' }}>{a.patient_name}</div>
                        <div className="ellipsis" style={{ marginTop: 3, font: '400 11.5px/1.25 var(--f-body)', color: 'var(--ink-3)' }}>{a.type_name}</div>
                        <div className="ellipsis" style={{ marginTop: 4, font: '600 9px/1.2 var(--f-mono)', letterSpacing: '.08em', textTransform: 'uppercase', color: a.status === 'attended' ? 'var(--green)' : a.status === 'no_show' ? 'var(--red)' : 'var(--gold)' }}>
                          {a.status === 'scheduled' ? (user.isOwner ? a.therapist_short : a.location_name) : APPT_STATUS_LABEL[a.status]}
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>

            {/* Móvil: lista agrupada por día */}
            <div className="ag-weeklist stack lg">
              {weekDays.map((d) => {
                const list = byDay.get(d) ?? [];
                return (
                  <section key={d} className="stack sm">
                    <div className="hstack between">
                      <button type="button" className="btn-link" style={{ fontSize: 11, color: d === today ? 'var(--blue)' : 'var(--ink-2)' }} onClick={() => go({ fecha: d, vista: 'dia' })}>{dayLabel(d, today)}</button>
                      <span className="t-label">{nCitas(live(list))}</span>
                    </div>
                    {blockRows(d)}
                    {list.length === 0 ? <div className="ag-none" style={{ textAlign: 'left' }}>Sin citas</div> : list.map((a) => <ApptCard key={a.id} a={a} onOpen={setSelected} />)}
                  </section>
                );
              })}
            </div>
          </>
        )}

      <NewAppointmentSheet open={newOpen} onClose={() => setNewOpen(false)} date={fecha} onSavedDate={(d) => go({ fecha: d })} />
      <AppointmentSheet appointment={current} onClose={() => setSelected(null)} onMoved={(d) => { if (view === 'dia') go({ fecha: d }); }} />
      <Sheet open={hoursOpen} onClose={() => setHoursOpen(false)} title={user.isOwner && hoursUser ? `Horario de ${hoursUser.display_name}` : 'Mi horario'} wide>
        <HoursEditor userId={user.isOwner && hoursUser ? hoursUser.id : user.id} />
      </Sheet>
    </div>
  );
}
