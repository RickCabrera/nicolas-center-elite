import { z } from 'zod';
import { route } from '@/lib/api';
import type { Tx } from '@/lib/db';
import { AppError, badRequest, conflict } from '@/lib/errors';
import { queuePersonRemoval } from '@/modules/attendance/server';
import { loadUser } from '@/modules/team/server';

const Body = z.object({
  reassign_to: z.uuid('Fisioterapeuta destino inválido.').nullish().transform((v) => v ?? null),
  patients: z.record(z.uuid('Paciente inválido.'), z.uuid('Fisioterapeuta destino inválido.')).default({}),
});

const CANCEL_REASON = 'Fisioterapeuta dado de baja';

type Appt = { id: string; starts_at: Date; patient_name: string; to_name: string; reason?: string };

/** HUE-13 · Si tenía huella, encola su baja en cada lector (la ejecuta el agente puente). */
async function removeFingerprint(tx: Tx, userId: string, ownerId: string): Promise<'queued' | 'none'> {
  const [e] = await tx<{ n: number }[]>`
    select count(*)::int as n from enrollments where user_id = ${userId} and status in ('pending', 'enrolled')`;
  const [u] = await tx<{ enrolled: boolean }[]>`select (fingerprint_enrolled_at is not null) as enrolled from users where id = ${userId}`;
  if (!e.n && !u?.enrolled) return 'none';
  await queuePersonRemoval(tx, { personType: 'staff', personId: userId, createdBy: ownerId });
  return 'queued';
}

