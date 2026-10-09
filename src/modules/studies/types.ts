import type { UploadTicket } from '@/lib/storage';

/** Estudio tal como lo entrega la API. Nunca incluye rutas de almacenamiento (EST-01). */
export type Study = {
  id: string;
  patient_id: string;
  patient_name: string;
  type_name: string;
  title: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  study_date: string;
  status: 'pending' | 'ready';
  uploaded_by: string | null;
  uploaded_by_name: string;
  created_at: string;
  archived_at: string | null;
  archived_by_name: string | null;
  archive_reason: string | null;
  has_thumb: boolean;
  thumb_url: string | null;
};

/** Detalle: agrega las URLs firmadas de corta duración del archivo. */
export type StudyDetail = Study & { file_url: string; download_url: string; url_expires_in: number };

export type CreatedStudy = { study: Study; upload: UploadTicket; thumb_upload?: UploadTicket };
