import { z } from 'zod';
import { route } from '@/lib/api';
import { badRequest } from '@/lib/errors';
import { requirePatient } from '@/modules/record/server';

type NoteRow = {
  id: string; patient_id: string; appointment_id: string | null; addendum_of: string | null; body: string;
  pain_level: number | null; range_of_motion: string; noted_at: Date; author_id: string; author_name: string;
  author_license: string | null; signature_hash: string; created_at: Date;
};

// EXP-04 · Notas de evolución, la más reciente primero; cada nota lleva sus adendas en `addenda` (en orden cronológico).
export const GET = route({ auth: 'clinical' }, async ({ db, params }) => {
  const patient = await requirePatient(db, params.id);
  const rows = await db<NoteRow[]>`
    select id, patient_id, appointment_id, addendum_of, body, pain_level, range_of_motion, noted_at,
           author_id, author_name, author_license, signature_hash, created_at
    from evolution_notes where patient_id = ${patient.id}
    order by noted_at desc, created_at desc`;
  const byParent = new Map<string, NoteRow[]>();
  for (const r of rows) {
    if (!r.addendum_of) continue;
    const list = byParent.get(r.addendum_of) ?? [];
    list.unshift(r); // las filas vienen de la más nueva a la más vieja
    byParent.set(r.addendum_of, list);
  }
  return rows.filter((r) => !r.addendum_of).map((r) => ({ ...r, addenda: byParent.get(r.id) ?? [] }));
});

const Body = z.object({
  body: z.string().trim().min(1, 'Escribe la nota.').max(8000, 'Máximo 8,000 caracteres.'),
  pain_level: z.number().int().min(0).max(10).nullish(),
  range_of_motion: z.string().trim().max(200, 'Máximo 200 caracteres.').default(''),
  appointment_id: z.uuid().nullish(),
  addendum_of: z.uuid().nullish(),
});

// EXP-04 · Crea una nota firmada. El autor, la cédula, la hora y la firma los fija la base (trigger
// evolution_notes_sign) con el usuario de la sesión: lo que mande el cliente en esos campos se ignora.
// No hay PATCH ni DELETE: una nota firmada solo se corrige con una adenda.
export const POST = route({ auth: 'clinical', body: Body }, async ({ db, user, params, body, system }) => {
  const patient = await requirePatient(db, params.id);

  let addendumOf: string | null = null;
  if (body.addendum_of) {
    const [parent] = await db<{ id: string; addendum_of: string | null }[]>`
      select id, addendum_of from evolution_notes where id = ${body.addendum_of} and patient_id = ${patient.id}`;
    if (!parent) throw badRequest('La nota que quieres corregir no pertenece a este paciente.', { addendum_of: 'Nota no encontrada.' });
    addendumOf = parent.addendum_of ?? parent.id; // una adenda de adenda cuelga de la nota original
  }

  if (body.appointment_id) {
    // El acceso al paciente ya se validó; la cita solo debe ser suya (pudo atenderla otro fisioterapeuta).
    const [appt] = await system((tx) => tx`select 1 from appointments where id = ${body.appointment_id!} and patient_id = ${patient.id}`);
    if (!appt) throw badRequest('La cita indicada no es de este paciente.', { appointment_id: 'La cita no es de este paciente.' });
  }

  const [row] = await db<NoteRow[]>`
    insert into evolution_notes (patient_id, appointment_id, addendum_of, body, pain_level, range_of_motion,
                                 author_id, author_name, signature_hash)
    values (${patient.id}, ${body.appointment_id ?? null}, ${addendumOf}, ${body.body},
            ${addendumOf ? null : body.pain_level ?? null}, ${addendumOf ? '' : body.range_of_motion},
            ${user.id}, ${user.display_name}, 'pendiente')
    returning id, patient_id, appointment_id, addendum_of, body, pain_level, range_of_motion, noted_at,
              author_id, author_name, author_license, signature_hash, created_at`;
  return { ...row, addenda: [] };
});
