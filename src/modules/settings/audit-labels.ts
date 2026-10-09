/** CFG-09 · Nombres en español para leer la bitácora sin conocer la base de datos. */
import { fmtDate, fmtDateTime } from '@/lib/dates';
import { APPT_STATUS_LABEL, money, PAYMENT_METHOD_LABEL, PLAN_KIND_LABEL } from '@/lib/format';

export const TABLE_LABEL: Record<string, { many: string; one: string }> = {
  patients: { many: 'Pacientes', one: 'Paciente' },
  clinical_profiles: { many: 'Perfiles clínicos', one: 'Perfil clínico' },
  exercises: { many: 'Ejercicios', one: 'Ejercicio' },
  evolution_notes: { many: 'Notas de evolución', one: 'Nota de evolución' },
  consents: { many: 'Consentimientos', one: 'Consentimiento' },
  studies: { many: 'Estudios', one: 'Estudio' },
  appointments: { many: 'Citas', one: 'Cita' },
  documents: { many: 'Recetas e indicaciones', one: 'Documento' },
  membership_plans: { many: 'Planes de membresía', one: 'Plan' },
  memberships: { many: 'Membresías', one: 'Membresía' },
  payments: { many: 'Pagos', one: 'Pago' },
  attendance_events: { many: 'Asistencias', one: 'Asistencia' },
  devices: { many: 'Lectores de huella', one: 'Lector' },
  users: { many: 'Usuarios', one: 'Usuario' },
  clinic: { many: 'Datos de la clínica', one: 'Datos de la clínica' },
  locations: { many: 'Sedes', one: 'Sede' },
  therapist_hours: { many: 'Horarios laborales', one: 'Horario laboral' },
  time_blocks: { many: 'Bloqueos de agenda', one: 'Bloqueo de agenda' },
  session_types: { many: 'Tipos de sesión', one: 'Tipo de sesión' },
  study_types: { many: 'Tipos de estudio', one: 'Tipo de estudio' },
  patient_tags: { many: 'Etiquetas', one: 'Etiqueta' },
  arco_requests: { many: 'Solicitudes de privacidad', one: 'Solicitud de privacidad' },
};
export const tableLabel = (t: string) => TABLE_LABEL[t]?.many ?? (t || 'General');

export const ACTION_LABEL: Record<string, string> = {
  insert: 'Creó', update: 'Actualizó', delete: 'Eliminó', view: 'Consultó', login: 'Inició sesión', logout: 'Cerró sesión',
  export: 'Exportó', import: 'Importó', print: 'Imprimió', download: 'Descargó', security: 'Seguridad', arco_submit: 'Formulario público',
};
export const actionLabel = (a: string) => ACTION_LABEL[a] ?? a;
export const ACTION_TONE: Record<string, 'green' | 'gold' | 'red' | 'blue' | undefined> = {
  insert: 'green', update: 'blue', delete: 'red', export: 'gold', import: 'gold', security: 'gold', print: undefined, view: undefined,
};

