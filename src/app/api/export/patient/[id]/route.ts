import { strToU8, zipSync, type Zippable } from 'fflate';
import { z } from 'zod';
import { route } from '@/lib/api';
import { logEvent } from '@/lib/audit';
import { fmtDate, fmtDateTime, todayIso } from '@/lib/dates';
import { notFound } from '@/lib/errors';
import { APPT_STATUS_LABEL, fileSize, money, PAYMENT_METHOD_LABEL } from '@/lib/format';
import { storage } from '@/lib/storage';
import { safeName, text, zipResponse } from '@/modules/settings/server';

export const maxDuration = 300;
const MAX_FILES_BYTES = 150 * 1024 * 1024;
const CONSENT_LABEL: Record<string, string> = { privacy: 'Aviso de privacidad', informed: 'Consentimiento informado', biometric: 'Consentimiento de huella' };

type Row = Record<string, any>;  

/**
 * CFG-10 · Expediente completo de un paciente en un ZIP (solo dueño): portabilidad y derecho de acceso.
 *   expediente.json · resumen.txt · LEEME.txt · consentimientos/*.png · estudios/* (hasta 150 MB) · faltantes.txt
 */
export const GET = route({ auth: 'owner' }, async ({ db, params, user }) => {
  if (!z.uuid().safeParse(params.id).success) throw notFound('Paciente no encontrado.');
  const [patient] = await db<Row[]>`
    select p.*, l.name as location_name, trim(u.title || ' ' || u.full_name) as therapist_name
    from patients p join locations l on l.id = p.location_id join users u on u.id = p.therapist_id
    where p.id = ${params.id}`;
  if (!patient) throw notFound('Paciente no encontrado.');
  delete patient.search;
  const pid = patient.id as string;

  const [clinic] = await db<{ name: string }[]>`select name from clinic`;
  const assignments = await db<Row[]>`
    select a.therapist_id, trim(u.title || ' ' || u.full_name) as therapist_name, a.from_at, a.to_at
    from patient_assignments a join users u on u.id = a.therapist_id where a.patient_id = ${pid} order by a.from_at`;
  const profiles = await db<Row[]>`select * from clinical_profiles where patient_id = ${pid} order by version`;
  const exercises = await db<Row[]>`select * from exercises where patient_id = ${pid} order by active desc, position, created_at`;
  const notes = await db<Row[]>`select * from evolution_notes where patient_id = ${pid} order by noted_at`;
  const consentRows = await db<Row[]>`select * from consents where patient_id = ${pid} order by signed_at`;
  const appointments = await db<Row[]>`
    select a.*, trim(u.title || ' ' || u.full_name) as therapist_name, l.name as location_name
    from appointments a join users u on u.id = a.therapist_id join locations l on l.id = a.location_id
    where a.patient_id = ${pid} order by a.starts_at`;
  const documents = await db<Row[]>`select * from documents where patient_id = ${pid} order by issued_at`;
  const items = documents.length
    ? await db<Row[]>`select * from document_items where document_id = any(${documents.map((d) => d.id)}::uuid[]) order by document_id, position`
    : [];
  const memberships = await db<Row[]>`
    select m.*, pl.name as plan_name, pl.kind as plan_kind
    from memberships m join membership_plans pl on pl.id = m.plan_id where m.patient_id = ${pid} order by m.created_at`;
  const payments = await db<Row[]>`select * from payments where patient_id = ${pid} order by paid_on, created_at`;
  const attendance = await db<Row[]>`
    select e.id, e.occurred_at, e.direction, e.source, e.verify_mode, e.manual_reason, e.appointment_id, e.session_consumed,
           l.name as location_name
    from attendance_events e join locations l on l.id = e.location_id where e.patient_id = ${pid} order by e.occurred_at`;
  const studies = await db<Row[]>`select * from studies where patient_id = ${pid} order by study_date, created_at`;

  const zip: Zippable = {};
  const missing: string[] = [];
  const skipped: string[] = [];

  // Consentimientos: la firma sale como imagen aparte; el JSON solo dice en qué archivo quedó.
  const consents: Row[] = consentRows.map((c) => {
    const { signature_png, ...rest } = c;
    let signature_file: string | null = null;
    const m = /^data:image\/png;base64,(.+)$/s.exec(String(signature_png ?? ''));
    if (m) {
      signature_file = `consentimientos/${c.kind}-${fmtDate(c.signed_at).split('/').reverse().join('-')}-${String(c.id).slice(0, 8)}.png`;
      zip[signature_file] = [new Uint8Array(Buffer.from(m[1], 'base64')), { level: 0 }];
    }
    return { ...rest, signature_file };
  });

  // Estudios: los archivos reales, hasta el tope; el resto queda solo como metadatos.
  let used = 0;
  const studiesOut: Row[] = [];
  for (const s of studies) {
    const size = Number(s.size_bytes);
    const name = `estudios/${s.study_date}_${String(s.id).slice(0, 8)}_${safeName(String(s.file_name))}`;
    let export_file: string | null = null;
    if (used + size > MAX_FILES_BYTES) {
      skipped.push(`${s.title} · ${s.file_name} · ${fileSize(size)}`);
    } else {
      try {
        const data = await storage.read(String(s.storage_path));
        if (used + data.length > MAX_FILES_BYTES) skipped.push(`${s.title} · ${s.file_name} · ${fileSize(data.length)}`);
        else {
          zip[name] = [new Uint8Array(data), { level: 0 }]; // imágenes, PDF y DICOM ya vienen comprimidos
          used += data.length;
          export_file = name;
        }
      } catch {
        missing.push(`${s.title} · ${s.file_name} · subido el ${fmtDate(s.created_at)}${s.status === 'pending' ? ' · la subida nunca terminó' : ''}`);
      }
    }
    studiesOut.push({ ...s, size_bytes: size, export_file });
  }

  const exportedAt = new Date();
  const expediente = {
    exported_at: exportedAt,
    exported_by: user.display_name,
    clinic: clinic?.name ?? '',
    patient,
    assignments,
    clinical_profiles: profiles,
    exercises,
    evolution_notes: notes,
    consents,
    appointments,
    documents: documents.map((d) => ({ ...d, items: items.filter((i) => i.document_id === d.id) })),
    memberships,
    payments,
    attendance,
    studies: studiesOut,
  };
  zip['expediente.json'] = strToU8(JSON.stringify(expediente, null, 2));

  // ── resumen legible ──
  const L: string[] = [];
  const h = (t: string) => L.push('', t.toUpperCase(), '-'.repeat(t.length));
  L.push(`${clinic?.name ?? ''} · Expediente clínico`, `Exportado el ${fmtDateTime(exportedAt)} h por ${user.display_name}`);
  h('Paciente');
  L.push(`Nombre: ${patient.full_name}`, `Expediente: ${patient.record_number}`, `Fecha de nacimiento: ${fmtDate(patient.birth_date)}`,
    `Sexo: ${patient.sex ?? '—'}`, `CURP: ${patient.curp ?? '—'}`, `Teléfono: ${patient.phone || '—'}`, `Correo: ${patient.email || '—'}`,
    `Domicilio: ${patient.address || '—'}`, `Contacto de emergencia: ${[patient.emergency_name, patient.emergency_phone].filter(Boolean).join(' · ') || '—'}`);
  if (patient.guardian_name) L.push(`Tutor: ${patient.guardian_name} (${patient.guardian_relationship || 'tutor'}) ${patient.guardian_phone}`.trim());
  L.push(`Sede: ${patient.location_name}`, `Fisioterapeuta: ${patient.therapist_name}`, `Motivo de consulta: ${patient.reason || '—'}`,
    `Etiquetas: ${(patient.tags as string[]).join(', ') || '—'}`, `Estado: ${patient.status === 'active' ? 'Activo' : 'Inactivo'}`,
    `Alta: ${fmtDate(patient.created_at)}`);
  const last = profiles[profiles.length - 1];
  h(`Perfil clínico (${profiles.length} ${profiles.length === 1 ? 'versión' : 'versiones'})`);
  if (last) {
    L.push(`Versión vigente: ${last.version} · ${fmtDateTime(last.created_at)} h · ${last.created_by_name}`, `Antecedentes: ${last.background || '—'}`,
      `Padecimiento actual: ${last.condition || '—'}`, `Exploración física: ${last.examination || '—'}`, `Diagnóstico: ${last.diagnosis || '—'}`,
      `Plan de tratamiento: ${last.treatment_plan || '—'}`);
  } else L.push('Sin perfil clínico capturado.');
  h(`Ejercicios (${exercises.length})`);
  exercises.forEach((e) => L.push(`· ${e.name}${e.dosage ? ` — ${e.dosage}` : ''}${e.active ? '' : ' (retirado)'}`));
  h(`Notas de evolución (${notes.length})`);
  notes.forEach((n) => L.push(`[${fmtDateTime(n.noted_at)} h] ${n.author_name}${n.author_license ? ` · céd. ${n.author_license}` : ''}${n.addendum_of ? ' · ADENDA' : ''}`,
    `${n.body}`, `${n.pain_level !== null ? `Dolor: ${n.pain_level}/10. ` : ''}${n.range_of_motion ? `Movilidad: ${n.range_of_motion}. ` : ''}Firma: ${n.signature_hash}`, ''));
  h(`Consentimientos (${consents.length})`);
  consents.forEach((c) => L.push(`· ${CONSENT_LABEL[c.kind] ?? c.kind} · ${fmtDateTime(c.signed_at)} h · firmó ${c.signer_name} (${c.signer_relationship})${c.signature_file ? ` · ${c.signature_file}` : ''}`));
  h(`Citas (${appointments.length})`);
  appointments.forEach((a) => L.push(`· ${fmtDateTime(a.starts_at)} h · ${a.duration_min} min · ${a.type_name} · ${a.therapist_name} · ${a.location_name} · ${APPT_STATUS_LABEL[a.status] ?? a.status}`));
  h(`Recetas e indicaciones (${documents.length})`);
  documents.forEach((d) => {
    L.push(`· ${d.folio} · ${d.kind === 'prescription' ? 'Receta médica' : 'Indicaciones'} · ${fmtDateTime(d.issued_at)} h · ${d.issuer_name}${d.status === 'cancelled' ? ' · CANCELADA' : ''}`);
    items.filter((i) => i.document_id === d.id).forEach((i) => L.push(`    - ${[i.name, i.presentation, i.dose, i.route, i.frequency, i.duration, i.instructions].filter(Boolean).join(' · ')}`));
  });
  h(`Membresías (${memberships.length}) y pagos (${payments.length})`);
  memberships.forEach((m) => L.push(`· ${m.plan_name} · desde ${fmtDate(m.started_on)} · vence ${fmtDate(m.next_due_date)} · ${m.status}${m.sessions_remaining !== null ? ` · ${m.sessions_remaining} sesiones restantes` : ''}`));
  payments.forEach((p) => L.push(`· ${p.receipt_number} · ${fmtDate(p.paid_on)} · ${money(p.amount_cents)} · ${PAYMENT_METHOD_LABEL[p.method] ?? p.method} · ${p.plan_name}${p.voided_at ? ` · ANULADO (${p.void_reason ?? ''})` : ''}`));
  h(`Asistencias (${attendance.length})`);
  attendance.forEach((e) => L.push(`· ${fmtDateTime(e.occurred_at)} h · ${e.direction === 'in' ? 'entrada' : 'salida'} · ${e.location_name} · ${e.source === 'manual' ? 'captura manual' : 'lector'}`));
  h(`Estudios (${studies.length})`);
  studiesOut.forEach((s) => L.push(`· ${fmtDate(s.study_date)} · ${s.type_name} · ${s.title} · ${s.file_name} (${fileSize(s.size_bytes)})${s.archived_at ? ' · archivado' : ''} · ${s.export_file ?? 'archivo no incluido'}`));
  zip['resumen.txt'] = text(L.join('\n') + '\n');

  if (missing.length) {
    zip['faltantes.txt'] = text(`Estos archivos de estudio están registrados en el expediente pero no se pudieron leer del almacenamiento.\nSus datos (fecha, tipo, título) sí están en expediente.json.\n\n${missing.map((m) => `· ${m}`).join('\n')}\n`);
  }
  zip['LEEME.txt'] = text([
    `Expediente de ${patient.full_name} (${patient.record_number})`,
    `Exportado el ${fmtDateTime(exportedAt)} h (hora del centro de México) por ${user.display_name}.`,
    '',
    'Contenido:',
    '  expediente.json    Todos los datos del paciente en formato estructurado: ficha, perfiles clínicos con todas sus versiones,',
    '                     ejercicios, notas de evolución, consentimientos, citas, recetas e indicaciones con sus renglones,',
    '                     membresías, pagos, asistencias y los datos de cada estudio.',
    '  resumen.txt        Lo mismo en texto legible.',
    '  consentimientos/   Imagen de la firma de cada consentimiento.',
    `  estudios/          Archivos originales de los estudios (${Object.keys(zip).filter((k) => k.startsWith('estudios/')).length} de ${studies.length}).`,
    ...(missing.length ? ['  faltantes.txt      Estudios cuyo archivo no se pudo leer.'] : []),
    ...(skipped.length ? ['', `Límite de tamaño: una exportación incluye hasta ${fileSize(MAX_FILES_BYTES)} de archivos. Estos estudios NO caben y solo van sus datos en expediente.json;`,
      'descárgalos uno por uno desde la pestaña Estudios del paciente:', ...skipped.map((s) => `  · ${s}`)] : []),
    '',
    'Este archivo contiene datos personales sensibles de salud. Entrégalo solo a su titular o a quien esté legalmente autorizado,',
    'y bórralo de este equipo cuando ya no lo necesites. La exportación quedó registrada en la bitácora de la clínica.',
    '',
  ].join('\n'));

  await logEvent(db, 'export', `Exportó el expediente completo de ${patient.full_name} (${patient.record_number})`, { patientId: pid, table: 'patients', rowId: pid });
  return zipResponse(zipSync(zip, { level: 6 }), `expediente-${patient.record_number}-${todayIso()}.zip`);
});
