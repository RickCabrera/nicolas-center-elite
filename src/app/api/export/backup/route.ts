import { zipSync, type Zippable } from 'fflate';
import { route } from '@/lib/api';
import { logEvent } from '@/lib/audit';
import { fmtDateTime, todayIso } from '@/lib/dates';
import type { Tx } from '@/lib/db';
import { text, toCsv, zipResponse } from '@/modules/settings/server';

export const maxDuration = 300;

type Rows = Record<string, unknown>[];
/**
 * Cada archivo del respaldo: nombre, qué contiene y su consulta. Las columnas se listan una por una
 * a propósito: nada sale "por accidente". Aquí NUNCA van contraseñas, tokens ni credenciales de lectores
 * (la tabla de lectores ni siquiera se exporta), y la firma de los consentimientos se queda fuera.
 */
const FILES: { file: string; about: string; query: (db: Tx) => Promise<Rows> }[] = [
  { file: 'pacientes.csv', about: 'Ficha de cada paciente',
    query: (db) => db`select p.id, p.record_number, p.full_name, p.sex, p.birth_date, p.curp, p.address, p.phone, p.email, p.emergency_name, p.emergency_phone,
      p.guardian_name, p.guardian_relationship, p.guardian_phone, l.name as location_name, trim(u.title || ' ' || u.full_name) as therapist_name,
      p.tags, p.reason, p.status, p.deactivated_at, p.deactivation_reason, p.fingerprint_enrolled_at, p.created_at, p.updated_at, p.location_id, p.therapist_id
      from patients p join locations l on l.id = p.location_id join users u on u.id = p.therapist_id order by p.record_number` },
  { file: 'perfiles_clinicos.csv', about: 'Perfil clínico, todas las versiones',
    query: (db) => db`select id, patient_id, version, background, condition, examination, diagnosis, treatment_plan, created_by_name, created_at
      from clinical_profiles order by patient_id, version` },
  { file: 'ejercicios.csv', about: 'Plan de ejercicios',
    query: (db) => db`select id, patient_id, name, dosage, position, active, created_at, updated_at from exercises order by patient_id, position` },
  { file: 'notas_evolucion.csv', about: 'Notas de evolución firmadas',
    query: (db) => db`select id, patient_id, appointment_id, addendum_of, noted_at, body, pain_level, range_of_motion, author_name, author_license, signature_hash, created_at
      from evolution_notes order by patient_id, noted_at` },
  { file: 'consentimientos.csv', about: 'Consentimientos firmados (texto y firmante; la imagen de la firma solo sale en la exportación por paciente)',
    query: (db) => db`select id, patient_id, kind, signer_name, signer_relationship, signed_at, recorded_by_name, body_snapshot from consents order by patient_id, signed_at` },
  { file: 'citas.csv', about: 'Agenda',
    query: (db) => db`select a.id, a.patient_id, p.full_name as patient_name, trim(u.title || ' ' || u.full_name) as therapist_name, l.name as location_name,
      a.starts_at, a.duration_min, a.ends_at, a.type_name, a.status, a.notes, a.cancel_reason, a.cancelled_at, a.attended_at, a.series_id, a.created_at
      from appointments a join patients p on p.id = a.patient_id join users u on u.id = a.therapist_id join locations l on l.id = a.location_id order by a.starts_at` },
  { file: 'documentos.csv', about: 'Recetas e indicaciones emitidas',
    query: (db) => db`select id, kind, folio, patient_id, patient_name, patient_age, patient_sex, issuer_name, issuer_title, issuer_specialty, issuer_license,
      issuer_institution, issuer_specialty_license, clinic_name, location_name, location_address, location_phone, diagnosis, general_indications, footer,
      status, cancel_reason, cancelled_at, duplicated_from, issued_at, content_hash from documents order by issued_at` },
  { file: 'documentos_renglones.csv', about: 'Renglones de cada receta o indicación',
    query: (db) => db`select i.id, i.document_id, d.folio, i.position, i.kind, i.name, i.presentation, i.dose, i.route, i.frequency, i.duration, i.instructions
      from document_items i join documents d on d.id = i.document_id order by d.issued_at, i.position` },
  { file: 'planes.csv', about: 'Catálogo de membresías y precios',
    query: (db) => db`select id, name, kind, price_cents, round(price_cents / 100.0, 2) as price_mxn, period_days, sessions_count, position, active, created_at, updated_at
      from membership_plans order by position, name` },
  { file: 'membresias.csv', about: 'Membresía de cada paciente',
    query: (db) => db`select m.id, m.patient_id, p.full_name as patient_name, pl.name as plan_name, m.started_on, m.next_due_date, m.sessions_remaining, m.status,
      m.paused_on, m.ended_on, m.created_at, m.updated_at
      from memberships m join patients p on p.id = m.patient_id join membership_plans pl on pl.id = m.plan_id order by p.full_name, m.created_at` },
  { file: 'pagos.csv', about: 'Pagos registrados (incluye anulados)',
    query: (db) => db`select y.id, y.receipt_number, y.patient_id, p.full_name as patient_name, y.plan_name, y.plan_kind, y.amount_cents,
      round(y.amount_cents / 100.0, 2) as amount_mxn, y.method, y.paid_on, y.reference, y.note, y.prev_due_date, y.new_due_date, y.prev_sessions, y.new_sessions,
      y.recorded_by_name, y.created_at, y.voided_at, y.void_reason
      from payments y join patients p on p.id = y.patient_id order by y.paid_on, y.created_at` },
  { file: 'asistencias.csv', about: 'Lecturas de huella y asistencias manuales',
    query: (db) => db`select e.id, e.occurred_at, e.person_type, e.person_name, e.patient_id, e.user_id, e.employee_no, e.direction, e.source, e.verify_mode,
      l.name as location_name, e.manual_reason, e.appointment_id, e.session_consumed, e.created_at
      from attendance_events e join locations l on l.id = e.location_id order by e.occurred_at` },
  { file: 'usuarios.csv', about: 'Cuentas del personal, sin contraseñas ni llaves de acceso',
    query: (db) => db`select u.id, u.username, u.email, u.role, u.full_name, u.title, u.specialty, l.name as location_name, u.phone, u.license_number,
      u.license_institution, u.specialty_license, u.is_physician, u.active, u.last_login_at, u.fingerprint_enrolled_at, u.created_at, u.deactivated_at
      from users u left join locations l on l.id = u.location_id order by u.full_name` },
  { file: 'sedes.csv', about: 'Sedes',
    query: (db) => db`select id, code, name, street, neighborhood, city, state, zip, phone, hours, active, created_at, updated_at from locations order by name` },
  { file: 'estudios.csv', about: 'Datos de cada estudio (el archivo en sí NO va en este respaldo)',
    query: (db) => db`select s.id, s.patient_id, p.full_name as patient_name, s.type_name, s.title, s.file_name, s.mime, s.size_bytes, s.study_date, s.status,
      s.uploaded_by_name, s.created_at, s.archived_at, s.archive_reason, s.storage_path
      from studies s join patients p on p.id = s.patient_id order by s.study_date` },
  { file: 'bitacora.csv', about: 'Bitácora de auditoría de los últimos 12 meses',
    query: (db) => db`select a.id, a.at, a.actor_name, a.action, a.table_name, a.row_id, a.patient_id, a.summary, a.before, a.after
      from audit_log a where a.at > now() - interval '12 months' order by a.at` },
];

