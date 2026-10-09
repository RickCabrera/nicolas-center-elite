'use client';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Checkbox, ErrorNote, Field, Input, Notice, Select, Skeleton, useToast } from '@/components/ui';
import { api, ApiError, useApi } from '@/lib/client';
import { CFDI_USES, type BillingSettings } from './catalogs';

type View = {
  settings: BillingSettings;
  integrations: {
    stripe: { configured: boolean; live: boolean; webhook_configured: boolean };
    facturapi: { configured: boolean; live: boolean };
    webhook_url: string;
  };
};

function Status({ configured, live, label }: { configured: boolean; live: boolean; label: string }) {
  return (
    <div className="row">
      <span className="grow t-strong">{label}</span>
      {!configured ? <Badge tone="gold">Sin conectar</Badge> : live ? <Badge tone="green">Conectado · producción</Badge> : <Badge tone="blue">Conectado · prueba</Badge>}
    </div>
  );
}

// PAG-12 · FAC-05 · Configuración → Cobros y facturación.
export function BillingSettingsTab() {
  const toast = useToast();
  const { data, error, mutate } = useApi<View>('/api/billing/settings');
  const [s, setS] = useState<BillingSettings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data && !s) setS(data.settings); }, [data, s]);

  if (error && !data) return <ErrorNote error={error} retry={() => mutate()} />;
  if (!data || !s) return <Skeleton rows={5} height={64} />;
  const set = <K extends keyof BillingSettings>(k: K, v: BillingSettings[K]) => { setS({ ...s, [k]: v }); setErrors((e) => ({ ...e, [k]: '' })); };
  const changed = Object.fromEntries(Object.entries(s).filter(([k, v]) => data.settings[k as keyof BillingSettings] !== v));
  const { integrations: it } = data;

  const save = async () => {
    if (!Object.keys(changed).length) return;
    setBusy(true);
    try {
      const r = await api.patch<View>('/api/billing/settings', changed);
      setS(r.settings);
      await mutate(r, { revalidate: false });
      toast('Cobros y facturación guardados');
    } catch (e) {
      const ae = e as ApiError;
      setErrors(ae.fields ?? {});
      toast(ae.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Card title="Conexiones" blue>
          <div className="stack sm">
            <Status label="Stripe (cobro con tarjeta y OXXO)" configured={it.stripe.configured} live={it.stripe.live} />
            {it.stripe.configured && !it.stripe.webhook_configured && (
              <Notice tone="red">Falta STRIPE_WEBHOOK_SECRET: sin él los pagos no se registran solos.</Notice>
            )}
            <Status label="Facturapi (timbrado CFDI 4.0)" configured={it.facturapi.configured} live={it.facturapi.live} />
            <div className="t-small" style={{ lineHeight: 1.45, overflowWrap: 'anywhere' }}>
              Las llaves se configuran como variables de entorno en el servidor (docs/despliegue.md → «Cobro en línea y facturación»).
              Dirección del webhook para Stripe: <span className="t-mono">{it.webhook_url}</span>
            </div>
          </div>
        </Card>

        <Card title="Cobro en línea" blue>
          <div className="stack sm">
            <Checkbox label="Permitir generar links de pago" checked={s.online_payments_enabled} onChange={(e) => set('online_payments_enabled', e.target.checked)} />
            <Checkbox label="Aceptar pago en efectivo en OXXO" checked={s.oxxo_enabled} onChange={(e) => set('oxxo_enabled', e.target.checked)} />
            <div className="grid-form">
              <Field label="Vigencia del link (horas)" error={errors.payment_link_hours} hint="De 1 a 24 (límite de Stripe).">
                <Input inputMode="numeric" value={s.payment_link_hours} invalid={!!errors.payment_link_hours}
                  onChange={(e) => set('payment_link_hours', Number(e.target.value.replace(/\D/g, '')) || 0)} />
              </Field>
              <Field label="Días para pagar la ficha OXXO" error={errors.oxxo_days} hint="De 1 a 14.">
                <Input inputMode="numeric" value={s.oxxo_days} invalid={!!errors.oxxo_days}
                  onChange={(e) => set('oxxo_days', Number(e.target.value.replace(/\D/g, '')) || 0)} />
              </Field>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Facturación (CFDI 4.0)" blue>
        <div className="stack md">
          <Notice>
            El RFC, razón social, régimen fiscal y certificado de sello digital (CSD) de la clínica se cargan una sola vez en el panel de
            Facturapi. Confirma con tu contador el tratamiento del IVA: los servicios de fisioterapia pueden estar exentos (art. 15 fr. XIV
            LIVA) cuando los presta un profesional con título.
          </Notice>
          <div className="grid-form">
            <Field label="IVA" error={errors.invoice_tax}>
              <Select value={s.invoice_tax} onChange={(e) => set('invoice_tax', e.target.value as BillingSettings['invoice_tax'])}>
                <option value="iva16">IVA 16 % incluido en el precio</option>
                <option value="exento">Exento de IVA</option>
              </Select>
            </Field>
            <Field label="Código postal del lugar de expedición" error={errors.invoice_zip} hint="El mismo que en Facturapi. Obligatorio para la factura global.">
              <Input inputMode="numeric" maxLength={5} value={s.invoice_zip} invalid={!!errors.invoice_zip}
                onChange={(e) => set('invoice_zip', e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label="Clave de producto SAT" error={errors.invoice_product_key} hint="85122101 · Servicios de fisioterapia">
              <Input inputMode="numeric" maxLength={8} value={s.invoice_product_key} invalid={!!errors.invoice_product_key}
                onChange={(e) => set('invoice_product_key', e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label="Clave de unidad SAT" error={errors.invoice_unit_key} hint="E48 · Unidad de servicio">
              <Input maxLength={3} value={s.invoice_unit_key} invalid={!!errors.invoice_unit_key}
                onChange={(e) => set('invoice_unit_key', e.target.value.toUpperCase())} />
            </Field>
            <Field label="Serie" error={errors.invoice_series} hint="Letras que anteceden al folio, por ejemplo NCE.">
              <Input maxLength={10} value={s.invoice_series} invalid={!!errors.invoice_series}
                onChange={(e) => set('invoice_series', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
            </Field>
            <Field label="Uso de CFDI por omisión" error={errors.invoice_default_use}>
              <Select value={s.invoice_default_use} onChange={(e) => set('invoice_default_use', e.target.value)}>
                {CFDI_USES.map((u) => <option key={u.code} value={u.code}>{u.code} · {u.label}</option>)}
              </Select>
            </Field>
          </div>
        </div>
      </Card>

      <div className="hstack" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <Button disabled={!Object.keys(changed).length || busy} onClick={() => { setS(data.settings); setErrors({}); }}>Descartar</Button>
        <Button variant="primary" loading={busy} disabled={!Object.keys(changed).length} onClick={save}>Guardar</Button>
      </div>
    </div>
  );
}
