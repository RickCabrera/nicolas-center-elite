import type { BillingState } from '@/lib/format';

/** DASH-01..04 · Respuesta de GET /api/dashboard. */
export type Dashboard = {
  today: string;
  date_label: string;
  location_id: string | null;
  location_name: string | null;
  stats: { patients_active: number; appointments_today: number; due: number; attendance_today: number };
  today_appointments: {
    id: string; starts_at: string; time: string; patient_id: string; patient_name: string; type_name: string;
    therapist_name: string; status: 'scheduled' | 'attended' | 'no_show';
  }[];
  recent_attendance: {
    id: string; person_name: string; person_type: 'patient' | 'staff'; role_label: 'Paciente' | 'Fisioterapeuta' | 'Dirección' | 'Recepción';
    patient_id: string | null; location_name: string; occurred_at: string; time: string; direction: 'in' | 'out';
  }[];
  due_payments?: { patient_id: string; full_name: string; plan_name: string; next_due_date: string; state: BillingState }[];
};
