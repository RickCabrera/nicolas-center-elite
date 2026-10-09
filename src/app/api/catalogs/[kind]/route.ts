import { z } from 'zod';
import { route } from '@/lib/api';
import { badRequest, conflict, notFound } from '@/lib/errors';
import type { Tx } from '@/lib/db';

/**
 * CFG-05 / AGE-06 · Catálogos editables: tipos de sesión, tipos de estudio y etiquetas de paciente.
 * Lectura para todos (alimentan los selectores), escritura solo del dueño. No hay DELETE: se desactiva,
 * porque citas, estudios y pacientes ya guardados siguen mostrando el nombre con el que se capturaron.
 */
const KINDS = {
  'session-types': { table: 'session_types', key: 'id', one: 'un tipo de sesión' },
  'study-types': { table: 'study_types', key: 'name', one: 'un tipo de estudio' },
  tags: { table: 'patient_tags', key: 'name', one: 'una etiqueta' },
} as const;
type Cfg = (typeof KINDS)[keyof typeof KINDS];

function cfgFor(kind: string): Cfg {
  const cfg = (KINDS as Record<string, Cfg>)[kind];
  if (!cfg) throw notFound('Catálogo no encontrado.');
  return cfg;
}
const list = (db: Tx, cfg: Cfg) =>
  cfg.key === 'id'
    ? db`select id, name, default_duration_min, position, active from session_types order by position, name`
    : db`select name, position, active from ${db(cfg.table)} order by position, name`;

async function assertFreeName(db: Tx, cfg: Cfg, name: string, exceptKey?: string) {
  // Sin distinguir mayúsculas ni acentos: "Radiografia" y "Radiografía" son el mismo renglón.
  const rows = await db<{ k: string }[]>`select ${db(cfg.key)}::text as k from ${db(cfg.table)} where norm(name) = norm(${name})`;
  if (rows.some((r) => r.k !== exceptKey)) throw conflict(`Ya existe ${cfg.one} con ese nombre.`, 'duplicate');
}

const Name = z.string().trim().min(2, 'Escribe el nombre.').max(60, 'Máximo 60 caracteres.');
const Duration = z.number('Escribe la duración en minutos.').int('La duración va en minutos enteros.').min(5, 'Mínimo 5 minutos.').max(480, 'Máximo 480 minutos.');

export const GET = route({ auth: 'user' }, async ({ db, params }) => list(db, cfgFor(params.kind)));

const Create = z.object({ name: Name, default_duration_min: Duration.optional() });

export const POST = route({ auth: 'owner', body: Create }, async ({ db, params, body }) => {
  const cfg = cfgFor(params.kind);
  await assertFreeName(db, cfg, body.name);
  const [{ next }] = await db<{ next: number }[]>`select coalesce(max(position), 0) + 1 as next from ${db(cfg.table)}`;
  if (cfg.key === 'id') {
    const [row] = await db`
      insert into session_types (name, default_duration_min, position) values (${body.name}, ${body.default_duration_min ?? 50}, ${next})
      returning id, name, default_duration_min, position, active`;
    return row;
  }
  const [row] = await db`insert into ${db(cfg.table)} (name, position) values (${body.name}, ${next}) returning name, position, active`;
  return row;
});

const Patch = z.object({
  id: z.uuid().optional(),               // tipos de sesión
  name: Name.optional(),                 // llave en tipos de estudio y etiquetas; nombre nuevo en tipos de sesión
  new_name: Name.optional(),             // renombrar tipo de estudio o etiqueta
  default_duration_min: Duration.optional(),
  position: z.number().int().min(0).max(9999).optional(),
  active: z.boolean().optional(),
  /** Orden completo del catálogo: lista de llaves (id o nombre) de arriba hacia abajo. */
  order: z.array(z.string().min(1)).max(300).optional(),
});

export const PATCH = route({ auth: 'owner', body: Patch }, async ({ db, params, body, system }) => {
  const cfg = cfgFor(params.kind);

  if (body.order) {
    const keys = [...new Set(body.order)];
    const rows = await db<{ k: string }[]>`select ${db(cfg.key)}::text as k from ${db(cfg.table)}`;
    if (keys.some((k) => !rows.some((r) => r.k === k))) throw badRequest('La lista de orden incluye un elemento que ya no existe. Recarga la pantalla.');
    for (let i = 0; i < keys.length; i++) {
      await db`update ${db(cfg.table)} set position = ${i + 1} where ${db(cfg.key)}::text = ${keys[i]} and position <> ${i + 1}`;
    }
    return list(db, cfg);
  }

  if (cfg.key === 'id') {
    if (!body.id) throw badRequest('Falta indicar el tipo de sesión.', { id: 'Requerido.' });
    const patch: Record<string, string | number | boolean> = {};
    for (const k of ['name', 'default_duration_min', 'position', 'active'] as const) if (body[k] !== undefined) patch[k] = body[k]!;
    if (!Object.keys(patch).length) throw badRequest('No hay cambios que guardar.');
    if (body.name) await assertFreeName(db, cfg, body.name, body.id);
    const [row] = await db`
      update session_types set ${db(patch, ...Object.keys(patch))} where id = ${body.id}
      returning id, name, default_duration_min, position, active`;
    if (!row) throw notFound('Tipo de sesión no encontrado.');
    return row;
  }

  if (!body.name) throw badRequest('Falta indicar el nombre.', { name: 'Requerido.' });
  if (body.default_duration_min !== undefined) throw badRequest('Solo los tipos de sesión tienen duración.');
  const [cur] = await db<{ name: string }[]>`select name from ${db(cfg.table)} where name = ${body.name} for update`;
  if (!cur) throw notFound(cfg.table === 'patient_tags' ? 'Etiqueta no encontrada.' : 'Tipo de estudio no encontrado.');
  const patch: Record<string, string | number | boolean> = {};
  const renamed = body.new_name !== undefined && body.new_name !== cur.name ? body.new_name : null;
  if (renamed) {
    await assertFreeName(db, cfg, renamed, cur.name);
    patch.name = renamed;
  }
  if (body.position !== undefined) patch.position = body.position;
  if (body.active !== undefined) patch.active = body.active;
  if (!Object.keys(patch).length) throw badRequest('No hay cambios que guardar.');
  const [row] = await db`
    update ${db(cfg.table)} set ${db(patch, ...Object.keys(patch))} where name = ${cur.name} returning name, position, active`;

  if (renamed) {
    // El nombre vive copiado en pacientes y estudios. Un fisioterapeuta solo alcanza a los suyos bajo RLS,
    // así que se actualiza como sistema; el permiso ya se validó (ruta solo del dueño).
    await system(async (tx) => {
      if (cfg.table === 'patient_tags') {
        await tx`update patients set tags = array_replace(tags, ${cur.name}, ${renamed}) where ${cur.name} = any(tags)`;
      } else {
        await tx`update studies set type_name = ${renamed} where type_name = ${cur.name}`;
      }
    });
  }
  return row;
});
