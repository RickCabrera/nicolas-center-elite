import type { ArcoKind, ArcoStatus, ClinicSettings } from './shared';

export type ClinicData = {
  name: string; legal_name: string; tagline: string; phone: string; email: string; logo_url: string | null;
  settings: ClinicSettings;
  privacy_notice: string; privacy_notice_short: string; consent_template: string; biometric_consent: string; rx_footer: string;
  updated_at: string;
};
export type LocationRow = {
  id: string; code: string; name: string; street: string; neighborhood: string; city: string; state: string; zip: string;
  phone: string; hours: string; active: boolean; active_patients: number; active_users: number; documents_count: number;
};
export type CatalogItem = { id?: string; name: string; default_duration_min?: number; position: number; active: boolean };
export type AuditItem = {
  id: string; at: string; actor_id: string | null; actor_name: string; action: string; table_name: string; row_id: string | null;
  patient_id: string | null; patient_name: string | null; summary: string; row_label: string | null; changed: string[];
};
export type AuditDetail = Omit<AuditItem, 'changed' | 'row_label'> & { before: Record<string, unknown> | null; after: Record<string, unknown> | null };
export type AuditFacets = { actors: { id: string; name: string }[]; actions: string[]; tables: string[] };
export type ArcoRequest = {
  id: string; requester_name: string; contact: string; kind: ArcoKind; details: string; status: ArcoStatus; resolution: string;
  created_at: string; resolved_at: string | null;
};
