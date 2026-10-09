'use client';
import { Button, Card, Empty, ErrorNote, Skeleton } from '@/components/ui';
import { useApi } from '@/lib/client';
import { fmtDate, fmtTime } from '@/lib/dates';
import type { AddendumTarget } from './note-sheet';
import { PainChart } from './pain-chart';
import type { EvolutionNote, NoteWithAddenda } from './types';

function NoteHead({ note }: { note: EvolutionNote }) {
  return (
    <div className="hstack between wrap" style={{ gap: 10, alignItems: 'baseline' }}>
      <span className="t-mono blue" style={{ lineHeight: 1.3 }}>{fmtDate(note.noted_at)} · {fmtTime(note.noted_at)}</span>
      <span className="t-small" style={{ color: 'var(--ink-4)', overflowWrap: 'anywhere' }}>
        {note.author_name}{note.author_license ? ` · Céd. ${note.author_license}` : ''}
      </span>
    </div>
  );
}
const Signed = ({ hash }: { hash: string }) => (
  <span className="t-label" style={{ letterSpacing: '.08em', textTransform: 'none' }}>Firmada electrónicamente · {hash.slice(0, 12)}</span>
);

/** EXP-04 / EXP-05 · Pestaña Sesiones: evolución del dolor y notas firmadas con sus adendas. */
export function NotesTab({ patientId, onAdd, onAddendum }: { patientId: string; onAdd: () => void; onAddendum: (n: AddendumTarget) => void }) {
  const { data, error, isLoading, mutate } = useApi<NoteWithAddenda[]>(`/api/patients/${patientId}/notes`);
  const pain = (data ?? []).filter((n) => n.pain_level !== null).map((n) => ({ at: n.noted_at, value: n.pain_level as number })).reverse();

  return (
    <div className="stack">
      {pain.length >= 2 && (
        <Card title="Evolución del dolor" blue action={<span className="t-label">Escala 0-10</span>}>
          <PainChart points={pain} />
        </Card>
      )}
      <Card title="Notas de evolución" blue action={<Button size="sm" onClick={onAdd}>Agregar nota</Button>}>
        {isLoading && !data && <Skeleton rows={3} height={84} />}
        {!data && <ErrorNote error={error} retry={() => mutate()} />}
        {data && !data.length && <Empty>Sin notas de evolución. Agrega la primera al terminar la sesión.</Empty>}
        <div className="stack md">
          {data?.map((n) => (
            <article key={n.id} className="row" style={{ display: 'block', padding: 12 }}>
              <NoteHead note={n} />
              <p className="t-body" style={{ marginTop: 8, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{n.body}</p>
              {(n.pain_level !== null || n.range_of_motion) && (
                <div className="hstack wrap" style={{ marginTop: 10 }}>
                  {n.pain_level !== null && <span className="pill blue">Dolor {n.pain_level}/10</span>}
                  {n.range_of_motion && <span className="pill" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>Rango de movimiento: {n.range_of_motion}</span>}
                </div>
              )}
              {n.addenda.map((a) => (
                <div key={a.id} style={{ marginTop: 12, marginLeft: 4, paddingLeft: 12, borderLeft: '2px solid rgba(216,180,92,.6)' }}>
                  <div className="hstack wrap" style={{ gap: 10, marginBottom: 6 }}>
                    <span className="badge gold">Adenda</span>
                  </div>
                  <NoteHead note={a} />
                  <p className="t-body" style={{ marginTop: 6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{a.body}</p>
                  <div style={{ marginTop: 8 }}><Signed hash={a.signature_hash} /></div>
                </div>
              ))}
              <div className="hstack between wrap" style={{ marginTop: 12, gap: 10 }}>
                <Signed hash={n.signature_hash} />
                <button type="button" className="btn-link" onClick={() => onAddendum({ id: n.id, noted_at: n.noted_at, author_name: n.author_name })}>Agregar adenda</button>
              </div>
            </article>
          ))}
        </div>
      </Card>
    </div>
  );
}
