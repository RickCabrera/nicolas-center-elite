'use client';
import { useState } from 'react';
import { Badge, BillingBadge, Button, Card, Checkbox, Confirm, Empty, ErrorNote, Field, KV, Notice, Sheet, Skeleton, Textarea, useToast } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { api, ApiError, refresh, useApi } from '@/lib/client';
import { fmtDate } from '@/lib/dates';
import { money, PAYMENT_METHOD_LABEL, PLAN_KIND_LABEL } from '@/lib/format';
import { InvoiceSheet, invoiceFileUrl } from '@/modules/invoicing/invoice-sheet';
import { PaymentLinkSheet } from './payment-link-sheet';
import { PaymentSheet, receiptUrl } from './payment-sheet';
import { PlanPickerSheet } from './plan-picker-sheet';
import type { MembershipDetail, Payment } from './types';

// PAG-02 · Membresía dentro del expediente. Dueño: pagos y acciones. Fisioterapeuta: solo plan y estado.
export function MembershipPanel({ patientId }: { patientId: string }) {
  const user = useUser();
  const toast = useToast();
  const { data, error, mutate } = useApi<MembershipDetail>(`/api/billing/memberships/${patientId}`);
  const [paying, setPaying] = useState(false);
  const [picker, setPicker] = useState<'assign' | 'change_plan' | null>(null);
  const [confirm, setConfirm] = useState<'pause' | 'resume' | null>(null);
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const [linking, setLinking] = useState(false);
  const [invoicing, setInvoicing] = useState<string | null>(null);

  if (error && !data) return <ErrorNote error={error} retry={() => mutate()} />;
  if (!data) return <Skeleton rows={2} height={90} />;

  const m = data.membership;
  const name = data.patient.full_name;
  const owner = user.isOwner;

  const act = async (action: 'pause' | 'resume') => {
    try {
      await api.patch(`/api/billing/memberships/${patientId}`, { action });
      toast(action === 'pause' ? `Membresía en pausa · ${name}` : `Membresía reanudada · ${name}`);
      refresh('/api/billing', '/api/patients');
      setConfirm(null);
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };
  const doVoid = async (reason: string, refund = false) => {
    if (!voiding) return;
    try {
      const r = await api.post<{ reverted: boolean; refund_id: string | null }>(`/api/billing/payments/${voiding.id}/void`, { reason, refund });
      const extra = r.refund_id ? ' y se pidió el reembolso a Stripe' : '';
      toast(r.reverted ? `Pago ${voiding.receipt_number} anulado${extra}` : `Pago ${voiding.receipt_number} anulado${extra}. Era de un plan anterior: la fecha del plan actual no cambió.`);
      refresh('/api/billing', '/api/patients');
      setVoiding(null);
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  return (
    <div className="stack">
      <Card title="Membresía" blue action={<BillingBadge state={data.state} />}>
        {!m ? (
          <div className="stack md">
            <Empty>Sin membresía. {owner ? 'Asigna un plan para llevar el control de sus pagos.' : 'El dueño de la clínica asigna el plan.'}</Empty>
            {owner && <Button variant="primary" style={{ alignSelf: 'flex-start' }} onClick={() => setPicker('assign')}>Asignar plan</Button>}
          </div>
        ) : (
          <div className="stack md">
            <div className="grid-kv">
              <KV label="Plan">{m.plan_name}{m.plan_active === false ? ' (plan inactivo)' : ''}</KV>
              <KV label="Tipo">{PLAN_KIND_LABEL[m.plan_kind ?? ''] ?? '—'}</KV>
              <KV label="Precio" tone="gold">{money(m.price_cents)}</KV>
              {m.plan_kind === 'package' && <KV label="Sesiones restantes">{m.sessions_remaining ?? 0} de {m.sessions_count ?? '—'}</KV>}
              <KV label={m.plan_kind === 'package' ? 'Vigencia' : 'Próximo pago'}>{fmtDate(m.next_due_date)}</KV>
              <KV label="Desde">{fmtDate(m.started_on)}</KV>
            </div>
            {m.membership_status === 'paused' && (
              <Notice tone="gold">En pausa desde el {fmtDate(m.paused_on)}. Al reanudar, el vencimiento se recorre los días que duró la pausa.</Notice>
            )}
            {owner && (
              <div className="hstack wrap">
                {m.membership_status === 'paused'
                  ? <Button variant="primary" onClick={() => setConfirm('resume')}>Reanudar</Button>
                  : <>
                      <Button variant="primary" onClick={() => setPaying(true)}>Registrar pago</Button>
                      <Button onClick={() => setLinking(true)}>Cobrar en línea</Button>
                      <Button onClick={() => setPicker('change_plan')}>Cambiar plan</Button>
                      <Button onClick={() => setConfirm('pause')}>Pausar</Button>
                    </>}
              </div>
            )}
          </div>
        )}
      </Card>

      {owner && (
        <Card title="Historial de pagos">
          {!data.payments?.length ? <Empty>Aún no hay pagos registrados para este paciente.</Empty> : (
            <div className="stack sm">
              {data.payments.map((p) => {
                const voided = !!p.voided_at;
                return (
                  <div key={p.id} className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-start', rowGap: 8 }}>
                    <div className="grow" style={{ minWidth: 180, opacity: voided ? 0.72 : 1 }}>
                      <div className="t-strong" style={{ textDecoration: voided ? 'line-through' : undefined }}>
                        {fmtDate(p.paid_on)} · {p.plan_name}
                      </div>
                      <div className="t-small" style={{ marginTop: 3, overflowWrap: 'anywhere' }}>
                        {PAYMENT_METHOD_LABEL[p.method]}{p.reference ? ` · Ref. ${p.reference}` : ''} · Registró {p.recorded_by_name || '—'}
                      </div>
                      {p.note && <div className="t-small" style={{ marginTop: 3, overflowWrap: 'anywhere' }}>Nota: {p.note}</div>}
                      {p.invoice_folio && !voided && (
                        <div className="t-small" style={{ marginTop: 5 }}>
                          <Badge tone="blue">Facturado {p.invoice_folio}</Badge>{' '}
                          <a href={invoiceFileUrl(p.invoice_id!, 'pdf')} target="_blank" rel="noopener" className="btn-link">PDF</a>
                        </div>
                      )}
                      {voided && (
                        <div className="t-small red" style={{ marginTop: 3, overflowWrap: 'anywhere' }}>
                          Anulado el {fmtDate(p.voided_at)}{p.voided_by_name ? ` por ${p.voided_by_name}` : ''}: {p.void_reason}
                        </div>
                      )}
                    </div>
                    <div className="hstack" style={{ gap: 10, marginLeft: 'auto' }}>
                      <span className={`t-mono ${voided ? 'dim' : 'green'}`} style={{ fontSize: 14, textDecoration: voided ? 'line-through' : undefined }}>{money(p.amount_cents)}</span>
                      <a className="btn sm" href={receiptUrl(p.id)} target="_blank" rel="noopener" aria-label={`Recibo ${p.receipt_number} en PDF`}>{p.receipt_number}</a>
                      {!voided && !p.invoice_id && p.amount_cents > 0 && <Button size="sm" onClick={() => setInvoicing(p.id)}>Facturar</Button>}
                      {p.voidable && <Button size="sm" variant="danger" onClick={() => setVoiding(p)}
                        title={p.invoice_id ? 'Cancela primero la factura de este pago' : undefined}>Anular</Button>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {data.history.length > 0 && (
        <Card title="Planes anteriores">
          <div className="stack sm">
            {data.history.map((h) => (
              <div key={h.id} className="row">
                <div className="grow t-strong ellipsis">{h.plan_name}</div>
                <span className="t-small">{fmtDate(h.started_on)} – {fmtDate(h.ended_on)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {owner && (
        <>
          <PaymentSheet open={paying} onClose={() => setPaying(false)} patientId={patientId} patientName={name} billing={m} />
          <PaymentLinkSheet open={linking} onClose={() => setLinking(false)} patientId={patientId} patientName={name} phone={data.patient.phone} billing={m} />
          <InvoiceSheet open={!!invoicing} onClose={() => setInvoicing(null)} patientId={patientId} patientName={name}
            payments={data.payments ?? []} preselect={invoicing ?? undefined} />
          <PlanPickerSheet open={!!picker} onClose={() => setPicker(null)} patientId={patientId} patientName={name}
            mode={picker ?? 'assign'} currentPlanId={m?.plan_id} />
          <Confirm open={confirm === 'pause'} onClose={() => setConfirm(null)} onConfirm={() => act('pause')} title="Pausar membresía"
            confirmLabel="Pausar" message={`La membresía de ${name} deja de contar días. Al reanudarla, el vencimiento se recorre lo que haya durado la pausa.`} />
          <Confirm open={confirm === 'resume'} onClose={() => setConfirm(null)} onConfirm={() => act('resume')} title="Reanudar membresía"
            confirmLabel="Reanudar" message={`La membresía de ${name} vuelve a estar activa y su vencimiento se recorre los días que estuvo en pausa.`} />
          <VoidOnlineSheet payment={voiding?.refundable ? voiding : null} onClose={() => setVoiding(null)} onConfirm={doVoid} />
          <Confirm open={!!voiding && !voiding.refundable} onClose={() => setVoiding(null)} onConfirm={(r) => doVoid(r)} danger reason="required" reasonLabel="Motivo de la anulación"
            title={`Anular pago ${voiding?.receipt_number ?? ''}`} confirmLabel="Anular pago"
            message={voiding ? `Se anulará el pago de ${money(voiding.amount_cents)} del ${fmtDate(voiding.paid_on)} y la membresía regresará a como estaba antes de ese pago. El recibo queda marcado como anulado; no se borra.` : ''} />
        </>
      )}
    </div>
  );
}

// PAG-05 · PAG-12 · Anular un pago cobrado en línea: además se puede devolver el dinero por Stripe.
function VoidOnlineSheet({ payment, onClose, onConfirm }: {
  payment: Payment | null; onClose: () => void; onConfirm: (reason: string, refund: boolean) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState(true);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  if (payment && key !== payment.id) { setKey(payment.id); setReason(''); setRefund(true); }
  const go = async () => {
    setBusy(true);
    try { await onConfirm(reason.trim(), refund); } finally { setBusy(false); }
  };
  return (
    <Sheet open={!!payment} onClose={onClose} title={`Anular pago ${payment?.receipt_number ?? ''}`}
      footer={<>
        <Button onClick={onClose}>Volver</Button>
        <Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={go}>{refund ? 'Anular y reembolsar' : 'Anular pago'}</Button>
      </>}>
      {payment && (
        <div className="stack md">
          <div className="t-body">
            Este pago de {money(payment.amount_cents)} se cobró en línea ({PAYMENT_METHOD_LABEL[payment.method]}). La membresía regresará a como
            estaba antes del pago y el recibo queda marcado como anulado.
          </div>
          <Checkbox label="Devolver también el dinero al paciente por Stripe" checked={refund} onChange={(e) => setRefund(e.target.checked)} />
          {!refund && <Notice tone="gold">El dinero se queda en tu cuenta de Stripe; usa esta opción solo si lo devolverás por otro medio.</Notice>}
          <Field label="Motivo de la anulación">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Escribe el motivo" />
          </Field>
        </div>
      )}
    </Sheet>
  );
}
