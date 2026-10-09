import type { Tx } from './db';

/**
 * Deja un evento explícito en la bitácora (los cambios a tablas ya se registran solos por trigger).
 * Úsalo para accesos al expediente, inicios de sesión, exportaciones e impresiones.
 */
export async function logEvent(
  tx: Tx,
  action: 'view' | 'login' | 'logout' | 'export' | 'print' | 'download' | 'security' | string,
  summary: string,
  opts: { patientId?: string | null; table?: string; rowId?: string | null } = {},
) {
  await tx`select log_event(${action}, ${summary}, ${opts.patientId ?? null}, ${opts.table ?? ''}, ${opts.rowId ?? null})`;
}
