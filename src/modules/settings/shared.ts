/**
 * Piezas del módulo Configuración que sirven igual en servidor y navegador:
 * marcadores de plantillas, parámetros de la clínica y nombres legibles.
 */
import type { TemplateKey } from './default-templates';

// ───────── CFG-07 · plantillas ─────────
export const TEMPLATE_KEYS: TemplateKey[] = ['privacy_notice', 'privacy_notice_short', 'consent_template', 'biometric_consent', 'rx_footer'];

export const TEMPLATE_INFO: Record<TemplateKey, { label: string; where: string; markers: string[]; required: boolean }> = {
  privacy_notice: { label: 'Aviso de privacidad integral', where: 'Se muestra en la página pública de privacidad y se firma al dar de alta a un paciente.', markers: ['clinica', 'domicilio'], required: true },
  privacy_notice_short: { label: 'Aviso de privacidad corto', where: 'Versión resumida que acompaña los formularios de captura.', markers: ['clinica', 'domicilio'], required: true },
  consent_template: { label: 'Consentimiento informado', where: 'Carta que firma el paciente o su tutor antes de iniciar el tratamiento.', markers: ['clinica', 'domicilio', 'paciente', 'firmante', 'parentesco'], required: true },
  biometric_consent: { label: 'Consentimiento de huella', where: 'Se firma antes de registrar la huella en el lector.', markers: ['clinica', 'domicilio', 'paciente', 'firmante', 'parentesco'], required: true },
  rx_footer: { label: 'Pie de recetas e indicaciones', where: 'Se imprime al pie de cada receta e indicación que se emita a partir de ahora.', markers: [], required: false },
};

export const MARKER_HELP: Record<string, string> = {
  clinica: 'Nombre de la clínica',
  domicilio: 'Domicilio de la sede',
  paciente: 'Nombre del paciente',
  firmante: 'Quien firma',
  parentesco: 'Relación de quien firma con el paciente',
};

/** Sustituye {{marcador}} por su valor; un marcador desconocido se deja tal cual para que se note. */
export function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k: string) => vars[k.toLowerCase()] ?? m);
}

/** Marcadores escritos en el texto que el sistema no conoce (errores de dedo como {{clinca}}). */
export function unknownMarkers(text: string, allowed: string[]): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)) if (!allowed.includes(m[1].toLowerCase())) out.add(m[1]);
  return [...out];
}

export type LocationLike = { name: string; street: string; neighborhood: string; city: string; state: string; zip: string };
/** Mismo armado que usa la base al emitir documentos (documents_before_insert). */
export function locationAddress(l: LocationLike): string {
  return [l.street, l.neighborhood, `${l.zip} ${l.city}`.trim(), l.state].map((s) => s.trim()).filter(Boolean).join(', ');
}

// ───────── CFG-06 · parámetros ─────────
export type ClinicSettings = {
  due_soon_days: number;
  attendance_tolerance_min: number;
  idle_minutes: number;
  staff_alternate_in_out: boolean;
  patient_alternate_in_out: boolean;
  package_consume_on_attendance: boolean;
};
/** Valores con los que trabaja la base cuando la llave no existe (ver clinic_setting(...) en las migraciones). */
export const SETTING_DEFAULTS: ClinicSettings = {
  due_soon_days: 7,
  attendance_tolerance_min: 90,
  idle_minutes: 30,
  staff_alternate_in_out: true,
  patient_alternate_in_out: false,
  package_consume_on_attendance: true,
};
export const SETTING_RANGES = {
  due_soon_days: { min: 1, max: 30, unit: 'días' },
  attendance_tolerance_min: { min: 15, max: 240, unit: 'minutos' },
  idle_minutes: { min: 5, max: 240, unit: 'minutos' },
} as const;

/** Mezcla lo guardado con los valores por defecto, ignorando llaves ajenas o con tipo incorrecto. */
export function readSettings(raw: unknown): ClinicSettings {
  const out = { ...SETTING_DEFAULTS } as Record<string, number | boolean>;
  if (raw && typeof raw === 'object') {
    for (const [k, def] of Object.entries(SETTING_DEFAULTS)) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === typeof def) out[k] = v as number | boolean;
    }
  }
  return out as unknown as ClinicSettings;
}

// ───────── LEG-03 · ARCO ─────────
export const ARCO_KINDS = ['acceso', 'rectificacion', 'cancelacion', 'oposicion'] as const;
export type ArcoKind = (typeof ARCO_KINDS)[number];
export const ARCO_KIND_LABEL: Record<ArcoKind, string> = { acceso: 'Acceso', rectificacion: 'Rectificación', cancelacion: 'Cancelación', oposicion: 'Oposición' };
export const ARCO_KIND_HELP: Record<ArcoKind, string> = {
  acceso: 'Conocer qué datos personales tenemos de usted y cómo los usamos.',
  rectificacion: 'Corregir datos inexactos o incompletos.',
  cancelacion: 'Solicitar que se eliminen sus datos cuando la ley lo permita.',
  oposicion: 'Oponerse a un uso específico de sus datos.',
};
export const ARCO_STATUSES = ['recibida', 'en_proceso', 'resuelta', 'rechazada'] as const;
export type ArcoStatus = (typeof ARCO_STATUSES)[number];
export const ARCO_STATUS_LABEL: Record<ArcoStatus, string> = { recibida: 'Recibida', en_proceso: 'En proceso', resuelta: 'Resuelta', rechazada: 'Rechazada' };
export const ARCO_RESPONSE_DAYS = 20; // días hábiles (art. 32 LFPDPPP)

// ───────── CFG-05 · catálogos ─────────
export const CATALOG_KINDS = ['session-types', 'study-types', 'tags'] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];
