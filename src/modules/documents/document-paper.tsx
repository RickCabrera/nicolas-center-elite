'use client';
import { fmtDateTime } from '@/lib/dates';
import {
  CLINIC_LINE, DOC_TITLE, INDICATION_GROUPS, SEX_LABEL, itemLine, shortHash, signatureLines, withTitle,
  type DocumentDetail, type DocumentItem,
} from './shared';

const mono = { font: "600 12px/1.3 var(--f-mono)", color: '#1272d6', letterSpacing: '.04em' } as const;

function Num({ n }: { n: number }) {
  return <span style={{ flex: 'none', width: 24, font: '700 13px/1.5 var(--f-mono)', color: '#6d7682' }}>{n}.</span>;
}

/** REC-08 · Hoja imprimible (carta) con todos los datos legales del documento tal como se emitió. */
export function DocumentPaper({ doc }: { doc: DocumentDetail }) {
  const [first, ...rest] = doc.clinic_name.split(' ');
  const rx = doc.kind === 'prescription';
  let n = 0;
  return (
    <article className="paper" aria-label={`${DOC_TITLE[doc.kind]} ${doc.folio}`}>
      <div className="p-head">
        { }
        <img src="/logo.png" alt="" />
        <div style={{ minWidth: 0 }}>
          <div className="p-brand"><span>{first}</span> {rest.join(' ')}</div>
          <div className="p-sub">{CLINIC_LINE} · {doc.location_name}</div>
          <div className="p-sub" style={{ marginTop: 2 }}>
            {doc.location_address}{doc.location_phone ? ` · Tel. ${doc.location_phone}` : ''}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div className="p-title" style={{ fontSize: 15 }}>{DOC_TITLE[doc.kind]}</div>
        <div style={{ textAlign: 'right', marginLeft: 'auto' }}>
          <div style={mono}>Folio {doc.folio}</div>
          <div style={{ marginTop: 4, font: '400 12px/1.3 var(--f-body)', color: '#4a4f57' }}>Emitido el {fmtDateTime(doc.issued_at)} h</div>
        </div>
      </div>

      {doc.status === 'cancelled' && (
        <div className="p-void" role="status">
          Cancelado · {doc.cancel_reason} · {fmtDateTime(doc.cancelled_at)}
        </div>
      )}

      <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
        <div style={{ gridColumn: 'span 2', minWidth: 0 }}><div className="p-label">Paciente</div><div className="p-val">{doc.patient_name}</div></div>
        <div><div className="p-label">Edad</div><div className="p-val">{doc.patient_age} {doc.patient_age === 1 ? 'año' : 'años'}</div></div>
        <div><div className="p-label">Sexo</div><div className="p-val">{doc.patient_sex ? SEX_LABEL[doc.patient_sex] ?? doc.patient_sex : '—'}</div></div>
      </div>
      {doc.diagnosis && (
        <div style={{ marginTop: 14 }}>
          <div className="p-label">Diagnóstico</div>
          <div className="p-val" style={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{doc.diagnosis}</div>
        </div>
      )}

      <div className="p-box">
        <div className="p-title">{rx ? 'Prescripción' : 'Indicaciones'}</div>
        {rx ? (
          <div style={{ marginTop: 6 }}>
            {doc.items.map((it, i) => (
              <div key={it.id} className="p-item" style={{ display: 'flex', gap: 6 }}>
                <Num n={i + 1} />
                <div style={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>
                  <div style={{ font: '700 20px/1.2 var(--f-head)' }}>{it.name}</div>
                  {it.presentation && <div style={{ marginTop: 3, font: '400 13px/1.4 var(--f-body)', color: '#4a4f57' }}>{it.presentation}</div>}
                  <div style={{ marginTop: 8, font: '600 15px/1.4 var(--f-body)' }}>{itemLine(it)}</div>
                  {it.instructions && <p style={{ marginTop: 6, font: '400 14px/1.5 var(--f-body)', whiteSpace: 'pre-wrap' }}>{it.instructions}</p>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          INDICATION_GROUPS.map((g) => {
            const rows: DocumentItem[] = doc.items.filter((i) => i.kind === g.kind);
            if (!rows.length) return null;
            return (
              <div key={g.kind} style={{ marginTop: 16 }}>
                <div className="p-label" style={{ color: '#1272d6', fontSize: 10 }}>{g.title}</div>
                {rows.map((it) => {
                  n += 1;
                  const line = [it.dose, it.frequency, it.duration].map((x) => x.trim()).filter(Boolean).join(' · ');
                  return (
                    <div key={it.id} className="p-item" style={{ display: 'flex', gap: 6 }}>
                      <Num n={n} />
                      <div style={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>
                        <div style={{ font: '700 16px/1.25 var(--f-head)' }}>{it.name}</div>
                        {line && <div style={{ marginTop: 5, font: '500 14px/1.4 var(--f-body)' }}>{line}</div>}
                        {it.instructions && <p style={{ marginTop: 5, font: '400 14px/1.5 var(--f-body)', whiteSpace: 'pre-wrap' }}>{it.instructions}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      {doc.general_indications && (
        <div style={{ marginTop: 18, breakInside: 'avoid' }}>
          <div className="p-label">Indicaciones generales</div>
          <p style={{ marginTop: 6, font: '400 15px/1.5 var(--f-body)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{doc.general_indications}</p>
        </div>
      )}

      <div className="p-sign" style={{ marginTop: 64, breakInside: 'avoid' }}>
        <div>
          <b style={{ fontWeight: 600 }}>{withTitle(doc.issuer_title, doc.issuer_name)}</b>
          {signatureLines(doc).map((l) => <small key={l}>{l}</small>)}
        </div>
      </div>

      <div style={{ marginTop: 28, paddingTop: 10, borderTop: '1px solid #dcdcd6', font: '400 11px/1.45 var(--f-body)', color: '#4a4f57', breakInside: 'avoid' }}>
        {doc.footer && <p style={{ whiteSpace: 'pre-wrap' }}>{doc.footer}</p>}
        <p style={{ marginTop: doc.footer ? 6 : 0, font: '500 10px/1.3 var(--f-mono)', letterSpacing: '.06em', color: '#6d7682' }}>
          Huella de contenido: {shortHash(doc.content_hash)}
        </p>
      </div>
    </article>
  );
}
