import { z } from 'zod';
import { route } from '@/lib/api';
import { badRequest } from '@/lib/errors';
import { storage } from '@/lib/storage';
import { clinicView, imageKind } from '@/modules/settings/server';
import { SETTING_DEFAULTS, SETTING_RANGES, TEMPLATE_INFO, unknownMarkers } from '@/modules/settings/shared';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_PATH = /^clinic\/logo-\d{10,16}\.(png|jpg|webp)$/;

// CFG-01 · Datos de la clínica. Cualquier usuario los lee (membretes); el dueño recibe además parámetros y plantillas.
export const GET = route({ auth: 'user' }, async ({ db, user }) => clinicView(db, user.role === 'owner'));

// CFG-01 · Boleto para subir el logo directo al almacenamiento. Después se fija con PATCH { logo_path }.
const LogoRequest = z.object({ logo: z.literal('request'), ext: z.enum(['png', 'jpg', 'webp']).default('png') });
export const POST = route({ auth: 'owner', body: LogoRequest }, async ({ body }) => {
  const path = `clinic/logo-${Date.now()}.${body.ext}`;
  return { path, ticket: await storage.createUpload(path), max_bytes: MAX_LOGO_BYTES };
});

const int = (key: keyof typeof SETTING_RANGES) => {
  const { min, max, unit } = SETTING_RANGES[key];
  const msg = `Debe ser un número entero entre ${min} y ${max} ${unit}.`;
  return z.number(msg).int(msg).min(min, msg).max(max, msg).optional();
};
const bool = z.boolean('Debe ser sí o no.').optional();
// CFG-06 · Solo llaves conocidas; se conservan las desconocidas en el análisis para poder rechazarlas con un mensaje claro.
const Settings = z.looseObject({
  due_soon_days: int('due_soon_days'),
  attendance_tolerance_min: int('attendance_tolerance_min'),
  idle_minutes: int('idle_minutes'),
  staff_alternate_in_out: bool,
  patient_alternate_in_out: bool,
  package_consume_on_attendance: bool,
});

const template = (key: keyof typeof TEMPLATE_INFO) => {
  const info = TEMPLATE_INFO[key];
  return z.string().trim().max(20000, 'El texto es demasiado largo (máximo 20,000 caracteres).')
    .refine((s) => !info.required || s.length >= 20, 'Este texto no puede quedar vacío: se usa en documentos que se firman.')
    .refine((s) => unknownMarkers(s, info.markers).length === 0, 'Hay un marcador que no existe para este texto. Usa solo los de la lista.')
    .optional();
};

const Body = z.object({
  name: z.string().trim().min(2, 'Escribe el nombre de la clínica.').max(120, 'Máximo 120 caracteres.').optional(),
  legal_name: z.string().trim().max(160, 'Máximo 160 caracteres.').optional(),
  tagline: z.string().trim().max(160, 'Máximo 160 caracteres.').optional(),
  phone: z.string().trim().max(40, 'Máximo 40 caracteres.').regex(/^[\d\s()+\-.,/extEXT]*$/, 'Escribe solo el número telefónico.').optional(),
  email: z.union([z.literal(''), z.email('Escribe un correo válido.')]).optional(),
  logo_path: z.string().regex(LOGO_PATH, 'Ruta de logo inválida.').nullable().optional(),
  settings: Settings.optional(),
  privacy_notice: template('privacy_notice'),
  privacy_notice_short: template('privacy_notice_short'),
  consent_template: template('consent_template'),
  biometric_consent: template('biometric_consent'),
  rx_footer: template('rx_footer'),
});

const COLUMNS = ['name', 'legal_name', 'tagline', 'phone', 'email', 'privacy_notice', 'privacy_notice_short', 'consent_template', 'biometric_consent', 'rx_footer'] as const;

// CFG-01 · CFG-06 · CFG-07 · Guarda datos, parámetros y plantillas de la clínica (solo dueño).
export const PATCH = route({ auth: 'owner', body: Body }, async ({ db, body }) => {
  const patch: Record<string, string | null> = {};
  for (const k of COLUMNS) if (body[k] !== undefined) patch[k] = body[k] as string;
  if (typeof body.email === 'string') patch.email = body.email.trim().toLowerCase();

  let settings: Record<string, number | boolean> | null = null;
  if (body.settings) {
    const unknown = Object.keys(body.settings).filter((k) => !(k in SETTING_DEFAULTS));
    if (unknown.length) throw badRequest(`Parámetro desconocido: ${unknown.join(', ')}.`, Object.fromEntries(unknown.map((k) => [`settings.${k}`, 'Parámetro desconocido.'])));
    settings = Object.fromEntries(Object.entries(body.settings).filter(([, v]) => v !== undefined)) as Record<string, number | boolean>;
    if (!Object.keys(settings).length) settings = null;
  }

  let oldLogo: string | null = null;
  if (body.logo_path !== undefined) {
    const [cur] = await db<{ logo_path: string | null }[]>`select logo_path from clinic`;
    if (body.logo_path) {
      // El archivo ya se subió con el boleto: se comprueba que exista, que pese poco y que de verdad sea una imagen.
      const size = await storage.size(body.logo_path);
      if (size === null) throw badRequest('No se encontró el archivo del logo. Vuelve a subirlo.', { logo_path: 'No se encontró el archivo.' });
      let problem = size > MAX_LOGO_BYTES ? 'El logo no debe pesar más de 2 MB.' : size === 0 ? 'El archivo está vacío.' : '';
      if (!problem && !imageKind(await storage.read(body.logo_path))) problem = 'El logo debe ser una imagen PNG, JPG o WEBP.';
      if (problem) {
        await storage.remove(body.logo_path).catch(() => {});
        throw badRequest(problem, { logo_path: problem });
      }
    }
    patch.logo_path = body.logo_path;
    if (cur?.logo_path && cur.logo_path !== body.logo_path) oldLogo = cur.logo_path;
  }

  const keys = Object.keys(patch);
  if (!keys.length && !settings) throw badRequest('No hay cambios que guardar.');
  if (keys.length) await db`update clinic set ${db(patch, ...keys)}`;
  // La mezcla ocurre en la base: las llaves que no vienen conservan su valor.
  if (settings) await db`update clinic set settings = settings || ${db.json(settings as never)}`;
  if (oldLogo) await storage.remove(oldLogo).catch(() => {});
  return clinicView(db, true);
});
