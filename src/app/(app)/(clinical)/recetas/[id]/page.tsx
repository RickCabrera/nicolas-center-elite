'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/shell';
import { Button, Confirm, ErrorNote, Skeleton, useToast } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { ApiError, api, refresh, useApi } from '@/lib/client';
import { DocumentPaper } from '@/modules/documents/document-paper';
import { Portal } from '@/modules/documents/portal';
import { NewDocumentSheet } from '@/modules/documents/new-document-sheet';
import { DOC_SHORT, PHYSICIAN_ONLY, type DocumentDetail } from '@/modules/documents/shared';

// REC-08 · Vista imprimible de una receta médica o de unas indicaciones, con sus acciones.
export default function Documento() {
  const { id } = useParams<{ id: string }>();
  const user = useUser();
  const toast = useToast();
  const { data: doc, error, isLoading, mutate } = useApi<DocumentDetail>(`/api/documents/${id}`);
  const [cancelling, setCancelling] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  const print = () => {
    // Constancia en la bitácora; no detiene la impresión si falla.
    api.post(`/api/documents/${id}/print`).catch(() => {});
    window.print();
  };
  const cancel = async (reason: string) => {
    try {
      const d = await api.post<DocumentDetail>(`/api/documents/${id}/cancel`, { reason });
      await mutate(d, { revalidate: false });
      await refresh('/api/documents?');
      setCancelling(false);
      toast(`${d.folio} cancelado`);
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  const canDuplicate = !!doc && (doc.kind === 'indications' ? !!user.license_number : user.is_physician && !!user.license_number);
  const back = doc ? { href: `/pacientes/${doc.patient_id}?tab=recetas`, label: 'Expediente' } : { href: '/recetas', label: 'Recetas' };

  return (
    <div className="page">
      <PageHeader title={doc ? DOC_SHORT[doc.kind] : 'Documento'} sub="Lista para imprimir" back={back} />
      {error && !doc ? <ErrorNote error={error} retry={() => mutate()} />
        : isLoading || !doc ? <Skeleton rows={3} height={120} />
        : (
          <>
            <DocumentPaper doc={doc} />
            <div className="hstack wrap no-print">
              <Button variant="primary" size="lg" onClick={print}>Imprimir</Button>
              <a className="btn lg" href={`/api/documents/${doc.id}/pdf?download=1`}>Descargar PDF</a>
              <Button size="lg" onClick={() => setDuplicating(true)} disabled={!canDuplicate}
                title={canDuplicate ? 'Emitir un documento nuevo con estos renglones' : doc.kind === 'prescription' ? PHYSICIAN_ONLY : 'Registra tu cédula profesional en Mi perfil.'}>Duplicar</Button>
              {doc.can_cancel && <Button size="lg" variant="danger" onClick={() => setCancelling(true)}>Cancelar</Button>}
            </div>
            <Portal><Confirm open={cancelling} onClose={() => setCancelling(false)} onConfirm={cancel} danger reason="required"
              title={`Cancelar ${doc.folio}`} confirmLabel="Cancelar documento" reasonLabel="Motivo de la cancelación"
              message="El documento queda marcado como cancelado y conserva su folio. No se puede deshacer; si hace falta, emite uno nuevo." /></Portal>
            <NewDocumentSheet open={duplicating} onClose={() => setDuplicating(false)} duplicateFrom={doc} />
          </>
        )}
    </div>
  );
}
