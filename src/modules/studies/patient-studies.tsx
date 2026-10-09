'use client';
import { useState } from 'react';
import { Button, Card, Empty, ErrorNote } from '@/components/ui';
import { useApi } from '@/lib/client';
import { StudyGrid, StudyGridSkeleton } from './study-card';
import type { Study } from './types';
import { UploadStudySheet } from './upload-sheet';
import { StudyViewer } from './viewer';

/** Pestaña "Estudios" del expediente: rejilla de archivos del paciente, subida y visor (EST-02, EST-04). */
export function PatientStudies({ patientId }: { patientId: string }) {
  const { data, error, isLoading, mutate } = useApi<Study[]>(`/api/studies?patient_id=${patientId}&limit=200`);
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  return (
    <>
      <Card blue title="Estudios y archivos" action={<Button size="sm" variant="gold" onClick={() => setUploading(true)}>Subir estudio</Button>}>
        {error && !data ? (
          <ErrorNote error={error} retry={() => mutate()} />
        ) : !data || (isLoading && !data.length) ? (
          <StudyGridSkeleton count={3} />
        ) : data.length === 0 ? (
          <Empty>Sin estudios cargados para este paciente.</Empty>
        ) : (
          <StudyGrid studies={data} onOpen={setViewing} flat />
        )}
      </Card>
      <UploadStudySheet open={uploading} onClose={() => setUploading(false)} patientId={patientId} />
      <StudyViewer studyId={viewing} onClose={() => setViewing(null)} patientLink={false} />
    </>
  );
}
