'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Chip, Confirm, Empty, ErrorNote, Notice, Skeleton, useToast } from '@/components/ui';
import { api, ApiError, qs, refresh, useApi } from '@/lib/client';
import { fmtDateTime } from '@/lib/dates';
import { money, PAYMENT_METHOD_LABEL } from '@/lib/format';
import { LINK_STATUS_LABEL } from '@/modules/invoicing/catalogs';
import { shareLink } from './payment-link-sheet';
import type { PaymentLink } from './types';

type List = { items: PaymentLink[]; total: number; counts: Record<string, number> };

const TONE: Record<PaymentLink['status'], 'green' | 'gold' | 'red' | 'blue' | undefined> = {
  open: 'blue', pending_oxxo: 'gold', paid: 'green', needs_review: 'red', expired: undefined, failed: 'red', cancelled: undefined, refunded: undefined,
};
const FILTERS: { key: string; label: string }[] = [
  { key: 'active', label: 'Pendientes' },
  { key: 'paid', label: 'Pagados' },
  { key: 'needs_review', label: 'En revisión' },
  { key: '', label: 'Todos' },
];

// PAG-12 · Mensualidades → Cobros en línea: links generados, su estado y la resolución de los que requieren revisión.
export function OnlineLinks() {
  const toast = useToast();
  const [status, setStatus] = useState('active');
  const { data, error, mutate } = useApi<List>('/api/billing/payment-links' + qs({ status }), { refreshInterval: 15000 });
  const [confirm, setConfirm] = useState<{ link: PaymentLink; action: 'cancel' | 'apply' | 'refund' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (link: PaymentLink, action: 'sync' | 'cancel' | 'apply' | 'refund', note = '') => {
    setBusy(link.id + action);
    try {
      const r = await api.post<{ outcome?: string }>(`/api/billing/payment-links/${link.id}`, action === 'apply' ? { action, note } : { action });
      const msg = action === 'sync' ? (r.outcome === 'paid' ? 'Pago confirmado y registrado' : `Estado actualizado (${LINK_STATUS_LABEL[(r as { link?: PaymentLink }).link?.status ?? ''] ?? 'sin cambios'})`)
        : action === 'cancel' ? 'Link cancelado' : action === 'apply' ? 'Pago aplicado a la membresía vigente' : 'Reembolso solicitado a Stripe';
      toast(msg);
      setConfirm(null);
      refresh('/api/billing', '/api/patients');
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const copy = async (url: string | null) => {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); toast('Link copiado'); } catch { toast('No se pudo copiar el link.', 'error'); }
  };

  const review = data?.counts.needs_review ?? 0;
  return (
    <div className="stack">
      {review > 0 && status !== 'needs_review' && (
        <Notice tone="red">
          {review === 1 ? 'Un pago en línea requiere' : `${review} pagos en línea requieren`} tu revisión: el paciente pagó, pero su membresía cambió
          antes de que llegara el pago.{' '}
          <button type="button" className="btn-link" onClick={() => setStatus('needs_review')}>Ver</button>
        </Notice>
      )}
      <div className="scroll-x" role="group" aria-label="Filtrar links">
        {FILTERS.map((f) => (
          <Chip key={f.key} on={status === f.key} onClick={() => setStatus(f.key)}>
            {f.label}{f.key === 'needs_review' && review ? ` · ${review}` : ''}
          </Chip>
        ))}
      </div>
      {error && !data ? <ErrorNote error={error} retry={() => mutate()} />
        : !data ? <Skeleton rows={3} height={84} />
        : !data.items.length ? (
          <Empty>
            {status === 'active' ? 'No hay links esperando pago. Genera uno desde la membresía del paciente con "Cobrar en línea".'
              : 'No hay links con este filtro.'}
          </Empty>
        ) : (
          <div className="stack sm">
            {data.items.map((l) => (
              <div key={l.id} className="card" style={{ padding: 14 }}>
                <div className="hstack wrap" style={{ gap: 10, alignItems: 'flex-start' }}>
                  <div className="grow" style={{ minWidth: 200 }}>
                    <Link href={`/pacientes/${l.patient_id}?tab=membresia`} className="t-name ellipsis" style={{ display: 'block', color: 'var(--ink)' }}>
                      {l.patient_name}
                    </Link>
                    <div className="t-sub" style={{ marginTop: 3 }}>
                      {l.plan_name} · {l.methods.map((m) => (m === 'card' ? 'Tarjeta' : 'OXXO')).join(' u ')}
                    </div>
                  </div>
                  <span className="t-mono" style={{ fontSize: 15 }}>{money(l.amount_cents)}</span>
                  <Badge tone={TONE[l.status]}>{LINK_STATUS_LABEL[l.status]}</Badge>
                </div>
                <div className="t-small" style={{ marginTop: 8, lineHeight: 1.45 }}>
                  Generado {fmtDateTime(l.created_at)} por {l.created_by_name || '—'}
                  {l.status === 'open' && ` · vence ${fmtDateTime(l.expires_at)}`}
                  {l.status === 'paid' && l.paid_at && ` · pagado ${fmtDateTime(l.paid_at)} (${PAYMENT_METHOD_LABEL[l.paid_method ?? 'online_card']})${l.receipt_number ? ` · recibo ${l.receipt_number}` : ''}`}
                </div>
                {l.status === 'needs_review' && l.review_reason && (
                  <div className="t-small red" style={{ marginTop: 6 }}>Motivo: {l.review_reason}</div>
                )}
                <div className="hstack wrap" style={{ marginTop: 10, gap: 8 }}>
                  {l.status === 'open' && <>
                    <Button size="sm" onClick={() => copy(l.url)}>Copiar link</Button>
                    <a className="btn sm" href={shareLink(l.patient_name ?? '', l)} target="_blank" rel="noopener">WhatsApp</a>
                    <Button size="sm" variant="danger" onClick={() => setConfirm({ link: l, action: 'cancel' })}>Cancelar</Button>
                  </>}
                  {l.status === 'needs_review' && <>
                    <Button size="sm" variant="primary" onClick={() => setConfirm({ link: l, action: 'apply' })}>Aplicar al plan vigente</Button>
                    <Button size="sm" variant="danger" onClick={() => setConfirm({ link: l, action: 'refund' })}>Reembolsar</Button>
                  </>}
                  {['open', 'pending_oxxo', 'expired'].includes(l.status) && (
                    <Button size="sm" loading={busy === l.id + 'sync'} onClick={() => act(l, 'sync')}>Consultar a Stripe</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      <Confirm open={confirm?.action === 'cancel'} onClose={() => setConfirm(null)} danger confirmLabel="Cancelar link"
        title="Cancelar link de pago" onConfirm={async () => { if (confirm) await act(confirm.link, 'cancel'); }}
        message={confirm ? `El link de ${money(confirm.link.amount_cents)} para ${confirm.link.patient_name} dejará de aceptar pagos.` : ''} />
      <Confirm open={confirm?.action === 'apply'} onClose={() => setConfirm(null)} confirmLabel="Aplicar pago" reason="optional" reasonLabel="Nota"
        title="Aplicar pago en línea" onConfirm={async (note) => { if (confirm) await act(confirm.link, 'apply', note); }}
        message={confirm ? `Se registrará el pago de ${money(confirm.link.amount_cents)} en la membresía que ${confirm.link.patient_name} tiene hoy, como si se hubiera capturado a mano.` : ''} />
      <Confirm open={confirm?.action === 'refund'} onClose={() => setConfirm(null)} danger confirmLabel="Reembolsar"
        title="Reembolsar pago en línea" onConfirm={async () => { if (confirm) await act(confirm.link, 'refund'); }}
        message={confirm ? `Stripe devolverá ${money(confirm.link.amount_cents)} a ${confirm.link.patient_name}. Con tarjeta tarda de 5 a 10 días hábiles; un pago de OXXO se devuelve según indique Stripe al paciente por correo.` : ''} />
    </div>
  );
}
