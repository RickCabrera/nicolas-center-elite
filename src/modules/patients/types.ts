import type { BillingState } from '@/lib/format';

/** Renglón de `GET /api/patients` (PAC-01). */
export type PatientListItem = {
  id: string;
  record_number: string;
  full_name: string;
  birth_date: string;
  age: number;
  sex: 'F' | 'M' | 'X' | null;
  location_id: string;
  location_name: string;
  therapist_id: string;
  therapist_name: string; // con título: "L.F.T. Karla Ocampo"
  reason: string;
  tags: string[];
  status: 'active' | 'inactive';
  plan_name: string | null;
  billing_state: BillingState;
  next_due_date: string | null;
  fingerprint_enrolled_at: string | null;
};
export type PatientList = { items: PatientListItem[]; total: number; total_scope: number };

/** Respuesta de `GET /api/patients/[id]`: datos generales + cobranza + consentimientos firmados. */
export type PatientDetail = {
  id: string;
  record_number: string;
  full_name: string;
  sex: 'F' | 'M' | 'X' | null;
  birth_date: string;
  age: number;
  curp: string | null;
  address: string;
  phone: string;
  email: string;
  emergency_name: string;
  emergency_phone: string;
  guardian_name: string;
  guardian_relationship: string;
  guardian_phone: string;
  location_id: string;
  location_name: string;
  therapist_id: string;
  therapist_name: string;    // "Karla Ocampo"
  therapist_display: string; // "L.F.T. Karla Ocampo"
  tags: string[];
  reason: string;
  status: 'active' | 'inactive';
  deactivated_at: string | null;
  deactivation_reason: string | null;
  hik_employee_no: string;
  fingerprint_enrolled_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  plan_name: string | null;
  plan_kind: 'monthly' | 'package' | 'single' | null;
  billing_state: BillingState;
  next_due_date: string | null;
  sessions_remaining: number | null;
  consents: { privacy: boolean; informed: boolean; biometric: boolean };
};

export type ImportRow = {
  line: number;
  ok: boolean;
  errors: string[];
  data: {
    full_name: string; birth_date: string; sex: string; phone: string; location_name: string;
    therapist_name: string; plan_name: string; reason: string; tags: string[];
  };
};
export type ImportPreview = { rows: ImportRow[]; valid: number; invalid: number };
