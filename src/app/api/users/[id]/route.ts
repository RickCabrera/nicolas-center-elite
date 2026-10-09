import { route } from '@/lib/api';
import { badRequest } from '@/lib/errors';
import { assertLocation, assertUnique, EditUser, loadUser, PHYSICIAN_NEEDS_LICENSE } from '@/modules/team/server';

// EQ-03 · Detalle de un usuario con lo que el asistente de baja necesita saber. Solo dueño.
export const GET = route({ auth: 'owner' }, async ({ params, system }) =>
  system(async (tx) => {
    const user = await loadUser(tx, params.id);
    const [c] = await tx<{ patients_active: number; patients_inactive: number; future_appointments: number }[]>`
      select (select count(*)::int from patients p where p.therapist_id = ${user.id} and p.status = 'active') as patients_active,
             (select count(*)::int from patients p where p.therapist_id = ${user.id} and p.status <> 'active') as patients_inactive,
             (select count(*)::int from appointments a
               where a.therapist_id = ${user.id} and a.status = 'scheduled' and a.starts_at > now()) as future_appointments`;
    return { ...user, ...c };
  }),
);

const COLUMNS = ['full_name', 'title', 'username', 'email', 'specialty', 'location_id', 'phone',
  'license_number', 'license_institution', 'specialty_license', 'is_physician'] as const;

const CLINICAL_COLUMNS: readonly string[] = ['specialty', 'license_number', 'license_institution', 'specialty_license', 'is_physician'];

// EQ-03 · El dueño edita datos, cédula y la facultad de emitir recetas médicas. El rol no se cambia aquí.
// AUTH-10 · A una cuenta de recepción no se le guardan cédula, especialidad ni facultad de recetar.
export const PATCH = route({ auth: 'owner', body: EditUser }, async ({ params, body, system }) =>
  system(async (tx) => {
    const cur = await loadUser(tx, params.id);
    const patch: Record<string, unknown> = {};
    const columns = cur.role === 'reception' ? COLUMNS.filter((k) => !CLINICAL_COLUMNS.includes(k)) : COLUMNS;
    for (const k of columns) if (body[k] !== undefined) patch[k] = body[k];
    if (!Object.keys(patch).length) return cur;

    // Quitar `is_physician` no toca las recetas ya emitidas: cada documento guarda copia de los datos del emisor.
    const physician = cur.role === 'reception' ? false : body.is_physician ?? cur.is_physician;
    const licenseNo = body.license_number !== undefined ? body.license_number : cur.license_number;
    if (physician && !licenseNo) {
      throw badRequest(PHYSICIAN_NEEDS_LICENSE, { license_number: 'Un médico habilitado para recetar no puede quedar sin cédula.' });
    }
    await assertUnique(tx, {
      username: body.username && body.username !== cur.username.toLowerCase() ? body.username : undefined,
      email: body.email && body.email !== cur.email.toLowerCase() ? body.email : undefined,
    }, cur.id);
    if (body.location_id && body.location_id !== cur.location_id) await assertLocation(tx, body.location_id, cur.location_id);

    await tx`update users set ${tx(patch)} where id = ${cur.id}`;
    return loadUser(tx, cur.id);
  }),
);
