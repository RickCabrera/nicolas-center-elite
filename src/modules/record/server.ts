import { inflateSync } from 'node:zlib';
import type { Tx } from '@/lib/db';
import { badRequest, notFound } from '@/lib/errors';
import type { ConsentKind } from './consent-text';

/** Lógica de servidor del expediente clínico (solo se importa desde rutas de la API). */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string | undefined | null): s is string => !!s && UUID.test(s);

export type RecordPatient = {
  id: string; record_number: string; full_name: string; sex: string | null; birth_date: string; age: number;
  phone: string; reason: string; guardian_name: string; guardian_relationship: string; guardian_phone: string;
  location_id: string; therapist_id: string; status: string;
  location_name: string; location_address: string; location_phone: string; therapist_display: string | null;
};

/**
 * Paciente del expediente leído bajo RLS: si no es del fisioterapeuta de la sesión, para él no existe (404).
 * Toda ruta del expediente empieza por aquí.
 */
export async function requirePatient(db: Tx, id: string): Promise<RecordPatient> {
  if (!isUuid(id)) throw notFound('Paciente no encontrado.');
  const [p] = await db<RecordPatient[]>`
    select p.id, p.record_number, p.full_name, p.sex, p.birth_date, age_years(p.birth_date) as age,
           p.phone, p.reason, p.guardian_name, p.guardian_relationship, p.guardian_phone,
           p.location_id, p.therapist_id, p.status,
           l.name as location_name, l.phone as location_phone,
           trim(both ', ' from concat_ws(', ', nullif(l.street, ''), nullif(l.neighborhood, ''),
                nullif(trim(l.zip || ' ' || l.city), ''), nullif(l.state, ''))) as location_address,
           (select trim(u.title || ' ' || u.full_name) from users u where u.id = p.therapist_id) as therapist_display
    from patients p join locations l on l.id = p.location_id
    where p.id = ${id}`;
  if (!p) throw notFound('Paciente no encontrado.');
  return p;
}

// ───────── consentimientos (EXP-10 / PAC-08) ─────────
export { CONSENT_KINDS, CONSENT_TITLE, RELATIONSHIPS, resolveSigner, type ConsentKind } from './consent-text';

/** Texto de la plantilla con los datos de la clínica, la sede y el paciente ya puestos. */
export async function consentTemplate(db: Tx, patient: RecordPatient, kind: ConsentKind): Promise<{ clinic_name: string; body: string }> {
  const [c] = await db<{ name: string; privacy_notice: string; consent_template: string; biometric_consent: string }[]>`
    select name, privacy_notice, consent_template, biometric_consent from clinic`;
  if (!c) throw notFound('La clínica no está configurada.');
  const raw = kind === 'privacy' ? c.privacy_notice : kind === 'informed' ? c.consent_template : c.biometric_consent;
  if (!raw.trim()) throw badRequest('La plantilla de este documento está vacía. Captúrala en Configuración antes de firmar.');
  const body = raw
    .replaceAll('{{clinica}}', () => c.name)
    .replaceAll('{{domicilio}}', () => patient.location_address || patient.location_name);
  return { clinic_name: c.name, body };
}

const PNG_PREFIX = 'data:image/png;base64,';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const SIGNATURE_MAX_BYTES = 300 * 1024;

/**
 * Valida la firma trazada: data URL PNG real, de tamaño razonable y con trazo.
 * Un lienzo en blanco produce renglones de píxeles idénticos; una firma, muchos renglones distintos.
 * Devuelve el mensaje de error o null si es válida.
 */
export function signatureProblem(dataUrl: string): string | null {
  if (!dataUrl.startsWith(PNG_PREFIX)) return 'La firma debe ser una imagen PNG trazada en pantalla.';
  const b64 = dataUrl.slice(PNG_PREFIX.length);
  if (!b64 || !/^[A-Za-z0-9+/]+=*$/.test(b64)) return 'La firma no es válida. Traza la firma de nuevo.';
  if (dataUrl.length > SIGNATURE_MAX_BYTES) return 'La imagen de la firma es demasiado grande. Limpia el panel y firma de nuevo.';
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 57 || !buf.subarray(0, 8).equals(PNG_MAGIC)) return 'La firma no es una imagen PNG válida.';
  try {
    let pos = 8, width = 0, height = 0, channels = 4, depth = 8, interlace = 0;
    const idat: Buffer[] = [];
    while (pos + 8 <= buf.length) {
      const len = buf.readUInt32BE(pos);
      const type = buf.toString('latin1', pos + 4, pos + 8);
      const data = buf.subarray(pos + 8, pos + 8 + len);
      if (type === 'IHDR') {
        width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; interlace = data[12];
        channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[data[9]] ?? 4;
      } else if (type === 'IDAT') idat.push(data);
      else if (type === 'IEND') break;
      pos += 12 + len;
    }
    if (!width || !height || width > 2400 || height > 2400 || !idat.length) return 'La firma no es una imagen PNG válida.';
    if (interlace) return null; // no se puede inspeccionar renglón por renglón; se acepta la imagen
    const raw = inflateSync(Buffer.concat(idat), { maxOutputLength: 32 * 1024 * 1024 });
    const stride = 1 + Math.ceil((width * channels * depth) / 8);
    const rows = new Set<string>();
    for (let y = 0; y < height && (y + 1) * stride <= raw.length; y++) {
      rows.add(raw.toString('latin1', y * stride, (y + 1) * stride));
      if (rows.size >= 8) return null;
    }
    return 'La firma está vacía. Pide a quien firma que trace su firma en el panel.';
  } catch {
    return 'La firma no es una imagen PNG válida.';
  }
}