const FIELD_LABEL: Record<string, string> = {
  id: 'identificador', full_name: 'nombre', name: 'nombre', legal_name: 'razón social', tagline: 'lema', sex: 'sexo', birth_date: 'fecha de nacimiento',
  curp: 'CURP', address: 'domicilio', phone: 'teléfono', email: 'correo', emergency_name: 'contacto de emergencia', emergency_phone: 'teléfono de emergencia',
  guardian_name: 'tutor', guardian_relationship: 'parentesco del tutor', guardian_phone: 'teléfono del tutor', location_id: 'sede', therapist_id: 'fisioterapeuta',
  tags: 'etiquetas', reason: 'motivo de consulta', status: 'estado', deactivated_at: 'fecha de baja', deactivation_reason: 'motivo de baja',
  hik_employee_no: 'número en el lector', fingerprint_enrolled_at: 'huella registrada', record_number: 'número de expediente',
  created_at: 'creado', updated_at: 'actualizado', created_by: 'creado por', created_by_name: 'creado por',
  version: 'versión', background: 'antecedentes', condition: 'padecimiento actual', examination: 'exploración física', diagnosis: 'diagnóstico',
  treatment_plan: 'plan de tratamiento', dosage: 'dosis', position: 'orden', active: 'activo',
  body: 'texto', pain_level: 'dolor', range_of_motion: 'movilidad', noted_at: 'fecha de la nota', author_id: 'autor', author_name: 'autor',
  author_license: 'cédula del autor', signature_hash: 'firma electrónica', addendum_of: 'adenda de', appointment_id: 'cita', patient_id: 'paciente',
  kind: 'tipo', signer_name: 'firmante', signer_relationship: 'parentesco del firmante', signed_at: 'fecha de firma', recorded_by: 'registró', recorded_by_name: 'registró',
  type_name: 'tipo', title: 'título', file_name: 'archivo', storage_path: 'ubicación del archivo', thumb_path: 'miniatura', mime: 'formato', size_bytes: 'tamaño',
  study_date: 'fecha del estudio', uploaded_by: 'subió', uploaded_by_name: 'subió', archived_at: 'archivado', archived_by: 'archivó', archive_reason: 'motivo de archivo',
  starts_at: 'inicio', ends_at: 'fin', duration_min: 'duración (min)', notes: 'notas', cancel_reason: 'motivo de cancelación', cancelled_at: 'cancelado',
  cancelled_by: 'canceló', attended_at: 'asistió', series_id: 'serie',
  folio: 'folio', folio_number: 'número de folio', issuer_id: 'emisor', issuer_name: 'emisor', issuer_title: 'título del emisor', issuer_specialty: 'especialidad del emisor',
  issuer_license: 'cédula del emisor', issuer_institution: 'institución del emisor', issuer_specialty_license: 'cédula de especialidad', clinic_name: 'clínica',
  location_name: 'sede', location_address: 'domicilio de la sede', location_phone: 'teléfono de la sede', patient_name: 'paciente', patient_age: 'edad',
  patient_sex: 'sexo', general_indications: 'indicaciones generales', footer: 'pie de página', duplicated_from: 'duplicado de', issued_at: 'emitido',
  content_hash: 'huella de contenido',
  price_cents: 'precio', period_days: 'vigencia (días)', sessions_count: 'sesiones', plan_id: 'plan', started_on: 'inicio', next_due_date: 'próximo vencimiento',
  sessions_remaining: 'sesiones restantes', paused_on: 'pausada desde', ended_on: 'terminó',
  receipt_number: 'recibo', membership_id: 'membresía', plan_name: 'plan', plan_kind: 'tipo de plan', amount_cents: 'monto', method: 'forma de pago',
  paid_on: 'fecha de pago', reference: 'referencia', note: 'nota', prev_due_date: 'vencimiento anterior', new_due_date: 'vencimiento nuevo',
  prev_sessions: 'sesiones antes', new_sessions: 'sesiones después', voided_at: 'anulado', voided_by: 'anuló', void_reason: 'motivo de anulación',
  model: 'modelo', serial: 'número de serie', firmware: 'firmware', host: 'dirección en la red', port: 'puerto', use_https: 'usa HTTPS', username: 'usuario',
  last_event_at: 'última lectura', last_webhook_at: 'último aviso', bridge_seen_at: 'puente visto', bridge_version: 'versión del puente',
  device_reachable: 'lector alcanzable', device_checked_at: 'última revisión', last_sync_at: 'última sincronización', last_error: 'último error',
  role: 'rol', specialty: 'especialidad', license_number: 'cédula profesional', license_institution: 'institución', specialty_license: 'cédula de especialidad',
  is_physician: 'es médico', must_change_password: 'debe cambiar contraseña', failed_attempts: 'intentos fallidos', locked_until: 'bloqueado hasta',
  last_login_at: 'último acceso', logo_path: 'logo', settings: 'parámetros', privacy_notice: 'aviso de privacidad', privacy_notice_short: 'aviso de privacidad corto',
  consent_template: 'consentimiento informado', biometric_consent: 'consentimiento de huella', rx_footer: 'pie de recetas',
  code: 'clave', street: 'calle y número', neighborhood: 'colonia', city: 'ciudad', state: 'estado', zip: 'código postal', hours: 'horario',
  default_duration_min: 'duración (min)', user_id: 'usuario', weekday: 'día de la semana', start_time: 'hora de inicio', end_time: 'hora de fin',
  requester_name: 'solicitante', contact: 'contacto', details: 'descripción', resolution: 'resolución', resolved_at: 'resuelta',
  device_id: 'lector', person_type: 'tipo de persona', employee_no: 'número en el lector', person_name: 'persona', occurred_at: 'momento',
  direction: 'sentido', source: 'origen', verify_mode: 'modo de verificación', dedupe_key: 'llave de lectura', manual_reason: 'motivo de captura manual',
  session_consumed: 'descontó sesión',
};
export const fieldLabel = (k: string) => FIELD_LABEL[k] ?? k.replace(/_/g, ' ');

const VALUE_LABEL: Record<string, Record<string, string>> = {
  status: { active: 'Activo', inactive: 'Inactivo', paused: 'Pausada', ended: 'Terminada', issued: 'Emitido', cancelled: 'Cancelado', pending: 'Pendiente', ready: 'Listo', ...APPT_STATUS_LABEL },
  sex: { F: 'Femenino', M: 'Masculino', X: 'Otro' },
  method: PAYMENT_METHOD_LABEL,
  plan_kind: PLAN_KIND_LABEL,
  role: { owner: 'Dueño', therapist: 'Fisioterapeuta' },
  direction: { in: 'Entrada', out: 'Salida' },
};

/** Valor de un campo de la bitácora en texto legible. */
export function fieldValue(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') : '—';
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${fieldLabel(k)}: ${fieldValue(k, x)}`).join('\n');
  if (typeof v === 'number') return /_cents$/.test(key) ? money(v) : String(v);
  const s = String(v);
  if (VALUE_LABEL[key]?.[s]) return VALUE_LABEL[key][s];
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return fmtDate(s);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return `${fmtDateTime(s)} h`;
  return s;
}
