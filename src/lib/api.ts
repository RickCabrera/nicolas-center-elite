import { NextRequest, NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { asSystem, asUser, type Tx } from './db';
import { AppError, forbidden, unauthorized } from './errors';
import { readSession, SESSION_COOKIE, type SessionUser } from './auth/session';

/**
 * Envoltura única para TODAS las rutas de la API (INF-05).
 *
 *   export const GET = route({ auth: 'user', query: Q }, async ({ db, user, query }) => { ... return datos; });
 *
 * · auth: 'user' (cualquier sesión) · 'owner' (solo dueño) · 'public' (sin sesión; la ruta valida lo suyo)
 * · body / query: esquemas zod; un dato inválido responde 400 señalando el campo.
 * · db: transacción abierta. Con sesión corre bajo RLS a nombre del usuario; en 'public' es de sistema.
 * · system(fn): transacción aparte SIN RLS para lo que el usuario no puede tocar directo
 *   (p. ej. escribir en users o device_commands). Valida el permiso antes de usarla.
 *   Ojo: no ve los cambios aún no confirmados de `db`.
 * · Respuesta: { ok: true, data } o { ok: false, error: { code, message, fields? } }.
 *   Si el handler devuelve un Response (PDF, descarga), se envía tal cual.
 */
export type RouteCtx<B, Q> = {
  req: NextRequest;
  params: Record<string, string>;
  user: SessionUser;
  db: Tx;
  body: B;
  query: Q;
  system: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
};

type Options<B, Q> = {
  auth?: 'user' | 'owner' | 'public';
  body?: ZodType<B>;
  query?: ZodType<Q>;
  /** Permite usar la ruta aunque el usuario deba cambiar su contraseña. */
  allowPendingPassword?: boolean;
};

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: { code: string; message: string; fields?: Record<string, string> } };

export const ok = <T>(data: T, init?: ResponseInit) => NextResponse.json({ ok: true, data } satisfies ApiOk<T>, init);
export const fail = (status: number, code: string, message: string, fields?: Record<string, string>) =>
  NextResponse.json({ ok: false, error: { code, message, ...(fields ? { fields } : {}) } } satisfies ApiErr, { status });

const ANON = { id: '', role: 'therapist' } as unknown as SessionUser;

export function route<B = unknown, Q = Record<string, string>>(
  opts: Options<B, Q>,
  handler: (ctx: RouteCtx<B, Q>) => Promise<unknown>,
) {
  const auth = opts.auth ?? 'user';
  return async (req: NextRequest, segment: { params: Promise<Record<string, string | string[]>> }): Promise<Response> => {
    let who: string | null = null;
    try {
      const rawParams = (await segment?.params) ?? {};
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawParams)) params[k] = Array.isArray(v) ? v.join('/') : v;

      // Defensa CSRF: una petición que modifica debe venir del mismo origen.
      if (auth !== 'public' && !['GET', 'HEAD'].includes(req.method)) {
        const origin = req.headers.get('origin');
        const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
        if (origin && host && new URL(origin).host !== host) throw forbidden('Origen no permitido.');
      }

      let user = ANON;
      if (auth !== 'public') {
        const u = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
        if (!u) throw unauthorized();
        if (auth === 'owner' && u.role !== 'owner') throw forbidden('Esta sección es solo para el dueño.');
        if (u.must_change_password && !opts.allowPendingPassword) {
          throw new AppError(403, 'password_change_required', 'Debes cambiar tu contraseña antes de continuar.');
        }
        user = u;
        who = u.id;
      }

      let query = Object.fromEntries(req.nextUrl.searchParams.entries()) as unknown as Q;
      if (opts.query) query = opts.query.parse(query);

      let body = undefined as unknown as B;
      if (opts.body) {
        let json: unknown;
        try {
          json = await req.json();
        } catch {
          throw new AppError(400, 'bad_request', 'El cuerpo de la petición debe ser JSON válido.');
        }
        body = opts.body.parse(json);
      }

      const identity = { id: user.id, role: user.role };
      const system = <T>(fn: (tx: Tx) => Promise<T>) => asSystem(fn, auth === 'public' ? undefined : identity);
      const run = (db: Tx) => handler({ req, params, user, db, body, query, system });
      const result = auth === 'public' ? await asSystem(run) : await asUser(identity, run);
      if (result instanceof Response) return result;
      return ok(result ?? null);
    } catch (e) {
      return errorResponse(e, { method: req.method, path: req.nextUrl.pathname, user_id: who });
    }
  };
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  appointments_no_therapist_overlap: 'El fisioterapeuta ya tiene una cita que se empalma con ese horario.',
  appointments_no_patient_overlap: 'El paciente ya tiene una cita que se empalma con ese horario.',
  memberships_one_current: 'El paciente ya tiene una membresía vigente.',
  users_username_key: 'Ese nombre de usuario ya está en uso.',
  users_email_key: 'Ya existe una cuenta con ese correo.',
  membership_plans_name_key: 'Ya existe un plan con ese nombre.',
  locations_name_key: 'Ya existe una sede con ese nombre.',
  locations_code_key: 'Ya existe una sede con esa clave.',
  session_types_name_key: 'Ya existe un tipo de sesión con ese nombre.',
};

