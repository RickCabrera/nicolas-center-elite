'use client';
import { useMemo, useState } from 'react';
import { useMeta } from '@/components/meta';
import { Card, Empty, ErrorNote, Field, Input, Select, Skeleton, StatCard } from '@/components/ui';
import { qs, useApi } from '@/lib/client';
import { addDays, fmtDate, fmtDateTime, todayIso, weekdayShort, weekday } from '@/lib/dates';
import { fmtMinutes, weekStart } from './hours';
import type { AttendanceReport } from './types';

/** HUE-12 · Reportes (solo dueño): horas trabajadas por fisioterapeuta y asistencias por paciente. */
export function ReportsTab() {
  const { meta } = useMeta();
  const monday = weekStart(todayIso());
  const [from, setFrom] = useState(monday);
  const [to, setTo] = useState(addDays(monday, 6));
  const [location, setLocation] = useState('');
  const valid = !!from && !!to && from <= to;
  const params = qs({ from, to, location_id: location });
  const rep = useApi<AttendanceReport>(valid ? `/api/attendance/report${params}` : null);
  const data = rep.data && rep.data.from === from && rep.data.to === to ? rep.data : undefined;

  const days = useMemo(() => {
    if (!valid) return [];
    const out: string[] = [];
    for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
    return out;
  }, [from, to, valid]);
  const byDay = days.length <= 14;
  const weeks = useMemo(() => [...new Set(days.map(weekStart))], [days]);

  const setWeek = (offset: number) => {
    const start = addDays(weekStart(from || todayIso()), offset * 7);
    setFrom(start);
    setTo(addDays(start, 6));
  };

  return (
    <>
      <Card>
        <div className="hstack wrap" style={{ alignItems: 'flex-end', gap: 10 }}>
          <Field label="Desde"><Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Hasta" error={from && to && from > to ? 'Revisa el rango.' : undefined}><Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Sede">
            <Select value={location} onChange={(e) => setLocation(e.target.value)}>
              <option value="">Todas las sedes</option>
              {meta?.locations.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          <div className="hstack" style={{ minHeight: 48 }}>
            <button type="button" className="btn sm" onClick={() => setWeek(-1)} aria-label="Semana anterior">←</button>
            <button type="button" className="btn sm" onClick={() => { setFrom(monday); setTo(addDays(monday, 6)); }}>Semana actual</button>
            <button type="button" className="btn sm" onClick={() => setWeek(1)} aria-label="Semana siguiente">→</button>
          </div>
          <div className="grow" />
          {valid
            ? <a className="btn primary" href={`/api/attendance/report${qs({ from, to, location_id: location, format: 'csv' })}`} download style={{ textDecoration: 'none' }}>Exportar CSV</a>
            : <button type="button" className="btn primary" disabled>Exportar CSV</button>}
        </div>
      </Card>

      {rep.error && !data ? <ErrorNote error={rep.error} retry={() => rep.mutate()} />
        : !data ? <Skeleton rows={3} height={90} />
        : (
          <>
            <div className="grid-stats">
              <StatCard label="Horas trabajadas" value={fmtMinutes(data.totals.staff_minutes)} note={`${data.staff.length} ${data.staff.length === 1 ? 'persona' : 'personas'} del equipo`} />
              <StatCard label="Días incompletos" value={data.totals.incomplete_days} note="Entrada sin salida: no suman" color={data.totals.incomplete_days ? 'var(--gold)' : undefined} />
              <StatCard label="Asistencias de pacientes" value={data.totals.patient_visits} note={`${data.patients.length} ${data.patients.length === 1 ? 'paciente' : 'pacientes'}`} color="var(--green)" />
            </div>

            <Card blue title="Horas por fisioterapeuta">
              {data.staff.length === 0 ? <Empty>Nadie del equipo registró entrada o salida del {fmtDate(from)} al {fmtDate(to)}.</Empty> : (
                <>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Persona</th>
                          {byDay
                            ? days.map((d) => <th key={d} className="num" title={fmtDate(d)}>{weekdayShort(weekday(d))} {Number(d.slice(8))}</th>)
                            : weeks.map((w) => <th key={w} className="num">Sem. {fmtDate(w).slice(0, 5)}</th>)}
                          <th className="num">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.staff.map((s) => (
                          <tr key={s.user_id}>
                            <td style={{ whiteSpace: 'nowrap' }}><b>{s.person_name}</b><div className="t-small">{s.location_name}</div></td>
                            {byDay
                              ? days.map((d) => {
                                const x = s.days.find((y) => y.date === d);
                                if (!x) return <td key={d} className="num" style={{ color: 'var(--ink-5)' }}>—</td>;
                                return (
                                  <td key={d} className="num" style={{ color: x.incomplete ? 'var(--gold)' : undefined, whiteSpace: 'nowrap' }}
                                    title={`${x.first_in ?? '—'} a ${x.last_out ?? 'sin salida'}${x.incomplete ? ' · incompleto' : ''}`}>
                                    {fmtMinutes(x.minutes)}{x.incomplete ? '*' : ''}
                                  </td>
                                );
                              })
                              : weeks.map((w) => {
                                const x = s.weeks.find((y) => y.week_start === w);
                                return <td key={w} className="num" style={{ color: x?.incomplete_days ? 'var(--gold)' : x ? undefined : 'var(--ink-5)' }}>{x ? `${fmtMinutes(x.minutes)}${x.incomplete_days ? '*' : ''}` : '—'}</td>;
                              })}
                            <td className="num"><b>{fmtMinutes(s.total_minutes)}</b></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="t-small" style={{ marginTop: 10 }}>
                    Horas:minutos, sumando cada par entrada → salida. <span className="gold">*</span> Día incompleto: hay una entrada sin salida y esa entrada no suma.
                  </div>

                  <h4 className="t-label" style={{ margin: '18px 0 8px' }}>Detalle por día</h4>
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>Persona</th><th>Fecha</th><th className="num">Primera entrada</th><th className="num">Última salida</th><th className="num">Horas</th><th>Estado</th></tr></thead>
                      <tbody>
                        {data.staff.flatMap((s) => s.days.map((d) => (
                          <tr key={s.user_id + d.date}>
                            <td style={{ whiteSpace: 'nowrap' }}>{s.person_name}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>{weekdayShort(weekday(d.date))} {fmtDate(d.date)}</td>
                            <td className="num">{d.first_in ?? '—'}</td>
                            <td className="num">{d.last_out ?? '—'}</td>
                            <td className="num">{fmtMinutes(d.minutes)}</td>
                            <td>{d.incomplete ? <span className="badge gold">Incompleto</span> : <span className="badge green">Completo</span>}</td>
                          </tr>
                        )))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </Card>

            <Card blue title="Asistencias de pacientes">
              {data.patients.length === 0 ? <Empty>Ningún paciente registró asistencia del {fmtDate(from)} al {fmtDate(to)}.</Empty> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Paciente</th><th>Expediente</th><th>Sede</th><th className="num">Asistencias</th><th className="num">Días</th><th className="num">Última</th></tr></thead>
                    <tbody>
                      {data.patients.map((p) => (
                        <tr key={p.patient_id}>
                          <td style={{ whiteSpace: 'nowrap' }}><b>{p.person_name}</b></td>
                          <td className="t-mono" style={{ whiteSpace: 'nowrap' }}>{p.record_number}</td>
                          <td>{p.location_name}</td>
                          <td className="num">{p.visits}</td>
                          <td className="num">{p.days}</td>
                          <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(p.last_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
    </>
  );
}
