import { z } from 'zod';
import { route } from '@/lib/api';
import { badRequest, conflict, notFound } from '@/lib/errors';
import { LocationCode, LocationFields } from '@/modules/settings/location-schema';

const Body = z.object({
  code: LocationCode.optional(),
  name: LocationFields.name.optional(),
  street: LocationFields.street.optional(),
  neighborhood: LocationFields.neighborhood.optional(),
  city: LocationFields.city.optional(),
  state: LocationFields.state.optional(),
  zip: LocationFields.zip.optional(),
  phone: LocationFields.phone.optional(),
  hours: LocationFields.hours.optional(),
  active: z.boolean().optional(),
});
const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// CFG-02 · Edita o desactiva una sede (solo dueño). No existe DELETE: los folios y expedientes la referencian.
export const PATCH = route({ auth: 'owner', body: Body }, async ({ db, params, body }) => {
  if (!z.uuid().safeParse(params.id).success) throw notFound('Sede no encontrada.');
  const [loc] = await db<{ id: string; code: string; name: string; active: boolean }[]>`
    select id, code, name, active from locations where id = ${params.id} for update`;
  if (!loc) throw notFound('Sede no encontrada.');

  const patch: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(body)) if (v !== undefined) patch[k] = v as string | boolean;
  if (!Object.keys(patch).length) throw badRequest('No hay cambios que guardar.');

  if (body.code !== undefined && body.code !== loc.code) {
    // La clave ya quedó impresa en folios emitidos: cambiarla rompería la serie consecutiva.
    const [{ docs }] = await db<{ docs: number }[]>`
      select (select count(*) from documents where location_id = ${loc.id})::int as docs`;
    if (docs > 0) {
      const msg = `La clave no puede cambiarse: la sede ya tiene ${n(docs, 'documento emitido', 'documentos emitidos')} con el folio ${loc.code}-…`;
      throw conflict(msg, 'code_in_use');
    }
  }

  if (body.active === false && loc.active) {
    const [c] = await db<{ patients: number; users: number; others: number }[]>`
      select (select count(*) from patients where location_id = ${loc.id} and status = 'active')::int as patients,
             (select count(*) from users where location_id = ${loc.id} and active)::int as users,
             (select count(*) from locations where active and id <> ${loc.id})::int as others`;
    if (c.patients > 0 || c.users > 0) {
      const parts = [c.patients > 0 && n(c.patients, 'paciente activo', 'pacientes activos'), c.users > 0 && n(c.users, 'usuario activo asignado', 'usuarios activos asignados')].filter(Boolean);
      throw conflict(`No se puede desactivar ${loc.name}: tiene ${parts.join(' y ')}. Reasígnalos a otra sede primero.`, 'location_in_use');
    }
    if (c.others === 0) throw conflict('Debe quedar al menos una sede activa.', 'last_location');
  }

  const [row] = await db`
    update locations set ${db(patch, ...Object.keys(patch))} where id = ${loc.id}
    returning id, code, name, street, neighborhood, city, state, zip, phone, hours, active`;
  return row;
});
