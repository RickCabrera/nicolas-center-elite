'use client';
import { useEffect, useState } from 'react';
import { Button, Checkbox, Empty, ErrorNote, Field, Input, Notice, Skeleton, useToast } from '@/components/ui';
import { api, ApiError, refresh, useApi } from '@/lib/client';
import { addDays, fmtDate, fmtTime, isoDate, todayIso, weekdayLong } from '@/lib/dates';
import type { HourRow, TimeBlock } from './types';

type Day = { on: boolean; s1: string; e1: string; two: boolean; s2: string; e2: string };
const ORDER = [1, 2, 3, 4, 5, 6, 0];   // lunes primero
const OFF: Day = { on: false, s1: '09:00', e1: '14:00', two: false, s2: '16:00', e2: '20:00' };

function toDays(rows: HourRow[]): Record<number, Day> {
  const out: Record<number, Day> = {};
  for (const wd of ORDER) {
    const r = rows.filter((x) => x.weekday === wd).sort((a, b) => a.start_time.localeCompare(b.start_time));
    out[wd] = r.length
      ? { on: true, s1: r[0].start_time, e1: r[0].end_time, two: r.length > 1, s2: r[1]?.start_time ?? OFF.s2, e2: r[1]?.end_time ?? OFF.e2 }
      : { ...OFF };
  }
  return out;
}

/** Texto de un bloqueo: días completos se muestran sin horas. */
export function blockRange(b: Pick<TimeBlock, 'starts_at' | 'ends_at'>): string {
  const allDay = fmtTime(b.starts_at) === '00:00' && fmtTime(b.ends_at) === '00:00';
  if (allDay) {
    const from = isoDate(b.starts_at), to = addDays(isoDate(b.ends_at), -1);
    return from === to ? `${fmtDate(from)} · todo el día` : `Del ${fmtDate(from)} al ${fmtDate(to)}`;
  }
  const sameDay = isoDate(b.starts_at) === isoDate(b.ends_at);
  return sameDay
    ? `${fmtDate(b.starts_at)} · ${fmtTime(b.starts_at)} – ${fmtTime(b.ends_at)}`
    : `${fmtDate(b.starts_at)} ${fmtTime(b.starts_at)} – ${fmtDate(b.ends_at)} ${fmtTime(b.ends_at)}`;
}

/**
 * AGE-07 · Horario laboral y bloqueos de un usuario. Autocontenido: lo incrustan Agenda, Equipo y Mi perfil.
 * El permiso real lo aplica la API (el dueño edita a cualquiera; el fisioterapeuta solo el suyo).
 */
