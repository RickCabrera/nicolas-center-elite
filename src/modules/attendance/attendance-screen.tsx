'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FingerRings } from '@/components/icons';
import { PatientPicker, useMeta } from '@/components/meta';
import { Badge, Button, Card, Chip, Empty, ErrorNote, Field, Input, Notice, ScanOverlay, Select, Sheet, Skeleton, Tabs, Textarea, useToast } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { api, ApiError, qs, refresh, useApi } from '@/lib/client';
import { fmtDate, fmtTime, todayIso } from '@/lib/dates';
import { when } from './devices-settings';
import { ReportsTab } from './reports-tab';
import type { Attendance, AttendanceList, ReaderStatus } from './types';

type Role = 'all' | 'patient' | 'staff';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** HUE-10 · Pantalla "Control de asistencia": estado real del lector y asistencias en vivo. */
export function AttendanceScreen() {
  const user = useUser();
  const [tab, setTab] = useState<'hoy' | 'reportes'>('hoy');
  return (
    <>
      {user.isOwner && <Tabs tabs={[{ key: 'hoy', label: 'Asistencias' }, { key: 'reportes', label: 'Reportes' }]} value={tab} onChange={setTab} />}
      {tab === 'hoy' || !user.isOwner ? <LiveTab /> : <ReportsTab />}
    </>
  );
}

