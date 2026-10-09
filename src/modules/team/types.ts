/** Tipos que comparten las rutas y las pantallas de Equipo. Las fechas llegan al navegador como texto ISO. */
export type WorkloadRow = {
  id: string; display_name: string; title: string; full_name: string; username: string; email: string; specialty: string;
  location_id: string | null; location_name: string | null; is_physician: boolean; license_number: string | null; active: boolean;
  fingerprint_enrolled_at: string | Date | null; last_login_at: string | Date | null; invited_pending: boolean; has_password: boolean;
  patients_active: number; appointments_today: number; appointments_week: number; attended_week: number;
  no_show_week: number; attendance_days_week: number; notes_week: number;
};

export type Workload = { today: string; week_from: string; week_to: string; items: WorkloadRow[] };

export type TeamUserDetail = {
  id: string; username: string; email: string; role: 'owner' | 'therapist'; full_name: string; title: string; display_name: string;
  specialty: string; location_id: string | null; location_name: string | null; phone: string;
  license_number: string | null; license_institution: string | null; specialty_license: string | null;
  is_physician: boolean; active: boolean; deactivated_at: string | null; last_login_at: string | null;
  fingerprint_enrolled_at: string | null; created_at: string; has_password: boolean; invited_pending: boolean;
  patients_active?: number; patients_inactive?: number; future_appointments?: number;
};

export type InviteResult = { kind?: 'invite' | 'reset'; email?: string; invite_link: string; email_status: 'sent' | 'logged' | 'error'; expires_hours?: number };

export type DeactivateAppointment = { id: string; starts_at: string; patient_name: string; to_name: string; reason?: string };
export type DeactivateResult = {
  user: TeamUserDetail;
  patients_moved: number;
  appointments_moved: number;
  appointments_cancelled: DeactivateAppointment[];
  appointments_review: DeactivateAppointment[];
  sessions_revoked: number;
  fingerprint_removal: 'queued' | 'none';
};

export type ReassignResult = {
  moved: number; appointments_moved: number;
  appointments_conflict: { id: string; starts_at: string; patient_name: string; reason: string }[];
};
