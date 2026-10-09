'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Empty, ErrorNote, Field, Select, Skeleton } from '@/components/ui';
import { qs, useApi } from '@/lib/client';
import { monthName, todayIso } from '@/lib/dates';
import { money, PAYMENT_METHOD_LABEL } from '@/lib/format';
import { monthRange, shiftMonth } from './rules';
import type { Report } from './types';

const monthLabel = (m: string) => { const [y, mm] = m.split('-').map(Number); return `${monthName(mm)} ${y}`; };
const monthShort = (m: string) => { const [y, mm] = m.split('-').map(Number); return `${monthName(mm).slice(0, 3)} ${String(y).slice(2)}`; };
/** Monto compacto para la etiqueta de la barra: $12.4 k, $1.2 M. */
const compact = (cents: number) => {
  const v = cents / 100;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)} M`;
  if (v >= 10_000) return `$${(v / 1000).toFixed(1)} k`;
  return money(Math.round(v) * 100);
};

/** Gráfica de barras por mes (SVG propio). Los mismos datos están en la tabla de abajo. */
function Bars({ data }: { data: { month: string; total_cents: number }[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const max = Math.max(...data.map((d) => d.total_cents), 1);
  // Se dibuja en pixeles reales del contenedor: el texto no se encoge en móvil ni se estira en escritorio.
  const H = 210, top = 26, base = H - 28;
  const w = Math.max(width, data.length * 48);
  const step = w / data.length;
  const bar = Math.min(56, step * 0.56);
  const dense = step < 62;
  return (
    <div ref={box} className="table-wrap">
      {width > 0 && (
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" style={{ display: 'block' }}
          aria-label={`Ingresos por mes: ${data.map((d) => `${monthLabel(d.month)} ${money(d.total_cents)}`).join(', ')}`}>
          <line x1={0} x2={w} y1={base + 0.5} y2={base + 0.5} stroke="rgba(255,255,255,.22)" strokeWidth={1} />
          {data.map((d, i) => {
            const h = d.total_cents > 0 ? Math.max(3, ((base - top) * d.total_cents) / max) : 0;
            const cx = i * step + step / 2;
            return (
              <g key={d.month}>
                <title>{`${monthLabel(d.month)}: ${money(d.total_cents)}`}</title>
                <rect x={i * step} y={0} width={step} height={H} fill="transparent" />
                {h > 0 && <rect x={cx - bar / 2} y={base - h} width={bar} height={h} rx={4} fill="#2e9bff" />}
                <text x={cx} y={base - h - 7} textAnchor="middle" fill="rgba(255,255,255,.9)"
                  style={{ font: `600 ${dense ? 10 : 11.5}px var(--f-mono)` }}>{d.total_cents > 0 ? compact(d.total_cents) : '—'}</text>
                <text x={cx} y={H - 9} textAnchor="middle" fill="rgba(255,255,255,.74)"
                  style={{ font: `600 ${dense ? 9.5 : 10.5}px var(--f-mono)`, letterSpacing: '.06em', textTransform: 'uppercase' }}>{monthShort(d.month)}</text>
              </g>
            );
          })}
        </svg>
      )}
      {width === 0 && <div style={{ height: H }} />}
    </div>
  );
}

/** Tabla mes × (sede | plan) con totales por renglón y por columna. */
function Pivot({ report, by, colLabel }: { report: Report; by: 'location_name' | 'plan_name'; colLabel: string }) {
  const cols = (by === 'location_name' ? report.totals.by_location.map((x) => x.location_name) : report.totals.by_plan.map((x) => x.plan_name));
  const cell = new Map<string, number>();
  for (const r of report.rows) cell.set(`${r.month}|${r[by]}`, (cell.get(`${r.month}|${r[by]}`) ?? 0) + r.total_cents);
  const colTotal = (c: string) => report.rows.filter((r) => r[by] === c).reduce((s, r) => s + r.total_cents, 0);
  const months = [...report.totals.by_month].reverse();
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="sr-only">Ingresos por mes y {colLabel}</caption>
        <thead>
          <tr><th scope="col">Mes</th>{cols.map((c) => <th key={c} scope="col" className="num" style={{ whiteSpace: 'normal', minWidth: 84 }}>{c}</th>)}<th scope="col" className="num">Total</th></tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <th scope="row" style={{ border: 0, borderBottom: '1px solid rgba(255,255,255,.08)', padding: 10, font: '500 13.5px/1.35 var(--f-body)', letterSpacing: 0, textTransform: 'capitalize', color: 'var(--ink)' }}>{monthLabel(m.month)}</th>
              {cols.map((c) => <td key={c} className="num">{cell.has(`${m.month}|${c}`) ? money(cell.get(`${m.month}|${c}`)) : <span className="dim">—</span>}</td>)}
              <td className="num" style={{ fontWeight: 700 }}>{money(m.total_cents)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ fontWeight: 700 }}>Total</td>
            {cols.map((c) => <td key={c} className="num" style={{ fontWeight: 700 }}>{money(colTotal(c))}</td>)}
            <td className="num green" style={{ fontWeight: 700 }}>{money(report.totals.total_cents)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// PAG-10 · Pestaña "Ingresos": totales, gráfica por mes, tablas mes × sede y mes × plan, y exportación CSV.
export function IncomeReport() {
  const current = todayIso().slice(0, 7);
  const [from, setFrom] = useState(shiftMonth(current, -5));
  const [to, setTo] = useState(current);
  const options = useMemo(() => monthRange(shiftMonth(current, -59), current).reverse(), [current]);
  const valid = from <= to;
  const { data, error, mutate } = useApi<Report>(valid ? '/api/billing/report' + qs({ from, to }) : null);
  const t = data?.totals;

  return (
    <div className="stack">
      <div className="hstack wrap" style={{ alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: '1 1 150px', minWidth: 0 }}><Field label="Desde">
          <Select value={from} onChange={(e) => setFrom(e.target.value)} style={{ textTransform: 'capitalize' }}>
            {options.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </Select>
        </Field></div>
        <div style={{ flex: '1 1 150px', minWidth: 0 }}><Field label="Hasta" error={valid ? undefined : 'Debe ser igual o posterior al mes inicial.'}>
          <Select value={to} invalid={!valid} onChange={(e) => setTo(e.target.value)} style={{ textTransform: 'capitalize' }}>
            {options.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </Select>
        </Field></div>
        {valid
          ? <a className="btn" style={{ minHeight: 48, marginTop: 19 }} href={'/api/billing/report' + qs({ from, to, format: 'csv' })} download>Exportar CSV</a>
          : <button type="button" className="btn" style={{ minHeight: 48, marginTop: 19 }} disabled>Exportar CSV</button>}
      </div>

      {!valid ? null : error && !data ? <ErrorNote error={error} retry={() => mutate()} /> : !data || !t ? <Skeleton rows={3} height={90} /> : (
        <>
          <div className="grid-stats">
            <div className="card" style={{ padding: 14 }}>
              <div className="t-label">Ingresos del periodo</div>
              <div className="green" style={{ marginTop: 8, font: '800 24px/1 var(--f-head)' }}>{money(t.total_cents)}</div>
              <div className="t-small" style={{ marginTop: 6 }}>{t.payments} {t.payments === 1 ? 'pago' : 'pagos'} · {data.months.length} {data.months.length === 1 ? 'mes' : 'meses'}</div>
            </div>
            <div className="card" style={{ padding: 14 }}>
              <div className="t-label">Promedio mensual</div>
              <div style={{ marginTop: 8, font: '800 24px/1 var(--f-head)' }}>{money(Math.round(t.total_cents / data.months.length / 100) * 100)}</div>
              <div className="t-small" style={{ marginTop: 6 }}>Pago promedio: {t.payments ? money(Math.round(t.total_cents / t.payments / 100) * 100) : '$—'}</div>
            </div>
            <div className="card" style={{ padding: 14 }}>
              <div className="t-label">Por método</div>
              {t.by_method.length === 0 ? <div className="t-small" style={{ marginTop: 10 }}>Sin pagos en el periodo.</div> : (
                <div className="stack" style={{ gap: 5, marginTop: 8 }}>
                  {t.by_method.map((m) => (
                    <div key={m.method} className="hstack between" style={{ font: '500 13px/1.3 var(--f-body)' }}>
                      <span>{PAYMENT_METHOD_LABEL[m.method] ?? m.method} <span className="dim">· {m.payments}</span></span>
                      <span className="t-mono">{money(m.total_cents)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {t.payments === 0 ? (
            <Empty>No hay pagos registrados en este periodo. Cambia el rango de meses o registra pagos en la pestaña «Estado de pago».</Empty>
          ) : (
            <>
              <Card title="Ingresos por mes"><Bars data={t.by_month} /></Card>
              <div className="grid-2" style={{ alignItems: 'start' }}>
                <Card title="Mes × sede"><Pivot report={data} by="location_name" colLabel="sede" /></Card>
                <Card title="Mes × plan"><Pivot report={data} by="plan_name" colLabel="plan" /></Card>
              </div>
              <div className="t-small">Solo cuentan pagos no anulados. La sede es la del paciente. El CSV incluye también los pagos anulados, marcados en la columna «Estado».</div>
            </>
          )}
        </>
      )}
    </div>
  );
}
