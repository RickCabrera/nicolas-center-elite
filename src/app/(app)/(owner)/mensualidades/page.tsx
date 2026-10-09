'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMeta } from '@/components/meta';
import { PageHeader } from '@/components/shell';
import { BillingBadge, Button, Chip, Empty, ErrorNote, Input, Skeleton, Tabs } from '@/components/ui';
import { qs, useApi } from '@/lib/client';
import { fmtDate } from '@/lib/dates';
import { money, type BillingState } from '@/lib/format';
import { IncomeReport } from '@/modules/billing/income-report';
import { OnlineLinks } from '@/modules/billing/online-links';
import { PaymentSheet } from '@/modules/billing/payment-sheet';
import { PlanPickerSheet } from '@/modules/billing/plan-picker-sheet';
import type { Board, BoardRow } from '@/modules/billing/types';
import { InvoicesTab } from '@/modules/invoicing/invoices-tab';

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const STATS: { key: BillingState; label: string; color: string }[] = [
  { key: 'pagado', label: 'Pagados', color: 'var(--green)' },
  { key: 'por_vencer', label: 'Por vencer', color: 'var(--gold)' },
  { key: 'vencido', label: 'Vencidos', color: 'var(--red)' },
];
const STATE_EMPTY: Record<BillingState, string> = {
  pagado: 'Ningún paciente está al corriente con estos filtros.',
  por_vencer: 'Ningún pago está por vencer con estos filtros.',
  vencido: 'No hay pagos vencidos con estos filtros.',
  pausado: 'No hay membresías en pausa con estos filtros.',
  sin_plan: 'Todos los pacientes tienen plan con estos filtros.',
};

function PatientCard({ p, onPay, onAssign }: { p: BoardRow; onPay: () => void; onAssign: () => void }) {
  const href = `/pacientes/${p.patient_id}?tab=membresia`;
  const detail = p.state === 'sin_plan' ? 'SIN MEMBRESÍA'
    : p.membership_status === 'paused' ? 'EN PAUSA'
    : p.plan_kind === 'package' ? `SESIONES RESTANTES: ${p.sessions_remaining ?? 0}`
    : `PRÓX. PAGO ${fmtDate(p.next_due_date)}`;
  return (
    <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="hstack" style={{ gap: 10 }}>
        <div className="grow">
          <Link href={href} className="t-name ellipsis" style={{ display: 'block', color: 'var(--ink)' }} title={`Abrir la membresía de ${p.full_name}`}>{p.full_name}</Link>
          <div className="t-sub ellipsis" style={{ marginTop: 3, lineHeight: 1.3 }}>
            {p.plan_name ? `${p.plan_name} · ${money(p.price_cents)}` : `Sin plan · ${p.location_name}`}
          </div>
        </div>
        <BillingBadge state={p.state} />
      </div>
      <div className="hstack wrap between" style={{ gap: 10 }}>
        <div style={{ font: '500 11px/1.3 var(--f-mono)', color: 'var(--ink-4)', letterSpacing: '.08em' }}>
          {detail}
          {p.plan_kind === 'package' && p.state !== 'pausado' && <div style={{ marginTop: 4 }}>VIGENCIA {fmtDate(p.next_due_date)}</div>}
        </div>
        {p.state === 'sin_plan' ? <Button size="sm" style={{ minHeight: 44, color: 'var(--blue)' }} onClick={onAssign}>Asignar plan</Button>
          : p.membership_status === 'paused' ? <Link href={href} className="btn sm" style={{ minHeight: 44, color: 'var(--blue)' }}>Ver membresía</Link>
          : <Button size="sm" style={{ minHeight: 44, color: 'var(--blue)' }} onClick={onPay}>Registrar pago</Button>}
      </div>
    </div>
  );
}

