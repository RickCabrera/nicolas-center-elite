'use client';
import { forwardRef, type ReactNode } from 'react';
import { Button, Card, Empty, ErrorNote, Skeleton } from '@/components/ui';
import { fmtDate, fmtDateTime } from '@/lib/dates';
import { EnrollFingerprint } from '@/modules/attendance/enroll-fingerprint';
import { CONSENT_KINDS, CONSENT_TITLE, type ConsentKind } from './consent-text';
import type { Consent } from './types';

const STEP_TITLE: Record<ConsentKind, string> = {
  privacy: 'Aviso de privacidad firmado',
  informed: 'Consentimiento informado firmado',
  biometric: 'Consentimiento de huella firmado',
};
export const consentPdfUrl = (c: Consent) => `/api/patients/${c.patient_id}/consents/${c.id}/pdf`;

/** El consentimiento vigente de cada tipo es el más reciente (la lista llega de más nuevo a más viejo). */
export function latestByKind(list: Consent[] | undefined): Partial<Record<ConsentKind, Consent>> {
  const out: Partial<Record<ConsentKind, Consent>> = {};
  for (const c of list ?? []) if (!out[c.kind]) out[c.kind] = c;
  return out;
}

function Step({ n, done, title, detail, children }: { n: number; done: boolean; title: string; detail: ReactNode; children?: ReactNode }) {
  return (
    <li className="row" style={{ flexWrap: 'wrap', rowGap: 10 }}>
      <span className={`dot ${done ? 'green' : 'gold'}`} aria-hidden="true" />
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div className="t-strong">{n}. {title} <span className="sr-only">{done ? '(completo)' : '(pendiente)'}</span></div>
        <div className="t-small" style={{ marginTop: 3, overflowWrap: 'anywhere' }}>{detail}</div>
      </div>
      {children && <div className="hstack wrap" style={{ marginLeft: 'auto' }}>{children}</div>}
    </li>
  );
}

/**
 * PAC-07 / PAC-08 · "Completa el alta": aviso de privacidad, consentimientos y huella.
 * La huella no se puede registrar sin el consentimiento biométrico firmado (la API también lo exige).
 */
export const OnboardingChecklist = forwardRef<HTMLElement, {
  patientId: string; consents: Consent[] | undefined; loading: boolean; error: { message: string } | undefined; retry: () => void;
  fingerprintAt: string | null; onSign: (kind: ConsentKind) => void; onEnrolled: () => void;
}>(function OnboardingChecklist({ patientId, consents, loading, error, retry, fingerprintAt, onSign, onEnrolled }, ref) {
  const signed = latestByKind(consents);
  const done = CONSENT_KINDS.filter((k) => signed[k]).length + (fingerprintAt ? 1 : 0);
  return (
    <section ref={ref} tabIndex={-1} className="card" aria-label="Completa el alta" style={{ borderColor: 'rgba(216,180,92,.5)', outline: 'none' }}>
      <div className="card-head">
        <h3 className="t-h3 gold">Completa el alta</h3>
        <span className="t-label">{consents ? `${done} de 4` : ''}</span>
      </div>
      {!consents && loading && <Skeleton rows={4} height={52} />}
      {!consents && <ErrorNote error={error} retry={retry} />}
      {consents && (
        <ol className="stack sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {CONSENT_KINDS.map((k, i) => {
            const c = signed[k];
            return (
              <Step key={k} n={i + 1} done={!!c} title={STEP_TITLE[k]}
                detail={c ? `Firmó ${c.signer_name} (${c.signer_relationship}) el ${fmtDateTime(c.signed_at)}` : 'Pendiente de firma en pantalla.'}>
                {c
                  ? <a className="btn sm" href={consentPdfUrl(c)} target="_blank" rel="noopener">Ver PDF</a>
                  : <Button size="sm" variant="primary" onClick={() => onSign(k)}>Firmar</Button>}
              </Step>
            );
          })}
          <Step n={4} done={!!fingerprintAt} title="Huella registrada"
            detail={fingerprintAt
              ? `Registrada el ${fmtDate(fingerprintAt)}.`
              : signed.biometric
                ? 'Registra la huella en el lector de recepción para tomar asistencia.'
                : 'No disponible todavía: primero debe firmarse el consentimiento de huella (paso 3).'}>
            {signed.biometric
              ? <EnrollFingerprint personType="patient" personId={patientId} enrolledAt={fingerprintAt} onDone={onEnrolled} />
              : <Button size="sm" disabled title="Primero firma el consentimiento de huella">Registrar huella</Button>}
          </Step>
        </ol>
      )}
    </section>
  );
});

/** EXP-10 · "Documentos firmados": consentimientos del paciente con enlace a su PDF y opción de firmar de nuevo. */
export function SignedDocuments({ consents, loading, error, retry, onSign }: {
  consents: Consent[] | undefined; loading: boolean; error: { message: string } | undefined; retry: () => void; onSign: (kind: ConsentKind) => void;
}) {
  const signed = latestByKind(consents);
  const missing = CONSENT_KINDS.filter((k) => !signed[k]);
  return (
    <Card title="Documentos firmados" blue>
      {!consents && loading && <Skeleton rows={2} height={52} />}
      {!consents && <ErrorNote error={error} retry={retry} />}
      {consents && (
        <div className="stack sm">
          {!consents.length && <Empty>Aún no hay documentos firmados. Firma el aviso de privacidad y los consentimientos en pantalla.</Empty>}
          {consents.map((c) => (
            <div key={c.id} className="row" style={{ flexWrap: 'wrap', rowGap: 8 }}>
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <div className="t-strong">{CONSENT_TITLE[c.kind]}{signed[c.kind]?.id !== c.id ? ' (versión anterior)' : ''}</div>
                <div className="t-small" style={{ marginTop: 3, overflowWrap: 'anywhere' }}>
                  Firmó {c.signer_name} ({c.signer_relationship}) · {fmtDateTime(c.signed_at)} · Registró {c.recorded_by_name || 'Sistema'}
                </div>
              </div>
              <a className="btn sm" href={consentPdfUrl(c)} target="_blank" rel="noopener" style={{ marginLeft: 'auto' }}
                aria-label={`Ver PDF de ${CONSENT_TITLE[c.kind]} del ${fmtDate(c.signed_at)}`}>Ver PDF</a>
            </div>
          ))}
          <div className="hstack wrap" style={{ marginTop: 4 }}>
            {missing.map((k) => <Button key={k} size="sm" variant="primary" onClick={() => onSign(k)}>Firmar {CONSENT_TITLE[k].toLowerCase()}</Button>)}
            {CONSENT_KINDS.filter((k) => signed[k]).map((k) => (
              <button key={k} type="button" className="btn-link" onClick={() => onSign(k)} style={{ marginRight: 8 }}>Firmar de nuevo: {CONSENT_TITLE[k]}</button>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
