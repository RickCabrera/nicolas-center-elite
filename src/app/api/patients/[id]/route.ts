import { z } from 'zod';
import { route } from '@/lib/api';
import type { Tx } from '@/lib/db';
import { notFound } from '@/lib/errors';
import { catalogErrors, loadCatalogs, PATIENT_COLUMNS, PatientFields, patientRuleErrors, throwIfFields, type PatientInput } from '@/modules/patients/server';

const Id = z.uuid();

// AUTH-10 · `clinical: false` (recepción) deja fuera el motivo de consulta y las etiquetas.
async function loadPatient(db: Tx, id: string, clinical = true) {
  if (!Id.safeParse(id).success) return null;
  const [p] = await db`
    select p.id, p.record_number, p.full_name, p.sex, p.birth_date, age_years(p.birth_date) as age, p.curp, p.address,
           p.phone, p.email, p.emergency_name, p.emergency_phone, p.guardian_name, p.guardian_relationship, p.guardian_phone,
           p.location_id, l.name as location_name, p.therapist_id, u.full_name as therapist_name,
           trim(u.title || ' ' || u.full_name) as therapist_display,
           ${clinical ? db`p.tags, p.reason` : db`'{}'::text[] as tags, '' as reason`}, p.status, p.deactivated_at,
           p.deactivation_reason, p.hik_employee_no, p.fingerprint_enrolled_at, p.created_by, p.created_at, p.updated_at,
           b.plan_name, b.plan_kind, coalesce(b.state, 'sin_plan') as billing_state, b.next_due_date, b.sessions_remaining,
           jsonb_build_object(
             'privacy',   exists (select 1 from consents c where c.patient_id = p.id and c.kind = 'privacy'),
             'informed',  exists (select 1 from consents c where c.patient_id = p.id and c.kind = 'informed'),
             'biometric', exists (select 1 from consents c where c.patient_id = p.id and c.kind = 'biometric')) as consents
    from patients p
    join locations l on l.id = p.location_id
    join users u on u.id = p.therapist_id
    left join patient_billing b on b.patient_id = p.id
    where p.id = ${id}`;
  return p ?? null;
}

// Detalle del paciente: datos generales, cobranza y consentimientos firmados. 404 si RLS no lo deja ver.
export const GET = route({ auth: 'user' }, async ({ db, user, params }) => {
  const p = await loadPatient(db, params.id, user.role !== 'reception');
  if (!p) throw notFound('Paciente no encontrado.');
  return p;
});

// PAC-05 · Edita los datos generales. El fisioterapeuta se cambia en /assign y la membresía en Mensualidades.
// Acepta solo los campos que cambian; lo que no llega se conserva.
// AUTH-10 · Recepción edita datos generales y de contacto; el motivo de consulta y las etiquetas no (se ignoran).
export const PATCH = route({ auth: 'user', body: z.record(z.string(), z.unknown()) }, async ({ db, user, params, body }) => {
  const reception = user.role === 'reception';
  const [cur] = Id.safeParse(params.id).success
    ? await db<(PatientInput & { id: string })[]>`
        select id, full_name, birth_date, sex, phone, email, address, curp, emergency_name, emergency_phone,
               guardian_name, guardian_relationship, guardian_phone, location_id, tags, reason
        from patients where id = ${params.id} for update`
    : [];
  if (!cur) throw notFound('Paciente no encontrado.');   // RLS: si no es suyo, no existe

  const editable = reception ? PATIENT_COLUMNS.filter((k) => k !== 'reason' && k !== 'tags') : PATIENT_COLUMNS;
  const sent = Object.fromEntries(editable.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
  const next = PatientFields.parse({ ...cur, ...sent });   // un dato inválido responde 400 con su campo
  throwIfFields({
    ...patientRuleErrors(next),
    ...catalogErrors(next, await loadCatalogs(db), { keepTags: cur.tags, keepLocation: cur.location_id }),
  });

  await db`
    update patients set
      full_name = ${next.full_name}, birth_date = ${next.birth_date}, sex = ${next.sex}, phone = ${next.phone},
      email = ${next.email}, address = ${next.address}, curp = ${next.curp}, emergency_name = ${next.emergency_name},
      emergency_phone = ${next.emergency_phone}, guardian_name = ${next.guardian_name},
      guardian_relationship = ${next.guardian_relationship}, guardian_phone = ${next.guardian_phone},
      location_id = ${next.location_id}
      ${reception ? db`` : db`, tags = ${[...new Set(next.tags)]}::text[], reason = ${next.reason}`}
    where id = ${params.id}`;
  return loadPatient(db, params.id, !reception);
});
