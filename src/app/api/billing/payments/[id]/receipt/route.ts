import { z } from 'zod';
import { route } from '@/lib/api';
import { logEvent } from '@/lib/audit';
import { fmtDate, fmtDateTime } from '@/lib/dates';
import { notFound } from '@/lib/errors';
import { money, PAYMENT_METHOD_LABEL, PLAN_KIND_LABEL } from '@/lib/format';
import { PdfBuilder, pdfResponse } from '@/lib/pdf';
import { coveredPeriod } from '@/modules/billing/rules';

// PAG-08 · Recibo de pago en PDF (no es comprobante fiscal).
export const GET = route({ auth: 'front' }, async ({ db, params }) => {
  if (!z.uuid().safeParse(params.id).success) throw notFound('Pago no encontrado.');
  const [p] = await db`
    select y.*, pt.full_name as patient_name, pt.record_number, l.name as location_name,
           (select trim(u.title || ' ' || u.full_name) from users u where u.id = y.voided_by) as voided_by_name
    from payments y join patients pt on pt.id = y.patient_id join locations l on l.id = pt.location_id
    where y.id = ${params.id}`;
  if (!p) throw notFound('Pago no encontrado.');
  const [clinic] = await db`select name, tagline, phone from clinic`;

  const period = coveredPeriod(p as never);
  const periodText = p.plan_kind === 'package'
    ? `${period.sessions} sesiones · vigentes hasta el ${fmtDate(period.to)}`
    : p.plan_kind === 'single' ? `Sesión del ${fmtDate(period.from)}`
    : `Del ${fmtDate(period.from)} al ${fmtDate(period.to)}`;

  const pdf = await PdfBuilder.create({ clinicName: clinic.name, subtitle: [clinic.tagline, clinic.phone && `Tel. ${clinic.phone}`].filter(Boolean).join(' · ') });
  pdf.title('Recibo de pago', `No. ${p.receipt_number}`);
  pdf.kv([
    { label: 'Fecha de pago', value: fmtDate(p.paid_on) },
    { label: 'Paciente', value: p.patient_name },
    { label: 'Expediente', value: p.record_number },
    { label: 'Sede', value: p.location_name },
  ]);
  pdf.rule();
  pdf.kv([
    { label: 'Concepto', value: `${p.plan_name} (${PLAN_KIND_LABEL[p.plan_kind] ?? p.plan_kind})` },
    { label: 'Periodo cubierto', value: periodText },
  ], 2);
  pdf.kv([
    { label: 'Método de pago', value: PAYMENT_METHOD_LABEL[p.method] ?? p.method },
    { label: 'Referencia', value: p.reference || '—' },
  ], 2);
  if (p.note) pdf.kv([{ label: 'Nota', value: p.note }], 1);
  pdf.rule().space(6);
  pdf.heading('Monto pagado');
  pdf.paragraph(`${money(p.amount_cents)} MXN`, { size: 26, bold: true });
  pdf.space(10);
  pdf.kv([
    { label: 'Registró', value: p.recorded_by_name || '—' },
    { label: 'Fecha de registro', value: fmtDateTime(p.created_at) },
  ], 2);
  if (p.voided_at) {
    pdf.space(6);
    pdf.paragraph(`RECIBO ANULADO el ${fmtDateTime(p.voided_at)}${p.voided_by_name ? ` por ${p.voided_by_name}` : ''}. Motivo: ${p.void_reason ?? ''}`, { bold: true, color: 'red' });
    pdf.stamp('ANULADO');
  }
  pdf.space(14);
  pdf.paragraph('Este recibo no es un comprobante fiscal (CFDI).', { size: 9, color: 'grey' });

  await logEvent(db, 'print', `Recibo de pago ${p.receipt_number}`, { patientId: p.patient_id, table: 'payments', rowId: p.id });
  return pdfResponse(await pdf.finish(`${clinic.name} · Recibo ${p.receipt_number} · Este recibo no es un comprobante fiscal (CFDI).`), `Recibo ${p.receipt_number}.pdf`);
});