// EQ-04 / AUTH-09 · Baja de un fisioterapeuta. Todo ocurre en UNA transacción: o se reasigna y se
// desactiva completo, o no cambia nada. Sus notas, recetas y firmas no se tocan (son inmutables y
// guardan copia de su nombre y cédula).
export const POST = route({ auth: 'owner', body: Body }, async ({ params, body, user, system }) =>
  system(async (tx) => {
    const target = await loadUser(tx, params.id);
    if (target.role === 'owner') throw new AppError(403, 'forbidden', 'La cuenta del dueño no se puede desactivar.');
    if (target.id === user.id) throw new AppError(403, 'forbidden', 'No puedes desactivar tu propia cuenta.');
    if (!target.active) throw conflict('Esta cuenta ya está desactivada.', 'inactive');

    // Bloquea la fila: dos bajas simultáneas no se pisan.
    await tx`select id from users where id = ${target.id} for update`;

    const mine = await tx<{ id: string; full_name: string; status: string }[]>`
      select id, full_name, status from patients where therapist_id = ${target.id} order by norm(full_name) for update`;
    const active = mine.filter((p) => p.status === 'active');
    const mineIds = new Set(mine.map((p) => p.id));

    const foreign = Object.keys(body.patients).filter((id) => !mineIds.has(id));
    if (foreign.length) throw badRequest('La lista incluye pacientes que no están asignados a este fisioterapeuta.', { patients: 'Hay pacientes que no son de este fisioterapeuta.' });

    // Destinos: otro fisioterapeuta ACTIVO, nunca el mismo que se da de baja.
    const destIds = [...new Set([body.reassign_to, ...Object.values(body.patients)].filter((x): x is string => !!x))];
    if (destIds.includes(target.id)) throw badRequest('El destino no puede ser el mismo fisioterapeuta que se desactiva.', { reassign_to: 'Elige a otra persona.' });
    const dests = destIds.length
      ? await tx<{ id: string; display_name: string }[]>`
          select id, trim(title || ' ' || full_name) as display_name from users
          where id = any(${destIds}::uuid[]) and role = 'therapist' and active for share`
      : [];
    if (dests.length !== destIds.length) throw badRequest('El destino debe ser un fisioterapeuta activo.', { reassign_to: 'Elige un fisioterapeuta activo.' });
    const destName = new Map(dests.map((d) => [d.id, d.display_name]));

    // A quién pasa cada paciente: lo indicado para él o, si no, el destino general.
    const destOf = new Map<string, string>();
    for (const p of mine) {
      const d = body.patients[p.id] ?? body.reassign_to;
      if (d) destOf.set(p.id, d);
    }
    const unassigned = active.filter((p) => !destOf.has(p.id));

    const appts = await tx<{ id: string; patient_id: string; starts_at: Date; ends_at: Date; duration_min: number; patient_name: string; patient_therapist: string; patient_therapist_ok: boolean }[]>`
      select a.id, a.patient_id, a.starts_at, a.ends_at, a.duration_min, p.full_name as patient_name,
             p.therapist_id as patient_therapist, (pu.active and pu.role = 'therapist') as patient_therapist_ok
      from appointments a
      join patients p on p.id = a.patient_id
      join users pu on pu.id = p.therapist_id
      where a.therapist_id = ${target.id} and a.status = 'scheduled' and a.starts_at > now()
      order by a.starts_at for update of a`;
    // Una cita suya con un paciente de otro colega pasa al fisioterapeuta de ese paciente.
    const apptDest = (a: (typeof appts)[number]) =>
      destOf.get(a.patient_id) ?? (a.patient_therapist !== target.id && a.patient_therapist_ok ? a.patient_therapist : body.reassign_to);
    const orphanAppts = appts.filter((a) => !apptDest(a));

    if (unassigned.length || orphanAppts.length) {
      const parts = [
        active.length ? `${active.length} paciente${active.length === 1 ? '' : 's'} activo${active.length === 1 ? '' : 's'}` : '',
        appts.length ? `${appts.length} cita${appts.length === 1 ? '' : 's'} futura${appts.length === 1 ? '' : 's'}` : '',
      ].filter(Boolean).join(' y ');
      const missing = unassigned.length && Object.keys(body.patients).length
        ? ` Faltan por asignar: ${unassigned.slice(0, 5).map((p) => p.full_name).join(', ')}${unassigned.length > 5 ? '…' : ''}.` : '';
      const err = new AppError(409, 'needs_reassign',
        `${target.display_name} tiene ${parts}. Elige a qué fisioterapeuta pasan antes de desactivar la cuenta.${missing}`,
        { reassign_to: 'Elige el fisioterapeuta destino.' });
      throw err;
    }

    // 1. Pacientes (el trigger `patients_track_assignment` escribe el historial de asignación).
    let patients_moved = 0;
    const byDest = new Map<string, string[]>();
    for (const [pid, d] of destOf) byDest.set(d, [...(byDest.get(d) ?? []), pid]);
    for (const [d, ids] of byDest) {
      const r = await tx`update patients set therapist_id = ${d} where id = any(${ids}::uuid[]) and therapist_id = ${target.id}`;
      patients_moved += r.count;
    }

    // 2. Citas futuras programadas: se mueven si el destino está libre; si se empalman, se cancelan con motivo.
    //    Una por una, para que cada cita movida cuente al revisar la siguiente.
    let appointments_moved = 0;
    const appointments_cancelled: Appt[] = [];
    const appointments_review: Appt[] = [];
    for (const a of appts) {
      const d = apptDest(a)!;
      const to_name = destName.get(d) ?? (await tx<{ n: string }[]>`select trim(title || ' ' || full_name) as n from users where id = ${d}`)[0]?.n ?? '';
      const [done] = await tx<{ id: string }[]>`
        update appointments a set therapist_id = ${d}
        where a.id = ${a.id}
          and not exists (
            select 1 from appointments o
            where o.therapist_id = ${d} and o.status <> 'cancelled' and o.id <> a.id
              and tstzrange(o.starts_at, o.ends_at) && tstzrange(a.starts_at, a.ends_at))
        returning a.id`;
      if (!done) {
        await tx`update appointments set status = 'cancelled', cancel_reason = ${CANCEL_REASON}, cancelled_at = now() where id = ${a.id}`;
        appointments_cancelled.push({ id: a.id, starts_at: a.starts_at, patient_name: a.patient_name, to_name });
        continue;
      }
      appointments_moved++;
      // Se movió, pero cae fuera del horario o en un bloqueo del destino: se avisa para reprogramarla.
      const [why] = await tx<{ problem: string | null }[]>`select appointment_slot_problem(${d}, ${a.starts_at}, ${a.duration_min}) as problem`;
      if (why?.problem) appointments_review.push({ id: a.id, starts_at: a.starts_at, patient_name: a.patient_name, to_name, reason: why.problem });
    }

    // 3. La cuenta: inactiva, sin sesiones y sin enlaces de acceso vigentes.
    await tx`update users set active = false, deactivated_at = now() where id = ${target.id}`;
    const revoked = await tx`update sessions set revoked_at = now() where user_id = ${target.id} and revoked_at is null`;
    await tx`update auth_tokens set used_at = now() where user_id = ${target.id} and used_at is null`;
    await tx`delete from webauthn_challenges where user_id = ${target.id}`;

    // 4. Su huella deja de abrir asistencia en el lector de recepción.
    const fingerprint_removal = await removeFingerprint(tx, target.id, user.id);

    await tx`select log_event('security', ${`Baja de ${target.display_name}: ${patients_moved} pacientes reasignados, ${appointments_moved} citas movidas, ${appointments_cancelled.length} canceladas`}, null, 'users', ${target.id})`;
    return {
      user: await loadUser(tx, target.id),
      patients_moved, appointments_moved, appointments_cancelled, appointments_review,
      sessions_revoked: revoked.count, fingerprint_removal,
    };
  }),
);
