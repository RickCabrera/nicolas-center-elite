'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/shell';
import { useMeta } from '@/components/meta';
import { Badge, BillingBadge, Card, Chip, Empty, ErrorNote, Skeleton, StatCard } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { qs, useApi } from '@/lib/client';
import { fmtDate, longDate, todayIso } from '@/lib/dates';
import type { Dashboard } from './types';

const moreLink = { display: 'inline-flex', alignItems: 'center' } as const;

/**
 * DASH-01..04 · Panel de inicio: indicadores, citas de hoy, asistencias y mensualidades por atender.
 * AUTH-10 · Recepción ve el mismo tablero del mostrador que el dueño (todas las sedes, con filtro).
 */
export function DashboardView() {
  const user = useUser();
  const { meta } = useMeta();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // DASH-03 · La sede elegida vive en la URL (?sede=cor) para que el filtro sobreviva a recargas y enlaces.
  const locations = (meta?.locations ?? []).filter((l) => l.active);
  const code = user.isFront ? (params.get('sede') ?? '').toUpperCase() : '';
  const selected = locations.find((l) => l.code === code) ?? null;
  const waitingMeta = user.isFront && !!code && !meta;
  const setLocation = (c: string | null) => {
    const p = new URLSearchParams(params.toString());
    if (c) p.set('sede', c.toLowerCase()); else p.delete('sede');
    const s = p.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  // DASH-04 · En vivo: se vuelve a leer cada 5 segundos.
  const { data, error, mutate } = useApi<Dashboard>(
    waitingMeta ? null : `/api/dashboard${qs({ location_id: selected?.id })}`, { refreshInterval: 5000 });

  const today = data?.today ?? todayIso();
  const dateLabel = data?.date_label ?? longDate(today);
  const allNames = locations.map((l) => l.name).join(' + ');
  const sub = user.isFront
    ? `${selected ? selected.name : allNames || 'Todas las sedes'} · ${dateLabel}`
    : `Pacientes asignados · ${user.location_name ?? 'Sin sede asignada'}`;
  const scopeNote = !user.isFront ? 'Asignados a ti' : selected ? `Sede ${selected.name}` : locations.length === 2 ? 'Ambas sedes' : 'Todas las sedes';
  const s = data?.stats;

  return (
    <div className="page" style={{ gap: 18 }}>
      <PageHeader title={user.isReception ? 'Panel de recepción' : user.isFront ? 'Panel general' : 'Mi panel'} sub={sub} />

      {user.isFront && locations.length > 1 && (
        <div className="scroll-x" role="group" aria-label="Sede" style={{ marginTop: -6 }}>
          <Chip on={!selected} onClick={() => setLocation(null)}>Todas</Chip>
          {locations.map((l) => <Chip key={l.id} on={selected?.id === l.id} onClick={() => setLocation(l.code)}>{l.name}</Chip>)}
        </div>
      )}

      <ErrorNote error={error} retry={() => mutate()} />

      {!data ? (!error && <><Skeleton rows={1} height={104} /><Skeleton rows={4} /></>) : (
        <>
          <div className="grid-stats">
            <StatCard label="Pacientes activos" value={s!.patients_active} note={scopeNote} color="var(--ink)" />
            <StatCard label="Citas de hoy" value={s!.appointments_today} note={dateLabel} color="var(--blue)" />
            <StatCard label="Mensualidades por vencer" value={s!.due} note={user.isFront ? 'Incluye vencidas' : 'De tus pacientes'} color="var(--gold)" />
            <StatCard label="Asistencias por huella" value={s!.attendance_today} note="Registradas hoy" color="var(--green)" />
          </div>

          <div className="grid-2">
            <Card title="Citas de hoy" action={<Link href="/agenda" className="btn-link" style={moreLink}>Ver agenda</Link>}>
              <div className="stack sm">
                {data.today_appointments.length === 0 && <Empty>Sin citas para hoy.</Empty>}
                {data.today_appointments.map((a) => (
                  <Link key={a.id} href={`/agenda?fecha=${today}`} className="row">
                    <div className="blue" style={{ font: '600 13px/1 var(--f-mono)', flex: 'none' }}>{a.time}</div>
                    <div className="grow">
                      <div className="t-strong ellipsis">{a.patient_name}</div>
                      <div className="t-small ellipsis">{a.type_name} · {a.therapist_name}</div>
                    </div>
                    {a.status === 'attended' && <Badge tone="green">Asistió</Badge>}
                    {a.status === 'no_show' && <Badge tone="red">No asistió</Badge>}
                  </Link>
                ))}
                {s!.appointments_today > data.today_appointments.length && (
                  <Link href={`/agenda?fecha=${today}`} className="btn-link dim" style={{ ...moreLink, alignSelf: 'flex-start' }}>
                    y {s!.appointments_today - data.today_appointments.length} más en la agenda
                  </Link>
                )}
              </div>
            </Card>

            <Card title="Asistencias por huella" action={<Link href="/huella" className="btn-link" style={moreLink}>Lector</Link>}>
              <div className="stack sm">
                {data.recent_attendance.length === 0 && <Empty>Aún no hay asistencias registradas hoy.</Empty>}
                {data.recent_attendance.map((r) => (
                  <Link key={r.id} href={user.isFront && r.patient_id ? `/pacientes/${r.patient_id}` : '/huella'} className="row">
                    <div className={`dot ${r.direction === 'out' ? 'off' : ''}`} />
                    <div className="grow">
                      <div className="t-strong ellipsis">{r.person_name}</div>
                      <div className="t-small ellipsis">{r.role_label} · {r.location_name}{r.direction === 'out' ? ' · Salida' : ''}</div>
                    </div>
                    <div className="dim" style={{ font: '600 12px/1 var(--f-mono)', flex: 'none' }}>{r.time}</div>
                  </Link>
                ))}
              </div>
            </Card>
          </div>

          {user.isFront && data.due_payments && (
            <Card title="Mensualidades por atender" action={<Link href="/mensualidades" className="btn-link" style={moreLink}>Ver mensualidades</Link>}>
              <div className="stack sm">
                {data.due_payments.length === 0 && <Empty>Todas las mensualidades están al corriente.</Empty>}
                {data.due_payments.map((p) => (
                  <Link key={p.patient_id} href={`/pacientes/${p.patient_id}?tab=membresia`} className="row" style={{ gap: 10 }}>
                    <div className="grow">
                      <div className="t-strong ellipsis">{p.full_name}</div>
                      <div className="t-small ellipsis">{p.plan_name} · {p.state === 'vencido' ? 'venció' : 'vence'} {fmtDate(p.next_due_date)}</div>
                    </div>
                    <BillingBadge state={p.state} />
                  </Link>
                ))}
                {s!.due > data.due_payments.length && (
                  <Link href="/mensualidades" className="btn-link dim" style={{ ...moreLink, alignSelf: 'flex-start' }}>
                    y {s!.due - data.due_payments.length} más en mensualidades
                  </Link>
                )}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
