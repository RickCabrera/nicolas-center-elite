import { route } from '@/lib/api';
import { logEvent } from '@/lib/audit';
import { fmtDateTime } from '@/lib/dates';
import { notFound } from '@/lib/errors';
import { PdfBuilder, pdfResponse } from '@/lib/pdf';
import { CONSENT_TITLE, isUuid, requirePatient, type ConsentKind } from '@/modules/record/server';

// EXP-10 · PDF del consentimiento firmado: texto que se firmó, imagen de la firma, firmante y quién lo registró.
export const GET = route({ auth: 'user' }, async ({ db, user, params }) => {
  const patient = await requirePatient(db, params.id);
  if (!isUuid(params.consentId)) throw notFound('Documento no encontrado.');
  const [c] = await db<{
    id: string; kind: ConsentKind; body_snapshot: string; signer_name: string; signer_relationship: string;
    signature_png: string; signed_at: Date; recorded_by_name: string;
  }[]>`
    select id, kind, body_snapshot, signer_name, signer_relationship, signature_png, signed_at, recorded_by_name
    from consents where id = ${params.consentId} and patient_id = ${patient.id}`;
  if (!c) throw notFound('Documento no encontrado.');
  const [clinic] = await db<{ name: string; tagline: string | null }[]>`select name, tagline from clinic`;

  const pdf = await PdfBuilder.create({
    clinicName: clinic?.name ?? 'Nicolas Center Elite',
    subtitle: [`Sede ${patient.location_name}`, patient.location_address, patient.location_phone].filter(Boolean).join(' · '),
  });
  pdf.title(CONSENT_TITLE[c.kind], `Expediente ${patient.record_number}`);
  pdf.kv([
    { label: 'Paciente', value: patient.full_name },
    { label: 'Edad', value: `${patient.age} años` },
    { label: 'Fecha y hora de firma', value: fmtDateTime(c.signed_at) },
  ], 3);
  pdf.rule().space(4);
  for (const para of c.body_snapshot.split(/\n{2,}/)) pdf.paragraph(para.trim()).space(6);
  pdf.space(8).heading('Firma');
  await pdf.signatureImage(c.signature_png, 200);
  pdf.rule();
  pdf.kv([
    { label: 'Nombre de quien firma', value: c.signer_name },
    { label: 'Parentesco', value: c.signer_relationship },
    { label: 'Fecha y hora', value: fmtDateTime(c.signed_at) },
    { label: 'Registró', value: c.recorded_by_name || 'Sistema' },
  ], 2);

  await logEvent(db, 'print', `Generó PDF: ${CONSENT_TITLE[c.kind]}`, { patientId: patient.id, table: 'consents', rowId: c.id });
  const footer = `Firma trazada en pantalla y conservada en el expediente clínico ${patient.record_number}. Documento generado el ${fmtDateTime(new Date())} por ${user.display_name}.`;
  return pdfResponse(await pdf.finish(footer), `${CONSENT_TITLE[c.kind]} - ${patient.full_name}.pdf`);
});
