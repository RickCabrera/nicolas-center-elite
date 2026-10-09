'use client';
import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/shell';
import { Skeleton } from '@/components/ui';
import { RecordScreen } from '@/modules/record/record-screen';

// EXP-01 · Expediente clínico del paciente. La pestaña activa vive en la URL (?tab=sesiones).
export default function ExpedientePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <Suspense fallback={<div className="page"><PageHeader title="Expediente clínico" back={{ href: '/pacientes', label: 'Pacientes' }} /><Skeleton rows={3} height={120} /></div>}>
      <RecordScreen patientId={id} />
    </Suspense>
  );
}
