'use client';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, KV, Select, Sheet, Skeleton } from '@/components/ui';
import { qs, useApi } from '@/lib/client';
import { addDays, fmtDate, fmtDateTime, fmtTime, todayIso } from '@/lib/dates';
import { ACTION_TONE, actionLabel, fieldLabel, fieldValue, TABLE_LABEL, tableLabel } from './audit-labels';
import type { AuditDetail, AuditFacets, AuditItem } from './types';

const PAGE = 50;
const HIDDEN = ['updated_at'];

/** "Paciente Regina Solís" · "Sede Xalapa" · "Cita de Regina Solís" */
function subject(it: Pick<AuditItem, 'table_name' | 'patient_name' | 'row_label'>): string {
  const one = TABLE_LABEL[it.table_name]?.one ?? '';
  if (it.table_name === 'patients') return `${one} ${it.patient_name ?? it.row_label ?? ''}`.trim();
  if (it.table_name === 'clinic') return one;
  const label = it.row_label && it.row_label !== it.patient_name ? ` ${it.row_label}` : '';
  const of = it.patient_name ? ` de ${it.patient_name}` : '';
  return `${one}${label}${of}`.trim();
}
function detailLine(it: AuditItem): string {
  if (it.summary) return it.summary;
  if (it.action === 'update') return it.changed.length ? it.changed.map(fieldLabel).join(', ') : 'sin cambios visibles';
  return '';
}

function EventSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, error, mutate } = useApi<AuditDetail>(id ? `/api/audit?id=${id}` : null, { keepPreviousData: false });
  const before = data?.before ?? null;
  const after = data?.after ?? null;
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter((k) => !HIDDEN.includes(k));
  const changedKeys = before && after ? keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])) : keys;
  const cell = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as const;

  return (
    <Sheet open={!!id} onClose={onClose} title="Detalle del evento" wide>
      {error && !data ? <ErrorNote error={error} retry={() => mutate()} />
        : !data ? <Skeleton rows={4} />
        : (
          <div className="stack md">
            <div className="grid-kv">
              <KV label="Fecha y hora">{fmtDateTime(data.at)} h</KV>
              <KV label="Quién">{data.actor_name}</KV>
              <KV label="Qué hizo">{actionLabel(data.action)}</KV>
              <KV label="Dónde">{tableLabel(data.table_name)}</KV>
              {data.patient_name && <KV label="Paciente">{data.patient_name}</KV>}
            </div>
            {data.summary && <div className="notice">{data.summary}</div>}
            {before && after ? (
              changedKeys.length === 0 ? <Empty>El registro se guardó sin cambios visibles.</Empty> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Campo</th><th>Antes</th><th>Después</th></tr></thead>
                    <tbody>
                      {changedKeys.map((k) => (
                        <tr key={k}>
                          <td className="t-strong" style={{ minWidth: 120 }}>{fieldLabel(k)}</td>
                          <td style={{ ...cell, color: 'var(--ink-3)', minWidth: 140 }}>{fieldValue(k, before[k])}</td>
                          <td style={{ ...cell, minWidth: 140 }}>{fieldValue(k, after[k])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (after ?? before) ? (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Campo</th><th>{after ? 'Valor registrado' : 'Valor eliminado'}</th></tr></thead>
                  <tbody>
                    {keys.filter((k) => fieldValue(k, (after ?? before)![k]) !== '—').map((k) => (
                      <tr key={k}>
                        <td className="t-strong" style={{ minWidth: 120 }}>{fieldLabel(k)}</td>
                        <td style={cell}>{fieldValue(k, (after ?? before)![k])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : !data.summary ? <Empty>Este evento no guarda más detalle.</Empty> : null}
            {before && after && <p className="t-small">Solo se muestran los campos que cambiaron. La bitácora no se puede editar ni borrar.</p>}
          </div>
        )}
    </Sheet>
  );
}

// CFG-09 · Bitácora de auditoría: quién hizo qué, cuándo y sobre qué registro.
export function AuditTab() {
  const today = todayIso();
  const [f, setF] = useState({ from: addDays(today, -7), to: today, actor_id: '', action: '', table: '', q: '' });
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => { setF((s) => ({ ...s, [k]: v })); setOffset(0); };
  useEffect(() => {
    const t = setTimeout(() => set('q', q.trim()), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const { data: facets } = useApi<AuditFacets>('/api/audit?facets=1', { revalidateOnFocus: false });
  const { data, error, isLoading, mutate } = useApi<{ items: AuditItem[]; total: number }>(`/api/audit${qs({ ...f, limit: PAGE, offset })}`);
  const filtered = !!(f.actor_id || f.action || f.table || f.q);

  return (
    <div className="stack">
      <Card title="Bitácora de auditoría" blue>
        <div className="grid-form">
          <Field label="Desde"><Input type="date" value={f.from} max={f.to || today} onChange={(e) => set('from', e.target.value)} /></Field>
          <Field label="Hasta"><Input type="date" value={f.to} min={f.from} max={today} onChange={(e) => set('to', e.target.value)} /></Field>
          <Field label="Quién">
            <Select value={f.actor_id} onChange={(e) => set('actor_id', e.target.value)}>
              <option value="">Todos</option>
              {facets?.actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Qué hizo">
            <Select value={f.action} onChange={(e) => set('action', e.target.value)}>
              <option value="">Todo</option>
              {facets?.actions.map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
            </Select>
          </Field>
          <Field label="Dónde">
            <Select value={f.table} onChange={(e) => set('table', e.target.value)}>
              <option value="">Todas las secciones</option>
              {facets?.tables.map((t) => ({ t, label: tableLabel(t) })).sort((a, b) => a.label.localeCompare(b.label, 'es')).map(({ t, label }) => <option key={t} value={t}>{label}</option>)}
            </Select>
          </Field>
          <Field label="Buscar">
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Paciente, usuario o folio" />
          </Field>
        </div>
      </Card>

      {error && !data ? <ErrorNote error={error} retry={() => mutate()} />
        : !data ? <Skeleton rows={8} />
        : data.items.length === 0 ? (
          <Empty>
            No hay eventos {filtered ? 'con esos filtros' : 'en esas fechas'}. {f.from || f.to ? `Periodo: ${f.from ? fmtDate(f.from) : 'inicio'} a ${f.to ? fmtDate(f.to) : 'hoy'}. ` : ''}
            Amplía el rango de fechas o quita filtros.
          </Empty>
        ) : (
          <>
            <div className="stack sm" style={{ opacity: isLoading ? 0.6 : 1 }}>
              {data.items.map((it) => {
                const detail = detailLine(it);
                const subj = it.summary ? '' : subject(it);
                return (
                  <button key={it.id} type="button" className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 6 }} onClick={() => setOpen(it.id)}>
                    <span className="t-mono dim" style={{ flex: 'none', width: 112, lineHeight: 1.5, fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {fmtDate(it.at).slice(0, 5)} · {fmtTime(it.at)}
                    </span>
                    <span className="grow" style={{ flexBasis: 220 }}>
                      <span className="t-strong" style={{ display: 'block', lineHeight: 1.35, overflowWrap: 'anywhere' }}>
                        {it.actor_name}<span className="dim" style={{ fontWeight: 400 }}> · {actionLabel(it.action)}{subj ? ' · ' : ''}</span>{subj}
                      </span>
                      {detail && <span className="t-small" style={{ display: 'block', marginTop: 4, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{detail}</span>}
                    </span>
                    <Badge tone={ACTION_TONE[it.action]}>{tableLabel(it.table_name)}</Badge>
                  </button>
                );
              })}
            </div>
            <div className="hstack between wrap">
              <span className="t-small">
                {(offset + 1).toLocaleString('es-MX')}–{Math.min(offset + PAGE, data.total).toLocaleString('es-MX')} de {data.total.toLocaleString('es-MX')} eventos
              </span>
              <div className="hstack">
                <Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Anteriores</Button>
                <Button size="sm" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Siguientes</Button>
              </div>
            </div>
          </>
        )}
      <EventSheet id={open} onClose={() => setOpen(null)} />
    </div>
  );
}
