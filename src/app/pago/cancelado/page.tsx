import type { Metadata } from 'next';
import { asSystem } from '@/lib/db';
import { PayShell } from '../shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Pago no realizado' };

// PAG-12 · El paciente salió de la página de pago sin pagar. El link sigue sirviendo hasta que venza.
export default async function CanceladoPage() {
  let clinic = 'Nicolas Center Elite';
  try {
    clinic = await asSystem(async (tx) => (await tx<{ name: string }[]>`select name from clinic`)[0]?.name ?? clinic);
  } catch { /* se muestra el nombre por omisión */ }
  return (
    <PayShell name={clinic}>
      <h1 className="t-h2" style={{ textTransform: 'none' }}>No se realizó ningún cargo</h1>
      <p className="t-body" style={{ marginTop: 14, lineHeight: 1.6 }}>
        Saliste de la página de pago antes de terminar. Puedes volver a abrir el mismo link para pagar mientras siga vigente,
        o pedir uno nuevo en recepción.
      </p>
    </PayShell>
  );
}
