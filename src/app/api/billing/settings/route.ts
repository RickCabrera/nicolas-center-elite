import { z } from 'zod';
import { route } from '@/lib/api';
import { env } from '@/lib/env';
import { badRequest } from '@/lib/errors';
import { facturapiConfigured, facturapiLiveMode } from '@/lib/integrations/facturapi';
import { stripeConfigured, stripeLiveMode } from '@/lib/integrations/stripe';
import { BILLING_DEFAULTS, readBillingSettings } from '@/modules/invoicing/catalogs';

async function view(db: Parameters<Parameters<typeof route>[1]>[0]['db']) {
  const [c] = await db<{ settings: unknown }[]>`select settings from clinic`;
  const e = env();
  return {
    settings: readBillingSettings(c?.settings),
    integrations: {
      stripe: { configured: stripeConfigured(), live: stripeConfigured() && stripeLiveMode(), webhook_configured: !!e.STRIPE_WEBHOOK_SECRET },
      facturapi: { configured: facturapiConfigured(), live: facturapiConfigured() && facturapiLiveMode() },
      webhook_url: `${e.APP_URL.replace(/\/$/, '')}/api/webhooks/stripe`,
    },
  };
}

// PAG-12 · FAC-05 · Parámetros de cobro en línea y facturación, y estado de las conexiones (solo dueño).
export const GET = route({ auth: 'owner' }, async ({ db }) => view(db));

const Body = z.object({
  online_payments_enabled: z.boolean().optional(),
  oxxo_enabled: z.boolean().optional(),
  payment_link_hours: z.number().int().min(1, 'Entre 1 y 24 horas.').max(24, 'Stripe permite como máximo 24 horas.').optional(),
  oxxo_days: z.number().int().min(1, 'Entre 1 y 14 días.').max(14, 'Entre 1 y 14 días.').optional(),
  invoice_product_key: z.string().regex(/^\d{8}$/, 'La clave de producto SAT tiene 8 dígitos.').optional(),
  invoice_unit_key: z.string().trim().regex(/^[A-Z0-9]{2,3}$/, 'Clave de unidad SAT inválida (por ejemplo E48).').optional(),
  invoice_tax: z.enum(['iva16', 'exento'], 'Elige cómo se trata el IVA.').optional(),
  invoice_series: z.string().trim().regex(/^[A-Z]{0,10}$/, 'Solo letras mayúsculas, máximo 10.').optional(),
  invoice_zip: z.union([z.literal(''), z.string().regex(/^\d{5}$/, 'El código postal tiene 5 dígitos.')]).optional(),
  invoice_default_use: z.string().regex(/^[A-Z]{1,2}\d{2}$/, 'Uso de CFDI inválido.').optional(),
});

export const PATCH = route({ auth: 'owner', body: Body }, async ({ db, body }) => {
  const patch = Object.fromEntries(Object.entries(body).filter(([k, v]) => v !== undefined && k in BILLING_DEFAULTS));
  if (!Object.keys(patch).length) throw badRequest('No hay cambios que guardar.');
  await db`update clinic set settings = settings || ${db.json(patch as never)}`;
  return view(db);
});
