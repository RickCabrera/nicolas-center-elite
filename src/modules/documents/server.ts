import type { Tx } from '@/lib/db';
import { sha256 } from '@/lib/crypto';
import { fmtDateTime } from '@/lib/dates';
import { PdfBuilder } from '@/lib/pdf';
import type { SessionUser } from '@/lib/auth/session';
import {
  CLINIC_LINE, DOC_TITLE, INDICATION_GROUPS, SEX_LABEL, itemLine, shortHash, signatureLines, withTitle,
  type DocumentDetail, type DocumentItem,
} from './shared';

type DocRow = Omit<DocumentDetail, 'items' | 'can_cancel' | 'issued_at' | 'cancelled_at'> & { issued_at: Date; cancelled_at: Date | null };
export type LoadedDocument = DocRow & { items: DocumentItem[]; can_cancel: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string | undefined | null): s is string => !!s && UUID.test(s);

/** Documento completo con renglones. RLS decide si el usuario lo ve; null = no existe para él. */
export async function loadDocument(db: Tx, id: string, user: Pick<SessionUser, 'id' | 'role'>): Promise<LoadedDocument | null> {
  if (!isUuid(id)) return null;
  const [doc] = await db<DocRow[]>`select * from documents where id = ${id}`;
  if (!doc) return null;
  const items = await db<DocumentItem[]>`
    select id, position, kind, name, presentation, dose, route, frequency, duration, instructions
    from document_items where document_id = ${id} order by position, id`;
  return { ...doc, items, can_cancel: doc.status === 'issued' && (user.role === 'owner' || doc.issuer_id === user.id) };
}

/**
 * REC-05 · Huella del contenido: sha256 del contenido canónico (folio + emisor + paciente + renglones).
 * Se guarda al sellar el documento; después la base ya no admite cambios.
 */
export function contentHash(doc: DocRow, items: Omit<DocumentItem, 'id'>[]): string {
  const canonical = {
    folio: doc.folio,
    kind: doc.kind,
    issued_at: new Date(doc.issued_at).toISOString(),
    issuer: { id: doc.issuer_id, name: doc.issuer_name, title: doc.issuer_title, license: doc.issuer_license ?? '' },
    patient: { id: doc.patient_id, name: doc.patient_name, age: doc.patient_age, sex: doc.patient_sex ?? '' },
    diagnosis: doc.diagnosis,
    general_indications: doc.general_indications,
    items: items.map((i) => [i.position, i.kind, i.name, i.presentation, i.dose, i.route, i.frequency, i.duration, i.instructions]),
  };
  return sha256(JSON.stringify(canonical));
}

/** REC-08 · PDF con el mismo contenido que la vista imprimible. */
export async function buildDocumentPdf(doc: LoadedDocument): Promise<Uint8Array> {
  const pdf = await PdfBuilder.create({ clinicName: doc.clinic_name, subtitle: `${CLINIC_LINE} · ${doc.location_name}` });
  pdf.paragraph([doc.location_address, doc.location_phone ? `Tel. ${doc.location_phone}` : ''].filter(Boolean).join(' · '), { size: 8.5, color: 'grey' });
  pdf.space(8);
  pdf.title(DOC_TITLE[doc.kind], `Folio ${doc.folio}`);
  if (doc.status === 'cancelled') {
    pdf.paragraph(`CANCELADO · ${doc.cancel_reason ?? ''} · ${fmtDateTime(doc.cancelled_at)}`, { bold: true, color: 'red' });
    pdf.space(4);
  }
  pdf.kv([
    { label: 'Paciente', value: doc.patient_name },
    { label: 'Edad', value: `${doc.patient_age} ${doc.patient_age === 1 ? 'año' : 'años'}` },
    { label: 'Sexo', value: doc.patient_sex ? SEX_LABEL[doc.patient_sex] ?? doc.patient_sex : '—' },
    { label: 'Fecha y hora de emisión', value: fmtDateTime(doc.issued_at) },
  ], 4);
  if (doc.diagnosis) pdf.kv([{ label: 'Diagnóstico', value: doc.diagnosis }], 1);
  pdf.rule();

  if (doc.kind === 'prescription') {
    doc.items.forEach((it, n) => {
      pdf.space(4);
      pdf.paragraph(`${n + 1}. ${it.name}`, { size: 13, bold: true });
      if (it.presentation) pdf.paragraph(it.presentation, { indent: 16, color: 'grey', size: 9.5 });
      const line = itemLine(it);
      if (line) pdf.paragraph(line, { indent: 16 });
      if (it.instructions) pdf.paragraph(it.instructions, { indent: 16, size: 10 });
    });
  } else {
    let n = 0;
    for (const g of INDICATION_GROUPS) {
      const rows = doc.items.filter((i) => i.kind === g.kind);
      if (!rows.length) continue;
      pdf.space(6);
      pdf.heading(g.title);
      for (const it of rows) {
        n += 1;
        pdf.paragraph(`${n}. ${it.name}`, { size: 11.5, bold: true });
        const line = [it.dose, it.frequency, it.duration].map((x) => x.trim()).filter(Boolean).join(' · ');
        if (line) pdf.paragraph(line, { indent: 16 });
        if (it.instructions) pdf.paragraph(it.instructions, { indent: 16, size: 10 });
        pdf.space(3);
      }
    }
  }
  if (doc.general_indications) {
    pdf.space(8);
    pdf.heading('Indicaciones generales');
    pdf.paragraph(doc.general_indications);
  }
  pdf.space(14);
  pdf.signature(withTitle(doc.issuer_title, doc.issuer_name), signatureLines(doc));
  pdf.space(10);
  pdf.paragraph(`Huella de contenido: ${shortHash(doc.content_hash)}`, { size: 7.5, color: 'grey' });
  if (doc.status === 'cancelled') pdf.stamp('Cancelado');
  return pdf.finish(doc.footer || undefined);
}