export function HoursEditor({ userId }: { userId: string }) {
  const toast = useToast();
  const hours = useApi<HourRow[]>(`/api/schedule/hours?user_id=${userId}`);
  const blocks = useApi<TimeBlock[]>(`/api/schedule/blocks?user_id=${userId}`);
  // `edited` guarda lo que el usuario cambió; mientras no toque nada se muestra lo guardado en el servidor.
  const [edited, setEdited] = useState<Record<number, Day> | null>(null);
  const days = edited ?? (hours.data ? toDays(hours.data) : null);
  const dirty = edited !== null;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setEdited(null); setError(''); }, [userId]);

  const upd = (wd: number, patch: Partial<Day>) => {
    if (!days) return;
    setEdited({ ...days, [wd]: { ...days[wd], ...patch } });
    setError('');
  };

  const save = async () => {
    if (!days) return;
    const list: HourRow[] = [];
    for (const wd of ORDER) {
      const d = days[wd];
      if (!d.on) continue;
      const spans = [[d.s1, d.e1], ...(d.two ? [[d.s2, d.e2]] : [])];
      for (const [s, e] of spans) {
        if (!s || !e) { setError(`${weekdayLong(wd)}: completa la hora de inicio y de fin.`); return; }
        if (e <= s) { setError(`${weekdayLong(wd)}: la hora de fin debe ser posterior a la de inicio.`); return; }
        list.push({ weekday: wd, start_time: s, end_time: e });
      }
      if (d.two && d.s2 < d.e1) { setError(`${weekdayLong(wd)}: el segundo tramo debe empezar cuando termina el primero o después.`); return; }
    }
    setSaving(true); setError('');
    try {
      const saved = await api.put<HourRow[]>('/api/schedule/hours', { user_id: userId, hours: list });
      await hours.mutate(saved, { revalidate: false });
      await refresh('/api/schedule/hours');
      setEdited(null);
      toast(list.length ? 'Horario guardado' : 'Horario guardado · sin restricción de horas');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar el horario.');
    } finally { setSaving(false); }
  };

  const noHours = !!days && ORDER.every((wd) => !days[wd].on);

  return (
    <div className="stack lg">
      <section className="stack md" aria-label="Horario laboral">
        <div className="t-h3 blue">Horario laboral</div>
        {hours.error && !days ? <ErrorNote error={hours.error} retry={() => hours.mutate()} />
          : !days ? <Skeleton rows={4} height={48} />
          : (
            <>
              <div className="stack sm">
                {ORDER.map((wd) => {
                  const d = days[wd];
                  const name = weekdayLong(wd);
                  return (
                    <div key={wd} className="row" style={{ flexWrap: 'wrap', rowGap: 8, alignItems: 'center' }}>
                      <div style={{ flex: '0 0 124px' }}>
                        <Checkbox label={name} checked={d.on} onChange={(e) => upd(wd, { on: e.target.checked })} />
                      </div>
                      {!d.on ? <span className="t-small grow">No atiende</span> : (
                        <div className="stack sm grow" style={{ minWidth: 220 }}>
                          <div className="hstack">
                            <Input type="time" step={300} aria-label={`${name}: inicio`} value={d.s1} onChange={(e) => upd(wd, { s1: e.target.value })} style={{ minHeight: 42 }} />
                            <span className="dim" aria-hidden="true">–</span>
                            <Input type="time" step={300} aria-label={`${name}: fin`} value={d.e1} onChange={(e) => upd(wd, { e1: e.target.value })} style={{ minHeight: 42 }} />
                          </div>
                          {d.two && (
                            <div className="hstack">
                              <Input type="time" step={300} aria-label={`${name}: inicio del segundo tramo`} value={d.s2} onChange={(e) => upd(wd, { s2: e.target.value })} style={{ minHeight: 42 }} />
                              <span className="dim" aria-hidden="true">–</span>
                              <Input type="time" step={300} aria-label={`${name}: fin del segundo tramo`} value={d.e2} onChange={(e) => upd(wd, { e2: e.target.value })} style={{ minHeight: 42 }} />
                            </div>
                          )}
                          <button type="button" className="btn-link" style={{ alignSelf: 'flex-start' }} onClick={() => upd(wd, { two: !d.two })}>
                            {d.two ? 'Quitar segundo tramo' : '+ Segundo tramo'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="t-small">
                {noHours
                  ? 'Sin horario definido, la agenda no restringe: se puede agendar a cualquier hora. Activa los días que atiende para que solo se agende dentro de ellos.'
                  : 'Solo se podrán agendar citas dentro de este horario. Si desactivas todos los días, la agenda deja de restringir las horas.'}
              </div>
              {error && <Notice tone="red">{error}</Notice>}
              <Button variant="primary" loading={saving} disabled={!dirty} onClick={save} style={{ alignSelf: 'flex-start' }}>Guardar horario</Button>
            </>
          )}
      </section>

      <BlocksSection userId={userId} blocks={blocks} />
    </div>
  );
}

function BlocksSection({ userId, blocks }: { userId: string; blocks: ReturnType<typeof useApi<TimeBlock[]>> }) {
  const toast = useToast();
  const blank = () => ({ from_date: todayIso(), to_date: todayIso(), allDay: true, from_time: '09:00', to_time: '14:00', reason: '' });
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsForce, setNeedsForce] = useState(false);
  const [removing, setRemoving] = useState('');
  const set = (patch: Partial<ReturnType<typeof blank>>) => { setF((s) => ({ ...s, ...patch })); setError(''); setNeedsForce(false); };

  const add = async (force = false) => {
    if (!f.from_date || !f.to_date) { setError('Indica desde y hasta cuándo.'); return; }
    if (f.to_date < f.from_date) { setError('La fecha final debe ser igual o posterior a la inicial.'); return; }
    if (!f.allDay && f.from_date === f.to_date && f.to_time <= f.from_time) { setError('La hora final debe ser posterior a la inicial.'); return; }
    setBusy(true); setError('');
    try {
      await api.post('/api/schedule/blocks', f.allDay
        ? { user_id: userId, from_date: f.from_date, from_time: '00:00', to_date: addDays(f.to_date, 1), to_time: '00:00', reason: f.reason, force }
        : { user_id: userId, from_date: f.from_date, from_time: f.from_time, to_date: f.to_date, to_time: f.to_time, reason: f.reason, force });
      await refresh('/api/schedule/blocks');
      toast('Bloqueo agregado');
      setAdding(false); setF(blank()); setNeedsForce(false);
    } catch (e) {
      if (e instanceof ApiError) { setError(e.message); setNeedsForce(e.code === 'has_appointments'); }
      else setError('No se pudo agregar el bloqueo.');
    } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    setRemoving(id);
    try {
      await api.del(`/api/schedule/blocks/${id}`);
      await refresh('/api/schedule/blocks');
      toast('Bloqueo quitado');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'No se pudo quitar el bloqueo.', 'error');
    } finally { setRemoving(''); }
  };

  return (
    <section className="stack md" aria-label="Bloqueos">
      <div className="hstack between">
        <div className="t-h3 blue">Bloqueos</div>
        {!adding && <Button size="sm" onClick={() => { setAdding(true); setF(blank()); setError(''); setNeedsForce(false); }}>Agregar bloqueo</Button>}
      </div>
      <div className="t-small">Vacaciones, permisos o cualquier periodo en el que no se le debe agendar.</div>

      {adding && (
        <div className="kv stack md">
          <div className="grid-form">
            <Field label="Desde"><Input type="date" value={f.from_date} onChange={(e) => set({ from_date: e.target.value, to_date: f.to_date < e.target.value ? e.target.value : f.to_date })} /></Field>
            <Field label="Hasta"><Input type="date" value={f.to_date} min={f.from_date} onChange={(e) => set({ to_date: e.target.value })} /></Field>
            {!f.allDay && <Field label="Hora de inicio"><Input type="time" step={300} value={f.from_time} onChange={(e) => set({ from_time: e.target.value })} /></Field>}
            {!f.allDay && <Field label="Hora de fin"><Input type="time" step={300} value={f.to_time} onChange={(e) => set({ to_time: e.target.value })} /></Field>}
          </div>
          <Checkbox label="Todo el día" checked={f.allDay} onChange={(e) => set({ allDay: e.target.checked })} />
          <Field label="Motivo"><Input value={f.reason} maxLength={200} placeholder="Ej. vacaciones, permiso, congreso" onChange={(e) => set({ reason: e.target.value })} /></Field>
          {error && <Notice tone={needsForce ? 'gold' : 'red'}>{error}</Notice>}
          <div className="hstack wrap">
            <Button onClick={() => setAdding(false)}>Cancelar</Button>
            {needsForce
              ? <Button variant="gold" loading={busy} onClick={() => add(true)}>Bloquear de todos modos</Button>
              : <Button variant="primary" loading={busy} onClick={() => add(false)}>Guardar bloqueo</Button>}
          </div>
        </div>
      )}

      {blocks.error && !blocks.data ? <ErrorNote error={blocks.error} retry={() => blocks.mutate()} />
        : !blocks.data ? <Skeleton rows={1} height={48} />
        : blocks.data.length === 0 ? <Empty>Sin bloqueos próximos.</Empty>
        : (
          <div className="stack sm">
            {blocks.data.map((b) => (
              <div key={b.id} className="row">
                <div className="grow">
                  <div className="t-strong" style={{ fontFamily: 'var(--f-mono)', fontSize: 12.5, lineHeight: 1.4 }}>{blockRange(b)}</div>
                  <div className="t-small" style={{ marginTop: 3, overflowWrap: 'anywhere' }}>{b.reason || 'Sin motivo'}</div>
                </div>
                <Button size="sm" variant="danger" loading={removing === b.id} onClick={() => remove(b.id)}>Quitar</Button>
              </div>
            ))}
          </div>
        )}
    </section>
  );
}
