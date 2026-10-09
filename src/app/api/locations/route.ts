import { z } from 'zod';
import { route } from '@/lib/api';
import { LocationCode, LocationFields } from '@/modules/settings/location-schema';

// CFG-02 · Sedes. Todos las leen (selectores, también recepción); el dueño ve además cuántos pacientes, usuarios y documentos dependen de cada una.
export const GET = route({ auth: 'user' }, async ({ db, user }) => {
  if (user.role !== 'owner') {
    return db`select id, code, name, street, neighborhood, city, state, zip, phone, hours, active from locations order by active desc, name`;
  }
  return db`
    select l.id, l.code, l.name, l.street, l.neighborhood, l.city, l.state, l.zip, l.phone, l.hours, l.active, l.created_at, l.updated_at,
           (select count(*)::int from patients p where p.location_id = l.id and p.status = 'active') as active_patients,
           (select count(*)::int from users u where u.location_id = l.id and u.active) as active_users,
           (select count(*)::int from documents d where d.location_id = l.id) as documents_count
    from locations l order by l.active desc, l.name`;
});

const Create = z.object({
  code: LocationCode,
  name: LocationFields.name,
  street: LocationFields.street.default(''),
  neighborhood: LocationFields.neighborhood.default(''),
  city: LocationFields.city.default(''),
  state: LocationFields.state.default('Veracruz'),
  zip: LocationFields.zip.default(''),
  phone: LocationFields.phone.default(''),
  hours: LocationFields.hours.default(''),
});

// CFG-02 · Alta de sede (solo dueño). La clave se usa en los folios: COR-RX-000001. Clave o nombre repetido → 409.
export const POST = route({ auth: 'owner', body: Create }, async ({ db, body }) => {
  const [row] = await db`
    insert into locations ${db(body, 'code', 'name', 'street', 'neighborhood', 'city', 'state', 'zip', 'phone', 'hours')}
    returning id, code, name, street, neighborhood, city, state, zip, phone, hours, active`;
  return row;
});
