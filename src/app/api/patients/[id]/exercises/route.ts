import { z } from 'zod';
import { route } from '@/lib/api';
import { requirePatient } from '@/modules/record/server';

type ExerciseRow = { id: string; patient_id: string; name: string; dosage: string; position: number; active: boolean; created_at: Date; updated_at: Date };

// EXP-03 · Ejercicios activos del plan, en el orden que definió el fisioterapeuta.
export const GET = route({ auth: 'user' }, async ({ db, params }) => {
  const patient = await requirePatient(db, params.id);
  return db<ExerciseRow[]>`
    select id, patient_id, name, dosage, position, active, created_at, updated_at
    from exercises where patient_id = ${patient.id} and active
    order by position, created_at`;
});

const Body = z.object({
  name: z.string().trim().min(1, 'Escribe el nombre del ejercicio.').max(120, 'Máximo 120 caracteres.'),
  dosage: z.string().trim().max(120, 'Máximo 120 caracteres.').default(''),
});

// EXP-03 · Agrega un ejercicio al final del plan.
export const POST = route({ auth: 'user', body: Body }, async ({ db, user, params, body }) => {
  const patient = await requirePatient(db, params.id);
  const [row] = await db<ExerciseRow[]>`
    insert into exercises (patient_id, name, dosage, position, created_by)
    values (${patient.id}, ${body.name}, ${body.dosage},
            (select coalesce(max(position), 0) + 1 from exercises where patient_id = ${patient.id} and active), ${user.id})
    returning id, patient_id, name, dosage, position, active, created_at, updated_at`;
  return row;
});
