import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/api';
import { env } from '@/lib/env';
import { localFilePath, MAX_UPLOAD_BYTES, verifyLocalSignature } from '@/lib/storage';

// Solo controlador local: recibe la subida autorizada por un boleto firmado.
export async function PUT(req: NextRequest) {
  if (env().STORAGE_DRIVER !== 'local') return fail(404, 'not_found', 'No encontrado.');
  const q = req.nextUrl.searchParams;
  const path = q.get('path') ?? '';
  if (!verifyLocalSignature('put', path, Number(q.get('exp')), q.get('sig') ?? '')) return fail(403, 'expired', 'La autorización de subida caducó.');
  if (Number(req.headers.get('content-length') ?? 0) > MAX_UPLOAD_BYTES) return fail(413, 'too_large', 'El archivo es demasiado grande.');
  if (!req.body) return fail(400, 'bad_request', 'Archivo vacío.');
  const full = localFilePath(path);
  await mkdir(dirname(full), { recursive: true });
  try {
    await pipeline(Readable.fromWeb(req.body as never), createWriteStream(full));
  } catch {
    await rm(full, { force: true });
    return fail(500, 'upload_failed', 'No se pudo guardar el archivo.');
  }
  return ok(null);
}
