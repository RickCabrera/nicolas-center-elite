import postgres from 'postgres';
import { env } from './env';

/**
 * Acceso a datos. Hay exactamente dos modos:
 *
 *  · asUser(user, fn)  → consultas a nombre de un usuario. Corre con el rol `nce_app`, por lo que
 *                        TODA política RLS aplica (el fisioterapeuta solo ve a sus pacientes; recepción
 *                        ve lo administrativo de todos y nada clínico).
 *  · asSystem(fn)      → consultas del sistema (autenticación, webhooks, tareas programadas).
 *                        No pasa por RLS: úsalo solo cuando el código ya validó el permiso.
 *
 * Las fechas (`date`) llegan como texto 'AAAA-MM-DD' para no desplazarse por zona horaria.
 * Los `timestamptz` llegan como Date y viajan como ISO 8601.
 */
export type Sql = postgres.Sql<Record<string, never>>;
export type Tx = postgres.TransactionSql<Record<string, never>>;
/** AUTH-10 · Roles: dueño, fisioterapeuta y recepción (administrativo, sin acceso clínico). */
export type Role = 'owner' | 'therapist' | 'reception';
export type Identity = { id: string; role: Role };

const g = globalThis as unknown as { __nce_sql?: Sql };

export function db(): Sql {
  if (!g.__nce_sql) {
    g.__nce_sql = postgres(env().DATABASE_URL, {
      max: env().APP_ENV === 'production' ? 5 : 10,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false, // compatible con el pooler en modo transacción de Supabase
      onnotice: () => {},
      types: {
        date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
      },
    }) as unknown as Sql;
  }
  return g.__nce_sql;
}

export async function asUser<T>(user: Identity, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().begin(async (tx) => {
    await tx`select set_config('app.user_id', ${user.id}, true), set_config('app.user_role', ${user.role}, true)`;
    await tx`set local role nce_app`;
    return fn(tx as unknown as Tx);
  }) as Promise<T>;
}

export async function asSystem<T>(fn: (tx: Tx) => Promise<T>, actor?: Identity): Promise<T> {
  return db().begin(async (tx) => {
    if (actor) {
      // Conserva la identidad para la bitácora aunque no aplique RLS.
      await tx`select set_config('app.user_id', ${actor.id}, true), set_config('app.user_role', ${actor.role}, true)`;
    }
    return fn(tx as unknown as Tx);
  }) as Promise<T>;
}

export async function closeDb() {
  if (g.__nce_sql) {
    await g.__nce_sql.end({ timeout: 5 });
    g.__nce_sql = undefined;
  }
}
