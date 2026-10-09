import type { ConsentKind } from './consent-text';

/** Formas de las respuestas de la API del expediente (snake_case, igual que las columnas). */
export type ClinicalProfile = {
  id: string; patient_id: string; version: number;
  background: string; condition: string; examination: string; diagnosis: string; treatment_plan: string;
  created_by: string | null; created_by_name: string; created_at: string;
};
export type ProfileVersion = Pick<ClinicalProfile, 'id' | 'version' | 'created_at' | 'created_by_name'>;
export type ProfileData = { current: ClinicalProfile | null; versions: ProfileVersion[] };

export type Exercise = { id: string; patient_id: string; name: string; dosage: string; position: number; active: boolean };

export type EvolutionNote = {
  id: string; patient_id: string; appointment_id: string | null; addendum_of: string | null; body: string;
  pain_level: number | null; range_of_motion: string; noted_at: string;
  author_id: string; author_name: string; author_license: string | null; signature_hash: string;
};
export type NoteWithAddenda = EvolutionNote & { addenda: EvolutionNote[] };

export type Consent = {
  id: string; patient_id: string; kind: ConsentKind; signer_name: string; signer_relationship: string;
  signed_at: string; recorded_by: string | null; recorded_by_name: string;
};
export type ConsentTemplate = {
  kind: ConsentKind; title: string; body: string; patient_name: string; patient_age: number; is_minor: boolean;
  guardian_name: string; guardian_relationship: string;
};

export type AccessEvent = {
  id: string; action: string; at: string; actor_name: string; table_name: string; summary: string;
  is_addendum: boolean; consent_kind: ConsentKind | null;
};
export type AccessLog = { items: AccessEvent[]; total: number; limit: number; offset: number };
