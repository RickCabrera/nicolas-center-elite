import { asSystem } from './db';

/**
 * Reloj interno para la tarea diaria cuando la app corre en un servidor siempre encendido
 * (Railway, VPS) y no hay Vercel Cron. Se activa con INTERNAL_CRON=true.
 *
 * Cada 10 minutos revisa si en la Ciudad de México ya pasó la 01:30 y la tarea no ha corrido hoy.
 * El candado de la base y la tabla job_runs garantizan una sola ejecución por día aunque haya
 * reinicios o varias instancias.
 */
const JOB = 'daily';
const CHECK_MS = 10 * 60 * 1000;
let started = false;

export async function tick(now = new Date()): Promise<'ran' | 'skipped'> {
  const { runDaily } = await import('@/modules/maintenance/daily');
  return asSystem(async (tx) => {
    const [{ locked }] = await tx<{ locked: boolean }[]>`select pg_try_advisory_xact_lock(727275) as locked`;
    if (!locked) return 'skipped';
    const [t] = await tx<{ day: string; minutes: number }[]>`
      select (${now}::timestamptz at time zone 'America/Mexico_City')::date::text as day,
             extract(hour from ${now}::timestamptz at time zone 'America/Mexico_City')::int * 60
               + extract(minute from ${now}::timestamptz at time zone 'America/Mexico_City')::int as minutes`;
    if (t.minutes < 90) return 'skipped'; // antes de la 01:30
    const [done] = await tx<{ last_day: string }[]>`select last_day::text from job_runs where name = ${JOB}`;
    if (done && done.last_day >= t.day) return 'skipped';
    const result = await runDaily(tx);
    await tx`
      insert into job_runs (name, last_day, last_at, result) values (${JOB}, ${t.day}, now(), ${tx.json(result as never)})
      on conflict (name) do update set last_day = excluded.last_day, last_at = excluded.last_at, result = excluded.result`;
    console.log('[tarea diaria]', JSON.stringify(result));
    return 'ran';
  });
}

export function startInternalCron() {
  if (started) return;
  started = true;
  const run = () => tick().catch((e) => console.error('[tarea diaria] falló:', e instanceof Error ? e.message : e));
  setTimeout(run, 60 * 1000); // un minuto después de arrancar
  setInterval(run, CHECK_MS).unref();
  console.log('[tarea diaria] reloj interno activo (01:30, hora de la Ciudad de México).');
}
