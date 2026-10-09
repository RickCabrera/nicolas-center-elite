import { z } from 'zod';

/** Variables de entorno validadas (INF-02). Se evalúan en el primer uso, no al importar. */
const schema = z.object({
  DATABASE_URL: z.string().min(1, 'Cadena de conexión a Postgres (Supabase → Database → Transaction pooler).'),
  SESSION_SECRET: z.string().min(32, 'Secreto para firmar sesiones, mínimo 32 caracteres.'),
  ENCRYPTION_KEY: z.string().min(16, 'Llave para cifrar credenciales del lector, mínimo 16 caracteres.'),
  APP_URL: z.string().url('URL pública de la app, por ejemplo https://app.tuclinica.mx'),
  APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  SETUP_TOKEN: z.string().optional().default(''),
  CRON_SECRET: z.string().optional().default(''),
  STORAGE_DRIVER: z.enum(['local', 'supabase']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('.data/storage'),
  SUPABASE_URL: z.string().optional().default(''),
  SUPABASE_ANON_KEY: z.string().optional().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(''),
  SUPABASE_BUCKET: z.string().default('estudios'),
  RESEND_API_KEY: z.string().optional().default(''),
  EMAIL_FROM: z.string().default('Nicolas Center Elite <no-reply@example.com>'),
  ENABLE_SIMULATOR: z.string().optional().default('false'),
  // Cobro en línea (Stripe) y facturación (Facturapi). Opcionales: sin llave, la función se muestra desactivada.
  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),
  STRIPE_API_BASE: z.string().url().default('https://api.stripe.com'),
  FACTURAPI_KEY: z.string().optional().default(''),
  FACTURAPI_API_BASE: z.string().url().default('https://www.facturapi.io'),
});

export type Env = z.infer<typeof schema>;
let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Configuración incompleta. Revisa estas variables de entorno:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const problems: string[] = [];
  if (e.STORAGE_DRIVER === 'supabase') {
    if (!e.SUPABASE_URL) problems.push('SUPABASE_URL: URL del proyecto de Supabase.');
    if (!e.SUPABASE_ANON_KEY) problems.push('SUPABASE_ANON_KEY: llave pública (anon) del proyecto.');
    if (!e.SUPABASE_SERVICE_ROLE_KEY) problems.push('SUPABASE_SERVICE_ROLE_KEY: llave de servicio del proyecto.');
  }
  if (e.APP_ENV === 'production') {
    if (e.STORAGE_DRIVER !== 'supabase') problems.push('STORAGE_DRIVER: en producción debe ser "supabase".');
    if (!e.CRON_SECRET) problems.push('CRON_SECRET: secreto de la tarea programada diaria.');
  }
  if (problems.length) {
    throw new Error(`Configuración incompleta. Revisa estas variables de entorno:\n${problems.map((p) => `  · ${p}`).join('\n')}`);
  }
  cached = e;
  return e;
}

export const isProduction = () => env().APP_ENV === 'production';
/** El simulador de lecturas jamás existe en producción (HUE-14). */
export const simulatorEnabled = () => !isProduction() && env().ENABLE_SIMULATOR === 'true';
