import { route } from '@/lib/api';
import { badRequest } from '@/lib/errors';
import { inviteUser } from '@/lib/auth/tokens';
import { assertLocation, assertUnique, lastEmailStatus, loadUser, NewUser, PHYSICIAN_NEEDS_LICENSE } from '@/modules/team/server';

// EQ-01 · Lista simple de usuarios para selectores y filtros (incluye al dueño). Solo dueño.
export const GET = route({ auth: 'owner' }, async ({ db, query }) => {
  const onlyActive = query.active === '1' || query.active === 'true';
  return db`
    select u.id, u.username, u.email, u.role, u.full_name, u.title, trim(u.title || ' ' || u.full_name) as display_name,
           u.specialty, u.location_id, l.name as location_name, u.is_physician, u.active
    from users u left join locations l on l.id = u.location_id
    ${onlyActive ? db`where u.active` : db``}
    order by (u.role = 'owner') desc, u.active desc, norm(u.full_name)`;
});

// EQ-02 / AUTH-03 · Alta de fisioterapeuta SIN contraseña: recibe un enlace de invitación para definirla.
// AUTH-10 · También da de alta a recepción: sin cédula, sin especialidad y sin facultad de recetar.
export const POST = route({ auth: 'owner', body: NewUser }, async ({ body: sent, system }) => {
  const body = sent.role === 'reception'
    ? { ...sent, specialty: '', license_number: null, license_institution: null, specialty_license: null, is_physician: false }
    : sent;
  if (body.is_physician && !body.license_number) {
    throw badRequest(PHYSICIAN_NEEDS_LICENSE, { license_number: 'Escribe la cédula profesional para marcarlo como médico.' });
  }
  return system(async (tx) => {
    await assertUnique(tx, { username: body.username, email: body.email });
    await assertLocation(tx, body.location_id);
    const [row] = await tx<{ id: string }[]>`
      insert into users (username, email, role, full_name, title, specialty, location_id, phone,
                         license_number, license_institution, specialty_license, is_physician)
      values (${body.username}, ${body.email}, ${body.role}, ${body.full_name}, ${body.title}, ${body.specialty},
              ${body.location_id}, ${body.phone}, ${body.license_number}, ${body.license_institution},
              ${body.specialty_license}, ${body.is_physician})
      returning id`;
    const [clinic] = await tx<{ name: string }[]>`select name from clinic`;
    const invite_link = await inviteUser(tx, { id: row.id, email: body.email, full_name: body.full_name }, clinic?.name ?? 'la clínica');
    const email_status = await lastEmailStatus(tx, body.email);
    return { user: await loadUser(tx, row.id), invite_link, email_status };
  });
});