function LiveTab() {
  const user = useUser();
  const { meta } = useMeta();
  const toast = useToast();
  const today = todayIso();
  const [date, setDate] = useState(today);
  const [role, setRole] = useState<Role>('all');
  const [location, setLocation] = useState('');
  const [manual, setManual] = useState(false);
  const [scanning, setScanning] = useState(false);
  const isToday = date === today;

  const status = useApi<{ devices: ReaderStatus[] }>('/api/attendance/status', { refreshInterval: 5000 });
  const listKey = `/api/attendance${qs({ date, role: role === 'all' ? '' : role, location_id: user.isOwner ? location : '' })}`;
  // HUE-10 · En vivo: se vuelve a consultar cada 3 s mientras se mira el día de hoy.
  const list = useApi<AttendanceList>(listKey, { refreshInterval: isToday ? 3000 : 0 });

  // ── filas nuevas: animación breve y aviso de membresía vencida (HUE-15) ──
  const seen = useRef<{ key: string; ids: Set<string> } | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [alerts, setAlerts] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    const items = list.data?.items;
    if (!items || list.data?.date !== date) return;
    if (!seen.current || seen.current.key !== listKey) {
      seen.current = { key: listKey, ids: new Set(items.map((i) => i.id)) }; // primera carga: nada es "nuevo"
      return;
    }
    const added = items.filter((i) => !seen.current!.ids.has(i.id));
    if (!added.length) return;
    for (const a of added) seen.current.ids.add(a.id);
    setFresh((s) => new Set([...s, ...added.map((a) => a.id)]));
    const ids = added.map((a) => a.id);
    const t = setTimeout(() => setFresh((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n; }), 2600);
    if (isToday) {
      const overdue = added.filter((a) => a.person_type === 'patient' && a.billing_state === 'vencido');
      if (overdue.length) {
        setAlerts((s) => [...overdue.map((o) => ({ id: o.id, name: o.person_name })), ...s].slice(0, 4));
        toast(`${overdue[0].person_name} tiene la membresía vencida`, 'error');
      }
    }
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data, listKey]);

  // HUE-14 · Solo existe fuera de producción (meta.simulator lo decide el servidor).
  const simulate = async () => {
    setScanning(true);
    try {
      const [ev] = await Promise.all([api.post<Attendance>('/api/attendance/simulate', {}), sleep(1100)]);
      setScanning(false);
      toast(`Asistencia registrada · ${ev.person_name}`);
      await list.mutate();
      void status.mutate();
      void refresh('/api/appointments', '/api/dashboard');
    } catch (e) {
      setScanning(false);
      toast((e as ApiError).message, 'error');
    }
  };

  const devices = useMemo(() => {
    const all = status.data?.devices ?? [];
    return user.isOwner && location ? all.filter((d) => d.location_id === location) : all;
  }, [status.data, user.isOwner, location]);

  const actions = (
    <div className="stack sm" style={{ width: '100%', maxWidth: 340 }}>
      {meta?.simulator && <Button variant="primary" size="lg" block onClick={simulate} disabled={scanning}>Simular lectura de huella</Button>}
      <Button block onClick={() => setManual(true)}>Registro manual</Button>
    </div>
  );

  const locName = (id: string) => meta?.locations.find((l) => l.id === id)?.name;
  const emptySede = user.isOwner ? (location ? locName(location) : null) : user.location_name;
  const items = list.data?.date === date ? list.data.items : undefined;

  return (
    <>
      {alerts.map((a) => (
        <div key={a.id} className="notice red hstack between" role="alert" style={{ gap: 12 }}>
          <span><b>{a.name}</b> tiene la membresía vencida.</span>
          <button type="button" className="btn-link" onClick={() => setAlerts((s) => s.filter((x) => x.id !== a.id))}>Entendido</button>
        </div>
      ))}

      {status.isLoading && !status.data ? <Skeleton rows={1} height={220} />
        : status.error && !status.data ? <ErrorNote error={status.error} retry={() => status.mutate()} />
        : devices.length <= 1 ? (
          <ReaderCard reader={devices[0] ?? null} sede={emptySede ?? null} owner={user.isOwner}>{actions}</ReaderCard>
        ) : (
          <>
            <div className="grid-2">{devices.map((d) => <ReaderCard key={d.id} reader={d} sede={null} owner={user.isOwner} />)}</div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>{actions}</div>
          </>
        )}

      <Card title={isToday ? 'Asistencias de hoy' : `Asistencias del ${fmtDate(date)}`}
        action={<span className="t-mono" style={{ color: 'var(--ink-4)' }}>{items ? `${list.data!.total} ${list.data!.total === 1 ? 'registro' : 'registros'}` : ''}</span>}>
        <div className="hstack wrap" style={{ marginBottom: 12, gap: 8 }}>
          <div className="hstack" role="group" aria-label="Rol">
            <Chip on={role === 'all'} onClick={() => setRole('all')}>Todos</Chip>
            <Chip on={role === 'patient'} onClick={() => setRole('patient')}>Pacientes</Chip>
            <Chip on={role === 'staff'} onClick={() => setRole('staff')}>Personal</Chip>
          </div>
          <div className="grow" />
          {user.isOwner && (
            <Select aria-label="Sede" value={location} onChange={(e) => setLocation(e.target.value)} style={{ width: 'auto', minWidth: 150, minHeight: 40 }}>
              <option value="">Todas las sedes</option>
              {meta?.locations.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          )}
          <Input type="date" aria-label="Fecha" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} style={{ width: 'auto', minHeight: 40 }} />
          {!isToday && <button type="button" className="btn-link" onClick={() => setDate(today)}>Hoy</button>}
        </div>

        {list.error && !items ? <ErrorNote error={list.error} retry={() => list.mutate()} />
          : !items ? <Skeleton rows={4} />
          : items.length === 0 ? (
            <Empty>
              {isToday ? 'Todavía no hay asistencias hoy' : 'No hubo asistencias ese día'}
              {role !== 'all' ? (role === 'patient' ? ' de pacientes' : ' del personal') : ''}. Las lecturas del lector aparecen aquí al momento.
            </Empty>
          ) : (
            <div className="stack sm" aria-live="polite">
              {items.map((r) => <AttendanceRow key={r.id} r={r} fresh={fresh.has(r.id)} />)}
              {list.data!.total > items.length && <div className="t-small">Se muestran las {items.length} más recientes de {list.data!.total}.</div>}
            </div>
          )}
      </Card>

      {scanning && <ScanOverlay title="Leyendo huella" sub="Lector de recepción" />}
      <ManualSheet open={manual} onClose={() => setManual(false)} onSaved={() => { setManual(false); if (!isToday) setDate(today); void list.mutate(); void status.mutate(); }} />
    </>
  );
}

