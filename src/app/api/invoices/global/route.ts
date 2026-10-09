import { z } from 'zod';
import { route } from '@/lib/api';
import { globalPreview, issueGlobal } from '@/modules/invoicing/server';

const Period = {
  year: z.coerce.number('Año inválido.').int().min(2024, 'Año inválido.').max(2100, 'Año inválido.'),
  month: z.coerce.number('Mes inválido.').int().min(1, 'Mes inválido.').max(12, 'Mes inválido.'),
};

// FAC-03 · Vista previa de la factura global del mes: pagos sin factura agrupados por forma de pago.
export const GET = route({ auth: 'owner', query: z.object(Period) }, async ({ db, query }) => globalPreview(db, query.year, query.month));

// FAC-03 · Timbra la factura global del mes (a PÚBLICO EN GENERAL) para una forma de pago.
export const POST = route({ auth: 'owner', body: z.object({ ...Period, payment_form: z.string().regex(/^\d{2}$/, 'Forma de pago inválida.') }) },
  async ({ db, user, body }) => issueGlobal(db, user, body));
