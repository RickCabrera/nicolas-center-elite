'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, Button, Chip, Empty, ErrorNote, Field, Input, Notice, Select, Sheet, Skeleton, useToast } from '@/components/ui';
import { api, ApiError, qs, refresh, useApi } from '@/lib/client';
import { fmtDateTime, todayIso } from '@/lib/dates';
import { money } from '@/lib/format';
import type { Invoice } from '@/modules/billing/types';
import { CANCEL_MOTIVES, formLabel, INVOICE_STATUS_LABEL } from './catalogs';
import { invoiceFileUrl } from './invoice-sheet';

type List = { items: Invoice[]; total: number; total_cents: number };
type Preview = {
  year: number; month: number; zip_configured: boolean;
  groups: { payment_form: string; payments: number; total_cents: number }[];
  issued: { id: string; series: string; folio_number: number | null; status: string; total_cents: number; payment_form: string }[];
};
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const folio = (i: { series: string; folio_number: number | null }) => `${i.series}${i.folio_number ?? ''}` || 'Sin folio';

function statusBadge(i: Invoice) {
  if (i.status === 'valid' && i.cancellation_status === 'pending') return <Badge tone="gold">Cancelación en proceso</Badge>;
  const tone = i.status === 'valid' ? 'green' : i.status === 'canceled' ? 'red' : 'gold';
  return <Badge tone={tone}>{INVOICE_STATUS_LABEL[i.status]}</Badge>;
}

