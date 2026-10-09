import { z } from 'zod';
import { route } from '@/lib/api';
import { logEvent } from '@/lib/audit';
import { badRequest, notFound } from '@/lib/errors';
import { requirePatient } from '@/modules/record/server';

type ProfileRow = {
  id: string; patient_id: string; version: number; background: string; condition: string; examination: string;
  diagnosis: string; treatment_plan: string; created_by: string | null; created_by_name: string; created_at: Date;
};

const VIEW_WINDOW_MIN = 10;

// EXP-02 · Perfil clínico vigente y lista de versiones. `?version=N` devuelve esa versión completa.
// EXP-01 · Abrir el expediente deja un evento `view` (máximo uno cada 10 minutos por usuario y paciente).
export const GET = route({ auth: 'user' }, async ({ db, user, params, query, system }) => {
  const patient = await requirePatient(db, params.id);

  if (query.version !== undefined) {
    const n = Number(query.version);
    if (!Number.isInteger(n) || n < 1) throw badRequest('Versión no válida.');
    const [row] = await db<ProfileRow[]>`select * from clinical_profiles where patient_id = ${patient.id} and version = ${n}`;
    if (!row) throw notFound('Esa versión del perfil clínico no existe.');
    return row;
  }

  // La bitácora solo la lee el dueño bajo RLS: la comprobación y el registro van por el sistema, ya validado
  // el acceso al paciente. El candado evita eventos duplicados cuando la pantalla pide dos veces a la vez.
  await system(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${'record-view:' + user.id + ':' + patient.id}))`;
    const [recent] = await tx`
      select 1 from audit_log
      where action = 'view' and patient_id = ${patient.id} and actor_id = ${user.id}
        and at > now() - make_interval(mins => ${VIEW_WINDOW_MIN})
      limit 1`;
    if (!recent) await logEvent(tx, 'view', 'Abrió el expediente', { patientId: patient.id });
  });

  const versions = await db<ProfileRow[]>`
    select * from clinical_profiles where patient_id = ${patient.id} order by version desc`;
  return {
    current: versions[0] ?? null,
    versions: versions.map((v) => ({ id: v.id, version: v.version, created_at: v.created_at, created_by_name: v.created_by_name })),
  };
});

const text = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres.`).default('');
const Body = z.object({
  background: text(6000),
  condition: text(6000),
  examination: text(6000),
  diagnosis: text(4000),
  treatment_plan: text(6000),
});

// EXP-02 · Cada guardado crea una versión nueva; las anteriores no se tocan.
export const POST = route({ auth: 'user', body: Body }, async ({ db, user, params, body }) => {
  const patient = await requirePatient(db, params.id);
  if (!Object.values(body).some((v) => v.length > 0)) {
    throw badRequest('Captura al menos un campo del perfil clínico.', { diagnosis: 'Escribe el diagnóstico o algún otro campo.' });
  }
  const [row] = await db<ProfileRow[]>`
    insert into clinical_profiles (patient_id, background, condition, examination, diagnosis, treatment_plan, created_by, created_by_name)
    values (${patient.id}, ${body.background}, ${body.condition}, ${body.examination}, ${body.diagnosis}, ${body.treatment_plan},
            ${user.id}, ${user.display_name})
    returning *`;
  return row;
});
