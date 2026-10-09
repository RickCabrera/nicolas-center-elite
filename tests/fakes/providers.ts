import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Servidor falso que imita las partes de Stripe y Facturapi que usa la app. Las pruebas apuntan
 * STRIPE_API_BASE y FACTURAPI_API_BASE a este servidor: el código real (clientes HTTP, firmas,
 * idempotencia, manejo de errores) se ejercita completo sin salir a internet.
 */
export type FakeSession = {
  id: string; object: 'checkout.session'; url: string; status: 'open' | 'complete' | 'expired';
  payment_status: 'paid' | 'unpaid'; amount_total: number; currency: string; payment_intent: string | null;
  metadata: Record<string, string>; payment_method_types: string[]; expires_at: number; customer_email: string | null;
};
export type FakeInvoice = {
  id: string; uuid: string; status: 'valid' | 'canceled'; cancellation_status: string | null; total: number; series: string;
  folio_number: number; livemode: boolean; verification_url: string; body: any;
};

/** Convierte a[b][0][c]=x en objeto anidado (formato de Stripe). */
function parseForm(text: string) {
  const out: any = {};
  for (const pair of text.split('&').filter(Boolean)) {
    const [k, v = ''] = pair.split('=').map(decodeURIComponent);
    const keys = k.replace(/\]/g, '').split('[');
    let cur = out;
    keys.forEach((key, i) => {
      if (i === keys.length - 1) cur[key] = v;
      else cur = cur[key] ??= /^\d+$/.test(keys[i + 1]) ? [] : {};
    });
  }
  return out;
}

const read = (req: IncomingMessage) => new Promise<string>((resolve) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => resolve(b));
});

export class FakeProviders {
  server!: Server;
  base = '';
  sessions = new Map<string, FakeSession>();
  invoices = new Map<string, FakeInvoice>();
  calls: { method: string; path: string; body: any; headers: Record<string, string | string[] | undefined> }[] = [];
  refunds: { id: string; payment_intent: string; key: string }[] = [];
  emails: { id: string; email: string }[] = [];
  private idem = new Map<string, unknown>();
  private n = 0;
  failNextInvoice: string | null = null;

