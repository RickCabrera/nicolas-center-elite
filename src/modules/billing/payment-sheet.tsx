'use client';
import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, Field, Input, Notice, Sheet, Textarea, useToast } from '@/components/ui';
import { api, ApiError, refresh } from '@/lib/client';
import { fmtDate, todayIso } from '@/lib/dates';
import { money, parseMoney, PAYMENT_METHOD_LABEL } from '@/lib/format';
import { applyPayment, paidOnError } from './rules';
import type { Billing, Payment } from './types';

const METHODS = ['cash', 'transfer', 'card'] as const;
type Method = (typeof METHODS)[number];
const pesos = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

/** URL del recibo en PDF de un pago (PAG-08). */
export const receiptUrl = (paymentId: string) => `/api/billing/payments/${paymentId}/receipt`;

// PAG-04 / PAG-06 · Hoja "Registrar pago": monto, método, fecha, referencia, nota y vista previa del efecto.
export function PaymentSheet({ open, onClose, patientId, patientName, billing }: {
  open: boolean; onClose: () => void; patientId: string; patientName: string; billing: Billing | null;
}) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Method>('cash');
  const [cardType, setCardType] = useState<'04' | '28'>('28');
  const [paidOn, setPaidOn] = useState(todayIso());
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Payment | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount(billing?.price_cents != null ? pesos(billing.price_cents) : '');
    setMethod('cash'); setCardType('28'); setPaidOn(todayIso()); setReference(''); setNote('');
    setErrors({}); setFormError(''); setDone(null); setBusy(false);
    // Solo al abrir: los datos del plan no deben pisar lo que el dueño ya capturó.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const cents = parseMoney(amount);
  const differs = cents !== null && billing?.price_cents != null && cents !== billing.price_cents;
  const today = todayIso();

  // Vista previa con las mismas reglas puras que aplica el servidor.
  const preview = useMemo(() => {
    if (!billing?.plan_kind || !billing.next_due_date || !/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || paidOnError(paidOn, today)) return null;
    const fx = applyPayment(
      { kind: billing.plan_kind, period_days: billing.period_days ?? 30, sessions_count: billing.sessions_count },
      { next_due_date: billing.next_due_date, sessions_remaining: billing.sessions_remaining }, paidOn);
    if (billing.plan_kind === 'package') return `Sesiones: ${fx.prev_sessions ?? 0} → ${fx.new_sessions} · vigentes hasta el ${fmtDate(fx.new_due_date)}`;
    if (billing.plan_kind === 'single') return `Vigencia: ${fmtDate(fx.new_due_date)}`;
    return `Nuevo vencimiento: ${fmtDate(fx.new_due_date)}`;
  }, [billing, paidOn, today]);

  const save = async () => {
    const e: Record<string, string> = {};
    if (cents === null) e.amount_cents = 'Escribe un monto válido, por ejemplo 2400 o 2400.50.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) e.paid_on = 'Elige la fecha de pago.';
    else if (paidOnError(paidOn, today)) e.paid_on = paidOnError(paidOn, today)!;
    if (differs && !note.trim()) e.note = 'El monto es distinto al precio del plan: explica el motivo.';
    setErrors(e); setFormError('');
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const r = await api.post<{ payment: Payment }>('/api/billing/payments', {
        patient_id: patientId, amount_cents: cents, method, paid_on: paidOn, reference: reference.trim(), note: note.trim(),
        ...(method === 'card' ? { sat_payment_form: cardType } : {}),
      });
      setDone(r.payment);
      toast(`Pago registrado · ${patientName}`);
      refresh('/api/billing', '/api/patients');
    } catch (err) {
      const ae = err as ApiError;
      setErrors(ae.fields ?? {});
      setFormError(ae.fields && Object.keys(ae.fields).length ? '' : ae.message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Sheet open={open} onClose={onClose} title="Pago registrado"
        footer={<>
          <Button onClick={onClose}>Cerrar</Button>
          <a className="btn primary" href={receiptUrl(done.id)} target="_blank" rel="noopener">Descargar recibo</a>
        </>}>
        <div className="stack md">
          <Notice tone="green">
            Se registró el pago de <b>{money(done.amount_cents)}</b> de {patientName} ({PAYMENT_METHOD_LABEL[done.method]}).
          </Notice>
          <div className="grid-kv">
            <div className="kv"><div className="t-label">Recibo</div><div>{done.receipt_number}</div></div>
            <div className="kv"><div className="t-label">Fecha de pago</div><div>{fmtDate(done.paid_on)}</div></div>
            {done.plan_kind === 'package'
              ? <div className="kv"><div className="t-label">Sesiones</div><div>{done.prev_sessions ?? 0} → {done.new_sessions}</div></div>
              : <div className="kv"><div className="t-label">Nuevo vencimiento</div><div>{fmtDate(done.new_due_date)}</div></div>}
          </div>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title="Registrar pago"
      footer={<>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={busy} onClick={save} disabled={!billing?.membership_id}>Registrar pago</Button>
      </>}>
      <form className="stack md" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="row">
          <div className="grow">
            <div className="t-name ellipsis">{patientName}</div>
            <div className="t-sub" style={{ marginTop: 3 }}>{billing?.plan_name ?? 'Sin plan'} · {money(billing?.price_cents)}</div>
          </div>
        </div>
        {formError && <Notice tone="red">{formError}</Notice>}
        <div className="grid-form">
          <Field label="Monto (MXN)" error={errors.amount_cents} hint={differs ? `Precio del plan: ${money(billing?.price_cents)}` : undefined}>
            <Input inputMode="decimal" value={amount} invalid={!!errors.amount_cents} autoComplete="off"
              onChange={(e) => { setAmount(e.target.value); setErrors((x) => ({ ...x, amount_cents: '' })); }} />
          </Field>
          <Field label="Fecha de pago" error={errors.paid_on}>
            <Input type="date" value={paidOn} max={today} invalid={!!errors.paid_on}
              onChange={(e) => { setPaidOn(e.target.value); setErrors((x) => ({ ...x, paid_on: '' })); }} />
          </Field>
        </div>
        <div className="field" role="group" aria-label="Método de pago">
          <span>Método de pago</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {METHODS.map((m) => (
              <Chip key={m} on={method === m} onClick={() => setMethod(m)}
                style={{ minHeight: 46, padding: '0 6px', borderRadius: 10 }}>{PAYMENT_METHOD_LABEL[m]}</Chip>
            ))}
          </div>
          {errors.method && <span className="err" role="alert">{errors.method}</span>}
          {method === 'card' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 8 }} role="group" aria-label="Tipo de tarjeta">
              <Chip on={cardType === '28'} square onClick={() => setCardType('28')} style={{ minHeight: 40 }}>Débito</Chip>
              <Chip on={cardType === '04'} square onClick={() => setCardType('04')} style={{ minHeight: 40 }}>Crédito</Chip>
            </div>
          )}
        </div>
        <Field label="Referencia (opcional)" error={errors.reference} hint="Folio de transferencia o últimos dígitos de la terminal.">
          <Input value={reference} maxLength={120} invalid={!!errors.reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label={differs ? 'Nota (obligatoria: el monto cambió)' : 'Nota (opcional)'} error={errors.note}>
          <Textarea value={note} maxLength={500} invalid={!!errors.note} style={{ minHeight: 70 }}
            onChange={(e) => { setNote(e.target.value); setErrors((x) => ({ ...x, note: '' })); }}
            placeholder={differs ? 'Por ejemplo: descuento por pronto pago' : ''} />
        </Field>
        {preview && <Notice><b>{preview}</b></Notice>}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
}
