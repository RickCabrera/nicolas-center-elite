// DEP-01 · Reloj interno de la tarea diaria (Railway / VPS): una sola vez por día, después de la 01:30.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from '@/lib/internal-cron';
import { fixtures, sqlSystem } from '../helpers';

vi.mock('@/lib/db', async (original) => {
  const mod = await original<typeof import('@/lib/db')>();
  const skip = (tx: any) => new Proxy(tx, {
    get(target, key, receiver) {
      if (key === 'unsafe') return (q: string, ...rest: unknown[]) => (/session_replication_role/.test(q) ? Promise.resolve([]) : target.unsafe(q, ...rest));
      return Reflect.get(target, key, receiver);
    },
  });
  return { ...mod, asSystem: (fn: (tx: any) => Promise<unknown>, actor?: any) => mod.asSystem((tx) => fn(skip(tx)), actor) };
});

beforeEach(async () => { await fixtures(); });

describe('INTERNAL_CRON · tarea diaria sin Vercel', () => {
  it('no corre antes de la 01:30 (hora de México)', async () => {
    expect(await tick(new Date('2026-10-14T07:10:00Z'))).toBe('skipped'); // 01:10 en CDMX
    expect(await sqlSystem((tx) => tx`select 1 from job_runs`)).toHaveLength(0);
  });

  it('corre una vez después de la 01:30 y no se repite el mismo día', async () => {
    expect(await tick(new Date('2026-10-14T07:35:00Z'))).toBe('ran');
    expect(await tick(new Date('2026-10-14T15:00:00Z'))).toBe('skipped');
    const [r] = await sqlSystem((tx) => tx<{ last_day: string; result: Record<string, unknown> }[]>`select last_day::text, result from job_runs where name = 'daily'`);
    expect(r.last_day).toBe('2026-10-14');
    expect(r.result).toHaveProperty('expired_payment_links');
    expect(await tick(new Date('2026-10-15T08:00:00Z'))).toBe('ran'); // al día siguiente vuelve a correr
  });
});
