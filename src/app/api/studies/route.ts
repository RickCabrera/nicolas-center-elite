import { z } from 'zod';
import { paging, route } from '@/lib/api';
import { badRequest, forbidden, notFound } from '@/lib/errors';
import { MAX_UPLOAD_BYTES, storage } from '@/lib/storage';
import { todayIso } from '@/lib/dates';
import { allowedMime, publicStudy, safeFileName, studyDir, studySelect, type StudyRow } from '@/modules/studies/server';

const Query = z.object({
  q: z.string().trim().max(120).optional(),
  patient_id: z.uuid('Paciente inválido.').optional(),
  type: z.string().trim().max(80).optional(),
  archived: z.enum(['0', '1']).optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
});

/**
 * EST-03 · Listado de estudios (global o de un paciente). RLS limita al fisioterapeuta a sus pacientes.
 * Solo salen los estudios cuya subida terminó (`ready`); una subida a medias (`pending`) nunca se lista.
 * EST-01 · Cada item trae `thumb_url` firmada (10 min) pero nunca la URL del archivo.
 * EST-06 · Los archivados solo salen con ?archived=1, y eso es exclusivo del dueño.
 */
export const GET = route({ auth: 'clinical', query: Query }, async ({ db, user, query }) => {
  const archived = query.archived === '1';
  if (archived && user.role !== 'owner') throw forbidden('Solo el dueño puede ver los estudios archivados.');
  const { limit, offset } = paging(query, 200, 60);

  // Cada palabra debe aparecer; % y _ se buscan como texto, no como comodines.
  const words = (query.q ?? '').split(/\s+/).filter(Boolean).slice(0, 6).map((w) => w.replace(/[\\%_]/g, '\\$&'));
  let search = db``;
  for (const w of words) {
    search = db`${search} and norm(s.title || ' ' || s.file_name || ' ' || s.type_name || ' ' || p.full_name) like '%' || norm(${w}) || '%'`;
  }
  const rows = await db<StudyRow[]>`
    select ${studySelect(db)}
    from studies s join patients p on p.id = s.patient_id
    where s.status = 'ready'
      and ${archived ? db`s.archived_at is not null` : db`s.archived_at is null`}
      ${query.patient_id ? db`and s.patient_id = ${query.patient_id}` : db``}
      ${query.type ? db`and s.type_name = ${query.type}` : db``}
      ${search}
    order by s.study_date desc, s.created_at desc, s.id
    limit ${limit} offset ${offset}`;
  return Promise.all(rows.map((r) => publicStudy(r)));
});

const Body = z.object({
  patient_id: z.uuid('Selecciona un paciente.'),
  type_name: z.string().trim().min(1, 'Selecciona el tipo de estudio.').max(80),
  title: z.string().trim().min(1, 'Escribe el nombre del estudio.').max(160, 'El nombre es demasiado largo.'),
  file_name: z.string().trim().min(1, 'Falta el nombre del archivo.').max(255, 'El nombre del archivo es demasiado largo.'),
  mime: z.string().trim().max(120).optional(),
  size_bytes: z.number('Falta el tamaño del archivo.').int().nonnegative(),
  study_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida.').optional(),
  with_thumb: z.boolean().default(false),
});

/**
 * EST-02 · Paso 1 de la subida: valida, registra el estudio como `pending` y entrega el boleto para que
 * el navegador suba el archivo (y la miniatura) DIRECTO al almacenamiento privado.
 */
export const POST = route({ auth: 'clinical', body: Body }, async ({ db, user, body }) => {
  const mime = allowedMime(body.file_name, body.mime);
  if (!mime) {
    const msg = 'Ese tipo de archivo no se admite. Sube JPG, PNG, WEBP, PDF o DICOM.';
    throw badRequest(msg, { file: msg });
  }
  if (body.size_bytes <= 0) throw badRequest('El archivo está vacío.', { file: 'El archivo está vacío.' });
  if (body.size_bytes > MAX_UPLOAD_BYTES) {
    const msg = `El archivo supera el máximo de ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`;
    throw badRequest(msg, { file: msg });
  }
  const today = todayIso();
  const study_date = body.study_date ?? today;
  if (study_date > today) throw badRequest('La fecha del estudio no puede ser futura.', { study_date: 'La fecha del estudio no puede ser futura.' });

  const [type] = await db`select name from study_types where name = ${body.type_name} and active`;
  if (!type) throw badRequest('Ese tipo de estudio no existe o está desactivado.', { type_name: 'Selecciona un tipo de estudio válido.' });

  const [patient] = await db`select id from patients where id = ${body.patient_id}`; // RLS: si no es suyo, no existe
  if (!patient) throw notFound('Paciente no encontrado.');

  const [{ id }] = await db<{ id: string }[]>`select gen_random_uuid() as id`;
  const dir = studyDir(body.patient_id, id);
  const storage_path = `${dir}/${safeFileName(body.file_name, mime)}`;
  // La miniatura solo aplica a imágenes y DICOM (EST-05).
  const thumb_path = body.with_thumb && mime !== 'application/pdf' ? `${dir}/thumb.jpg` : null;

  await db`
    insert into studies (id, patient_id, type_name, title, file_name, storage_path, thumb_path, mime, size_bytes, study_date,
                         status, uploaded_by, uploaded_by_name)
    values (${id}, ${body.patient_id}, ${body.type_name}, ${body.title}, ${body.file_name}, ${storage_path}, ${thumb_path}, ${mime},
            ${body.size_bytes}, ${study_date}, 'pending', ${user.id}, ${user.display_name})`;
  const [row] = await db<StudyRow[]>`
    select ${studySelect(db)} from studies s join patients p on p.id = s.patient_id where s.id = ${id}`;

  const upload = await storage.createUpload(storage_path);
  const thumb_upload = thumb_path ? await storage.createUpload(thumb_path) : undefined;
  return { study: await publicStudy(row, { thumb: false }), upload, ...(thumb_upload ? { thumb_upload } : {}) };
});