export function errorResponse(e: unknown, ctx: { method?: string; path?: string; user_id?: string | null } = {}): Response {
  if (e instanceof AppError) return fail(e.status, e.code, e.message, e.fields);
  if (e instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const i of e.issues) {
      const k = i.path.join('.') || '_';
      if (!fields[k]) fields[k] = i.message;
    }
    const first = Object.entries(fields)[0];
    return fail(400, 'validation', first ? `${first[0] === '_' ? '' : first[0] + ': '}${first[1]}` : 'Datos inválidos.', fields);
  }
  const pg = e as { code?: string; message?: string; constraint_name?: string; hint?: string };
  if (typeof pg?.code === 'string' && /^[0-9A-Z]{5}$/.test(pg.code)) {
    const named = pg.constraint_name ? CONSTRAINT_MESSAGES[pg.constraint_name] : undefined;
    switch (pg.code) {
      case 'P0001': // raise exception de nuestras reglas: el mensaje ya viene en español
        return fail(400, pg.hint === 'controlled' ? 'controlled_substance' : 'rule', pg.message ?? 'Operación no permitida.',
          pg.hint && pg.hint !== 'controlled' ? { [pg.hint]: pg.message ?? '' } : undefined);
      case '23P01':
        return fail(409, 'overlap', named ?? 'El horario se empalma con otro registro.');
      case '23505':
        return fail(409, 'duplicate', named ?? 'Ya existe un registro con esos datos.');
      case '23503':
        return fail(409, 'in_use', 'No se puede completar: el registro está relacionado con otros datos.');
      case '23514':
      case '23502':
      case '22P02':
      case '22007':
      case '22008':
        return fail(400, 'invalid', 'Hay un dato con formato o valor no permitido.');
      case '42501':
        return fail(403, 'forbidden', pg.message?.includes('row-level security') || pg.message?.includes('permission denied')
          ? 'No tienes permiso para hacer esto.' : (pg.message ?? 'No tienes permiso para hacer esto.'));
    }
  }
  // INF-08 · Registro estructurado (una línea JSON): Vercel lo indexa y se puede buscar por ruta o usuario.
  // Nunca incluye el cuerpo de la petición (puede traer datos clínicos).
  const err = e instanceof Error ? e : new Error(String(e));
  console.error(JSON.stringify({
    level: 'error', at: new Date().toISOString(), msg: 'error no controlado en la API', ...ctx,
    error: err.message, code: (e as { code?: string })?.code ?? null, stack: err.stack?.split('\n').slice(0, 6).join(' | '),
  }));
  return fail(500, 'internal', 'Ocurrió un error inesperado. Intenta de nuevo.');
}

/** Paginación estándar: ?limit=&offset= */
export function paging(q: Record<string, string | undefined>, max = 200, def = 50) {
  const limit = Math.min(Math.max(parseInt(q.limit ?? '', 10) || def, 1), max);
  const offset = Math.max(parseInt(q.offset ?? '', 10) || 0, 0);
  return { limit, offset };
}

export function clientIp(req: NextRequest): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip');
}
