import type { Tx } from '@/lib/db';
import { ALLOWED_MIME, storage } from '@/lib/storage';

/**
 * Lógica de servidor del módulo de estudios (solo la importan las rutas de /api/studies).
 * EST-01 · La API nunca devuelve `storage_path` ni `thumb_path`: solo URLs firmadas que caducan.
 */
export const FILE_URL_TTL = 300;   // 5 minutos: abrir o descargar el archivo
export const THUMB_URL_TTL = 600;  // 10 minutos: miniaturas del listado

export type StudyRow = {
  id: string; patient_id: string; patient_name: string; type_name: string; title: string; file_name: string;
  storage_path: string; thumb_path: string | null; mime: string; size_bytes: string | number; study_date: string;
  status: 'pending' | 'ready'; uploaded_by: string | null; uploaded_by_name: string; created_at: Date;
  archived_at: Date | null; archived_by_name: string | null; archive_reason: string | null;
};

/** Columnas de lectura (con el nombre del paciente y de quien archivó). Usar con alias s / p. */
export const studySelect = (db: Tx) => db`
  s.id, s.patient_id, p.full_name as patient_name, s.type_name, s.title, s.file_name, s.storage_path, s.thumb_path,
  s.mime, s.size_bytes, s.study_date, s.status, s.uploaded_by, s.uploaded_by_name, s.created_at, s.archived_at,
  (select trim(u.title || ' ' || u.full_name) from users u where u.id = s.archived_by) as archived_by_name, s.archive_reason`;

/** Lee un estudio bajo RLS: si el paciente no es del usuario, no existe. */
export async function findStudy(db: Tx, id: string): Promise<StudyRow | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const [row] = await db<StudyRow[]>`
    select ${studySelect(db)} from studies s join patients p on p.id = s.patient_id where s.id = ${id}`;
  return row ?? null;
}

/** Fila → JSON público (sin rutas). `thumb` decide si se firma la miniatura. */
export async function publicStudy(row: StudyRow, opts: { thumb?: boolean } = {}) {
  const { storage_path: _s, thumb_path, ...rest } = row;
  let thumb_url: string | null = null;
  if (opts.thumb !== false && thumb_path) {
    // Una miniatura que no se puede firmar no debe tumbar el listado: la tarjeta muestra el mosaico.
    thumb_url = await storage.signedUrl(thumb_path, { expiresIn: THUMB_URL_TTL }).catch(() => null);
  }
  return { ...rest, size_bytes: Number(row.size_bytes), has_thumb: !!thumb_path, thumb_url };
}

const EXT_FOR_MIME: Record<string, string> = Object.fromEntries(Object.entries(ALLOWED_MIME).map(([m, e]) => [m, e[0]]));

/**
 * Tipo permitido de un archivo. Si el nombre trae extensión, manda la extensión (un .exe no pasa aunque
 * declare ser imagen); el MIME declarado solo cuenta cuando el nombre no trae extensión (foto de cámara).
 */
export function allowedMime(fileName: string, declared?: string): string | null {
  const i = fileName.lastIndexOf('.');
  const ext = i > 0 && i < fileName.length - 1 ? fileName.slice(i + 1).toLowerCase() : '';
  if (ext) {
    for (const [mime, exts] of Object.entries(ALLOWED_MIME)) if (exts.includes(ext)) return mime;
    return null;
  }
  return declared && ALLOWED_MIME[declared] ? declared : null;
}

/**
 * EST-02 · Nombre seguro para el almacenamiento: sin acentos, solo [A-Za-z0-9._-], conserva la extensión
 * (o agrega la que corresponde al tipo si el nombre no la traía).
 */
export function safeFileName(original: string, mime: string): string {
  const flat = original.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const dot = flat.lastIndexOf('.');
  let ext = dot > 0 && dot < flat.length - 1 ? flat.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  let base = ext ? flat.slice(0, dot) : flat;
  if (!ext || !(ALLOWED_MIME[mime] ?? []).includes(ext)) {
    if (ext) base = `${base}_${ext}`;
    ext = EXT_FOR_MIME[mime] ?? 'bin';
  }
  base = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/\.{2,}/g, '.').replace(/_{2,}/g, '_').replace(/^[._-]+|[._-]+$/g, '').slice(0, 80);
  if (!base) base = 'archivo';
  const name = `${base}.${ext}`;
  return name === 'thumb.jpg' ? 'archivo_thumb.jpg' : name; // ese nombre está reservado para la miniatura
}

export const studyDir = (patientId: string, studyId: string) => `patients/${patientId}/${studyId}`;
