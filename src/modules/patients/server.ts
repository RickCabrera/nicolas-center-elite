import { z } from 'zod';
import type { Tx } from '@/lib/db';
import { ageFrom, parseDateInput, todayIso } from '@/lib/dates';
import { badRequest } from '@/lib/errors';

/**
 * Reglas de servidor compartidas por el alta, la edición y el importador de pacientes
 * (PAC-03, PAC-05, PAC-09). Nada de esto confía en lo que valide el navegador.
 */

const digits = (s: string) => s.replace(/\D/g, '').length;
const phone = z.string().trim().max(30, 'Máximo 30 caracteres.').refine(
  (v) => v === '' || (/^[+\d(][\d\s().-]*$/.test(v) && digits(v) >= 10 && digits(v) <= 15),
  'Escribe un teléfono de 10 dígitos.',
);
const text = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres.`);

/** Datos generales del paciente. La edad NO es un campo: sale de la fecha de nacimiento. */
export const PatientFields = z.object({
  full_name: z.string().trim().min(2, 'Escribe el nombre completo.').max(120, 'Máximo 120 caracteres.')
    .transform((v) => v.replace(/\s+/g, ' ')),
  birth_date: z.string().trim().min(1, 'Escribe la fecha de nacimiento.')
    .transform((v) => parseDateInput(v))
    .refine((v) => v !== null, 'Fecha inválida. Usa el formato DD/MM/AAAA.')
    .transform((v) => v as string),
  // Obligatorio en el alta (lo exige la ruta); opcional al importar registros históricos.
  sex: z.preprocess((v) => (v === '' ? null : v), z.enum(['F', 'M', 'X'], 'Selecciona el sexo.').nullish()).transform((v) => v ?? null),
  phone: phone.default(''),
  email: z.string().trim().max(120, 'Máximo 120 caracteres.')
    .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), 'Escribe un correo válido.').default(''),
  address: text(240).default(''),
  curp: z.string().trim().transform((v) => v.toUpperCase())
    .refine((v) => v === '' || /^[A-Z0-9]{18}$/.test(v), 'La CURP tiene 18 caracteres (letras y números).')
    .nullish().transform((v) => v || null),
  emergency_name: text(120).default(''),
  emergency_phone: phone.default(''),
  guardian_name: text(120).default(''),
  guardian_relationship: text(60).default(''),
  guardian_phone: phone.default(''),
  location_id: z.uuid('Selecciona la sede.'),
  tags: z.array(z.string().trim().min(1).max(60)).max(12, 'Máximo 12 etiquetas.').default([]),
  reason: text(600).default(''),
});
export type PatientInput = z.infer<typeof PatientFields>;

/** Columnas editables, en el orden en que se guardan. */
export const PATIENT_COLUMNS = [
  'full_name', 'birth_date', 'sex', 'phone', 'email', 'address', 'curp', 'emergency_name', 'emergency_phone',
  'guardian_name', 'guardian_relationship', 'guardian_phone', 'location_id', 'tags', 'reason',
] as const;

/**
 * Reglas que dependen de la fecha de hoy (PAC-03). Devuelve los errores por campo; vacío = válido.
 * Un menor de edad no se guarda sin los datos de su tutor.
 */
export function patientRuleErrors(p: Pick<PatientInput, 'birth_date' | 'guardian_name' | 'guardian_relationship' | 'guardian_phone'>, today = todayIso()) {
  const fields: Record<string, string> = {};
  if (p.birth_date > today) fields.birth_date = 'La fecha de nacimiento no puede ser futura.';
  else if (p.birth_date < '1900-01-01') fields.birth_date = 'Revisa el año de nacimiento.';
  else if (ageFrom(p.birth_date, today) < 18) {
    if (!p.guardian_name) fields.guardian_name = 'Un paciente menor de edad requiere el nombre del padre, madre o tutor.';
    if (!p.guardian_relationship) fields.guardian_relationship = 'Indica el parentesco del tutor.';
    if (!p.guardian_phone) fields.guardian_phone = 'Escribe el teléfono del tutor.';
  }
  return fields;
}

export type Catalogs = {
  locations: { id: string; code: string; name: string; active: boolean }[];
  therapists: { id: string; username: string; full_name: string; display_name: string }[];
  plans: { id: string; name: string }[];
  tags: string[];
};

/** Catálogos vigentes contra los que se valida un alta: sedes, fisioterapeutas activos, planes activos y etiquetas. */
export async function loadCatalogs(db: Tx): Promise<Catalogs> {
  const locations = await db<Catalogs['locations']>`select id, code, name, active from locations order by name`;
  const therapists = await db<Catalogs['therapists']>`
    select id, username, full_name, trim(title || ' ' || full_name) as display_name
    from users where role = 'therapist' and active order by full_name`;
  const plans = await db<Catalogs['plans']>`select id, name from membership_plans where active order by position, name`;
  const tags = (await db<{ name: string }[]>`select name from patient_tags where active order by position, name`).map((t) => t.name);
  return { locations, therapists, plans, tags };
}

/** Errores de catálogo por campo (sede inactiva, etiqueta que no existe…). `keepTags` = etiquetas que el paciente ya tenía. */
export function catalogErrors(p: Pick<PatientInput, 'location_id' | 'tags'>, c: Catalogs, opts: { keepTags?: string[]; keepLocation?: string } = {}) {
  const fields: Record<string, string> = {};
  const loc = c.locations.find((l) => l.id === p.location_id);
  if (!loc) fields.location_id = 'La sede no existe.';
  else if (!loc.active && loc.id !== opts.keepLocation) fields.location_id = 'Esa sede está inactiva.';
  const unknown = p.tags.filter((t) => !c.tags.includes(t) && !(opts.keepTags ?? []).includes(t));
  if (unknown.length) fields.tags = `Etiqueta no reconocida: ${unknown.join(', ')}.`;
  return fields;
}

export function throwIfFields(fields: Record<string, string>) {
  const first = Object.values(fields)[0];
  if (first) throw badRequest(first, fields);
}

/** Inserta al paciente (bajo RLS) y devuelve su id y número de expediente. */
export async function insertPatient(db: Tx, p: PatientInput, therapistId: string, createdBy: string) {
  const [row] = await db<{ id: string; record_number: string }[]>`
    insert into patients (full_name, birth_date, sex, phone, email, address, curp, emergency_name, emergency_phone,
                          guardian_name, guardian_relationship, guardian_phone, location_id, therapist_id, tags, reason, created_by)
    values (${p.full_name}, ${p.birth_date}, ${p.sex}, ${p.phone}, ${p.email}, ${p.address}, ${p.curp}, ${p.emergency_name},
            ${p.emergency_phone}, ${p.guardian_name}, ${p.guardian_relationship}, ${p.guardian_phone}, ${p.location_id},
            ${therapistId}, ${[...new Set(p.tags)]}::text[], ${p.reason}, ${createdBy})
    returning id, record_number`;
  return row;
}

/** Fisioterapeuta destino válido para asignar pacientes: existe, es fisioterapeuta y está activo (PAC-04). */
export async function requireActiveTherapist(db: Tx, id: string, field = 'therapist_id') {
  const [t] = await db<{ id: string; display_name: string }[]>`
    select id, trim(title || ' ' || full_name) as display_name from users where id = ${id} and role = 'therapist' and active`;
  if (!t) throw badRequest('Elige un fisioterapeuta activo.', { [field]: 'Elige un fisioterapeuta activo.' });
  return t;
}

export type AppointmentConflict = { id: string; starts_at: Date; patient_name: string; reason: string };

/**
 * PAC-04 · Cambia el fisioterapeuta de los pacientes indicados (el historial lo escribe el trigger
 * `patients_track_assignment`) y pasa sus citas FUTURAS programadas al nuevo fisioterapeuta cuando
 * su agenda lo permite. Las que se empalman, o caen fuera de su horario o en un bloqueo, se quedan
 * como están y se devuelven para resolverlas a mano en la agenda.
 */
export async function reassignPatients(db: Tx, patientIds: string[], toTherapistId: string, moveAppointments = true) {
  const ids = [...new Set(patientIds)];
  const found = await db<{ id: string }[]>`select id from patients where id = any(${ids}::uuid[])`;
  if (found.length !== ids.length) throw badRequest('Alguno de los pacientes no existe.', { patient_ids: 'Alguno de los pacientes no existe.' });

  const moved = await db<{ id: string }[]>`
    update patients set therapist_id = ${toTherapistId}
    where id = any(${ids}::uuid[]) and therapist_id <> ${toTherapistId} returning id`;

  let appointments_moved = 0;
  const appointments_conflict: AppointmentConflict[] = [];
  if (moveAppointments) {
    const appts = await db<{ id: string; starts_at: Date; duration_min: number; patient_name: string }[]>`
      select a.id, a.starts_at, a.duration_min, p.full_name as patient_name
      from appointments a join patients p on p.id = a.patient_id
      where a.patient_id = any(${ids}::uuid[]) and a.status = 'scheduled' and a.starts_at > now()
        and a.therapist_id <> ${toTherapistId}
      order by a.starts_at`;
    for (const a of appts) {
      // Una por una: cada cita movida cuenta para detectar el empalme de la siguiente.
      const [done] = await db<{ id: string }[]>`
        update appointments a set therapist_id = ${toTherapistId}
        where a.id = ${a.id}
          and appointment_slot_problem(${toTherapistId}, a.starts_at, a.duration_min) is null
          and not exists (
            select 1 from appointments o
            where o.therapist_id = ${toTherapistId} and o.status <> 'cancelled' and o.id <> a.id
              and tstzrange(o.starts_at, o.ends_at) && tstzrange(a.starts_at, a.ends_at))
        returning a.id`;
      if (done) { appointments_moved++; continue; }
      const [why] = await db<{ problem: string | null }[]>`
        select appointment_slot_problem(${toTherapistId}, ${a.starts_at}, ${a.duration_min}) as problem`;
      appointments_conflict.push({
        id: a.id, starts_at: a.starts_at, patient_name: a.patient_name,
        reason: why?.problem ?? 'Se empalma con otra cita del fisioterapeuta.',
      });
    }
  }
  return { moved: moved.length, appointments_moved, appointments_conflict };
}

/** Texto sin acentos y en minúsculas (equivalente en JS a la función SQL `norm`). */
export const normText = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
