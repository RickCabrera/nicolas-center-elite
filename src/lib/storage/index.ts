import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { env } from '../env';
import { hmac, safeEqual } from '../crypto';

/**
 * Almacenamiento privado de archivos (EST-01). Dos controladores con la misma interfaz:
 *   · local    → disco del servidor, para desarrollo y pruebas
 *   · supabase → bucket privado de Supabase Storage, para producción
 * Los archivos NUNCA son públicos: se sirven con URLs firmadas de corta duración, y solo
 * después de que la API comprobó (bajo RLS) que el usuario puede ver ese registro.
 */
export type UploadTicket =
  | { driver: 'local'; url: string }
  | { driver: 'supabase'; supabaseUrl: string; anonKey: string; bucket: string; path: string; token: string };

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // un estudio DICOM puede ser grande
export const ALLOWED_MIME: Record<string, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
  'application/dicom': ['dcm', 'dicom'],
};

/** Deduce y valida el tipo por extensión (los .dcm suelen llegar sin MIME). */
export function mimeForFile(name: string, declared?: string): string | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  for (const [mime, exts] of Object.entries(ALLOWED_MIME)) if (exts.includes(ext)) return mime;
  if (declared && ALLOWED_MIME[declared]) return declared;
  return null;
}

// Las rutas del almacenamiento son claves con «/» (iguales en Supabase y en disco): se normalizan como POSIX.
// Con el `normalize` nativo, en Windows las «/» se volvían «\» y toda ruta válida se rechazaba.
const safePath = (p: string) => {
  const n = posix.normalize(p).replace(/^([/\\])+/, '');
  if (n.startsWith('..') || n.includes('../') ||!/^[\w./-]+$/.test(n)) throw new Error('Ruta de archivo inválida.');
  return n;
};

// ───────── controlador local ─────────
const root = () => resolve(process.cwd(), env().LOCAL_STORAGE_DIR);
const sign = (action: string, path: string, exp: number) => hmac(`${action}:${path}:${exp}`);

export function verifyLocalSignature(action: 'get' | 'put', path: string, exp: number, sig: string): boolean {
  return Number.isFinite(exp) && exp > Date.now() / 1000 && safeEqual(sign(action, path, exp), sig);
}
export const localFilePath = (path: string) => join(root(), safePath(path));

// ───────── controlador supabase ─────────
let sb: SupabaseClient | null = null;
const supa = () => {
  if (!sb) sb = createClient(env().SUPABASE_URL, env().SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  return sb.storage.from(env().SUPABASE_BUCKET);
};

export const storage = {
  /** Autoriza al navegador a subir UN archivo directo al almacenamiento. */
  async createUpload(path: string): Promise<UploadTicket> {
    path = safePath(path);
    if (env().STORAGE_DRIVER === 'local') {
      const exp = Math.floor(Date.now() / 1000) + 900;
      return { driver: 'local', url: `/api/files/upload?path=${encodeURIComponent(path)}&exp=${exp}&sig=${sign('put', path, exp)}` };
    }
    const { data, error } = await supa().createSignedUploadUrl(path);
    if (error || !data) throw new Error(`No se pudo preparar la subida: ${error?.message}`);
    return { driver: 'supabase', supabaseUrl: env().SUPABASE_URL, anonKey: env().SUPABASE_ANON_KEY, bucket: env().SUPABASE_BUCKET, path, token: data.token };
  },

  /** URL firmada de lectura. Caduca en `expiresIn` segundos (por defecto 5 minutos). */
  async signedUrl(path: string, opts: { expiresIn?: number; downloadName?: string } = {}): Promise<string> {
    path = safePath(path);
    const expiresIn = opts.expiresIn ?? 300;
    if (env().STORAGE_DRIVER === 'local') {
      const exp = Math.floor(Date.now() / 1000) + expiresIn;
      const dl = opts.downloadName ? `&dl=${encodeURIComponent(opts.downloadName)}` : '';
      return `/api/files/get?path=${encodeURIComponent(path)}&exp=${exp}&sig=${sign('get', path, exp)}${dl}`;
    }
    const { data, error } = await supa().createSignedUrl(path, expiresIn, opts.downloadName ? { download: opts.downloadName } : undefined);
    if (error || !data) throw new Error(`No se pudo firmar el archivo: ${error?.message}`);
    return data.signedUrl;
  },

  /** Tamaño en bytes si el archivo existe; null si no. */
  async size(path: string): Promise<number | null> {
    path = safePath(path);
    if (env().STORAGE_DRIVER === 'local') {
      try {
        return (await stat(localFilePath(path))).size;
      } catch {
        return null;
      }
    }
    const dir = path.split('/').slice(0, -1).join('/');
    const name = path.split('/').pop()!;
    const { data } = await supa().list(dir, { search: name, limit: 100 });
    const f = data?.find((x) => x.name === name);
    return f ? Number((f.metadata as { size?: number } | null)?.size ?? 0) : null;
  },

  async read(path: string): Promise<Buffer> {
    path = safePath(path);
    if (env().STORAGE_DRIVER === 'local') return readFile(localFilePath(path));
    const { data, error } = await supa().download(path);
    if (error || !data) throw new Error(`No se pudo leer el archivo: ${error?.message}`);
    return Buffer.from(await data.arrayBuffer());
  },

  async write(path: string, body: Buffer, contentType: string): Promise<void> {
    path = safePath(path);
    if (env().STORAGE_DRIVER === 'local') {
      const full = localFilePath(path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, body);
      return;
    }
    const { error } = await supa().upload(path, body, { contentType, upsert: true });
    if (error) throw new Error(`No se pudo guardar el archivo: ${error.message}`);
  },

  async remove(path: string): Promise<void> {
    path = safePath(path);
    if (env().STORAGE_DRIVER === 'local') {
      await rm(localFilePath(path), { force: true });
      return;
    }
    await supa().remove([path]);
  },
};
