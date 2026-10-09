import { z } from 'zod';
import { route } from '@/lib/api';
import { notFound } from '@/lib/errors';
import { reassignPatients, requireActiveTherapist } from '@/modules/patients/server';

const Body = z.object({
  therapist_id: z.uuid('Selecciona el fisioterapeuta.'),
  move_appointments: z.boolean().default(true),
});

// PAC-04 · El dueño reasigna a un paciente. El historial queda en patient_assignments (trigger).
export const POST = route({ auth: 'owner', body: Body }, async ({ db, params, body }) => {
  const [p] = z.uuid().safeParse(params.id).success ? await db`select id from patients where id = ${params.id} for update` : [];
  if (!p) throw notFound('Paciente no encontrado.');
  const t = await requireActiveTherapist(db, body.therapist_id);
  const r = await reassignPatients(db, [params.id], t.id, body.move_appointments);
  return { id: params.id, therapist_id: t.id, therapist_display: t.display_name, ...r };
});
