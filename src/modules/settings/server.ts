/** Lógica de servidor del módulo Configuración (no se importa desde el navegador). */
import { strToU8 } from 'fflate';
import type { Tx } from '@/lib/db';
import { notFound } from '@/lib/errors';
import { storage } from '@/lib/storage';
import { fillTemplate, locationAddress, readSettings, type LocationLike } from './shared';

// ───────── CFG-01 · clínica ─────────
type ClinicRow = {
  name: string; legal_name: string | null; tagline: string | null; phone: string | null; email: string | null;
  logo_path: string | null; settings: unknown; privacy_notice: string; privacy_notice_short: string;
  consent_template: string; biometric_consent: string; rx_footer: string; updated_at: Date;
};

/** Lo que devuelve GET/PATCH /api/clinic. El dueño recibe además parámetros y plantillas. */
export async function clinicView(db: Tx, owner: boolean) {
  const [c] = await db<ClinicRow[]>`select * from clinic`;
  if (!c) throw notFound('La clínica no está configurada.');
  let logo_url: string | null = null;
  if (c.logo_path) {
    try {
      logo_url = await storage.signedUrl(c.logo_path, { expiresIn: 3600 });
    } catch {
      logo_url = null; // el logo es decorativo: si el almacenamiento falla, la pantalla sigue funcionando
    }
  }
  const base = { name: c.name, legal_name: c.legal_name ?? '', tagline: c.tagline ?? '', phone: c.phone ?? '', email: c.email ?? '', logo_url };
  if (!owner) return base;
  return {
    ...base,
    settings: readSettings(c.settings),
    privacy_notice: c.privacy_notice,
    privacy_notice_short: c.privacy_notice_short,
    consent_template: c.consent_template,
    biometric_consent: c.biometric_consent,
    rx_footer: c.rx_footer,
    updated_at: c.updated_at,
  };
}

/** Reconoce PNG, JPG o WEBP por sus primeros bytes (no por la extensión que diga el navegador). */
export function imageKind(b: Uint8Array): 'png' | 'jpg' | 'webp' | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return null;
}

// ───────── LEG-03 · aviso de privacidad público ─────────
export async function loadPrivacy(tx: Tx) {
  const [c] = await tx<{ name: string; privacy_notice: string; privacy_notice_short: string }[]>`
    select name, privacy_notice, privacy_notice_short from clinic`;
  if (!c) throw notFound('La clínica no está configurada.');
  const locs = await tx<LocationLike[]>`
    select name, street, neighborhood, city, state, zip from locations where active order by name`;
  const parts = locs.map((l) => (locs.length > 1 ? `${locationAddress(l) || l.name} (sede ${l.name})` : locationAddress(l) || l.name));
  const domicilio = parts.length > 1 ? `${parts.slice(0, -1).join('; ')} y ${parts[parts.length - 1]}` : parts[0] ?? '';
  const vars = { clinica: c.name, domicilio };
  return {
    clinic_name: c.name,
    notice: fillTemplate(c.privacy_notice, vars),
    notice_short: fillTemplate(c.privacy_notice_short, vars),
  };
}

// ───────── CFG-10 · exportaciones ─────────
const cell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.every((x) => typeof x !== 'object' || x === null) ? v.join('; ') : JSON.stringify(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/** CSV en UTF-8 con BOM (para que Excel respete acentos), separado por comas y con CRLF. */
export function toCsv(columns: string[], rows: Record<string, unknown>[]): Uint8Array {
  const esc = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [columns.map(esc).join(',')];
  for (const r of rows) lines.push(columns.map((c) => esc(cell(r[c]))).join(','));
  return strToU8('﻿' + lines.join('\r\n') + '\r\n');
}

export const text = (s: string) => strToU8(s.replace(/\r?\n/g, '\r\n'));

/** Nombre de archivo seguro dentro de un ZIP (sin rutas ni caracteres raros). */
export function safeName(name: string, fallback = 'archivo'): string {
  const n = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').replace(/^\.+/, '').slice(-90);
  return n || fallback;
}

/**
 * Descarga de un ZIP. Se envía como flujo en trozos: así no aplica el tope de tamaño de respuesta
 * que las funciones de Vercel imponen a los cuerpos que se devuelven de una sola pieza.
 */
export function zipResponse(bytes: Uint8Array, filename: string): Response {
  const CHUNK = 256 * 1024;
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.subarray(offset, Math.min(offset + CHUNK, bytes.length)));
      offset += CHUNK;
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
