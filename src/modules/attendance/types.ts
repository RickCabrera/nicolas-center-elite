/** Tipos compartidos por las pantallas del módulo de huella (mismos nombres que la API). */
export type Device = {
  id: string; name: string; location_id: string; location_name: string;
  model: string; serial: string; firmware: string;
  host: string; port: number; use_https: boolean; username: string; has_password: boolean;
  active: boolean; online: boolean; bridge_online: boolean;
  last_event_at: string | null; last_webhook_at: string | null; bridge_seen_at: string | null; bridge_version: string | null;
  device_reachable: boolean | null; device_checked_at: string | null; last_sync_at: string | null; last_error: string | null;
};

export type DeviceSecrets = {
  webhook_url: string;
  listener: { protocol: 'HTTP' | 'HTTPS'; host: string; port: number; path: string };
  bridge_token: string;
  bridge_config: { cloud_url: string; bridge_token: string };
  bridge_config_json: string;
};

export type ReaderStatus = {
  id: string; name: string; location_id: string; location_name: string;
  online: boolean; bridge_online: boolean;
  last_event_at: string | null; last_sync_at: string | null; last_error: string | null;
  last_read: { person_name: string; occurred_at: string; direction: 'in' | 'out'; person_type: string } | null;
};

export type Attendance = {
  id: string; person_type: 'patient' | 'staff' | 'unknown'; patient_id: string | null; user_id: string | null;
  employee_no: string | null; person_name: string; role_label: string;
  location_id: string; location_name: string; occurred_at: string; direction: 'in' | 'out';
  source: 'device' | 'bridge' | 'manual' | 'simulator'; verify_mode: string; manual_reason: string | null;
  recorded_by_name: string | null; appointment_id: string | null; session_consumed: boolean;
  billing_state: 'pagado' | 'por_vencer' | 'vencido' | 'pausado' | 'sin_plan' | null;
};
export type AttendanceList = { date: string | null; total: number; items: Attendance[] };

export type CommandStatus = {
  id: string; kind: string; status: 'pending' | 'running' | 'done' | 'error';
  error: string | null; error_code: string | null; result: Record<string, unknown> | null;
  progress?: { stage: 'capturing' | 'on_device'; employee_no: string | null } | null;
  device_id: string; device_name: string; bridge_online: boolean;
};

export type EnrollInfo = {
  person_type: 'patient' | 'staff'; person_id: string; enrolled_at: string | null; has_consent: boolean;
  device: { id: string; name: string; online: boolean; bridge_online: boolean } | null;
  enrollments: { device_id: string; device_name: string; status: 'pending' | 'enrolled' | 'failed'; enrolled_at: string | null }[];
};

export type StaffReportRow = {
  user_id: string; person_name: string; location_name: string;
  days: { date: string; first_in: string | null; last_out: string | null; minutes: number; pairs: number; incomplete: boolean }[];
  weeks: { week_start: string; minutes: number; incomplete_days: number }[];
  total_minutes: number; incomplete_days: number;
};
export type AttendanceReport = {
  from: string; to: string; location_id: string | null;
  staff: StaffReportRow[];
  patients: { patient_id: string; person_name: string; record_number: string; location_name: string; visits: number; days: number; first_at: string; last_at: string }[];
  totals: { staff_minutes: number; incomplete_days: number; patient_visits: number };
};
