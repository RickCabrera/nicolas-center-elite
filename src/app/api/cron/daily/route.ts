import { route } from '@/lib/api';
import { safeEqual } from '@/lib/crypto';
import { env } from '@/lib/env';
import { AppError, unauthorized } from '@/lib/errors';
import { expireStaleLinks } from '@/modules/billing/online';
import { syncPendingCancellations } from '@/modules/invoicing/server';

export const dynamic = 'force-dynamic';

/**
 * DEP-01 / PAG-03 · Tarea diaria. Vercel Cron la llama a las 07:30 UTC (01:30 en México) con
 * `Authorization: Bearer <CRON_SECRET>` (ver vercel.json). Cierra lo que el día dejó abierto:
 * citas sin asistencia → "no asistió", sesiones y tokens caducados, órdenes al lector sin respuesta.
 * También vence los links de pago en línea abandonados y revisa las cancelaciones de facturas que
 * esperaban respuesta del receptor. Los estados de pago no necesitan tarea: se calculan al consultar.
 */
export const GET = route({ auth: 'public' }, async ({ req, db }) => {
  const secret = env().CRON_SECRET;
  if (!secret) throw new AppError(503, 'not_configured', 'La tarea diaria no está configurada: falta CRON_SECRET.');
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || !safeEqual(token, secret)) throw unauthorized('Token de la tarea programada inválido.');
  const [row] = await db<{ result: Record<string, number> }[]>`select daily_housekeeping() as result`;
  const expired_payment_links = await expireStaleLinks(db);
  const invoices = await syncPendingCancellations(db);
  return { ...row.result, expired_payment_links, invoice_cancellations_checked: invoices.checked, invoices_canceled: invoices.canceled, ran_at: new Date().toISOString() };
});
