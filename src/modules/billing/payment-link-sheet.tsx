'use client';
import { useEffect, useState } from 'react';
import { Button, Checkbox, Field, Input, Notice, Sheet, useToast } from '@/components/ui';
import { api, ApiError, refresh, useApi } from '@/lib/client';
import { fmtDateTime } from '@/lib/dates';
import { money, parseMoney } from '@/lib/format';
import type { BillingSettings } from '@/modules/invoicing/catalogs';
import type { Billing, PaymentLink } from './types';

type SettingsView = { settings: BillingSettings; integrations: { stripe: { configured: boolean; live: boolean } } };
const pesos = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

/** Mensaje listo para WhatsApp con el link de pago. */
export function whatsappText(name: string, link: Pick<PaymentLink, 'amount_cents' | 'plan_name' | 'url' | 'expires_at' | 'methods'>) {
  const first = name.split(' ')[0] ?? '';
  const how = link.methods.includes('oxxo') ? (link.methods.includes('card') ? 'con tarjeta o en efectivo en OXXO' : 'en efectivo en OXXO') : 'con tarjeta';
  return `Hola ${first}, te comparto el link para pagar tu ${link.plan_name} por ${money(link.amount_cents)} en Nicolas Center Elite. ` +
    `Puedes pagar ${how}. El link vence el ${fmtDateTime(link.expires_at)}:\n${link.url ?? ''}`;
}

export function shareLink(name: string, link: PaymentLink, phone?: string | null) {
  const digits = (phone ?? '').replace(/\D/g, '');
  const to = digits.length === 10 ? `52${digits}` : digits;
  return `https://wa.me/${to}?text=${encodeURIComponent(whatsappText(name, link))}`;
}

// PAG-12 · "Cobrar en línea": genera un link de Stripe (tarjeta u OXXO) para la mensualidad.
export function PaymentLinkSheet({ open, onClose, patientId, patientName, phone, billing }: {
  open: boolean; onClose: () => void; patientId: string; patientName: string; phone?: string | null; billing: Billing | null;
}) {
  const toast = useToast();
  const { data: cfg } = useApi<SettingsView>(open ? '/api/billing/settings' : null);
  const [amount, setAmount] = useState('');
  const [card, setCard] = useState(true);
  const [oxxo, setOxxo] = useState(true);
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<PaymentLink | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount(billing?.price_cents != null ? pesos(billing.price_cents) : '');
    setCard(true); setOxxo(true); setEmail(''); setErrors({}); setFormError(''); setLink(null); setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const ready = cfg?.integrations.stripe.configured && cfg.settings.online_payments_enabled;
  const oxxoAllowed = !!cfg?.settings.oxxo_enabled;
  const cents = parseMoney(amount);

  const create = async () => {
    const e: Record<string, string> = {};
    if (cents === null || cents < 1000) e.amount_cents = 'El cobro en línea debe ser de al menos $10.00.';
    if (!card && !(oxxo && oxxoAllowed)) e.methods = 'Elige al menos una forma de pago.';
    setErrors(e); setFormError('');
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const methods = [card && 'card', oxxo && oxxoAllowed && 'oxxo'].filter(Boolean);
      const r = await api.post<{ link: PaymentLink }>('/api/billing/payment-links', { patient_id: patientId, amount_cents: cents, methods, email: email.trim() });
      setLink(r.link);
      refresh('/api/billing/payment-links');
    } catch (err) {
      const ae = err as ApiError;
      setErrors(ae.fields ?? {});
      setFormError(ae.fields && Object.keys(ae.fields).length ? '' : ae.message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link?.url) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast('Link copiado');
    } catch {
      toast('No se pudo copiar; mantén presionado el link para copiarlo.', 'error');
    }
  };

  if (link) {
    return (
      <Sheet open={open} onClose={onClose} title="Link de pago listo"
        footer={<>
          <Button onClick={onClose}>Cerrar</Button>
          <a className="btn primary" href={shareLink(patientName, link, phone)} target="_blank" rel="noopener">Enviar por WhatsApp</a>
        </>}>
        <div className="stack md">
          <Notice tone="green">
            Link por <b>{money(link.amount_cents)}</b> para {patientName}. Cuando pague, el pago se registra solo y la mensualidad se
            actualiza; lo verás en Mensualidades → Cobros en línea.
          </Notice>
          <Field label="Link de pago">
            <Input readOnly value={link.url ?? ''} onFocus={(e) => e.currentTarget.select()} style={{ font: '500 13px/1.3 var(--f-mono)' }} />
          </Field>
          <div className="hstack wrap">
            <Button onClick={copy}>Copiar link</Button>
            {link.url && <a className="btn" href={link.url} target="_blank" rel="noopener">Abrir</a>}
          </div>
          <div className="t-small">
            Vence el {fmtDateTime(link.expires_at)}. {link.methods.includes('oxxo') && 'Si el paciente elige OXXO, recibe una ficha para pagar en tienda; el pago se confirma cuando OXXO lo reporta (normalmente al día siguiente).'}
          </div>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title="Cobrar en línea"
      footer={<>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={busy} onClick={create} disabled={!ready || !billing?.membership_id}>Generar link</Button>
      </>}>
      <form className="stack md" onSubmit={(e) => { e.preventDefault(); create(); }}>
        <div>
          <div className="t-name ellipsis">{patientName}</div>
          <div className="t-sub" style={{ marginTop: 3 }}>{billing?.plan_name ?? 'Sin plan'} · {money(billing?.price_cents)}</div>
        </div>
        {cfg && !cfg.integrations.stripe.configured && (
          <Notice tone="gold">El cobro en línea aún no está conectado: falta dar de alta la cuenta de Stripe (paso pendiente de configuración).</Notice>
        )}
        {cfg?.integrations.stripe.configured && !cfg.settings.online_payments_enabled && (
          <Notice tone="gold">El cobro en línea está desactivado en Configuración → Cobros y facturación.</Notice>
        )}
        {cfg?.integrations.stripe.configured && !cfg.integrations.stripe.live && (
          <Notice>Modo de prueba: el link no cobra dinero real. Usa la tarjeta 4242 4242 4242 4242.</Notice>
        )}
        {formError && <Notice tone="red">{formError}</Notice>}
        <Field label="Monto (MXN)" error={errors.amount_cents}>
          <Input inputMode="decimal" value={amount} invalid={!!errors.amount_cents} autoComplete="off"
            onChange={(e) => { setAmount(e.target.value); setErrors((x) => ({ ...x, amount_cents: '' })); }} />
        </Field>
        <div className="field" role="group" aria-label="Formas de pago">
          <span>El paciente puede pagar con</span>
          <div className="stack sm">
            <Checkbox label="Tarjeta de crédito o débito" checked={card} onChange={(e) => setCard(e.target.checked)} />
            <Checkbox label={oxxoAllowed ? 'Efectivo en OXXO' : 'Efectivo en OXXO (desactivado en Configuración)'} checked={oxxo && oxxoAllowed}
              disabled={!oxxoAllowed} onChange={(e) => setOxxo(e.target.checked)} />
          </div>
          {errors.methods && <span className="err" role="alert">{errors.methods}</span>}
        </div>
        <Field label="Correo del paciente (opcional)" error={errors.email} hint="Stripe le envía ahí su comprobante de pago.">
          <Input type="email" value={email} invalid={!!errors.email} autoComplete="off" onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
}
