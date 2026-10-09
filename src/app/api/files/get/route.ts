import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { NextRequest } from 'next/server';
import { fail } from '@/lib/api';
import { env } from '@/lib/env';
import { localFilePath, mimeForFile, verifyLocalSignature } from '@/lib/storage';

// Solo controlador local: sirve un archivo con URL firmada y vigente (equivale a la URL firmada de Supabase).
export async function GET(req: NextRequest) {
  if (env().STORAGE_DRIVER !== 'local') return fail(404, 'not_found', 'No encontrado.');
  const q = req.nextUrl.searchParams;
  const path = q.get('path') ?? '';
  if (!verifyLocalSignature('get', path, Number(q.get('exp')), q.get('sig') ?? '')) {
    return fail(403, 'expired', 'El enlace del archivo caducó. Vuelve a abrirlo desde el expediente.');
  }
  try {
    const full = localFilePath(path);
    const info = await stat(full);
    const headers: Record<string, string> = {
      'Content-Type': mimeForFile(path) ?? 'application/octet-stream',
      'Content-Length': String(info.size),
      'Cache-Control': 'private, no-store',
    };
    const dl = q.get('dl');
    if (dl) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(dl)}`;
    return new Response(Readable.toWeb(createReadStream(full)) as ReadableStream, { headers });
  } catch {
    return fail(404, 'not_found', 'El archivo no existe.');
  }
}
