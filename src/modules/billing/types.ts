import type { BillingState } from '@/lib/format';
import type { PlanKind } from './rules';

/** Renglón de la vista patient_billing tal como lo devuelve la API. */
export type Billing = {
  patient_id: string;
  membership_id: string | null;
  plan_id: string | null;
  plan_name: string | null;
  plan_kind: PlanKind | null;
  price_cents: number | null;
  period_days: number | null;
  sessions_count: number | null;
  started_on: string | null;
  next_due_date: string | null;
  sessions_remaining: number | null;
  membership_status: 'active' | 'paused' | null;
  paused_on?: string | null;
  plan_active?: boolean | null;
  state: BillingState;
};

export type BoardRow = Billing & { full_name: string; record_number: string; location_id: string; location_name: string };
export type Board = { stats: Record<BillingState, number>; rows: BoardRow[] };

export type Payment = {
  id: string;
  receipt_number: string;
  patient_id: string;
  membership_id: string;
  plan_name: string;
  plan_kind: PlanKind;
  amount_cents: number;
  method: 'cash' | 'transfer' | 'card' | 'online_card' | 'oxxo';
  sat_payment_form?: string | null;
  invoice_id?: string | null;
  invoice_folio?: string | null;
  invoice_status?: string | null;
  paid_on: string;
  reference: string;
  note: string;
  prev_due_date: string;
  new_due_date: string;
  prev_sessions: number | null;
  new_sessions: number | null;
  recorded_by: string | null;
  recorded_by_name: string;
  created_at: string;
  voided_at: string | null;
  voided_by: string | null;
  voided_by_name?: string | null;
  void_reason: string | null;
  voidable?: boolean;
  refundable?: boolean;
  patient_name?: string;
  location_name?: string;
};

export type MembershipDetail = {
  patient: { id: string; full_name: string; record_number: string; phone?: string | null };
  membership: Billing | null;
  state: BillingState;
  history: { id: string; plan_name: string; plan_kind: PlanKind; started_on: string; ended_on: string | null }[];
  payments?: Payment[];
};

export type Plan = {
  id: string; name: string; kind: PlanKind; price_cents: number; period_days: number; sessions_count: number | null;
  position: number; active: boolean; patients: number; memberships: number;
};

export type Report = {
  from: string; to: string; months: string[];
  rows: { month: string; location_name: string; plan_name: string; payments: number; total_cents: number }[];
  totals: {
    total_cents: number; payments: number;
    by_month: { month: string; payments: number; total_cents: number }[];
    by_location: { location_name: string; payments: number; total_cents: number }[];
    by_plan: { plan_name: string; payments: number; total_cents: number }[];
    by_method: { method: string; payments: number; total_cents: number }[];
  };
};

export type PaymentLink = {
  id: string; patient_id: string; membership_id: string; plan_name: string; concept: string; amount_cents: number;
  methods: string[]; customer_email: string | null; url: string | null;
  status: 'open' | 'pending_oxxo' | 'paid' | 'needs_review' | 'expired' | 'failed' | 'cancelled' | 'refunded';
  paid_method: 'online_card' | 'oxxo' | null; payment_id: string | null; review_reason: string | null;
  expires_at: string; paid_at: string | null; created_at: string; created_by_name: string;
  patient_name?: string; record_number?: string; receipt_number?: string | null;
};

export type Invoice = {
  id: string; kind: 'individual' | 'global'; patient_id: string | null; patient_name?: string | null; record_number?: string | null;
  uuid: string | null; series: string; folio_number: number | null; status: 'pending' | 'valid' | 'canceled' | 'error';
  cancellation_status: string | null; livemode: boolean; total_cents: number; payment_form: string; cfdi_use: string;
  customer: { legal_name: string; tax_id: string; tax_system: string; email?: string; address?: { zip: string } };
  global_period: { periodicity: string; months: string; year: number } | null; verification_url: string | null;
  cancel_motive: string | null; canceled_at: string | null; created_at: string; created_by_name: string;
  payments: { id: string; receipt_number: string; amount_cents: number }[];
};
