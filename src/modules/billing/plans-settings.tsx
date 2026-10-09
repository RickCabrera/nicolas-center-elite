'use client';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Confirm, Empty, ErrorNote, Field, Input, Notice, Select, Sheet, Skeleton, useToast } from '@/components/ui';
import { api, ApiError, refresh, useApi } from '@/lib/client';
import { money, parseMoney, PLAN_KIND_LABEL } from '@/lib/format';
import type { PlanKind } from './rules';
import type { Plan } from './types';

const pesos = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));
const DEFAULT_DAYS: Record<PlanKind, string> = { monthly: '30', package: '60', single: '1' };
type Form = { name: string; kind: PlanKind; price: string; period_days: string; sessions_count: string };
const EMPTY: Form = { name: '', kind: 'monthly', price: '', period_days: '30', sessions_count: '' };

function PlanSheet({ open, onClose, plan }: { open: boolean; onClose: () => void; plan: Plan | null }) {
  const toast = useToast();
  const [f, setF] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF(plan
      ? { name: plan.name, kind: plan.kind, price: pesos(plan.price_cents), period_days: String(plan.period_days), sessions_count: plan.sessions_count ? String(plan.sessions_count) : '' }
      : EMPTY);
    setErrors({}); setFormError(''); setBusy(false);
  }, [open, plan]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((s) => ({ ...s, [k]: v }));
    setErrors((e) => ({ ...e, [k === 'price' ? 'price_cents' : k]: '' }));
  };
  const kindLocked = !!plan && plan.memberships > 0;

  const save = async () => {
    const e: Record<string, string> = {};
    const price = parseMoney(f.price);
    const days = /^\d+$/.test(f.period_days.trim()) ? Number(f.period_days) : NaN;
    const sessions = /^\d+$/.test(f.sessions_count.trim()) ? Number(f.sessions_count) : NaN;
    if (!f.name.trim()) e.name = 'Escribe el nombre.';
    if (price === null) e.price_cents = 'Escribe un precio válido, por ejemplo 2400 o 2400.50.';
    if (!(days >= 1 && days <= 366)) e.period_days = 'La vigencia va de 1 a 366 días.';
    if (f.kind === 'package' && !(sessions >= 1)) e.sessions_count = 'Escribe el número de sesiones.';
    setErrors(e); setFormError('');
    if (Object.keys(e).length) return;
    const body = {
      name: f.name.trim(), price_cents: price, period_days: days,
      ...(kindLocked ? {} : { kind: f.kind }),
      ...(f.kind === 'package' ? { sessions_count: sessions } : {}),
    };
    setBusy(true);
    try {
      if (plan) await api.patch(`/api/plans/${plan.id}`, body);
      else await api.post('/api/plans', body);
      toast(plan ? 'Plan actualizado' : 'Plan agregado');
      refresh('/api/plans', '/api/meta');
      onClose();
    } catch (err) {
      const ae = err as ApiError;
      setErrors(ae.fields ?? {});
      setFormError(ae.fields && Object.keys(ae.fields).length ? '' : ae.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={plan ? 'Editar plan' : 'Agregar plan'}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Guardar</Button></>}>
      <form className="stack md" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {formError && <Notice tone="red">{formError}</Notice>}
        <Field label="Nombre" error={errors.name}>
          <Input value={f.name} maxLength={80} invalid={!!errors.name} onChange={(e) => set('name', e.target.value)} placeholder="Mensual Elite" />
        </Field>
        <Field label="Tipo" error={errors.kind} hint={kindLocked ? 'El tipo no se puede cambiar porque el plan ya tiene pacientes.' : undefined}>
          <Select value={f.kind} disabled={kindLocked} invalid={!!errors.kind}
            onChange={(e) => { const k = e.target.value as PlanKind; setF((s) => ({ ...s, kind: k, period_days: plan ? s.period_days : DEFAULT_DAYS[k] })); }}>
            {(['monthly', 'package', 'single'] as const).map((k) => <option key={k} value={k}>{PLAN_KIND_LABEL[k]}</option>)}
          </Select>
        </Field>
        <div className="grid-form">
          <Field label="Precio (MXN)" error={errors.price_cents}>
            <Input inputMode="decimal" value={f.price} invalid={!!errors.price_cents} autoComplete="off" onChange={(e) => set('price', e.target.value)} placeholder="2400" />
          </Field>
          <Field label="Vigencia (días)" error={errors.period_days}>
            <Input inputMode="numeric" value={f.period_days} invalid={!!errors.period_days} autoComplete="off" onChange={(e) => set('period_days', e.target.value)} />
          </Field>
          {f.kind === 'package' && (
            <Field label="Sesiones del paquete" error={errors.sessions_count}>
              <Input inputMode="numeric" value={f.sessions_count} invalid={!!errors.sessions_count} autoComplete="off" onChange={(e) => set('sessions_count', e.target.value)} placeholder="10" />
            </Field>
          )}
        </div>
        {plan && <Notice>Cambiar el precio o el nombre aplica a los pagos que se registren desde ahora. Los pagos y recibos anteriores no cambian.</Notice>}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
}

// PAG-01 / CFG-03 · Sección "Membresías y precios" de Configuración.
export function PlansSettings(_props: Record<string, never>) {
  const toast = useToast();
  const { data, error, mutate } = useApi<Plan[]>('/api/plans');
  const [sheet, setSheet] = useState<{ plan: Plan | null } | null>(null);
  const [toggle, setToggle] = useState<Plan | null>(null);

  const doToggle = async () => {
    if (!toggle) return;
    try {
      await api.patch(`/api/plans/${toggle.id}`, { active: !toggle.active });
      toast(toggle.active ? `Plan desactivado · ${toggle.name}` : `Plan activado · ${toggle.name}`);
      refresh('/api/plans', '/api/meta');
      setToggle(null);
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  return (
    <Card title="Membresías y precios" blue
      action={<button type="button" className="btn-link" onClick={() => setSheet({ plan: null })}>+ Agregar plan</button>}>
      {error && !data ? <ErrorNote error={error} retry={() => mutate()} />
        : !data ? <Skeleton rows={4} />
        : data.length === 0 ? <Empty>Aún no hay planes. Agrega el primero con «+ Agregar plan».</Empty>
        : (
          <div className="stack sm">
            {data.map((p) => (
              <div key={p.id} className="row" style={{ flexWrap: 'wrap', rowGap: 8, opacity: p.active ? 1 : 0.8 }}>
                <div className="grow" style={{ minWidth: 150 }}>
                  <div className="hstack" style={{ minWidth: 0 }}>
                    <span className="t-strong ellipsis">{p.name}</span>
                    {!p.active && <Badge>Inactivo</Badge>}
                  </div>
                  <div className="t-small" style={{ marginTop: 3 }}>
                    {PLAN_KIND_LABEL[p.kind]} · {p.period_days} {p.period_days === 1 ? 'día' : 'días'}
                    {p.kind === 'package' && p.sessions_count ? ` · ${p.sessions_count} sesiones` : ''}
                    {' · '}{p.patients} {p.patients === 1 ? 'paciente' : 'pacientes'}
                  </div>
                </div>
                <div className="hstack" style={{ gap: 10, marginLeft: 'auto' }}>
                  <span className="t-mono green" style={{ fontSize: 14 }}>{money(p.price_cents)}</span>
                  <Button size="sm" onClick={() => setSheet({ plan: p })} aria-label={`Editar ${p.name}`}>Editar</Button>
                  <button type="button" role="switch" aria-checked={p.active} aria-label={`${p.name}: ${p.active ? 'activo' : 'inactivo'}`}
                    onClick={() => setToggle(p)}
                    style={{
                      width: 46, height: 28, flex: 'none', borderRadius: 14, padding: 2, cursor: 'pointer', display: 'flex',
                      justifyContent: p.active ? 'flex-end' : 'flex-start', transition: 'background .15s',
                      border: `1px solid ${p.active ? 'rgba(74,217,145,.7)' : 'var(--line)'}`,
                      background: p.active ? 'rgba(74,217,145,.16)' : 'rgba(255,255,255,.05)',
                    }}>
                    <span style={{ width: 22, height: 22, borderRadius: '50%', background: p.active ? 'var(--green)' : 'rgba(255,255,255,.45)' }} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      <PlanSheet open={!!sheet} onClose={() => setSheet(null)} plan={sheet?.plan ?? null} />
      <Confirm open={!!toggle} onClose={() => setToggle(null)} onConfirm={doToggle}
        title={toggle?.active ? 'Desactivar plan' : 'Activar plan'} confirmLabel={toggle?.active ? 'Desactivar' : 'Activar'} danger={toggle?.active}
        message={toggle?.active
          ? `«${toggle.name}» ya no se podrá asignar a pacientes nuevos. ${toggle.patients > 0 ? `${toggle.patients === 1 ? 'El paciente que lo tiene lo conserva' : `Los ${toggle.patients} pacientes que lo tienen lo conservan`} y se le puede seguir cobrando.` : ''}`
          : `«${toggle?.name ?? ''}» volverá a estar disponible para asignarse.`} />
    </Card>
  );
}
