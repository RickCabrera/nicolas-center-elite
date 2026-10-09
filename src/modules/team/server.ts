import { z } from 'zod';
import type { Tx } from '@/lib/db';
import { AppError, badRequest, notFound } from '@/lib/errors';

/**
 * Reglas de servidor del módulo Equipo (EQ-01..07) y de "Mi perfil" (CFG-08).
 * La tabla `users` no admite escritura con el rol de aplicación: toda consulta de este archivo
 * recibe una transacción de SISTEMA, y la ruta ya validó que quien llama es el dueño (o el propio usuario).
 */

export const TITLES = ['', 'L.F.T.', 'Lic.', 'Dra.', 'Dr.'] as const;

const text = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres.`);
const optionalText = (max: number) =>
  z.string().trim().max(max, `Máximo ${max} caracteres.`).nullish().transform((v) => (v ? v : null));
const digits = (s: string) => s.replace(/\D/g, '').length;

export const fullName = z.string().trim().min(3, 'Escribe el nombre completo.').max(120, 'Máximo 120 caracteres.')
  .transform((v) => v.replace(/\s+/g, ' '));
export const title = z.enum(TITLES, 'Elige un título de la lista.');
export const username = z.string().trim().toLowerCase()
  .regex(/^[a-z0-9._-]{3,40}$/, 'Usa de 3 a 40 caracteres: minúsculas, números, punto, guion o guion bajo.');
export const email = z.string().trim().toLowerCase().max(160, 'Máximo 160 caracteres.')
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Escribe un correo válido.');
export const phone = z.string().trim().max(30, 'Máximo 30 caracteres.').refine(
  (v) => v === '' || (/^[+\d(][\d\s().-]*$/.test(v) && digits(v) >= 10 && digits(v) <= 15),
  'Escribe un teléfono de 10 dígitos.',
);
/** Cédula profesional: la SEP las emite numéricas (7 u 8 dígitos); se aceptan de 5 a 12 por cédulas antiguas o estatales. */
export const license = z.string().trim().nullish().transform((v) => (v ? v.replace(/\s+/g, '') : null))
  .refine((v) => v === null || /^[0-9A-Za-z-]{5,12}$/.test(v), 'La cédula lleva de 5 a 12 caracteres, sin espacios.');

/** EQ-02 · Alta de fisioterapeuta. El rol no viaja: siempre es `therapist`. */
export const NewUser = z.object({
  full_name: fullName,
  title: title.default(''),
  username,
  email,
  specialty: text(120).default(''),
  location_id: z.uuid('Selecciona la sede.'),
  phone: phone.default(''),
  license_number: license,
  license_institution: optionalText(160),
  specialty_license: license,
  is_physician: z.boolean().default(false),
});

/** EQ-03 · Edición por el dueño: los mismos campos, todos opcionales. */
export const EditUser = z.object({
  full_name: fullName.optional(),
  title: title.optional(),
  username: username.optional(),
  email: email.optional(),
  specialty: text(120).optional(),
  location_id: z.uuid('Selecciona la sede.').optional(),
  phone: phone.optional(),
  license_number: license.optional(),
  license_institution: optionalText(160).optional(),
  specialty_license: license.optional(),
  is_physician: z.boolean().optional(),
});

export const PHYSICIAN_NEEDS_LICENSE =
  'Para habilitar recetas médicas registra la cédula profesional de médico (art. 28 Bis de la Ley General de Salud).';

/** Columnas de `users` que pueden salir por la API. Nunca `password_hash`. */
export type TeamUser = {
  id: string; username: string; email: string; role: 'owner' | 'therapist'; full_name: string; title: string;
  display_name: string; specialty: string; location_id: string | null; location_name: string | null; phone: string;
  license_number: string | null; license_institution: string | null; specialty_license: string | null;
  is_physician: boolean; active: boolean; deactivated_at: Date | null; last_login_at: Date | null;
  fingerprint_enrolled_at: Date | null; created_at: Date; has_password: boolean; invited_pending: boolean;
};

export async function loadUser(tx: Tx, id: string): Promise<TeamUser> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Usuario no encontrado.');
  const [u] = await tx<TeamUser[]>`
    select u.id, u.username, u.email, u.role, u.full_name, u.title, trim(u.title || ' ' || u.full_name) as display_name,
           u.specialty, u.location_id, l.name as location_name, u.phone, u.license_number, u.license_institution,
           u.specialty_license, u.is_physician, u.active, u.deactivated_at, u.last_login_at, u.fingerprint_enrolled_at,
           u.created_at, (u.password_hash is not null) as has_password,
           (u.password_hash is null and exists (
              select 1 from auth_tokens t where t.user_id = u.id and t.kind = 'invite' and t.used_at is null and t.expires_at > now()
           )) as invited_pending
    from users u left join locations l on l.id = u.location_id
    where u.id = ${id}`;
  if (!u) throw notFound('Usuario no encontrado.');
  return u;
}

/** Usuario y correo únicos, con el error en su campo (el índice único de la base es el respaldo). */
export async function assertUnique(tx: Tx, v: { username?: string; email?: string }, exceptId: string | null = null) {
  const fields: Record<string, string> = {};
  if (v.username) {
    const [d] = await tx`select 1 from users where lower(username) = ${v.username.toLowerCase()} and id is distinct from ${exceptId}`;
    if (d) fields.username = 'Ese nombre de usuario ya está en uso.';
  }
  if (v.email) {
    const [d] = await tx`select 1 from users where lower(email) = ${v.email.toLowerCase()} and id is distinct from ${exceptId}`;
    if (d) fields.email = 'Ya existe una cuenta con ese correo.';
  }
  const first = Object.values(fields)[0];
  if (first) throw new AppError(409, 'duplicate', first, fields);
}

export async function assertLocation(tx: Tx, id: string, keep: string | null = null) {
  const [l] = await tx<{ active: boolean }[]>`select active from locations where id = ${id}`;
  if (!l) throw badRequest('La sede no existe.', { location_id: 'La sede no existe.' });
  if (!l.active && id !== keep) throw badRequest('Esa sede está inactiva.', { location_id: 'Esa sede está inactiva.' });
}

/** Estado del último correo enviado a una dirección (dentro de la misma transacción). */
export async function lastEmailStatus(tx: Tx, to: string): Promise<'sent' | 'logged' | 'error'> {
  const [m] = await tx<{ status: 'sent' | 'logged' | 'error' }[]>`
    select status from email_outbox where to_email = ${to} order by created_at desc limit 1`;
  return m?.status ?? 'logged';
}

/** Lunes y domingo de la semana que contiene a `date` ('AAAA-MM-DD'). */
export function weekRange(date: string): { from: string; to: string } {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const back = (t.getUTCDay() + 6) % 7; // lunes = 0
  const mon = new Date(t.getTime() - back * 86400000);
  const sun = new Date(mon.getTime() + 6 * 86400000);
  return { from: mon.toISOString().slice(0, 10), to: sun.toISOString().slice(0, 10) };
}

/** Resume un user-agent en algo legible: "Chrome · Windows". */
export function describeDevice(ua: string | null | undefined): string {
  if (!ua) return 'Dispositivo desconocido';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook'
    : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return [browser, os].filter(Boolean).join(' · ') || 'Dispositivo desconocido';
}
