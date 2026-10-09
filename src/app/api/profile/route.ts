import { z } from 'zod';
import { route } from '@/lib/api';
import type { Tx } from '@/lib/db';
import { badRequest, notFound } from '@/lib/errors';
import { assertUnique, email, fullName, license, phone, title } from '@/modules/team/server';

async function ownProfile(tx: Tx, id: string) {
  const [u] = await tx`
    select u.id, u.username, u.email, u.role, u.full_name, u.title, trim(u.title || ' ' || u.full_name) as display_name,
           u.specialty, u.phone, u.location_id, l.name as location_name, u.license_number, u.license_institution,
           u.specialty_license, u.is_physician, u.fingerprint_enrolled_at, u.last_login_at, u.created_at
    from users u left join locations l on l.id = u.location_id where u.id = ${id}`;
  if (!u) throw notFound('Usuario no encontrado.');
  return u;
}

// CFG-08 · Datos propios del usuario en sesión.
export const GET = route({ auth: 'user' }, async ({ db, user }) => ownProfile(db, user.id));

const optionalText = (max: number) =>
  z.string().trim().max(max, `Máximo ${max} caracteres.`).nullish().transform((v) => (v ? v : null)).optional();

const Body = z.object({
  full_name: fullName.optional(),
  title: title.optional(),
  phone: phone.optional(),
  specialty: z.string().trim().max(120, 'Máximo 120 caracteres.').optional(),
  email: email.optional(),
  license_number: license.optional(),
  license_institution: optionalText(160),
  specialty_license: license.optional(),
  // Estos NO los cambia el propio usuario: si llegan, se rechazan con un mensaje claro.
  username: z.unknown().optional(),
  role: z.unknown().optional(),
  location_id: z.unknown().optional(),
  is_physician: z.unknown().optional(),
  active: z.unknown().optional(),
});

const OWN_COLUMNS = ['full_name', 'title', 'phone', 'specialty', 'email', 'license_number', 'license_institution', 'specialty_license'] as const;
const OWNER_ONLY: Record<string, string> = {
  username: 'El nombre de usuario solo lo cambia el dueño desde Equipo.',
  role: 'El rol de la cuenta no se puede cambiar.',
  location_id: 'La sede la asigna el dueño desde Equipo.',
  is_physician: 'La facultad de emitir recetas médicas la habilita el dueño desde Equipo.',
  active: 'El estado de la cuenta lo cambia el dueño desde Equipo.',
};

// CFG-08 · El usuario edita SUS datos. Usuario, rol, sede y la facultad de recetar son del dueño.
export const PATCH = route({ auth: 'user', body: Body }, async ({ user, body, system }) => {
  const denied: Record<string, string> = {};
  for (const k of Object.keys(OWNER_ONLY)) if ((body as Record<string, unknown>)[k] !== undefined) denied[k] = OWNER_ONLY[k];
  if (Object.keys(denied).length) throw badRequest(Object.values(denied)[0], denied);

  return system(async (tx) => {
    const patch: Record<string, unknown> = {};
    for (const k of OWN_COLUMNS) if (body[k] !== undefined) patch[k] = body[k];
    if (Object.keys(patch).length) {
      const [cur] = await tx<{ email: string; is_physician: boolean; license_number: string | null }[]>`
        select email, is_physician, license_number from users where id = ${user.id} for update`;
      if (!cur) throw notFound('Usuario no encontrado.');
      const licenseNo = body.license_number !== undefined ? body.license_number : cur.license_number;
      if (cur.is_physician && !licenseNo) {
        throw badRequest('Estás habilitado para emitir recetas médicas: tu cédula profesional no puede quedar vacía.',
          { license_number: 'La cédula es obligatoria para un médico habilitado.' });
      }
      if (body.email && body.email !== cur.email.toLowerCase()) await assertUnique(tx, { email: body.email }, user.id);
      await tx`update users set ${tx(patch)} where id = ${user.id}`;
    }
    return ownProfile(tx, user.id);
  });
});
