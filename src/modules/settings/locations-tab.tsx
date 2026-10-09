'use client';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Confirm, Empty, ErrorNote, Field, Input, Notice, Sheet, Skeleton, useToast } from '@/components/ui';
import { api, ApiError, refresh, useApi } from '@/lib/client';
import { locationAddress } from './shared';
import type { LocationRow } from './types';

type Form = { code: string; name: string; street: string; neighborhood: string; city: string; state: string; zip: string; phone: string; hours: string };
const EMPTY: Form = { code: '', name: '', street: '', neighborhood: '', city: '', state: 'Veracruz', zip: '', phone: '', hours: '' };

function LocationSheet({ open, onClose, loc }: { open: boolean; onClose: () => void; loc: LocationRow | null }) {
  const toast = useToast();
  const [f, setF] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF(loc ? { code: loc.code, name: loc.name, street: loc.street, neighborhood: loc.neighborhood, city: loc.city, state: loc.state, zip: loc.zip, phone: loc.phone, hours: loc.hours } : EMPTY);
    setErrors({}); setFormError(''); setBusy(false);
  }, [open, loc]);
  const set = (k: keyof Form, v: string) => {
    setF((s) => ({ ...s, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };
  const codeLocked = !!loc && loc.documents_count > 0;

  const save = async () => {
    const e: Record<string, string> = {};
    if (!/^[A-Za-z]{2,5}$/.test(f.code.trim())) e.code = 'De 2 a 5 letras, sin números ni espacios.';
    if (f.name.trim().length < 2) e.name = 'Escribe el nombre de la sede.';
    if (f.zip.trim() && !/^\d{5}$/.test(f.zip.trim())) e.zip = 'El código postal tiene 5 dígitos.';
    setErrors(e); setFormError('');
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const { code, ...rest } = f;
      if (loc) await api.patch(`/api/locations/${loc.id}`, codeLocked ? rest : f);
      else await api.post('/api/locations', { ...rest, code });
      toast(loc ? 'Sede actualizada' : `Sede agregada · ${f.name.trim()}`);
      refresh('/api/locations', '/api/meta');
      onClose();
    } catch (err) {
      const ae = err as ApiError;
      if (ae.code === 'duplicate') setErrors(ae.message.includes('clave') ? { code: ae.message } : { name: ae.message });
      else if (ae.fields) setErrors(ae.fields);
      else setFormError(ae.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={loc ? `Editar sede · ${loc.name}` : 'Agregar sede'}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Guardar</Button></>}>
      <form className="stack md" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {formError && <Notice tone="red">{formError}</Notice>}
        <div className="grid-form">
          <Field label="Nombre" error={errors.name}>
            <Input value={f.name} maxLength={60} invalid={!!errors.name} onChange={(e) => set('name', e.target.value)} placeholder="Córdoba" />
          </Field>
          <Field label="Clave" error={errors.code}
            hint={codeLocked ? 'No se puede cambiar: ya hay documentos emitidos con esta clave.' : 'De 2 a 5 letras. Encabeza los folios: COR-RX-000001.'}>
            <Input value={f.code} maxLength={5} disabled={codeLocked} invalid={!!errors.code} autoCapitalize="characters" autoComplete="off"
              style={{ textTransform: 'uppercase', fontFamily: 'var(--f-mono)' }} onChange={(e) => set('code', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} placeholder="COR" />
          </Field>
        </div>
        <Field label="Calle y número" error={errors.street}>
          <Input value={f.street} maxLength={160} invalid={!!errors.street} onChange={(e) => set('street', e.target.value)} placeholder="Av. 1 No. 123" />
        </Field>
        <div className="grid-form">
          <Field label="Colonia" error={errors.neighborhood}>
            <Input value={f.neighborhood} maxLength={120} invalid={!!errors.neighborhood} onChange={(e) => set('neighborhood', e.target.value)} placeholder="Centro" />
          </Field>
          <Field label="Código postal" error={errors.zip}>
            <Input value={f.zip} maxLength={5} inputMode="numeric" invalid={!!errors.zip} onChange={(e) => set('zip', e.target.value.replace(/\D/g, ''))} placeholder="94500" />
          </Field>
          <Field label="Ciudad" error={errors.city}>
            <Input value={f.city} maxLength={80} invalid={!!errors.city} onChange={(e) => set('city', e.target.value)} placeholder="Córdoba" />
          </Field>
          <Field label="Estado" error={errors.state}>
            <Input value={f.state} maxLength={80} invalid={!!errors.state} onChange={(e) => set('state', e.target.value)} />
          </Field>
        </div>
        <div className="grid-form">
          <Field label="Teléfono" error={errors.phone}>
            <Input type="tel" inputMode="tel" value={f.phone} maxLength={40} invalid={!!errors.phone} onChange={(e) => set('phone', e.target.value)} placeholder="271 000 0000" />
          </Field>
          <Field label="Horario" error={errors.hours}>
            <Input value={f.hours} maxLength={200} invalid={!!errors.hours} onChange={(e) => set('hours', e.target.value)} placeholder="Lun a vie 7:00–21:00 · Sáb 8:00–14:00" />
          </Field>
        </div>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// CFG-02 · Sedes de la clínica.
export function LocationsTab() {
  const toast = useToast();
  const { data, error, mutate } = useApi<LocationRow[]>('/api/locations');
  const [sheet, setSheet] = useState<{ loc: LocationRow | null } | null>(null);
  const [toggle, setToggle] = useState<LocationRow | null>(null);

  const doToggle = async () => {
    if (!toggle) return;
    try {
      await api.patch(`/api/locations/${toggle.id}`, { active: !toggle.active });
      toast(toggle.active ? `Sede desactivada · ${toggle.name}` : `Sede activada · ${toggle.name}`);
      refresh('/api/locations', '/api/meta');
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setToggle(null);
    }
  };

  return (
    <div className="stack">
      <div className="hstack between wrap" style={{ gap: 12 }}>
        <p className="t-sub grow" style={{ minWidth: 220 }}>El domicilio y el teléfono de la sede se imprimen en recetas e indicaciones.</p>
        <Button variant="primary" onClick={() => setSheet({ loc: null })}>Agregar sede</Button>
      </div>
      {error && !data ? <ErrorNote error={error} retry={() => mutate()} />
        : !data ? <Skeleton rows={2} height={160} />
        : data.length === 0 ? <Empty>Aún no hay sedes. Agrega la primera para poder registrar pacientes y emitir documentos.</Empty>
        : (
          <div className="grid-cards" style={{ alignItems: 'start' }}>
            {data.map((l) => {
              const address = locationAddress(l);
              const incomplete = l.active && (!l.street.trim() || !l.phone.trim());
              return (
                <Card key={l.id} title={l.name} blue action={<span className="hstack"><span className="pill">{l.code}</span>{!l.active && <Badge tone="red">Inactiva</Badge>}</span>}>
                  <div className="stack md" style={{ opacity: l.active ? 1 : 0.72 }}>
                    <div>
                      <div className="t-label">Domicilio</div>
                      <div className="t-body" style={{ marginTop: 5, overflowWrap: 'anywhere' }}>{address || '—'}</div>
                    </div>
                    <div className="grid-kv">
                      <div><div className="t-label">Teléfono</div><div className="t-body" style={{ marginTop: 5, overflowWrap: 'anywhere' }}>{l.phone || '—'}</div></div>
                      <div><div className="t-label">Horario</div><div className="t-body" style={{ marginTop: 5, overflowWrap: 'anywhere' }}>{l.hours || '—'}</div></div>
                    </div>
                    {incomplete && <Notice tone="gold">Falta {[!l.street.trim() && 'el domicilio', !l.phone.trim() && 'el teléfono'].filter(Boolean).join(' y ')}: los documentos de esta sede saldrán sin ese dato.</Notice>}
                    <div className="t-small">
                      {plural(l.active_patients, 'paciente activo', 'pacientes activos')} · {plural(l.active_users, 'usuario', 'usuarios')} · {plural(l.documents_count, 'documento emitido', 'documentos emitidos')}
                    </div>
                    <div className="hstack wrap">
                      <Button size="sm" onClick={() => setSheet({ loc: l })}>Editar</Button>
                      <Button size="sm" variant={l.active ? 'danger' : 'success'} onClick={() => setToggle(l)}>{l.active ? 'Desactivar' : 'Activar'}</Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      <LocationSheet open={!!sheet} onClose={() => setSheet(null)} loc={sheet?.loc ?? null} />
      <Confirm open={!!toggle} onClose={() => setToggle(null)} onConfirm={doToggle} danger={toggle?.active}
        title={toggle?.active ? `Desactivar ${toggle?.name}` : `Activar ${toggle?.name ?? ''}`}
        confirmLabel={toggle?.active ? 'Desactivar' : 'Activar'}
        message={toggle?.active
          ? 'La sede dejará de aparecer al registrar pacientes, citas y usuarios. Su historial y sus folios se conservan. Solo se puede desactivar si ya no tiene pacientes ni usuarios activos.'
          : 'La sede volverá a aparecer en los selectores de toda la aplicación.'} />
    </div>
  );
}