// CFG-10 · Respaldo general en CSV (solo dueño). Corre bajo RLS a nombre del dueño: el rol de la app ni siquiera puede leer las columnas secretas.
export const GET = route({ auth: 'owner' }, async ({ db, user }) => {
  const zip: Zippable = {};
  const lines: string[] = [];
  for (const f of FILES) {
    const rows = await f.query(db);
    const columns = rows.length ? Object.keys(rows[0]) : ((rows as unknown as { columns?: { name: string }[] }).columns ?? []).map((c) => c.name);
    zip[f.file] = toCsv(columns, rows);
    lines.push(`  ${f.file.padEnd(26)} ${String(rows.length).padStart(7)} renglones   ${f.about}`);
  }
  const [clinic] = await db<{ name: string }[]>`select name from clinic`;
  const now = new Date();
  zip['LEEME.txt'] = text([
    `${clinic?.name ?? ''} · Respaldo general de datos`,
    `Generado el ${fmtDateTime(now)} h (hora del centro de México) por ${user.display_name}.`,
    '',
    'Qué contiene (un archivo CSV por tabla, en UTF-8; se abren con Excel, Numbers o Google Sheets):',
    ...lines,
    '',
    'Qué NO contiene:',
    '  · Los archivos de los estudios (radiografías, PDF, DICOM). Viven en el almacenamiento privado de Supabase',
    '    (Storage → bucket de estudios). Para llevarte los de un paciente usa "Exportar expediente de un paciente".',
    '  · Contraseñas, llaves de acceso, sesiones ni credenciales de los lectores de huella. Por seguridad nunca se exportan.',
    '  · Las imágenes de las firmas de consentimiento (van en la exportación por paciente).',
    '',
    'Este respaldo sirve para consultar o llevarte tu información; NO sirve para restaurar el sistema.',
    'El respaldo completo y restaurable de la base de datos se hace desde el proveedor: Supabase → Database → Backups',
    '(copias diarias automáticas según tu plan) o con pg_dump usando la cadena de conexión del proyecto.',
    '',
    'Formato: fechas con hora en UTC (ISO 8601, terminan en Z); fechas sin hora como AAAA-MM-DD; montos en centavos (columna *_cents)',
    'y en pesos (columna *_mxn).',
    '',
    'Contiene datos personales sensibles de salud. Guárdalo cifrado o en un lugar con acceso restringido y bórralo cuando ya no lo necesites.',
    'La descarga quedó registrada en la bitácora.',
    '',
  ].join('\n'));
  await logEvent(db, 'export', `Descargó el respaldo general en CSV (${FILES.length} tablas)`);
  return zipResponse(zipSync(zip, { level: 6 }), `respaldo-${todayIso()}.zip`);
});