function BoardView() {
  const { meta } = useMeta();
  const [state, setState] = useState<BillingState | ''>('');
  const [location, setLocation] = useState('');
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim());
  const [paying, setPaying] = useState<BoardRow | null>(null);
  const [assigning, setAssigning] = useState<BoardRow | null>(null);
  const { data, error, mutate } = useApi<Board>('/api/billing' + qs({ state, location_id: location, q }));

  const locations = (meta?.locations ?? []).filter((l) => l.active);
  const filtered = !!state || !!location || !!q;
  const toggle = (s: BillingState) => setState((cur) => (cur === s ? '' : s));
  const extra: { key: BillingState; label: string }[] = [{ key: 'sin_plan', label: 'Sin plan' }, { key: 'pausado', label: 'En pausa' }];

  return (
    <>
      <div role="group" aria-label="Filtrar por estado de pago" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'clamp(8px, 1vw, 16px)' }}>
        {STATS.map((s) => (
          <button key={s.key} type="button" className="card" aria-pressed={state === s.key} onClick={() => toggle(s.key)}
            style={{ padding: 14, ...(state === s.key ? { borderColor: s.color, boxShadow: `var(--shadow-card), 0 0 22px -8px ${s.color}` } : {}) }}>
            <div className="t-label ellipsis">{s.label}</div>
            <div style={{ marginTop: 8, font: '800 24px/1 var(--f-head)', color: s.color }}>{data ? data.stats[s.key] : '–'}</div>
          </button>
        ))}
      </div>

      <div className="hstack wrap">
        <Input className="round" style={{ flex: 1, minWidth: 200 }} type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar paciente..." aria-label="Buscar por nombre o número de expediente" />
      </div>
      <div className="scroll-x" role="group" aria-label="Filtrar por sede y otros estados">
        <Chip on={!location} onClick={() => setLocation('')}>Todas</Chip>
        {locations.map((l) => <Chip key={l.id} on={location === l.id} onClick={() => setLocation(l.id)}>{l.name}</Chip>)}
        {data && extra.filter((x) => data.stats[x.key] > 0 || state === x.key).map((x) => (
          <Chip key={x.key} square on={state === x.key} onClick={() => toggle(x.key)}>{x.label} · {data.stats[x.key]}</Chip>
        ))}
      </div>

      {error && !data ? <ErrorNote error={error} retry={() => mutate()} />
        : !data ? (
          <div className="grid-cards" aria-busy="true" aria-label="Cargando mensualidades">
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} rows={1} height={112} />)}
          </div>
        ) : data.rows.length === 0 ? (
          <Empty>
            {filtered ? (
              <>
                {state && !q ? STATE_EMPTY[state] : 'Ningún paciente coincide con la búsqueda o los filtros.'}{' '}
                <button type="button" className="btn-link" style={{ marginLeft: 6 }} onClick={() => { setState(''); setLocation(''); setQuery(''); }}>Quitar filtros</button>
              </>
            ) : 'Aún no hay pacientes activos. Al dar de alta un paciente con plan aparecerá aquí su estado de pago.'}
          </Empty>
        ) : (
          <>
            {error && <ErrorNote error={error} retry={() => mutate()} />}
            <div className="grid-cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))' }}>
              {data.rows.map((p) => <PatientCard key={p.patient_id} p={p} onPay={() => setPaying(p)} onAssign={() => setAssigning(p)} />)}
            </div>
          </>
        )}

      <PaymentSheet open={!!paying} onClose={() => setPaying(null)} patientId={paying?.patient_id ?? ''} patientName={paying?.full_name ?? ''} billing={paying} />
      <PlanPickerSheet open={!!assigning} onClose={() => setAssigning(null)} patientId={assigning?.patient_id ?? ''} patientName={assigning?.full_name ?? ''} mode="assign" />
    </>
  );
}

type TabKey = 'estado' | 'linea' | 'facturas' | 'ingresos';
const TAB_SUB: Record<TabKey, string> = {
  estado: 'Estado de pago por paciente',
  linea: 'Links de pago con tarjeta y OXXO',
  facturas: 'Facturas CFDI emitidas y factura global',
  ingresos: 'Ingresos por mes, sede y plan',
};

// PAG-06 / PAG-10 / PAG-12 / FAC-06 · Mensualidades: estado de pago, cobros en línea, facturas e ingresos (solo dueño).
export default function Mensualidades() {
  const [tab, setTab] = useState<TabKey>('estado');
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t && t in TAB_SUB) setTab(t as TabKey);
  }, []);
  const { data: links } = useApi<{ counts: Record<string, number> }>('/api/billing/payment-links?limit=1');
  const review = links?.counts.needs_review ?? 0;
  return (
    <div className="page">
      <PageHeader title="Mensualidades" sub={TAB_SUB[tab]} />
      <Tabs tabs={[
        { key: 'estado', label: 'Estado de pago' },
        { key: 'linea', label: review ? `Cobros en línea (${review})` : 'Cobros en línea' },
        { key: 'facturas', label: 'Facturas' },
        { key: 'ingresos', label: 'Ingresos' },
      ]} value={tab} onChange={setTab} />
      {tab === 'estado' && <BoardView />}
      {tab === 'linea' && <OnlineLinks />}
      {tab === 'facturas' && <InvoicesTab />}
      {tab === 'ingresos' && <IncomeReport />}
    </div>
  );
}