/** Tarjeta del lector con su estado real (HUE-10). `reader` null = no hay lector configurado. */
function ReaderCard({ reader, sede, owner, children }: { reader: ReaderStatus | null; sede: string | null; owner: boolean; children?: React.ReactNode }) {
  const online = !!reader?.online;
  const color = !reader ? 'rgba(255,255,255,.4)' : online ? 'var(--blue)' : 'rgba(255,255,255,.5)';
  return (
    <section className="card lg" style={{ padding: 22, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center' }}>
      <div style={{ width: 124, height: 124, borderRadius: '50%', border: `1px solid ${online ? '#2e9bff33' : 'rgba(255,255,255,.14)'}`, background: 'var(--glass-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <FingerRings size={66} color={color} />
      </div>
      <div style={{ minWidth: 0, maxWidth: '100%' }}>
        <div style={{ font: '700 15px/1.2 var(--f-head)', letterSpacing: '.06em', textTransform: 'uppercase', overflowWrap: 'anywhere' }}>
          Lector en recepción{reader ? ` · ${reader.location_name}` : sede ? ` · ${sede}` : ''}
        </div>
        <div role="status" style={{ marginTop: 6, font: '500 11px/1 var(--f-mono)', letterSpacing: '.14em', color: !reader ? 'var(--ink-4)' : online ? 'var(--green)' : 'var(--red)' }}>
          {!reader ? 'SIN LECTOR CONFIGURADO' : online ? 'EN LÍNEA' : 'SIN CONEXIÓN'}
        </div>
        {reader && (
          <div className="t-small" style={{ marginTop: 8 }}>
            {reader.last_read
              ? <>Última lectura {when(reader.last_read.occurred_at)} · {reader.last_read.person_name}</>
              : 'Sin lecturas todavía'}
          </div>
        )}
        {reader && !reader.bridge_online && (
          <div style={{ marginTop: 8, font: '600 10px/1.3 var(--f-mono)', letterSpacing: '.12em', color: 'var(--gold)', textTransform: 'uppercase' }}>Agente puente desconectado</div>
        )}
        {reader && !online && (
          <div className="t-small" style={{ marginTop: 8, maxWidth: 420 }}>
            Mientras vuelve la conexión usa &quot;Registro manual&quot;. Las lecturas hechas en el lector se recuperan solas al reconectar.
          </div>
        )}
        {!reader && (
          <div className="t-small" style={{ marginTop: 8, maxWidth: 420 }}>
            {owner
              ? <>Agrega el lector en <Link href="/configuracion">Configuración → Lectores</Link>. Mientras tanto puedes registrar asistencias a mano.</>
              : 'Pide al dueño que configure el lector de tu sede. Mientras tanto puedes registrar asistencias a mano.'}
          </div>
        )}
        {reader?.last_error && owner && <div className="t-small" style={{ marginTop: 8, color: 'var(--red)', maxWidth: 440 }}>{reader.last_error}</div>}
      </div>
      {children}
    </section>
  );
}

function AttendanceRow({ r, fresh }: { r: Attendance; fresh: boolean }) {
  const unknown = r.person_type === 'unknown';
  const overdue = r.person_type === 'patient' && r.billing_state === 'vencido';
  const title = r.source === 'manual' ? `Registro manual${r.recorded_by_name ? ` por ${r.recorded_by_name}` : ''}: ${r.manual_reason ?? ''}` : undefined;
  return (
    <div className="row" title={title}
      style={{ padding: '11px 12px', animation: fresh ? 'fadeUp .45s ease both' : undefined, borderColor: fresh ? 'var(--blue)' : undefined, transition: 'border-color 1.2s ease' }}>
      <span className={`dot ${unknown ? 'red' : 'green'}`} aria-hidden="true" />
      <div className="grow">
        <div className="hstack" style={{ gap: 8, minWidth: 0 }}>
          <span className="ellipsis" style={{ font: '600 15px/1.2 var(--f-body)' }}>
            {unknown ? `No reconocido · núm. ${r.employee_no ?? '—'}` : r.person_name}
          </span>
        </div>
        <div className="t-small ellipsis">{r.role_label} · {r.location_name}{r.source === 'manual' && r.manual_reason ? ` · ${r.manual_reason}` : ''}</div>
        {(overdue || r.source === 'manual' || r.source === 'simulator' || unknown) && (
          <div className="hstack wrap" style={{ marginTop: 6, gap: 6 }}>
            {overdue && <Badge tone="red">Membresía vencida</Badge>}
            {r.source === 'manual' && <Badge tone="gold">Manual</Badge>}
            {r.source === 'simulator' && <Badge>Simulada</Badge>}
            {unknown && <Badge tone="red">No reconocido</Badge>}
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right', flex: 'none' }}>
        <div style={{ font: '600 13px/1 var(--f-mono)' }}>{fmtTime(r.occurred_at)}</div>
        <div style={{ marginTop: 3, font: '600 10px/1 var(--f-mono)', letterSpacing: '.12em', color: 'var(--ink-4)' }}>{r.direction === 'in' ? 'ENTRADA' : 'SALIDA'}</div>
      </div>
    </div>
  );
}

/** HUE-11 · Registro manual: persona, hora de hoy y motivo obligatorio. */
function ManualSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const user = useUser();
  const { meta } = useMeta();
  const toast = useToast();
  const [type, setType] = useState<'patient' | 'staff'>('patient');
  const [person, setPerson] = useState('');
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setType('patient'); setPerson(''); setReason(''); setErrors({}); setFailure(null);
    setTime(fmtTime(new Date()));
  }, [open]);

  const save = async () => {
    const e: Record<string, string> = {};
    if (!person) e.person_id = type === 'patient' ? 'Selecciona al paciente.' : 'Selecciona a la persona.';
    if (!/^\d{2}:\d{2}$/.test(time)) e.time = 'Escribe la hora (HH:MM).';
    if (reason.trim().length < 3) e.reason = 'Escribe el motivo del registro manual.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    setFailure(null);
    try {
      const ev = await api.post<Attendance>('/api/attendance', { person_type: type, person_id: person, time, reason });
      toast(`Asistencia registrada · ${ev.person_name}`);
      void refresh('/api/appointments', '/api/dashboard', '/api/patients');
      onSaved();
    } catch (err) {
      const x = err as ApiError;
      if (x.fields) setErrors(x.fields);
      setFailure(x.message);
    } finally {
      setSaving(false);
    }
  };

  const staff = (meta?.therapists ?? []).filter((t) => t.active);
  return (
    <Sheet open={open} onClose={onClose} title="Registro manual"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={saving} onClick={save}>Registrar asistencia</Button></>}>
      <form className="stack md" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="t-small">Para cuando el lector no reconoce la huella o no hay conexión. Queda marcado como manual, con tu nombre y el motivo.</div>
        {user.isOwner && (
          <div className="hstack" role="group" aria-label="Tipo de persona">
            <Chip on={type === 'patient'} onClick={() => { setType('patient'); setPerson(''); }}>Paciente</Chip>
            <Chip on={type === 'staff'} onClick={() => { setType('staff'); setPerson(''); }}>Personal</Chip>
          </div>
        )}
        {type === 'patient' ? (
          <Field label="Paciente" error={errors.person_id}>
            <PatientPicker value={person} onChange={(id) => { setPerson(id); setErrors((s) => ({ ...s, person_id: '' })); }} invalid={!!errors.person_id} />
          </Field>
        ) : (
          <Field label="Persona del equipo" error={errors.person_id}>
            <Select value={person} onChange={(e) => { setPerson(e.target.value); setErrors((s) => ({ ...s, person_id: '' })); }} invalid={!!errors.person_id}>
              <option value="">Selecciona a la persona</option>
              {staff.map((t) => <option key={t.id} value={t.id}>{t.display_name}{t.location_name ? ` · ${t.location_name}` : ''}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Hora de hoy" error={errors.time}>
          <Input type="time" value={time} onChange={(e) => { setTime(e.target.value); setErrors((s) => ({ ...s, time: '' })); }} invalid={!!errors.time} />
        </Field>
        <Field label="Motivo" error={errors.reason}>
          <Textarea value={reason} onChange={(e) => { setReason(e.target.value); setErrors((s) => ({ ...s, reason: '' })); }} invalid={!!errors.reason}
            placeholder="Por ejemplo: el lector no reconoció la huella" maxLength={300} rows={3} />
        </Field>
        {failure && <Notice tone="red">{failure}</Notice>}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
