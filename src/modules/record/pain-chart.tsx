'use client';
import { useEffect, useRef, useState } from 'react';
import { fmtDate } from '@/lib/dates';

export type PainPoint = { at: string; value: number };

/**
 * EXP-05 · Evolución del dolor (0-10) por sesión. SVG propio dibujado al ancho real del contenedor para
 * que los números se lean igual en celular y escritorio. Cada punto lleva su valor encima y su fecha abajo.
 */
export function PainChart({ points }: { points: PainPoint[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = 176, left = 30, right = 18, top = 24, bottom = 30;
  const max = Math.max(2, Math.floor((width - left - right) / 30) + 1);
  const shown = points.slice(-max); // si no caben todas, se muestran las sesiones más recientes
  const innerW = Math.max(width - left - right, 1), innerH = H - top - bottom;
  const x = (i: number) => left + (shown.length === 1 ? innerW / 2 : (i * innerW) / (shown.length - 1));
  const y = (v: number) => top + innerH - (v / 10) * innerH;
  const step = shown.length > 1 ? innerW / (shown.length - 1) : innerW;
  const every = Math.max(1, Math.ceil(46 / step));
  const short = (iso: string) => fmtDate(iso).slice(0, 5);
  const label = `Evolución del dolor en ${shown.length} sesiones: ` + shown.map((p) => `${fmtDate(p.at)}, ${p.value} de 10`).join('; ') + '.';
  const first = shown[0], last = shown[shown.length - 1];
  const delta = last.value - first.value;

  return (
    <div>
      <div ref={box} style={{ width: '100%', minWidth: 0 }}>
        {width > 0 && (
          <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={label} style={{ display: 'block' }}>
            {[0, 5, 10].map((v) => (
              <g key={v}>
                <line x1={left} x2={width - right} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,.14)" strokeWidth={1} strokeDasharray={v === 0 ? undefined : '3 5'} />
                <text x={left - 8} y={y(v) + 3.5} textAnchor="end" style={{ font: '600 10px var(--f-mono)', fill: 'var(--ink-4)' }}>{v}</text>
              </g>
            ))}
            <polyline fill="none" stroke="var(--blue)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
              points={shown.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} />
            {shown.map((p, i) => (
              <g key={i}>
                <circle cx={x(i)} cy={y(p.value)} r={4.5} fill="var(--blue)" stroke="#0b0f17" strokeWidth={2} />
                <text x={x(i)} y={y(p.value) - 10} textAnchor="middle" style={{ font: '700 11px var(--f-mono)', fill: 'var(--ink)' }}>{p.value}</text>
                {(i % every === 0 || i === shown.length - 1) && (i === shown.length - 1 || (shown.length - 1 - i) * step >= 40) && (
                  <text x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === shown.length - 1 ? 'end' : 'middle'} dx={i === 0 ? -6 : i === shown.length - 1 ? 8 : 0}
                    style={{ font: '500 10px var(--f-mono)', fill: 'var(--ink-4)' }}>{short(p.at)}</text>
                )}
              </g>
            ))}
          </svg>
        )}
      </div>
      <div className="t-small" style={{ marginTop: 6 }}>
        {delta === 0 ? `Sin cambio: ${last.value}/10` : `${delta < 0 ? 'Bajó' : 'Subió'} de ${first.value}/10 a ${last.value}/10`}
        {' '}entre el {fmtDate(first.at)} y el {fmtDate(last.at)}
        {points.length > shown.length ? ` (últimas ${shown.length} de ${points.length} sesiones con dolor registrado)` : ''}.
      </div>
    </div>
  );
}
