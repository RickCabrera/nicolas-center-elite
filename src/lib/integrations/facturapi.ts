import { env } from '../env';
import { AppError } from '../errors';

/**
 * Cliente mínimo de Facturapi (PAC para CFDI 4.0). Las llaves `sk_test_…` timbran en modo prueba
 * (sin validez ante el SAT); `sk_live_…` timbran de verdad. El emisor (RFC, régimen, CSD y lugar de
 * expedición) se configura en el panel de Facturapi: aquí solo se emiten, consultan y cancelan facturas.
 */
export const facturapiConfigured = () => !!env().FACTURAPI_KEY;
export const facturapiLiveMode = () => env().FACTURAPI_KEY.startsWith('sk_live_');

async function call(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<Response> {
  const key = env().FACTURAPI_KEY;
  if (!key) throw new AppError(503, 'facturapi_not_configured', 'La facturación no está configurada (falta FACTURAPI_KEY).');
  try {
    return await fetch(`${env().FACTURAPI_API_BASE}/v2${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(45000),
    });
  } catch {
    throw new AppError(502, 'facturapi_unreachable', 'No se pudo conectar con Facturapi. Intenta de nuevo en un momento.');
  }
}

async function json<T>(res: Response): Promise<T> {
  const j = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!res.ok || !j) {
    // Facturapi responde { message } en español con el motivo del SAT o de validación.
    throw new AppError(res.status >= 500 ? 502 : 400, 'facturapi_error', `Facturapi: ${j?.message ?? `respondió ${res.status}`}`);
  }
  return j;
}

export type FacturapiInvoice = {
  id: string; uuid?: string | null; status: 'valid' | 'canceled' | 'pending' | 'draft'; cancellation_status?: string | null;
  total: number; series?: string; folio_number?: number; livemode?: boolean; verification_url?: string | null;
};

export type InvoiceItem = {
  quantity: number;
  product: {
    description: string; product_key: string; unit_key: string; unit_name?: string; price: number; tax_included: boolean;
    taxability?: string; taxes?: { type: 'IVA'; rate: number; factor?: 'Tasa' | 'Exento' }[]; sku?: string;
  };
};

export type CreateInvoice = {
  customer: { legal_name: string; tax_id: string; tax_system: string; email?: string; address: { zip: string } };
  items: InvoiceItem[];
  payment_form: string;
  payment_method?: 'PUE' | 'PPD';
  use: string;
  series?: string;
  global?: { periodicity: 'day' | 'week' | 'fortnight' | 'month' | 'two_months'; months: string; year: number };
  external_id?: string;
  idempotency_key?: string;
};

export async function createInvoice(data: CreateInvoice) {
  return json<FacturapiInvoice>(await call('POST', '/invoices', data));
}
export async function retrieveInvoice(id: string) {
  return json<FacturapiInvoice>(await call('GET', `/invoices/${encodeURIComponent(id)}`));
}
export async function cancelInvoice(id: string, motive: '01' | '02' | '03' | '04', substitution?: string) {
  const q = new URLSearchParams({ motive, ...(substitution ? { substitution } : {}) });
  return json<FacturapiInvoice>(await call('DELETE', `/invoices/${encodeURIComponent(id)}?${q}`));
}
export async function sendInvoiceEmail(id: string, email: string) {
  const res = await call('POST', `/invoices/${encodeURIComponent(id)}/email`, { email });
  if (!res.ok) await json(res);
}
/** Descarga el archivo timbrado (pdf, xml o zip). */
export async function downloadInvoice(id: string, format: 'pdf' | 'xml' | 'zip'): Promise<Buffer> {
  const res = await call('GET', `/invoices/${encodeURIComponent(id)}/${format}`);
  if (!res.ok) await json(res);
  return Buffer.from(await res.arrayBuffer());
}
