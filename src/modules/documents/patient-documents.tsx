'use client';
import { useState } from 'react';
import { Button, Card, Empty, ErrorNote, Skeleton } from '@/components/ui';
import { useApi } from '@/lib/client';
import { DocumentRow } from './document-row';
import { NewDocumentSheet } from './new-document-sheet';
import type { DocumentList } from './shared';

// REC-10 · Recetas e indicaciones del paciente dentro de su expediente.
export function PatientDocuments({ patientId }: { patientId: string }) {
  const { data, error, isLoading, mutate } = useApi<DocumentList>(`/api/documents?patient_id=${patientId}&limit=200`);
  const [open, setOpen] = useState(false);
  return (
    <Card title="Recetas e indicaciones" blue action={<Button size="sm" variant="primary" onClick={() => setOpen(true)}>Nueva</Button>}>
      {error && !data ? <ErrorNote error={error} retry={() => mutate()} />
        : isLoading && !data ? <Skeleton rows={2} />
        : !data?.items.length ? <Empty>Sin documentos emitidos para este paciente.</Empty>
        : <div className="stack md">{data.items.map((d) => <DocumentRow key={d.id} doc={d} inPatient />)}</div>}
      <NewDocumentSheet open={open} onClose={() => setOpen(false)} patientId={patientId} />
    </Card>
  );
}
