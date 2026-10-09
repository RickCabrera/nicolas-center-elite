import { z } from 'zod';
import { route } from '@/lib/api';
import { notFound } from '@/lib/errors';

// AGE-07 · Quita un bloqueo. Es un DELETE real: el bloqueo es configuración de agenda, no dato clínico.
// RLS: el fisioterapeuta solo alcanza los suyos.
export const DELETE = route({ auth: 'clinical' }, async ({ db, params }) => {
  if (!z.uuid().safeParse(params.id).success) throw notFound('Bloqueo no encontrado.');
  const [row] = await db<{ id: string }[]>`delete from time_blocks where id = ${params.id} returning id`;
  if (!row) throw notFound('Bloqueo no encontrado.');
  return { id: row.id };
});
