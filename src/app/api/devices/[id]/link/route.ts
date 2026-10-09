import { z } from 'zod';
import { route } from '@/lib/api';
import { conflict, notFound } from '@/lib/errors';

const Body = z.object({
  employee_no: z.string().trim().min(1, 'Falta el número de la persona en el lector.').max(32),
  person_type: z.enum(['patient', 'staff']),
  person_id: z.uuid(),
  has_fingerprint: z.boolean().default(true),
});

/**
 * Vincula a una persona que YA existe en el lector (dada de alta antes del sistema, por ejemplo con su
 * huella registrada) con un paciente o alguien del equipo. A partir de ahí sus lecturas cuentan como su
 * asistencia, sin volver a registrar la huella. Las lecturas pasadas que llegaron como "no reconocido"
 * con ese número se reasignan. Solo dueño.
 */
export const POST = route({ auth: 'owner', body: Body }, async ({ params, body, system }) => {
  if (!z.uuid().safeParse(params.id).success) throw notFound('Lector no encontrado.');
  return system(async (tx) => {
    const [d] = await tx<{ id: string }[]>`select id from devices where id = ${params.id} and active`;
    if (!d) throw notFound('Lector no encontrado.');
    const table = body.person_type === 'patient' ? tx`patients` : tx`users`;
    const [taken] = await tx<{ who: string }[]>`
      select full_name as who from patients where hik_employee_no = ${body.employee_no} and id <> ${body.person_id}
      union all select full_name from users where hik_employee_no = ${body.employee_no} and id <> ${body.person_id}`;
    if (taken) throw conflict(`El número ${body.employee_no} ya está vinculado a ${taken.who}.`, 'employee_no_taken');
    const [person] = await tx<{ id: string; name: string; hik_employee_no: string }[]>`
      select id, full_name as name, hik_employee_no from ${table} where id = ${body.person_id}`;
    if (!person) throw notFound(body.person_type === 'patient' ? 'Paciente no encontrado.' : 'Usuario no encontrado.');

    // Su número anterior deja de usarse en este lector.
    await tx`update enrollments set status = 'removed', removed_at = now()
             where device_id = ${d.id} and employee_no = ${person.hik_employee_no} and status <> 'removed'`;
    await tx`update ${table} set hik_employee_no = ${body.employee_no},
             fingerprint_enrolled_at = case when ${body.has_fingerprint} then coalesce(fingerprint_enrolled_at, now()) else fingerprint_enrolled_at end
             where id = ${person.id}`;
    await tx`
      insert into enrollments (device_id, person_type, patient_id, user_id, employee_no, status, enrolled_at)
      values (${d.id}, ${body.person_type}, ${body.person_type === 'patient' ? person.id : null}, ${body.person_type === 'staff' ? person.id : null},
              ${body.employee_no}, ${body.has_fingerprint ? 'enrolled' : 'pending'}, ${body.has_fingerprint ? new Date() : null})
      on conflict (device_id, employee_no) do update set person_type = excluded.person_type, patient_id = excluded.patient_id,
        user_id = excluded.user_id, status = excluded.status, enrolled_at = excluded.enrolled_at, removed_at = null`;
    const reassigned = await tx`
      update attendance_events set person_type = ${body.person_type},
             patient_id = ${body.person_type === 'patient' ? person.id : null}, user_id = ${body.person_type === 'staff' ? person.id : null},
             person_name = ${person.name}
       where employee_no = ${body.employee_no} and person_type = 'unknown'
       returning id`;
    await tx`select log_event('security', ${`Vinculó la persona ${body.employee_no} del lector con ${person.name}`}, ${body.person_type === 'patient' ? person.id : null}, ${body.person_type === 'patient' ? 'patients' : 'users'}, ${person.id})`;
    return { linked: true, employee_no: body.employee_no, reassigned_events: reassigned.length };
  });
});
