'use client';
import type { UploadTicket } from './storage';

/** Sube un archivo desde el navegador usando el boleto que entregó la API. */
export async function uploadWithTicket(ticket: UploadTicket, file: Blob, onProgress?: (fraction: number) => void): Promise<void> {
  if (ticket.driver === 'local') {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', ticket.url);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('No se pudo subir el archivo.')));
      xhr.onerror = () => reject(new Error('Se perdió la conexión durante la subida.'));
      xhr.send(file);
    });
    return;
  }
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(ticket.supabaseUrl, ticket.anonKey, { auth: { persistSession: false } });
  onProgress?.(0.1);
  const { error } = await client.storage.from(ticket.bucket).uploadToSignedUrl(ticket.path, ticket.token, file, {
    contentType: file.type || 'application/octet-stream',
  });
  if (error) throw new Error(`No se pudo subir el archivo: ${error.message}`);
  onProgress?.(1);
}
