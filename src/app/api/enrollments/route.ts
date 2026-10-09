import { z } from 'zod';
import { route, type RouteCtx } from '@/lib/api';
import { conflict } from '@/lib/errors';
import { asciiName, enqueueCommand, listDevices, loadPerson, pickDevice, queuePersonRemoval } from '@/modules/attendance/server';

const PersonRef = z.object({
  person_type: z.enum(['patient', 'staff']),
  person_id: z.uuid(),
});
const Body = PersonRef.extend({
  device_id: z.uuid().optional(),
  action: z.enum(['enroll', 'remove']).default('enroll'),
});

// HUE-07 · Estado de la huella de una persona: si ya está registrada, en qué lector y si falta el consentimiento.
export const GET = route({ auth: 'user', query: PersonRef }, async ({ db, user, query, system }) => {
  const person = await loadPerson(db, user, query.person_type, query.person_id);
  let has_consent = true;
  if (person.type === 'patient') {
    const [c] = await db`select 1 from consents where patient_id = ${person.id} and kind = 'biometric' limit 1`;
    has_consent = !!c;
  }
  return system(async (tx) => {
    const device = await pickDevice(tx, person);
    const who = person.type === 'patient' ? tx`e.patient_id = ${person.id}` : tx`e.user_id = ${person.id}`;
    const enrollments = await tx`
      select e.device_id, d.name as device_name, e.status, e.enrolled_at
      from enrollments e join devices d on d.id = e.device_id where ${who} and e.status <> 'removed' order by e.created_at`;
    return {
      person_type: person.type, person_id: person.id, enrolled_at: person.enrolled_at, has_consent,
      device: device ? { id: device.id, name: device.name, online: device.online, bridge_online: device.bridge_online } : null,
      enrollments,
    };
  });
});

type Ctx = RouteCtx<z.infer<typeof Body>, Record<string, string>>;

// HUE-13 · Encola el borrado de la persona en cada lector donde esté dada de alta.
async function remove({ db, user, body, system }: Pick<Ctx, 'db' | 'user' | 'system'> & { body: z.infer<typeof PersonRef> }) {
  const person = await loadPerson(db, user, body.person_type, body.person_id);
  const r = await system((tx) => queuePersonRemoval(tx, { personType: person.type, personId: person.id, createdBy: user.id }));
  const devices = r.command_ids.length ? await system((tx) => listDevices(tx, { onlyActive: true })) : [];
  return {
    command_ids: r.command_ids,
    command_id: r.command_ids[0] ?? null,
    removed_now: r.command_ids.length === 0,
    bridge_online: devices.some((d) => d.bridge_online),
  };
}

/**
 * HUE-07 · Inicia el registro de huella: valida permiso y consentimiento, elige el lector y encola la orden
 * para el agente puente. La captura ocurre en el lector; a la nube solo vuelve "listo" o el error.
 */
export const POST = route({ auth: 'user', body: Body }, async (ctx) => {
  const { db, user, body, system } = ctx;
  if (body.action === 'remove') return remove(ctx);

  const person = await loadPerson(db, user, body.person_type, body.person_id);
  if (!person.active) throw conflict(person.type === 'patient' ? 'El paciente está dado de baja.' : 'La persona está dada de baja.');

  if (person.type === 'patient') {
    // La huella es un dato sensible: sin consentimiento firmado no se captura.
    const [c] = await db`select 1 from consents where patient_id = ${person.id} and kind = 'biometric' limit 1`;
    if (!c) throw conflict('Falta firmar el consentimiento de huella.', 'consent_required');
  }

  return system(async (tx) => {
    const device = await pickDevice(tx, person, body.device_id);
    if (!device) throw conflict('No hay un lector activo en la sede.', 'no_device');

    const ref = { patientId: person.type === 'patient' ? person.id : null, userId: person.type === 'staff' ? person.id : null };
    const who = person.type === 'patient' ? tx`patient_id = ${person.id}` : tx`user_id = ${person.id}`;

    // Doble clic o reintento: se reutiliza la orden que ya está en curso.
    const [dup] = await tx<{ id: string }[]>`
      select id from device_commands
      where device_id = ${device.id} and kind = 'enroll_fingerprint' and status in ('pending','running') and ${who}
      order by created_at desc limit 1`;
    if (dup) return { command_id: dup.id, device_id: device.id, device_name: device.name, bridge_online: device.bridge_online };

    await tx`
      insert into enrollments (device_id, person_type, patient_id, user_id, employee_no, status)
      values (${device.id}, ${person.type}, ${ref.patientId}, ${ref.userId}, ${person.employee_no}, 'pending')
      on conflict (device_id, employee_no) do update
        set status = case when enrollments.status = 'enrolled' then 'enrolled' else 'pending' end, removed_at = null`;
    const command_id = await enqueueCommand(tx, {
      deviceId: device.id, kind: 'enroll_fingerprint',
      payload: { employee_no: person.employee_no, name: asciiName(person.name) || person.employee_no, finger_no: 1 },
      createdBy: user.id, personType: person.type, ...ref,
    });
    return { command_id, device_id: device.id, device_name: device.name, bridge_online: device.bridge_online };
  });
});

export const DELETE = route({ auth: 'user', body: PersonRef }, async (ctx) => remove(ctx));
