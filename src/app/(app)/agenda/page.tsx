'use client';
import { Suspense } from 'react';
import { Skeleton } from '@/components/ui';
import { AgendaScreen } from '@/modules/agenda/agenda-screen';

// AGE-02 · Agenda. La fecha y la vista viven en la URL (?fecha=AAAA-MM-DD&vista=semana).
export default function AgendaPage() {
  return (
    <Suspense fallback={<div className="page"><Skeleton rows={4} /></div>}>
      <AgendaScreen />
    </Suspense>
  );
}
