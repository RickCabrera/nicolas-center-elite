import { afterAll } from 'vitest';
import { applyTestEnv } from './env';

applyTestEnv();

afterAll(async () => {
  const { closeDb } = await import('@/lib/db');
  await closeDb();
});
