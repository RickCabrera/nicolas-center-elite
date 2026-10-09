'use client';
import { api, ApiError } from '@/lib/client';
import type { CommandStatus } from './types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type WaitResult =
  | { outcome: 'done'; command: CommandStatus }
  | { outcome: 'error'; command: CommandStatus | null; message: string }
  | { outcome: 'timeout'; command: CommandStatus | null }
  | { outcome: 'aborted'; command: CommandStatus | null };

/**
 * HUE-06 · Espera el resultado de una orden enviada al agente puente consultándola cada `intervalMs`.
 * Termina en `done`, `error`, por tiempo, o cuando `isAborted()` devuelve true (el usuario cerró la espera).
 */
export async function waitForCommand(
  commandId: string,
  opts: { timeoutMs: number; intervalMs?: number; isAborted?: () => boolean; onTick?: (c: CommandStatus) => void },
): Promise<WaitResult> {
  const interval = opts.intervalMs ?? 1500;
  const until = Date.now() + opts.timeoutMs;
  let last: CommandStatus | null = null;
  let netErrors = 0;
  while (Date.now() < until) {
    if (opts.isAborted?.()) return { outcome: 'aborted', command: last };
    try {
      last = await api.get<CommandStatus>(`/api/enrollments/${commandId}`);
      netErrors = 0;
      opts.onTick?.(last);
      if (last.status === 'done') return { outcome: 'done', command: last };
      if (last.status === 'error') return { outcome: 'error', command: last, message: last.error ?? 'El lector reportó un error.' };
    } catch (e) {
      // Un tropiezo de red no cancela la espera; un 404/403 sí.
      if (e instanceof ApiError && e.status !== 0 && e.status < 500) return { outcome: 'error', command: last, message: e.message };
      if (++netErrors > 5) return { outcome: 'error', command: last, message: 'Sin conexión. Revisa tu internet e intenta de nuevo.' };
    }
    await sleep(interval);
  }
  return { outcome: 'timeout', command: last };
}
