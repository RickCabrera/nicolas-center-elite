'use client';
import { useEffect, useState } from 'react';
import { useMeta } from '@/components/meta';
import { Button, Empty, Notice, Sheet, Skeleton, useToast } from '@/components/ui';
import { api, ApiError, refresh } from '@/lib/client';
import { money, PLAN_KIND_LABEL } from '@/lib/format';

// PAG-02 / PAG-09 · Hoja para asignar plan (paciente sin membresía) o cambiar de plan.
export function PlanPickerSheet({ open, onClose, patientId, patientName, mode, currentPlanId }: {
  open: boolean; onClose: () => void; patientId: string; patientName: string; mode: 'assign' | 'change_plan'; currentPlanId?: string | null;
}) {
  const { meta } = useMeta();
  const toast = useToast();
  const [planId, setPlanId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setPlanId(''); setError(''); setBusy(false); } }, [open]);

  const plans = (meta?.plans ?? []).filter((p) => p.active && p.id !== currentPlanId);
  const save = async () => {
    if (!planId) { setError('Elige un plan.'); return; }
    setBusy(true); setError('');
    try {
      await api.patch(`/api/billing/memberships/${patientId}`, { action: mode, plan_id: planId });
      toast(mode === 'assign' ? `Plan asignado · ${patientName}` : `Plan cambiado · ${patientName}`);
      refresh('/api/billing', '/api/patients');
      onClose();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={mode === 'assign' ? 'Asignar plan' : 'Cambiar plan'}
      footer={<>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={busy} onClick={save}>{mode === 'assign' ? 'Asignar plan' : 'Cambiar plan'}</Button>
      </>}>
      <div className="stack md">
        <div className="t-sub">{patientName}</div>
        {error && <Notice tone="red">{error}</Notice>}
        {!meta ? <Skeleton rows={3} /> : plans.length === 0 ? (
          <Empty>No hay otros planes activos. Agrega o activa planes en Configuración → Membresías y precios.</Empty>
        ) : (
          <div className="stack sm" role="radiogroup" aria-label="Plan">
            {plans.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={planId === p.id} className="row" onClick={() => { setPlanId(p.id); setError(''); }}
                style={planId === p.id ? { borderColor: 'var(--blue)', boxShadow: '0 0 20px -6px rgba(46,155,255,.7)' } : undefined}>
                <div className="grow">
                  <div className="t-strong ellipsis">{p.name}</div>
                  <div className="t-small" style={{ marginTop: 2 }}>
                    {PLAN_KIND_LABEL[p.kind]} · {p.period_days} {p.period_days === 1 ? 'día' : 'días'}{p.kind === 'package' && p.sessions_count ? ` · ${p.sessions_count} sesiones` : ''}
                  </div>
                </div>
                <span className="t-mono green" style={{ fontSize: 14 }}>{money(p.price_cents)}</span>
              </button>
            ))}
          </div>
        )}
        <Notice tone="gold">
          {mode === 'assign'
            ? 'El primer pago queda pendiente desde hoy. Regístralo para activar el plan.'
            : 'Si el plan actual está al corriente se conserva su fecha de vencimiento; si está vencido, el nuevo plan queda por pagar desde hoy. Un paquete empieza con 0 sesiones hasta registrar su pago. Los pagos anteriores no cambian.'}
        </Notice>
      </div>
    </Sheet>
  );
}
