/**
 * Catálogos del SAT que usa la facturación (CFDI 4.0), y los parámetros de cobro y facturación de la clínica.
 * Sirven igual en servidor y navegador.
 */

// c_RegimenFiscal (los que puede tener un cliente).
export const TAX_SYSTEMS: { code: string; label: string; person: 'fisica' | 'moral' | 'ambas' }[] = [
  { code: '605', label: 'Sueldos y salarios e ingresos asimilados a salarios', person: 'fisica' },
  { code: '612', label: 'Personas físicas con actividades empresariales y profesionales', person: 'fisica' },
  { code: '626', label: 'Régimen Simplificado de Confianza (RESICO)', person: 'ambas' },
  { code: '606', label: 'Arrendamiento', person: 'fisica' },
  { code: '621', label: 'Incorporación fiscal', person: 'fisica' },
  { code: '625', label: 'Actividades empresariales con ingresos a través de plataformas tecnológicas', person: 'fisica' },
  { code: '608', label: 'Demás ingresos', person: 'fisica' },
  { code: '611', label: 'Ingresos por dividendos (socios y accionistas)', person: 'fisica' },
  { code: '614', label: 'Ingresos por intereses', person: 'fisica' },
  { code: '615', label: 'Régimen de los ingresos por obtención de premios', person: 'fisica' },
  { code: '607', label: 'Régimen de enajenación o adquisición de bienes', person: 'fisica' },
  { code: '610', label: 'Residentes en el extranjero sin establecimiento permanente en México', person: 'ambas' },
  { code: '616', label: 'Sin obligaciones fiscales', person: 'fisica' },
  { code: '601', label: 'General de Ley Personas Morales', person: 'moral' },
  { code: '603', label: 'Personas morales con fines no lucrativos', person: 'moral' },
  { code: '620', label: 'Sociedades cooperativas de producción que optan por diferir sus ingresos', person: 'moral' },
  { code: '622', label: 'Actividades agrícolas, ganaderas, silvícolas y pesqueras', person: 'ambas' },
  { code: '623', label: 'Opcional para grupos de sociedades', person: 'moral' },
  { code: '624', label: 'Coordinados', person: 'moral' },
];

// c_UsoCFDI (los que tienen sentido para servicios de salud).
export const CFDI_USES: { code: string; label: string }[] = [
  { code: 'D01', label: 'Honorarios médicos, dentales y gastos hospitalarios (deducible personal)' },
  { code: 'G03', label: 'Gastos en general' },
  { code: 'D02', label: 'Gastos médicos por incapacidad o discapacidad' },
  { code: 'D07', label: 'Primas por seguros de gastos médicos' },
  { code: 'S01', label: 'Sin efectos fiscales' },
  { code: 'CP01', label: 'Pagos' },
];

// c_FormaPago (las que recibe la clínica).
export const PAYMENT_FORMS: { code: string; label: string }[] = [
  { code: '01', label: 'Efectivo' },
  { code: '03', label: 'Transferencia electrónica' },
  { code: '04', label: 'Tarjeta de crédito' },
  { code: '28', label: 'Tarjeta de débito' },
  { code: '02', label: 'Cheque nominativo' },
  { code: '31', label: 'Intermediario de pagos' },
  { code: '99', label: 'Por definir' },
];

export const CANCEL_MOTIVES: { code: '01' | '02' | '03' | '04'; label: string; help: string }[] = [
  { code: '02', label: '02 · Comprobante emitido con errores sin relación', help: 'El caso más común: datos equivocados y no se emitirá otra factura que la sustituya.' },
  { code: '01', label: '01 · Comprobante emitido con errores con relación', help: 'Primero emite la factura correcta y después cancela esta indicando la nueva como sustituta.' },
  { code: '03', label: '03 · No se llevó a cabo la operación', help: 'El servicio no se prestó o el pago se devolvió.' },
  { code: '04', label: '04 · Operación nominativa relacionada en una factura global', help: 'El pago ya estaba en una factura global y el paciente pidió factura a su nombre.' },
];

/** Público en general, para facturas globales (CFDI 4.0). */
export const PUBLIC_CUSTOMER = { legal_name: 'PUBLICO EN GENERAL', tax_id: 'XAXX010101000', tax_system: '616' } as const;

export const RFC_RE = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/;

/** Forma de pago SAT sugerida para un pago según cómo se cobró. */
export function satFormOf(p: { method: string; sat_payment_form?: string | null }): string {
  if (p.sat_payment_form) return p.sat_payment_form;
  switch (p.method) {
    case 'cash': return '01';
    case 'transfer': return '03';
    case 'card': return '04';
    case 'online_card': return '04';
    case 'oxxo': return '01';
    default: return '99';
  }
}

export const formLabel = (code: string) => PAYMENT_FORMS.find((f) => f.code === code)?.label ?? code;
export const useLabel = (code: string) => CFDI_USES.find((u) => u.code === code)?.label ?? code;
export const taxSystemLabel = (code: string) => TAX_SYSTEMS.find((t) => t.code === code)?.label ?? code;

// ───────── parámetros de cobro y facturación (clinic.settings) ─────────
export type BillingSettings = {
  online_payments_enabled: boolean;
  oxxo_enabled: boolean;
  payment_link_hours: number;
  oxxo_days: number;
  invoice_product_key: string;
  invoice_unit_key: string;
  invoice_tax: 'iva16' | 'exento';
  invoice_series: string;
  invoice_zip: string;
  invoice_default_use: string;
};

export const BILLING_DEFAULTS: BillingSettings = {
  online_payments_enabled: true,
  oxxo_enabled: true,
  payment_link_hours: 24,
  oxxo_days: 3,
  invoice_product_key: '85122101',
  invoice_unit_key: 'E48',
  invoice_tax: 'iva16',
  invoice_series: 'NCE',
  invoice_zip: '',
  invoice_default_use: 'D01',
};

export function readBillingSettings(raw: unknown): BillingSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...BILLING_DEFAULTS };
  for (const k of Object.keys(BILLING_DEFAULTS) as (keyof BillingSettings)[]) {
    if (s[k] !== undefined && typeof s[k] === typeof BILLING_DEFAULTS[k]) (out as Record<string, unknown>)[k] = s[k];
  }
  if (out.invoice_tax !== 'iva16' && out.invoice_tax !== 'exento') out.invoice_tax = 'iva16';
  return out;
}

export const LINK_STATUS_LABEL: Record<string, string> = {
  open: 'Esperando pago',
  pending_oxxo: 'Ficha OXXO generada',
  paid: 'Pagado',
  needs_review: 'Requiere revisión',
  expired: 'Vencido',
  failed: 'Falló',
  cancelled: 'Cancelado',
  refunded: 'Reembolsado',
};

export const INVOICE_STATUS_LABEL: Record<string, string> = {
  pending: 'Timbrando', valid: 'Vigente', canceled: 'Cancelada', error: 'Error',
};
