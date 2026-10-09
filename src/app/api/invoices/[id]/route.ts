import { z } from 'zod';
import { route } from '@/lib/api';
import { notFound } from '@/lib/errors';
import { cancel, email, refresh } from '@/modules/invoicing/server';

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cancel'), motive: z.enum(['01', '02', '03', '04'], 'Elige el motivo de cancelación.'), substitution_id: z.uuid().optional() }),
  z.object({ action: z.literal('refresh') }),
  z.object({ action: z.literal('email'), email: z.union([z.literal(''), z.email('Escribe un correo válido.')]).optional() }),
], 'Acción inválida.');

// FAC-04 · FAC-06 · Cancelar ante el SAT, consultar estado y reenviar por correo.
export const POST = route({ auth: 'owner', body: Body }, async ({ db, params, body }) => {
  if (!z.uuid().safeParse(params.id).success) throw notFound('Factura no encontrada.');
  switch (body.action) {
    case 'cancel': return { invoice: await cancel(db, params.id, body.motive, body.substitution_id) };
    case 'refresh': return { invoice: await refresh(db, params.id) };
    case 'email': return email(db, params.id, body.email || undefined);
  }
});
