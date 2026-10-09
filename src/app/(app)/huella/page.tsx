'use client';
import { PageHeader } from '@/components/shell';
import { AttendanceScreen } from '@/modules/attendance/attendance-screen';

// HUE-10 · Control de asistencia: estado del lector, asistencias en vivo, registro manual y reportes.
export default function Huella() {
  return (
    <div className="page">
      <PageHeader title="Control de asistencia" sub="Lector biométrico en recepción" />
      <AttendanceScreen />
    </div>
  );
}
