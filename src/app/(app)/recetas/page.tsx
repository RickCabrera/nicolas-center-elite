'use client';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/shell';
import { Button, Chip, Empty, ErrorNote, Input, Skeleton } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { qs, useApi } from '@/lib/client';
import { DocumentRow } from '@/modules/documents/document-row';
import { NewDocumentSheet } from '@/modules/documents/new-document-sheet';
import type { DocKind, DocumentList } from '@/modules/documents/shared';

const FILTERS: { key: '' | DocKind; label: string }[] = [
  { key: '', label: 'Todos' },
  { key: 'prescription', label: 'Recetas médicas' },
  { key: 'indications', label: 'Indicaciones' },
];
const PAGE = 50;

// REC-09 · Historial de recetas e indicaciones: toda la clínica para el dueño, "emitidas por ti" para el profesional.
export default function Recetas() {
  const user = useUser();
  const [kind, setKind] = useState<'' | DocKind>('');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => { setQ(text.trim()); setLimit(PAGE); }, 250);
    return () => clearTimeout(t);
  }, [text]);

  const { data, error, isLoading, mutate } = useApi<DocumentList>('/api/documents' + qs({ kind, q, mine: user.isOwner ? null : 1, limit }));
  const filtered = !!(kind || q);

  return (
    <div className="page">
      <PageHeader title="Recetas emitidas" sub={user.isOwner ? 'Historial de toda la clínica' : 'Documentos emitidos por ti'} />
      <Button variant="primary" size="lg" style={{ alignSelf: 'stretch', maxWidth: 240 }} onClick={() => setOpen(true)}>+ Nueva</Button>
      <Input className="input round" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Buscar por paciente o folio" aria-label="Buscar por paciente o folio" />
      <div className="scroll-x" role="group" aria-label="Filtrar por tipo">
        {FILTERS.map((f) => <Chip key={f.key} on={kind === f.key} onClick={() => { setKind(f.key); setLimit(PAGE); }}>{f.label}</Chip>)}
      </div>

      {error && !data ? <ErrorNote error={error} retry={() => mutate()} />
        : isLoading && !data ? <Skeleton rows={4} height={72} />
        : !data?.items.length ? <Empty>{filtered ? 'Ningún documento coincide con la búsqueda.' : 'Aún no se han emitido documentos.'}</Empty>
        : (
          <>
            <div className="grid-2">{data.items.map((d) => <DocumentRow key={d.id} doc={d} />)}</div>
            <div className="hstack between wrap">
              <span className="t-label">{data.items.length} de {data.total}</span>
              {data.items.length < data.total && <Button size="sm" onClick={() => setLimit((l) => l + PAGE)}>Ver más</Button>}
            </div>
          </>
        )}
      <NewDocumentSheet open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
