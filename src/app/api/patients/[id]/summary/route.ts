import { route } from '@/lib/api';
import { logEvent } from '@/lib/audit';
import { fmtDate, fmtDateTime } from '@/lib/dates';
import { PdfBuilder, pdfResponse } from '@/lib/pdf';
import { requirePatient } from '@/modules/record/server';

const SEX: Record<string, string> = { F: 'Femenino', M: 'Masculino', X: 'No especificado' };
const DOC_KIND: Record<string, string> = { prescription: 'Receta médica', indications: 'Indicaciones fisioterapéuticas' };

type Note = {
  id: string; addendum_of: string | null; body: string; pain_level: number | null; range_of_motion: string;
  noted_at: Date; author_name: string; author_license: string | null;
};

// EXP-07 · Resumen clínico en PDF con membrete de la clínica y la sede. Deja un evento `export` en la bitácora.
export const GET = route({ auth: 'user' }, async ({ db, user, params }) => {
  const patient = await requirePatient(db, params.id);
  const [clinic] = await db<{ name: string; tagline: string | null }[]>`select name, tagline from clinic`;
  const [profile] = await db<{
    version: number; background: string; condition: string; examination: string; diagnosis: string; treatment_plan: string;
    created_at: Date; created_by_name: string;
  }[]>`select version, background, condition, examination, diagnosis, treatment_plan, created_at, created_by_name
       from clinical_profiles where patient_id = ${patient.id} order by version desc limit 1`;
  const exercises = await db<{ name: string; dosage: string }[]>`
    select name, dosage from exercises where patient_id = ${patient.id} and active order by position, created_at`;
  const notes = await db<Note[]>`
    select id, addendum_of, body, pain_level, range_of_motion, noted_at, author_name, author_license
    from evolution_notes where patient_id = ${patient.id} order by noted_at, created_at`;
  const studies = await db<{ type_name: string; title: string; study_date: string }[]>`
    select type_name, title, study_date from studies
    where patient_id = ${patient.id} and archived_at is null and status = 'ready' order by study_date desc, created_at desc`;
  const documents = await db<{ folio: string; kind: string; issued_at: Date; status: string; issuer_name: string; issuer_title: string }[]>`
    select folio, kind, issued_at, status, issuer_name, issuer_title from documents
    where patient_id = ${patient.id} order by issued_at desc`;

  const pdf = await PdfBuilder.create({
    clinicName: clinic?.name ?? 'Nicolas Center Elite',
    subtitle: [clinic?.tagline, `Sede ${patient.location_name}`, patient.location_address, patient.location_phone].filter(Boolean).join(' · '),
  });
  const or = (s: string | null | undefined, fallback = 'Sin registro.') => (s && s.trim() ? s : fallback);

  pdf.title('Resumen clínico', `Expediente ${patient.record_number}`);
  pdf.heading('Datos generales');
  pdf.kv([
    { label: 'Expediente', value: patient.record_number },
    { label: 'Nombre', value: patient.full_name },
    { label: 'Edad', value: `${patient.age} años` },
    { label: 'Sexo', value: patient.sex ? SEX[patient.sex] ?? patient.sex : 'Sin registro' },
    { label: 'Fecha de nacimiento', value: fmtDate(patient.birth_date) },
    { label: 'Teléfono', value: or(patient.phone, 'Sin registro') },
    { label: 'Fisioterapeuta', value: or(patient.therapist_display, 'Sin asignar') },
    { label: 'Sede', value: patient.location_name },
  ], 4);
  if (patient.guardian_name.trim()) {
    pdf.kv([
      { label: 'Padre, madre o tutor', value: patient.guardian_name },
      { label: 'Parentesco', value: or(patient.guardian_relationship, 'Sin registro') },
      { label: 'Teléfono del tutor', value: or(patient.guardian_phone, 'Sin registro') },
    ], 3);
  }
  if (patient.status !== 'active') pdf.paragraph('Paciente dado de baja.', { color: 'red', bold: true });

  pdf.space(4).heading('Motivo de consulta').paragraph(or(patient.reason));

  pdf.space(6).heading('Valoración');
  if (!profile) {
    pdf.paragraph('Aún no se ha capturado el perfil clínico.', { color: 'grey' });
  } else {
    pdf.paragraph('Antecedentes', { bold: true, size: 9.5 }).paragraph(or(profile.background)).space(4);
    pdf.paragraph('Padecimiento actual', { bold: true, size: 9.5 }).paragraph(or(profile.condition)).space(4);
    pdf.paragraph('Exploración física', { bold: true, size: 9.5 }).paragraph(or(profile.examination));
    pdf.space(6).heading('Diagnóstico').paragraph(or(profile.diagnosis));
    pdf.space(6).heading('Plan de tratamiento').paragraph(or(profile.treatment_plan));
    pdf.paragraph(`Perfil clínico versión ${profile.version}, guardado el ${fmtDateTime(profile.created_at)} por ${or(profile.created_by_name, 'Sistema')}.`,
      { size: 8.5, color: 'grey' });
  }

  pdf.space(6).heading('Ejercicios activos');
  if (!exercises.length) pdf.paragraph('Sin ejercicios activos.', { color: 'grey' });
  else pdf.table(['Ejercicio', 'Dosis'], exercises.map((e) => [e.name, e.dosage || '—']), [0.6, 0.4]);

  pdf.space(6).heading('Evolución');
  const roots = notes.filter((n) => !n.addendum_of);
  if (!roots.length) pdf.paragraph('Sin notas de evolución.', { color: 'grey' });
  const line = (n: Note) =>
    [fmtDateTime(n.noted_at), n.author_name + (n.author_license ? ` (céd. ${n.author_license})` : ''),
      n.pain_level !== null ? `Dolor ${n.pain_level}/10` : '', n.range_of_motion ? `Rango de movimiento: ${n.range_of_motion}` : '']
      .filter(Boolean).join(' · ');
  for (const n of roots) {
    pdf.paragraph(line(n), { bold: true, size: 9.5 }).paragraph(n.body);
    for (const a of notes.filter((x) => x.addendum_of === n.id)) {
      pdf.paragraph(`Adenda · ${line(a)}`, { bold: true, size: 9, indent: 16 }).paragraph(a.body, { indent: 16 });
    }
    pdf.space(6);
  }

  pdf.space(2).heading('Estudios');
  if (!studies.length) pdf.paragraph('Sin estudios registrados.', { color: 'grey' });
  else pdf.table(['Tipo', 'Título', 'Fecha'], studies.map((s) => [s.type_name, s.title, fmtDate(s.study_date)]), [0.25, 0.55, 0.2]);

  pdf.space(6).heading('Documentos emitidos');
  if (!documents.length) pdf.paragraph('Sin recetas ni indicaciones emitidas.', { color: 'grey' });
  else {
    pdf.table(['Folio', 'Tipo', 'Fecha', 'Emitió'],
      documents.map((d) => [d.folio, (DOC_KIND[d.kind] ?? d.kind) + (d.status === 'cancelled' ? ' (cancelada)' : ''), fmtDate(d.issued_at),
        `${d.issuer_title} ${d.issuer_name}`.trim()]),
      [0.22, 0.34, 0.16, 0.28]);
  }

  await logEvent(db, 'export', 'Generó resumen clínico', { patientId: patient.id });
  const footer = `Resumen clínico generado el ${fmtDateTime(new Date())} por ${user.display_name}. Documento confidencial: contiene datos personales sensibles.`;
  return pdfResponse(await pdf.finish(footer), `Resumen clínico - ${patient.full_name}.pdf`);
});
