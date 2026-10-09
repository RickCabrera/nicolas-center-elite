import { z } from 'zod';
import { paging, route } from '@/lib/api';
import { AppError, badRequest, forbidden, notFound } from '@/lib/errors';
import { contentHash, loadDocument } from '@/modules/documents/server';
import { CONTROLLED_MSG, LICENSE_REQUIRED, PHYSICIAN_ONLY, type DocumentListItem } from '@/modules/documents/shared';

const Query = z.object({
  patient_id: z.uuid().optional(),
  kind: z.enum(['prescription', 'indications']).optional(),
  status: z.enum(['issued', 'cancelled']).optional(),
  q: z.string().trim().max(80).optional(),
  mine: z.string().optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
});

// REC-09 / REC-10 · Lista de documentos emitidos. RLS limita: el dueño ve todo; el profesional,
// lo que emitió y lo de sus pacientes. `mine=1` deja solo lo emitido por quien consulta.
export const GET = route({ auth: 'clinical', query: Query }, async ({ db, user, query }) => {
  const { limit, offset } = paging(query);
  const mine = query.mine === '1' || query.mine === 'true';
  const where = db`
    d.content_hash <> ''
    ${query.patient_id ? db`and d.patient_id = ${query.patient_id}` : db``}
    ${query.kind ? db`and d.kind = ${query.kind}` : db``}
    ${query.status ? db`and d.status = ${query.status}` : db``}
    ${mine ? db`and d.issuer_id = ${user.id}` : db``}
    ${query.q ? db`and (norm(d.patient_name) like '%' || norm(${query.q}) || '%' or norm(d.folio) like '%' || norm(${query.q}) || '%')` : db``}`;
  const rows = await db<(Omit<DocumentListItem, 'summary' | 'issued_at'> & { issued_at: Date; first_item: string | null; item_count: number })[]>`
    select d.id, d.kind, d.folio, d.patient_id, d.patient_name, d.issuer_id, d.issuer_name, d.issuer_title, d.issued_at, d.status,
           (select i.name from document_items i where i.document_id = d.id order by i.position, i.id limit 1) as first_item,
           (select count(*)::int from document_items i where i.document_id = d.id) as item_count
    from documents d
    where ${where}
    order by d.issued_at desc, d.folio desc
    limit ${limit} offset ${offset}`;
  const [{ total }] = await db<{ total: number }[]>`select count(*)::int as total from documents d where ${where}`;
  return {
    items: rows.map(({ first_item, item_count, ...r }) => ({
      ...r,
      summary: (first_item ?? '') + (item_count > 1 ? ` y ${item_count - 1} más` : ''),
    })),
    total,
  };
});

const text = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres.`).nullish().transform((v) => v ?? '');
const Item = z.object({
  kind: z.enum(['medication', 'exercise', 'physical_agent', 'home_care'], 'Tipo de renglón no válido.'),
  name: text(160),
  presentation: text(160),
  dose: text(160),
  route: text(60),
  frequency: text(160),
  duration: text(160),
  instructions: text(800),
});
const Body = z.object({
  kind: z.enum(['prescription', 'indications'], 'Elige el tipo de documento.'),
  patient_id: z.uuid('Selecciona un paciente.'),
  diagnosis: text(500),
  general_indications: text(2000),
  items: z.array(Item, 'Agrega al menos un renglón.').min(1, 'Agrega al menos un renglón.').max(20, 'Máximo 20 renglones por documento.'),
  duplicated_from: z.uuid().nullish(),
});

// REC-01, REC-02, REC-04, REC-05, REC-06 · Emite una receta médica o unas indicaciones fisioterapéuticas.
// Firma SIEMPRE quien emite (lo fija la base); cualquier emisor que mande el cliente se ignora.
export const POST = route({ auth: 'clinical', body: Body }, async ({ db, user, body }) => {
  // REC-02 / REC-04 · Facultad de prescribir. La base lo vuelve a exigir en el trigger.
  const hasLicense = !!user.license_number?.trim();
  if (body.kind === 'prescription' && !(user.is_physician && hasLicense)) throw forbidden(PHYSICIAN_ONLY);
  if (!hasLicense) throw new AppError(400, 'license_required', LICENSE_REQUIRED);

  const [patient] = await db<{ id: string }[]>`select id from patients where id = ${body.patient_id}`; // RLS: ajeno = no existe
  if (!patient) throw notFound('Paciente no encontrado.');

  // Validación por renglón con mensaje por campo (items.0.dose).
  const fields: Record<string, string> = {};
  body.items.forEach((it, i) => {
    const need = (k: 'name' | 'dose' | 'route' | 'frequency' | 'duration', msg: string) => {
      if (!it[k]) fields[`items.${i}.${k}`] = msg;
    };
    if (body.kind === 'prescription') {
      if (it.kind !== 'medication') fields[`items.${i}.kind`] = 'Una receta médica solo admite renglones de medicamento.';
      need('name', 'Escribe la denominación genérica.');
      need('dose', 'Escribe la dosis.');
      need('route', 'Elige la vía de administración.');
      need('frequency', 'Escribe la frecuencia.');
      need('duration', 'Escribe la duración del tratamiento.');
    } else {
      if (it.kind === 'medication') fields[`items.${i}.kind`] = 'Las indicaciones fisioterapéuticas no pueden incluir medicamentos.';
      need('name', 'Escribe la indicación.');
    }
  });
  const firstError = Object.values(fields)[0];
  if (firstError) throw badRequest(firstError, fields);

  // REC-06 · Medicamentos controlados: requieren recetario especial, no se emiten desde el sistema.
  if (body.kind === 'prescription') {
    for (const [i, it] of body.items.entries()) {
      const [hit] = await db`select 1 from controlled_substances cs where norm(${it.name}) like '%' || cs.name || '%' limit 1`;
      if (hit) fields[`items.${i}.name`] = CONTROLLED_MSG;
    }
    if (Object.keys(fields).length) throw new AppError(400, 'controlled_substance', CONTROLLED_MSG, fields);
  }

  if (body.duplicated_from) {
    const [src] = await db<{ kind: string; patient_id: string }[]>`select kind, patient_id from documents where id = ${body.duplicated_from}`;
    if (!src) throw badRequest('El documento de origen no existe.', { duplicated_from: 'El documento de origen no existe.' });
    if (src.patient_id !== body.patient_id || src.kind !== body.kind) {
      throw badRequest('El duplicado debe ser del mismo paciente y del mismo tipo que el documento de origen.');
    }
  }

  // El trigger BEFORE INSERT sobrescribe emisor, datos legales, sede, paciente, pie y folio consecutivo.
  const [doc] = await db<Parameters<typeof contentHash>[0][]>`
    insert into documents (kind, patient_id, diagnosis, general_indications, duplicated_from,
                           folio_number, folio, issuer_id, issuer_name, clinic_name, location_name, location_address, patient_name, patient_age)
    values (${body.kind}, ${body.patient_id}, ${body.diagnosis}, ${body.general_indications}, ${body.duplicated_from ?? null},
            0, '', ${user.id}, '', '', '', '', '', 0)
    returning *`;
  const items = body.items.map((it, position) => ({ document_id: doc.id, position, ...it }));
  await db`insert into document_items ${db(items, 'document_id', 'position', 'kind', 'name', 'presentation', 'dose', 'route', 'frequency', 'duration', 'instructions')}`;
  // Sello: a partir de aquí el documento ya no admite renglones ni cambios (solo cancelarse).
  await db`update documents set content_hash = ${contentHash(doc, items)} where id = ${doc.id}`;
  return loadDocument(db, doc.id, user);
});
