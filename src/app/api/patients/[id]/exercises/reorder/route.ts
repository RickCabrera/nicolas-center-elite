import { z } from 'zod';
import { route } from '@/lib/api';
import { badRequest } from '@/lib/errors';
import { requirePatient } from '@/modules/record/server';

const Body = z.object({ ids: z.array(z.uuid()).min(1, 'Envía los ejercicios en su nuevo orden.').max(200) });

// EXP-03 · Guarda el orden de los ejercicios activos: la posición es el lugar de cada id en la lista.
export const POST = route({ auth: 'clinical', body: Body }, async ({ db, params, body }) => {
  const patient = await requirePatient(db, params.id);
  if (new Set(body.ids).size !== body.ids.length) throw badRequest('La lista tiene ejercicios repetidos.');
  const mine = await db<{ id: string }[]>`
    select id from exercises where patient_id = ${patient.id} and active and id = any(${body.ids}::uuid[])`;
  if (mine.length !== body.ids.length) throw badRequest('La lista incluye ejercicios que no pertenecen al plan de este paciente.');
  await db`
    update exercises e set position = x.ord
    from unnest(${body.ids}::uuid[]) with ordinality as x(id, ord)
    where e.id = x.id and e.patient_id = ${patient.id}`;
  return db`
    select id, patient_id, name, dosage, position, active, created_at, updated_at
    from exercises where patient_id = ${patient.id} and active
    order by position, created_at`;
});
