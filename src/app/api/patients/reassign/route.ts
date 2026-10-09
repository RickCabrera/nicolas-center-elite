import { z } from 'zod';
import { route } from '@/lib/api';
import { reassignPatients, requireActiveTherapist } from '@/modules/patients/server';

const Body = z.object({
  patient_ids: z.array(z.uuid('Paciente inválido.')).min(1, 'Selecciona al menos un paciente.').max(2000, 'Máximo 2,000 pacientes por operación.'),
  to_therapist_id: z.uuid('Selecciona el fisioterapeuta destino.'),
  move_appointments: z.boolean().default(true),
});

// PAC-04 · Reasignación masiva (pantalla de Equipo). Mueve también las citas futuras sin empalme.
export const POST = route({ auth: 'owner', body: Body }, async ({ db, body }) => {
  const t = await requireActiveTherapist(db, body.to_therapist_id, 'to_therapist_id');
  return reassignPatients(db, body.patient_ids, t.id, body.move_appointments);
});
