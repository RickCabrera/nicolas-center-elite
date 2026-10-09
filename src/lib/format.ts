/** Utilidades de presentación compartidas por servidor y navegador. */

/** Centavos → '$2,400' / '$2,400.50' (MXN). */
export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '$—';
  const v = cents / 100;
  return v.toLocaleString('es-MX', {
    style: 'currency', currency: 'MXN',
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2,
  });
}

/** '2,400' o '2400.50' → centavos; null si no es un monto válido. */
export function parseMoney(s: string): number | null {
  const t = s.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}

/** Iniciales para el avatar: 'Emiliano Cárdenas' → 'EC'. */
export function initials(name: string): string {
  const w = name.replace(/^(Dra?\.|L\.F\.T\.|Lic\.|Mtr[ao]\.)\s*/i, '').split(/\s+/).filter((x) => x.length > 2);
  return (w.slice(0, 2).map((x) => x[0]).join('') || name.slice(0, 2)).toUpperCase();
}

/** Primer nombre sin título: 'L.F.T. Karla Ocampo' → 'Karla'. */
export function shortName(name: string): string {
  return name.replace(/^(Dra?\.|L\.F\.T\.|Lic\.|Mtr[ao]\.)\s*/i, '').split(/\s+/)[0] ?? name;
}

export type BillingState = 'pagado' | 'por_vencer' | 'vencido' | 'pausado' | 'sin_plan';
export const BILLING_LABEL: Record<BillingState, string> = {
  pagado: 'PAGADO', por_vencer: 'POR VENCER', vencido: 'VENCIDO', pausado: 'PAUSADO', sin_plan: 'SIN PLAN',
};

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: 'Efectivo', transfer: 'Transferencia', card: 'Tarjeta', online_card: 'Tarjeta en línea', oxxo: 'OXXO',
};
export const PLAN_KIND_LABEL: Record<string, string> = { monthly: 'Mensual', package: 'Paquete de sesiones', single: 'Sesión individual' };
export const APPT_STATUS_LABEL: Record<string, string> = {
  scheduled: 'Programada', attended: 'Asistió', no_show: 'No asistió', cancelled: 'Cancelada',
};

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
