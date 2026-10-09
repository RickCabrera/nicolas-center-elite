import { z } from 'zod';
import { isFrontDesk, paging, route } from '@/lib/api';
import { badRequest } from '@/lib/errors';
import { createInitialMembership } from '@/modules/billing/membership';
import { catalogErrors, insertPatient, loadCatalogs, PatientFields, patientRuleErrors, requireActiveTherapist, throwIfFields } from '@/modules/patients/server';

const dropEmpty = (v: unknown) =>
  v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '')) : v;

const Query = z.preprocess(dropEmpty, z.object({
  q: z.string().trim().max(100).optional(),
  age: z.enum(['ninos', 'adultos', 'mayores']).optional(),
  tag: z.string().trim().max(60).optional(),
  therapist_id: z.uuid().optional(),
  location_id: z.uuid().optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  limit: z.string().optional(),
  offset: z.string().optional(),
}));

// PAC-01 · Listado de pacientes con búsqueda y filtros. RLS deja al fisioterapeuta solo los suyos.
// AUTH-10 · Recepción lista a todos, pero sin motivo de consulta ni etiquetas, y su búsqueda no toca lo clínico.
export const GET = route({ auth: 'user', query: Query }, async ({ db, user, query }) => {
  const { limit, offset } = paging(query, 500, 60);
  const reception = user.role === 'reception';
  const like = query.q ? '%' + query.q.replace(/[\\%_]/g, '\\$&') + '%' : null;

  const fStatus = query.status === 'all' ? db`` : db`and p.status = ${query.status}`;
  const fAge =
    query.age === 'ninos' ? db`and age_years(p.birth_date) < 18`
    : query.age === 'adultos' ? db`and age_years(p.birth_date) between 18 and 59`
    : query.age === 'mayores' ? db`and age_years(p.birth_date) >= 60`
    : db``;
  const fTag = query.tag && !reception ? db`and exists (select 1 from unnest(p.tags) t where norm(t) = norm(${query.tag}))` : db``;
  // El filtro por fisioterapeuta aplica al dueño y a recepción; un fisioterapeuta siempre ve su propia carga.
  const fTher = query.therapist_id && isFrontDesk(user) ? db`and p.therapist_id = ${query.therapist_id}` : db``;
  const fLoc = query.location_id ? db`and p.location_id = ${query.location_id}` : db``;
  // Busca sin acentos en nombre, motivo y expediente (columna `search`) y en el diagnóstico vigente.
  const fSearch = !like ? db``
    : reception ? db`and norm(p.full_name || ' ' || p.record_number) like norm(${like})`
    : db`and (p.search like norm(${like})
          or exists (select 1 from clinical_profiles cp
                     where cp.patient_id = p.id and norm(cp.diagnosis) like norm(${like})
                       and cp.version = (select max(v.version) from clinical_profiles v where v.patient_id = p.id)))`;
  const where = db`where true ${fStatus} ${fAge} ${fTag} ${fTher} ${fLoc} ${fSearch}`;

  const items = await db`
    select p.id, p.record_number, p.full_name, p.birth_date, age_years(p.birth_date) as age, p.sex,
           p.location_id, l.name as location_name, p.therapist_id, trim(u.title || ' ' || u.full_name) as therapist_name,
           ${reception ? db`'' as reason, '{}'::text[] as tags` : db`p.reason, p.tags`}, p.status, b.plan_name, coalesce(b.state, 'sin_plan') as billing_state, b.next_due_date,
           p.fingerprint_enrolled_at
    from patients p
    join locations l on l.id = p.location_id
    join users u on u.id = p.therapist_id
    left join patient_billing b on b.patient_id = p.id
    ${where}
    order by norm(p.full_name), p.record_number
    limit ${limit} offset ${offset}`;
  const [{ total }] = await db<{ total: number }[]>`select count(*)::int as total from patients p ${where}`;
  const [{ total_scope }] = await db<{ total_scope: number }[]>`select count(*)::int as total_scope from patients where status = 'active'`;
  return { items, total, total_scope };
});

const Create = PatientFields.extend({
  therapist_id: z.uuid('Selecciona el fisioterapeuta.').nullish(),
  plan_id: z.uuid('Selecciona la membresía.').nullish(),
});

// PAC-03 · Alta de paciente. PAC-04 · El fisioterapeuta siempre se autoasigna; dueño y recepción eligen. PAC-06 · Membresía inicial.
export const POST = route({ auth: 'user', body: Create }, async ({ db, user, body }) => {
  const { therapist_id, plan_id, ...data } = body;
  // AUTH-10 · Recepción no captura motivo de consulta ni etiquetas: lo que mande en esos campos se ignora.
  if (user.role === 'reception') { data.reason = ''; data.tags = []; }
  const cats = await loadCatalogs(db);
  const fields: Record<string, string> = { ...patientRuleErrors(data), ...catalogErrors(data, cats) };
  if (!data.sex) fields.sex = 'Selecciona el sexo.';

  // Lo que mande el cliente como fisioterapeuta solo cuenta si quien da de alta es el dueño o recepción.
  const front = isFrontDesk(user);
  let therapistId = user.id;
  if (front) {
    if (!therapist_id) fields.therapist_id = 'Selecciona el fisioterapeuta.';
    else if (!cats.therapists.some((t) => t.id === therapist_id)) fields.therapist_id = 'Elige un fisioterapeuta activo.';
    else therapistId = therapist_id;
  }
  if (plan_id && !cats.plans.some((p) => p.id === plan_id)) fields.plan_id = 'Ese plan no está disponible.';
  throwIfFields(fields);
  if (front) await requireActiveTherapist(db, therapistId);

  const row = await insertPatient(db, data, therapistId, user.id);
  if (plan_id) {
    const membership = await createInitialMembership(db, row.id, plan_id, user.id);
    if (!membership) throw badRequest('Ese plan no está disponible.', { plan_id: 'Ese plan no está disponible.' });
  }
  return { id: row.id, record_number: row.record_number };
});
