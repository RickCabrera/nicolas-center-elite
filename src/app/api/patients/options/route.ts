import { route } from '@/lib/api';

// Lista ligera de pacientes activos para selectores (cita, receta, estudio). RLS limita al fisioterapeuta a los suyos.
export const GET = route({ auth: 'user' }, async ({ db }) =>
  db`select id, full_name, record_number, therapist_id, location_id from patients where status = 'active' order by full_name`,
);
