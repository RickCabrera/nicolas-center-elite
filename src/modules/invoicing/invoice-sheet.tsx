'use client';
import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Field, Input, Notice, Select, Sheet, Skeleton, useToast } from '@/components/ui';
import { api, ApiError, refresh, useApi } from '@/lib/client';
import { fmtDate } from '@/lib/dates';
import { money, PAYMENT_METHOD_LABEL } from '@/lib/format';
import type { Invoice, Payment } from '@/modules/billing/types';
import { CFDI_USES, PAYMENT_FORMS, RFC_RE, satFormOf, TAX_SYSTEMS, type BillingSettings } from './catalogs';

type Profile = { legal_name: string; tax_id: string; tax_system: string; zip: string; cfdi_use: string; email: string };
type SettingsView = { settings: BillingSettings; integrations: { facturapi: { configured: boolean; live: boolean } } };
const EMPTY: Profile = { legal_name: '', tax_id: '', tax_system: '', zip: '', cfdi_use: 'D01', email: '' };

export const invoiceFileUrl = (id: string, format: 'pdf' | 'xml' | 'zip') => `/api/invoices/${id}/file?format=${format}`;

// FAC-01 / FAC-02 · "Facturar": datos fiscales del paciente, pagos a incluir, forma de pago y uso de CFDI.
export function InvoiceSheet({ open, onClose, patientId, patientName, payments, preselect }: {
  open: boolean; onClose: () => void; patientId: string; patientName: string; payments: Payment[]; preselect?: string;
}) {
  const toast = useToast();
  const { data: prof } = useApi<{ profile: Profile | null }>(open ? `/api/billing/tax-profiles/${patientId}` : null);
  const { data: cfg } = useApi<SettingsView>(open ? '/api/billing/settings' : null);
  const candidates = useMemo(() => payments.filter((p) => !p.voided_at && !p.invoice_id && p.amount_cents > 0), [payments]);
  const [form, setForm] = useState<Profile>(EMPTY);
  const [selected, setSelected] = useState<string[]>([]);
  const [payForm, setPayForm] = useState('');
  const [use, setUse] = useState('D01');
  const [sendEmail, setSendEmail] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ invoice: Invoice; email_error: string | null; emailed_to: string | null } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open) { setLoaded(false); return; }
    setSelected(preselect ? [preselect] : candidates.slice(0, 1).map((p) => p.id));
    setErrors({}); setFormError(''); setDone(null); setBusy(false); setSendEmail(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preselect]);
  useEffect(() => {
    if (!open || loaded || !prof) return;
    const p = prof.profile ?? { ...EMPTY, cfdi_use: cfg?.settings.invoice_default_use ?? 'D01' };
    setForm(p); setUse(p.cfdi_use); setLoaded(true);
  }, [open, loaded, prof, cfg]);

  const chosen = candidates.filter((p) => selected.includes(p.id));
  const suggested = chosen.length ? satFormOf([...chosen].sort((a, b) => b.amount_cents - a.amount_cents)[0]) : '01';
  useEffect(() => { setPayForm(suggested); }, [suggested]);
  const total = chosen.reduce((s, p) => s + p.amount_cents, 0);
  const set = (k: keyof Profile, v: string) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [`tax_profile.${k}`]: '' })); };
  const err = (k: keyof Profile) => errors[`tax_profile.${k}`] ?? errors[k];
  const generic = form.tax_id.trim().toUpperCase() === 'XAXX010101000';

  const submit = async () => {
    const e: Record<string, string> = {};
    if (form.legal_name.trim().length < 2) e['tax_profile.legal_name'] = 'Escribe el nombre o razón social como aparece en la constancia.';
    if (!RFC_RE.test(form.tax_id.trim().toUpperCase())) e['tax_profile.tax_id'] = 'RFC inválido: 12 o 13 caracteres, sin guiones ni espacios.';
    if (!form.tax_system) e['tax_profile.tax_system'] = 'Elige el régimen fiscal.';
    if (!/^\d{5}$/.test(form.zip.trim())) e['tax_profile.zip'] = 'El código postal tiene 5 dígitos.';
    if (!chosen.length) e.payment_ids = 'Elige al menos un pago.';
    if (sendEmail && !form.email.trim()) e['tax_profile.email'] = 'Escribe el correo para enviarle la factura, o desmarca "Enviar por correo".';
    setErrors(e); setFormError('');
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const r = await api.post<{ invoice: Invoice; email_error: string | null; emailed_to: string | null }>('/api/invoices', {
        payment_ids: chosen.map((p) => p.id), payment_form: payForm, cfdi_use: use, send_email: sendEmail,
        tax_profile: { ...form, tax_id: form.tax_id.trim().toUpperCase(), zip: form.zip.trim(), email: form.email.trim(), cfdi_use: use },
      });
      setDone(r);
      toast(`Factura ${r.invoice.series}${r.invoice.folio_number ?? ''} timbrada`);
      refresh('/api/billing', '/api/invoices');
    } catch (x) {
      const ae = x as ApiError;
      setErrors(ae.fields ?? {});
      setFormError(ae.fields && Object.keys(ae.fields).length ? 'Revisa los campos marcados.' : ae.message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const inv = done.invoice;
    return (
      <Sheet open={open} onClose={onClose} title="Factura timbrada"
        footer={<>
          <Button onClick={onClose}>Cerrar</Button>
          <a className="btn primary" href={invoiceFileUrl(inv.id, 'pdf')} target="_blank" rel="noopener">Descargar PDF</a>
        </>}>
        <div className="stack md">
          <Notice tone="green">
            Factura <b>{inv.series}{inv.folio_number ?? ''}</b> por {money(inv.total_cents)} a nombre de {inv.customer.legal_name}.
            {done.emailed_to && <> Se envió a {done.emailed_to}.</>}
          </Notice>
          {done.email_error && <Notice tone="gold">La factura sí se timbró, pero no se pudo enviar el correo: {done.email_error}</Notice>}
          {!inv.livemode && <Notice tone="gold">Factura de PRUEBA: no tiene validez ante el SAT (Facturapi está en modo de prueba).</Notice>}
          <div className="t-small" style={{ overflowWrap: 'anywhere' }}>Folio fiscal (UUID): {inv.uuid ?? '—'}</div>
          <div className="hstack wrap">
            <a className="btn" href={invoiceFileUrl(inv.id, 'xml')}>Descargar XML</a>
            <a className="btn" href={invoiceFileUrl(inv.id, 'zip')}>PDF + XML (ZIP)</a>
          </div>
        </div>
      </Sheet>
    );
  }

  const notReady = cfg && !cfg.integrations.facturapi.configured;
  return (
    <Sheet open={open} onClose={onClose} title="Facturar" wide
      footer={<>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={busy} onClick={submit} disabled={!!notReady || !candidates.length}>
          {chosen.length ? `Timbrar ${money(total)}` : 'Timbrar'}
        </Button>
      </>}>
      {!prof ? <Skeleton rows={4} /> : (
        <form className="stack md" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div>
            <div className="t-name ellipsis">{patientName}</div>
            <div className="t-sub" style={{ marginTop: 3 }}>Factura CFDI 4.0 · los datos deben ser idénticos a la Constancia de Situación Fiscal</div>
          </div>
          {notReady && <Notice tone="gold">La facturación aún no está conectada: falta dar de alta la cuenta de Facturapi con el certificado (CSD) de la clínica.</Notice>}
          {cfg?.integrations.facturapi.configured && !cfg.integrations.facturapi.live && (
            <Notice>Modo de prueba: las facturas se timbran sin validez ante el SAT.</Notice>
          )}
          {formError && <Notice tone="red">{formError}</Notice>}

          <div className="t-label">Datos fiscales del receptor</div>
          <div className="grid-form">
            <Field label="RFC" error={err('tax_id')}>
              <Input value={form.tax_id} maxLength={13} autoComplete="off" invalid={!!err('tax_id')} style={{ textTransform: 'uppercase', font: '600 14px/1 var(--f-mono)' }}
                onChange={(e) => set('tax_id', e.target.value.replace(/[\s-]/g, '').toUpperCase())} />
            </Field>
            <Field label="Código postal fiscal" error={err('zip')}>
              <Input value={form.zip} inputMode="numeric" maxLength={5} invalid={!!err('zip')} onChange={(e) => set('zip', e.target.value.replace(/\D/g, ''))} />
            </Field>
          </div>
          <Field label="Nombre o razón social (sin régimen societario, como en la constancia)" error={err('legal_name')}>
            <Input value={form.legal_name} maxLength={300} invalid={!!err('legal_name')} style={{ textTransform: 'uppercase' }}
              onChange={(e) => set('legal_name', e.target.value)} />
          </Field>
          <div className="grid-form">
            <Field label="Régimen fiscal" error={err('tax_system')}>
              <Select value={form.tax_system} invalid={!!err('tax_system')} onChange={(e) => set('tax_system', e.target.value)}>
                <option value="">Elige…</option>
                {TAX_SYSTEMS.map((t) => <option key={t.code} value={t.code}>{t.code} · {t.label}</option>)}
              </Select>
            </Field>
            <Field label="Uso del CFDI" error={errors.cfdi_use}>
              <Select value={use} onChange={(e) => setUse(e.target.value)}>
                {CFDI_USES.map((u) => <option key={u.code} value={u.code}>{u.code} · {u.label}</option>)}
              </Select>
            </Field>
          </div>
          {generic && use !== 'S01' && <Notice tone="gold">Con el RFC genérico XAXX010101000 el SAT exige uso S01 y régimen 616.</Notice>}
          <div className="grid-form">
            <Field label="Correo para enviar la factura" error={err('email')}>
              <Input type="email" value={form.email} invalid={!!err('email')} onChange={(e) => set('email', e.target.value)} />
            </Field>
            <Field label="Forma de pago" error={errors.payment_form} hint={payForm !== suggested ? `Sugerida: ${suggested}` : undefined}>
              <Select value={payForm} onChange={(e) => setPayForm(e.target.value)}>
                {PAYMENT_FORMS.map((f) => <option key={f.code} value={f.code}>{f.code} · {f.label}</option>)}
              </Select>
            </Field>
          </div>
          <Checkbox label="Enviar la factura (PDF y XML) por correo al timbrar" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />

          <div className="t-label" style={{ marginTop: 4 }}>Pagos a facturar</div>
          {!candidates.length ? <Notice>Este paciente no tiene pagos pendientes de facturar.</Notice> : (
            <div className="stack sm" role="group" aria-label="Pagos a facturar">
              {candidates.map((p) => (
                <label key={p.id} className="row" style={{ cursor: 'pointer', flexWrap: 'wrap', rowGap: 6 }}>
                  <input type="checkbox" checked={selected.includes(p.id)} style={{ width: 20, height: 20, accentColor: 'var(--blue)', flex: 'none' }}
                    onChange={(e) => setSelected((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))} />
                  <span className="grow" style={{ minWidth: 160 }}>
                    <span className="t-strong" style={{ display: 'block' }}>{fmtDate(p.paid_on)} · {p.plan_name}</span>
                    <span className="t-small">{p.receipt_number} · {PAYMENT_METHOD_LABEL[p.method]}</span>
                  </span>
                  <span className="t-mono">{money(p.amount_cents)}</span>
                </label>
              ))}
              {errors.payment_ids && <span className="err" role="alert">{errors.payment_ids}</span>}
            </div>
          )}
          <div className="t-small">
            Concepto: servicios de fisioterapia (clave SAT {cfg?.settings.invoice_product_key ?? '85122101'}),
            {cfg?.settings.invoice_tax === 'exento' ? ' exento de IVA.' : ' IVA 16 % incluido en el precio.'} Método de pago PUE (una sola exhibición).
          </div>
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      )}
    </Sheet>
  );
}
