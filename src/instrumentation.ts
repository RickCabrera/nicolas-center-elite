// Next.js llama a register() una vez al arrancar el servidor.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.INTERNAL_CRON === 'true') {
    const { startInternalCron } = await import('./lib/internal-cron');
    startInternalCron();
  }
}