// FAC-03 · Factura global del mes (a PÚBLICO EN GENERAL), una por forma de pago.
function GlobalSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const today = todayIso();
  // Por defecto, el mes anterior: el SAT pide emitir la global dentro de las 72 horas siguientes al cierre del periodo.
  const [y, m] = today.split('-').map(Number);
  const [year, setYear] = useState(m === 1 ? y - 1 : y);
  const [month, setMonth] = useState(m === 1 ? 12 : m - 1);
  const { data, error, mutate } = useApi<Preview>(open ? `/api/invoices/global${qs({ year, month })}` : null);
  const [busy, setBusy] = useState('');
  useEffect(() => { if (open) setBusy(''); }, [open]);

  const issue = async (form: string) => {
    setBusy(form);
    try {
      const r = await api.post<{ invoice: Invoice; payments: number }>('/api/invoices/global', { year, month, payment_form: form });
      toast(`Factura global ${folio(r.invoice)} timbrada (${r.payments} pagos)`);
      mutate();
      refresh('/api/invoices', '/api/billing');
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Factura global del mes" footer={<Button onClick={onClose}>Cerrar</Button>}>
      <div className="stack md">
        <div className="t-small" style={{ lineHeight: 1.45 }}>
          Incluye los pagos del mes que no se facturaron a nombre de un paciente, a PÚBLICO EN GENERAL (XAXX010101000).
          Se emite una por forma de pago y debe timbrarse dentro de las 72 horas siguientes al cierre del mes.
        </div>
        <div className="grid-form">
          <Field label="Mes">
            <Select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTHS.map((n, i) => <option key={n} value={i + 1}>{n[0].toUpperCase() + n.slice(1)}</option>)}
            </Select>
          </Field>
          <Field label="Año">
            <Input inputMode="numeric" value={year} maxLength={4} onChange={(e) => setYear(Number(e.target.value.replace(/\D/g, '')) || y)} />
          </Field>
        </div>
        {error && !data ? <ErrorNote error={error} retry={() => mutate()} /> : !data ? <Skeleton rows={2} /> : (
          <>
            {!data.zip_configured && (
              <Notice tone="gold">Falta el código postal del lugar de expedición: Configuración → Cobros y facturación.</Notice>
            )}
            {!data.groups.length ? <Empty>No hay pagos pendientes de facturar en {MONTHS[month - 1]} de {year}.</Empty> : (
              <div className="stack sm">
                {data.groups.map((g) => (
                  <div key={g.payment_form} className="row" style={{ flexWrap: 'wrap', rowGap: 8 }}>
                    <div className="grow" style={{ minWidth: 160 }}>
                      <div className="t-strong">{g.payment_form} · {formLabel(g.payment_form)}</div>
                      <div className="t-small">{g.payments} {g.payments === 1 ? 'pago' : 'pagos'}</div>
                    </div>
                    <span className="t-mono">{money(g.total_cents)}</span>
                    <Button size="sm" variant="primary" loading={busy === g.payment_form} disabled={!!busy || !data.zip_configured}
                      onClick={() => issue(g.payment_form)}>Timbrar</Button>
                  </div>
                ))}
              </div>
            )}
            {data.issued.length > 0 && (
              <div className="t-small">
                Ya emitidas para este mes: {data.issued.map((i) => `${folio(i)} (${formLabel(i.payment_form)}, ${money(i.total_cents)}${i.status === 'canceled' ? ', cancelada' : ''})`).join(' · ')}
              </div>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

// FAC-04 · Cancelar una factura con motivo SAT.
function CancelSheet({ invoice, others, onClose }: { invoice: Invoice | null; others: Invoice[]; onClose: () => void }) {
  const toast = useToast();
  const [motive, setMotive] = useState<'01' | '02' | '03' | '04'>('02');
  const [substitution, setSubstitution] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (invoice) { setMotive('02'); setSubstitution(''); setBusy(false); } }, [invoice]);
  const candidates = others.filter((o) => invoice && o.id !== invoice.id && o.status === 'valid');

  const go = async () => {
    if (!invoice) return;
    setBusy(true);
    try {
      const r = await api.post<{ invoice: Invoice }>(`/api/invoices/${invoice.id}`, { action: 'cancel', motive, substitution_id: motive === '01' ? substitution || undefined : undefined });
      toast(r.invoice.status === 'canceled' ? `Factura ${folio(invoice)} cancelada` : 'Cancelación enviada: el receptor debe aceptarla. Se revisa sola cada día.');
      refresh('/api/invoices', '/api/billing');
      onClose();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const help = CANCEL_MOTIVES.find((c) => c.code === motive)?.help;
  return (
    <Sheet open={!!invoice} onClose={onClose} title={`Cancelar factura ${invoice ? folio(invoice) : ''}`}
      footer={<>
        <Button onClick={onClose}>Volver</Button>
        <Button variant="danger" loading={busy} disabled={motive === '01' && !substitution} onClick={go}>Cancelar ante el SAT</Button>
      </>}>
      <div className="stack md">
        <div className="t-body">
          Se cancelará la factura de {invoice ? money(invoice.total_cents) : ''} a {invoice?.customer.legal_name}. Sus pagos quedan libres para
          volver a facturarse o anularse. Facturas mayores a $1,000 pueden requerir que el receptor acepte la cancelación en el portal del SAT.
        </div>
        <Field label="Motivo" hint={help}>
          <Select value={motive} onChange={(e) => setMotive(e.target.value as typeof motive)}>
            {CANCEL_MOTIVES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </Select>
        </Field>
        {motive === '01' && (
          <Field label="Factura que la sustituye">
            <Select value={substitution} onChange={(e) => setSubstitution(e.target.value)}>
              <option value="">Elige…</option>
              {candidates.map((o) => <option key={o.id} value={o.id}>{folio(o)} · {o.customer.legal_name} · {money(o.total_cents)}</option>)}
            </Select>
          </Field>
        )}
      </div>
    </Sheet>
  );
}

// FAC-06 · Mensualidades → Facturas.
export function InvoicesTab() {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const { data, error, mutate } = useApi<List>('/api/invoices' + qs({ status, kind }));
  const [global, setGlobal] = useState(false);
  const [canceling, setCanceling] = useState<Invoice | null>(null);
  const [busy, setBusy] = useState('');

  const act = async (i: Invoice, action: 'refresh' | 'email') => {
    setBusy(i.id + action);
    try {
      if (action === 'email') {
        const r = await api.post<{ sent_to: string }>(`/api/invoices/${i.id}`, { action });
        toast(`Factura enviada a ${r.sent_to}`);
      } else {
        await api.post(`/api/invoices/${i.id}`, { action });
        toast('Estado actualizado');
        refresh('/api/invoices', '/api/billing');
      }
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="stack">
      <div className="hstack wrap between">
        <div className="scroll-x" role="group" aria-label="Filtrar facturas" style={{ flex: 1, minWidth: 0 }}>
          <Chip on={!status && !kind} onClick={() => { setStatus(''); setKind(''); }}>Todas</Chip>
          <Chip on={status === 'valid'} onClick={() => setStatus(status === 'valid' ? '' : 'valid')}>Vigentes</Chip>
          <Chip on={status === 'canceled'} onClick={() => setStatus(status === 'canceled' ? '' : 'canceled')}>Canceladas</Chip>
          <Chip square on={kind === 'global'} onClick={() => setKind(kind === 'global' ? '' : 'global')}>Globales</Chip>
        </div>
        <Button variant="primary" onClick={() => setGlobal(true)}>Factura global</Button>
      </div>
      {data && data.total > 0 && (
        <div className="t-small">{data.total} {data.total === 1 ? 'factura' : 'facturas'} · vigentes por {money(data.total_cents)}</div>
      )}
      {error && !data ? <ErrorNote error={error} retry={() => mutate()} />
        : !data ? <Skeleton rows={3} height={84} />
        : !data.items.length ? (
          <Empty>Aún no hay facturas. Factura un pago desde la membresía del paciente (botón «Facturar» en su historial de pagos) o emite la global del mes.</Empty>
        ) : (
          <div className="stack sm">
            {data.items.map((i) => (
              <div key={i.id} className="card" style={{ padding: 14 }}>
                <div className="hstack wrap" style={{ gap: 10, alignItems: 'flex-start' }}>
                  <div className="grow" style={{ minWidth: 200 }}>
                    <div className="t-name ellipsis">
                      {folio(i)} · {i.kind === 'global' ? `Global ${MONTHS[Number(i.global_period?.months ?? 1) - 1]} ${i.global_period?.year ?? ''}` : i.customer.legal_name}
                    </div>
                    <div className="t-sub" style={{ marginTop: 3, overflowWrap: 'anywhere' }}>
                      {i.customer.tax_id} · {formLabel(i.payment_form)} · {fmtDateTime(i.created_at)}
                      {i.patient_id && <> · <Link href={`/pacientes/${i.patient_id}?tab=membresia`}>{i.patient_name}</Link></>}
                    </div>
                  </div>
                  <span className="t-mono" style={{ fontSize: 15 }}>{money(i.total_cents)}</span>
                  {statusBadge(i)}
                  {!i.livemode && <Badge>Prueba</Badge>}
                </div>
                <div className="t-small" style={{ marginTop: 8, overflowWrap: 'anywhere' }}>
                  UUID {i.uuid ?? '—'} · {i.payments.length} {i.payments.length === 1 ? 'recibo' : 'recibos'}
                  {i.payments.length <= 4 && `: ${i.payments.map((p) => p.receipt_number).join(', ')}`}
                </div>
                {i.status !== 'pending' && i.status !== 'error' && (
                  <div className="hstack wrap" style={{ marginTop: 10, gap: 8 }}>
                    <a className="btn sm" href={invoiceFileUrl(i.id, 'pdf')} target="_blank" rel="noopener">PDF</a>
                    <a className="btn sm" href={invoiceFileUrl(i.id, 'xml')}>XML</a>
                    {i.status === 'valid' && i.kind === 'individual' && (
                      <Button size="sm" loading={busy === i.id + 'email'} onClick={() => act(i, 'email')}>Reenviar por correo</Button>
                    )}
                    {i.cancellation_status === 'pending' && (
                      <Button size="sm" loading={busy === i.id + 'refresh'} onClick={() => act(i, 'refresh')}>Consultar cancelación</Button>
                    )}
                    {i.status === 'valid' && i.cancellation_status !== 'pending' && (
                      <Button size="sm" variant="danger" onClick={() => setCanceling(i)}>Cancelar</Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      <GlobalSheet open={global} onClose={() => setGlobal(false)} />
      <CancelSheet invoice={canceling} others={data?.items ?? []} onClose={() => setCanceling(null)} />
    </div>
  );
}
