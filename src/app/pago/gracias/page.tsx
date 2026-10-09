import type { Metadata } from 'next';
import { asSystem } from '@/lib/db';
import { money } from '@/lib/format';
import { PayShell } from '../shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Pago recibido' };

type Row = { clinic: string; status: string | null; amount_cents: number | null; concept: string | null };

// PAG-12 · Página a la que Stripe regresa al paciente después de pagar. No muestra datos personales.
export default async function GraciasPage({ searchParams }: { searchParams: Promise<{ l?: string }> }) {
  const { l } = await searchParams;
  const id = /^[0-9a-f-]{36}$/i.test(l ?? '') ? l! : null;
  let row: Row = { clinic: 'Nicolas Center Elite', status: null, amount_cents: null, concept: null };
  try {
    row = await asSystem(async (tx) => {
      const [c] = await tx<{ name: string }[]>`select name from clinic`;
      const [k] = id ? await tx<{ status: string; amount_cents: number; concept: string }[]>`
        select status, amount_cents, concept from payment_links where id = ${id}` : [];
      return { clinic: c?.name ?? 'Nicolas Center Elite', status: k?.status ?? null, amount_cents: k?.amount_cents ?? null, concept: k?.concept ?? null };
    });
  } catch (e) {
    console.error('[pago] no se pudo leer el link:', e);
  }
  const oxxo = row.status === 'pending_oxxo';
  return (
    <PayShell name={row.clinic}>
      <h1 className="t-h2" style={{ textTransform: 'none' }}>{oxxo ? 'Tu ficha OXXO está lista' : '¡Gracias por tu pago!'}</h1>
      {row.amount_cents != null && (
        <p className="t-mono green" style={{ fontSize: 26, margin: '14px 0 4px' }}>{money(row.amount_cents)}</p>
      )}
      {row.concept && <p className="t-sub">{row.concept}</p>}
      <p className="t-body" style={{ marginTop: 16, lineHeight: 1.6 }}>
        {oxxo
          ? 'Paga la ficha en cualquier OXXO antes de su fecha límite. Tu mensualidad se actualiza sola cuando OXXO confirme el pago (normalmente al día siguiente).'
          : row.status === 'paid'
            ? 'Tu pago quedó registrado y tu mensualidad ya está actualizada. Recibirás el comprobante de Stripe en tu correo.'
            : 'Estamos confirmando tu pago con el banco; en unos minutos tu mensualidad quedará actualizada. Recibirás el comprobante en tu correo.'}
      </p>
      <p className="t-small" style={{ marginTop: 14 }}>Si necesitas factura, pídela en recepción con tu Constancia de Situación Fiscal.</p>
    </PayShell>
  );
}
