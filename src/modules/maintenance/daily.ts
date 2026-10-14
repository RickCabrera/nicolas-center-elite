import type { Tx } from '@/lib/db';
import { expireStaleLinks } from '@/modules/billing/online';
import { syncPendingCancellations } from '@/modules/invoicing/server';

/**
 * DEP-01 / PAG-03 · Tarea diaria. Cierra lo que el día dejó abierto: citas sin asistencia → "no asistió",
 * sesiones y tokens caducados, órdenes al lector sin respuesta, links de pago abandonados y cancelaciones
 * de facturas que esperaban respuesta del receptor.
 *
 * La disparan dos caminos, el que aplique según dónde corra la app:
 *  · Vercel Cron → GET /api/cron/daily (vercel.json).
 *  · Servidor siempre encendido (Railway, VPS) → reloj interno con INTERNAL_CRON=true (src/lib/internal-cron.ts).
 */
export async function runDaily(db: Tx) {
  const [row] = await db<{ result: Record<string, number> }[]>`select daily_housekeeping() as result`;
  const expired_payment_links = await expireStaleLinks(db);
  const invoices = await syncPendingCancellations(db);
  return {
    ...row.result, expired_payment_links,
    invoice_cancellations_checked: invoices.checked, invoices_canceled: invoices.canceled,
    ran_at: new Date().toISOString(),
  };
}
