/** Cita tal como la entrega /api/appointments (mismos nombres que las columnas). */
export type Appointment = {
  id: string; patient_id: string; therapist_id: string; location_id: string;
  starts_at: string; ends_at: string; duration_min: number; type_name: string; notes: string;
  status: 'scheduled' | 'attended' | 'no_show' | 'cancelled';
  cancel_reason: string | null; cancelled_at: string | null; attended_at: string | null; series_id: string | null;
  patient_name: string; therapist_name: string; therapist_short: string; location_name: string;
  date: string; time: string; has_note: boolean;
};
export type SeriesResult = { series_id: string; created: Appointment[]; conflicts: { date: string; time: string; reason: string }[] };
export type HourRow = { weekday: number; start_time: string; end_time: string };
export type TimeBlock = { id: string; user_id: string; user_name?: string; starts_at: string; ends_at: string; reason: string };

export const STATUS_TONE: Record<Appointment['status'], 'green' | 'red' | 'blue' | undefined> = {
  scheduled: 'blue', attended: 'green', no_show: 'red', cancelled: undefined,
};
export const DURATIONS = [30, 40, 50, 60, 90];
