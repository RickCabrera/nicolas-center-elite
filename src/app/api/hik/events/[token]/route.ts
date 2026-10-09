import { NextResponse } from 'next/server';
import { route } from '@/lib/api';
import { notFound } from '@/lib/errors';
import { parseHikPayload, textBytes, MAX_TEXT_BYTES } from '@/modules/attendance/hik-parser';
import { deviceByWebhookToken, ingestEvents } from '@/modules/attendance/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Tope del cuerpo completo (el lector puede adjuntar una foto, que se descarta). */
const MAX_BODY_BYTES = 6 * 1024 * 1024;
const okText = (text = 'OK') => new NextResponse(text, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
const tooLarge = () => new NextResponse('Payload too large', { status: 413, headers: { 'content-type': 'text/plain' } });

/**
 * HUE-02 / HUE-03 / HUE-04 · Webhook del lector Hikvision ("HTTP Listening").
 * El token de la URL identifica al lector (se guarda solo su hash). Responde 200 corto y rápido aunque el
 * evento se ignore o venga mal formado, porque el lector reintenta lo que no recibe 200.
 * La foto adjunta, si viene, no se lee ni se guarda (HUE-16).
 */
export const POST = route({ auth: 'public' }, async ({ req, params, db }) => {
  const device = await deviceByWebhookToken(db, params.token);
  if (!device) throw notFound(); // genérico: no revela si el token existió

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return tooLarge();

  await db`update devices set last_webhook_at = now() where id = ${device.id}`;

  let body: Uint8Array;
  try {
    body = new Uint8Array(await req.arrayBuffer());
  } catch {
    return okText();
  }
  if (body.length > MAX_BODY_BYTES) return tooLarge();
  const contentType = req.headers.get('content-type');
  if (textBytes(contentType, body) > MAX_TEXT_BYTES) return tooLarge();

  const events = parseHikPayload(contentType, body);
  if (events.length) {
    try {
      await ingestEvents(db, device, events, 'device');
    } catch (e) {
      console.error('[huella] webhook: error al registrar eventos:', (e as Error).message);
    }
  }
  return okText();
});

// El botón de prueba del lector (y algunos firmwares antes de enviar) hacen GET/HEAD a la URL.
export const GET = route({ auth: 'public' }, async ({ params, db }) => {
  const device = await deviceByWebhookToken(db, params.token);
  if (!device) throw notFound();
  return okText();
});

export const HEAD = route({ auth: 'public' }, async ({ params, db }) => {
  const device = await deviceByWebhookToken(db, params.token);
  if (!device) throw notFound();
  return new NextResponse(null, { status: 200 });
});