  async start() {
    this.server = createServer(async (req, res) => {
      const raw = await read(req);
      const url = new URL(req.url ?? '/', 'http://x');
      const send = (status: number, body: unknown, type = 'application/json') => {
        res.writeHead(status, { 'content-type': type });
        res.end(typeof body === 'string' ? body : JSON.stringify(body));
      };
      const isStripe = url.pathname.startsWith('/v1/');
      const body = !raw ? {} : isStripe ? parseForm(raw) : JSON.parse(raw);
      this.calls.push({ method: req.method!, path: url.pathname + url.search, body, headers: req.headers });
      const auth = String(req.headers.authorization ?? '');
      if (!auth.startsWith('Bearer sk_test_')) return send(401, isStripe ? { error: { message: 'Invalid API Key' } } : { message: 'API key inválida' });
      const key = String(req.headers['idempotency-key'] ?? body.idempotency_key ?? '');
      if (key && this.idem.has(key)) return send(200, this.idem.get(key));
      const remember = (v: unknown) => { if (key) this.idem.set(key, v); return v; };

      // ───── Stripe ─────
      if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
        const id = `cs_test_${++this.n}`;
        const s: FakeSession = {
          id, object: 'checkout.session', url: `https://checkout.stripe.test/c/pay/${id}`, status: 'open', payment_status: 'unpaid',
          amount_total: Number(body.line_items[0].price_data.unit_amount), currency: body.line_items[0].price_data.currency,
          payment_intent: null, metadata: body.metadata ?? {}, payment_method_types: body.payment_method_types ?? ['card'],
          expires_at: Number(body.expires_at), customer_email: body.customer_email ?? null,
        };
        this.sessions.set(id, s);
        return send(200, remember(s));
      }
      let m = url.pathname.match(/^\/v1\/checkout\/sessions\/([^/]+)(\/expire)?$/);
      if (m) {
        const s = this.sessions.get(m[1]);
        if (!s) return send(404, { error: { message: 'No such checkout session' } });
        if (m[2]) {
          if (s.status !== 'open') return send(400, { error: { message: 'Only Checkout Sessions with a status of open can be expired.' } });
          s.status = 'expired';
        }
        return send(200, s);
      }
      if (req.method === 'POST' && url.pathname === '/v1/refunds') {
        const r = { id: `re_test_${++this.n}`, status: 'succeeded', amount: 0 };
        this.refunds.push({ id: r.id, payment_intent: body.payment_intent, key });
        return send(200, remember(r));
      }

      // ───── Facturapi ─────
      if (req.method === 'POST' && url.pathname === '/v2/invoices') {
        if (this.failNextInvoice) {
          const message = this.failNextInvoice;
          this.failNextInvoice = null;
          return send(400, { message });
        }
        const total = body.items.reduce((s: number, i: any) => s + i.product.price * i.quantity, 0);
        const inv: FakeInvoice = {
          id: `inv_${++this.n}`, uuid: randomUUID().toUpperCase(), status: 'valid', cancellation_status: null, total,
          series: body.series ?? '', folio_number: this.n, livemode: false, verification_url: 'https://verificacfdi.facturaelectronica.sat.gob.mx/', body,
        };
        this.invoices.set(inv.id, inv);
        const { body: _b, ...pub } = inv;
        return send(200, remember(pub));
      }
      m = url.pathname.match(/^\/v2\/invoices\/([^/]+)(?:\/(pdf|xml|zip|email))?$/);
      if (m) {
        const inv = this.invoices.get(m[1]);
        if (!inv) return send(404, { message: 'No se encontró la factura' });
        const pub = () => { const { body: _b, ...p } = inv; return p; };
        if (m[2] === 'email') { this.emails.push({ id: inv.id, email: body.email }); return send(200, { ok: true }); }
        if (m[2] === 'pdf') return send(200, '%PDF-1.4 factura falsa', 'application/pdf');
        if (m[2] === 'xml') return send(200, `<cfdi:Comprobante UUID="${inv.uuid}"/>`, 'application/xml');
        if (m[2] === 'zip') return send(200, 'PK', 'application/zip');
        if (req.method === 'DELETE') {
          // Igual que el SAT: arriba de $1,000 el receptor debe aceptar la cancelación.
          if (inv.total > 1000) inv.cancellation_status = 'pending';
          else { inv.status = 'canceled'; inv.cancellation_status = 'accepted'; }
          return send(200, pub());
        }
        return send(200, pub());
      }
      send(404, { message: 'ruta falsa desconocida' });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', () => r()));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  /** Simula que el receptor aceptó la cancelación en el portal del SAT. */
  acceptCancellation(id: string) {
    const inv = this.invoices.get(id)!;
    inv.status = 'canceled';
    inv.cancellation_status = 'accepted';
  }

  /** Marca la sesión como la reportaría Stripe tras el pago. */
  pay(sessionId: string, opts: { oxxo?: boolean; paid?: boolean; amount?: number } = {}) {
    const s = this.sessions.get(sessionId)!;
    s.status = 'complete';
    s.payment_status = opts.paid === false ? 'unpaid' : 'paid';
    s.payment_intent = s.payment_intent ?? `pi_test_${sessionId}`;
    if (opts.oxxo) s.payment_method_types = ['oxxo'];
    else if (opts.paid !== false) s.payment_method_types = ['card'];
    if (opts.amount) s.amount_total = opts.amount;
    return s;
  }

  reset() {
    this.sessions.clear(); this.invoices.clear(); this.calls = []; this.refunds = []; this.emails = []; this.idem.clear(); this.failNextInvoice = null;
  }

  stop() {
    return new Promise<void>((r) => this.server.close(() => r()));
  }
}
