'use client';
import Link from 'next/link';
import { Avatar, Badge } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { initials } from '@/lib/format';
import { DOC_SHORT, withTitle, type DocumentListItem } from './shared';

/** Fila de un documento emitido (REC-09, REC-10). En el expediente no se repite el nombre del paciente. */
export function DocumentRow({ doc, inPatient }: { doc: DocumentListItem; inPatient?: boolean }) {
  const cancelled = doc.status === 'cancelled';
  const issuer = withTitle(doc.issuer_title, doc.issuer_name);
  return (
    <Link href={`/recetas/${doc.id}`} className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 8 }}>
      {!inPatient && <Avatar text={initials(doc.patient_name)} />}
      <div className="grow" style={{ flexBasis: 180 }}>
        <div className="t-name ellipsis" style={cancelled ? { textDecoration: 'line-through', opacity: 0.7 } : undefined}>{doc.summary || DOC_SHORT[doc.kind]}</div>
        <div className="t-sub ellipsis" style={{ marginTop: 3 }}>
          {inPatient ? `${DOC_SHORT[doc.kind]} · ${issuer}` : `${doc.patient_name} · ${issuer}`}
        </div>
        {!inPatient && <div className="t-label" style={{ marginTop: 6 }}>{DOC_SHORT[doc.kind]}</div>}
      </div>
      <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 7, marginLeft: 'auto' }}>
        <span className="t-mono blue">{doc.folio}</span>
        <span className="t-mono blue" style={{ opacity: 0.85 }}>{fmtDate(doc.issued_at)}</span>
        {cancelled && <Badge tone="red">Cancelada</Badge>}
      </div>
    </Link>
  );
}
