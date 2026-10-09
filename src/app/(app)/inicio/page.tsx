import { Suspense } from 'react';
import { DashboardView } from '@/modules/dashboard/dashboard-view';

// DASH-01..04 · Panel de inicio (dueño: "Panel general"; fisioterapeuta: "Mi panel").
export default function Inicio() {
  return <Suspense><DashboardView /></Suspense>;
}
