import { z } from 'zod';
import { route } from '@/lib/api';
import { badRequest, notFound } from '@/lib/errors';
import { isUuid, requirePatient } from '@/modules/record/server';

const Body = z.object({
  name: z.string().trim().min(1, 'Escribe el nombre del ejercicio.').max(120, 'Máximo 120 caracteres.').optional(),
  dosage: z.string().trim().max(120, 'Máximo 120 caracteres.').optional(),
  active: z.boolean().optional(),
});

// EXP-03 · Edita nombre o dosis, o quita el ejercicio del plan (`active: false`). Nunca se borra.
export const PATCH = route({ auth: 'clinical', body: Body }, async ({ db, params, body }) => {
  const patient = await requirePatient(db, params.id);
  if (!isUuid(params.exerciseId)) throw notFound('Ejercicio no encontrado.');
  if (body.name === undefined && body.dosage === undefined && body.active === undefined) throw badRequest('No hay cambios que guardar.');
  const [row] = await db`
    update exercises set
      name = coalesce(${body.name ?? null}, name),
      dosage = coalesce(${body.dosage ?? null}, dosage),
      active = coalesce(${body.active ?? null}, active)
    where id = ${params.exerciseId} and patient_id = ${patient.id}
    returning id, patient_id, name, dosage, position, active, created_at, updated_at`;
  if (!row) throw notFound('Ejercicio no encontrado.');
  return row;
});
