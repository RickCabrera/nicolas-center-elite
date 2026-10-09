'use client';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Checkbox, Empty, ErrorNote, Field, Input, Notice, Sheet, Skeleton, useToast } from '@/components/ui';
import { api, ApiError, refresh, useApi } from '@/lib/client';
import type { CatalogKind } from './shared';
import type { CatalogItem } from './types';

const INFO: Record<CatalogKind, { title: string; one: string; help: string; placeholder: string; renameNote: string }> = {
  'session-types': {
    title: 'Tipos de sesión', one: 'tipo de sesión', placeholder: 'Fisioterapia',
    help: 'Opciones al agendar una cita. La duración se propone sola al elegir el tipo.',
    renameNote: 'Las citas ya agendadas conservan el nombre con el que se crearon.',
  },
  'study-types': {
    title: 'Tipos de estudio', one: 'tipo de estudio', placeholder: 'Radiografía',
    help: 'Clasificación al subir un estudio y filtros de la pantalla Estudios.',
    renameNote: 'Al cambiar el nombre también se actualizan los estudios ya guardados con este tipo.',
  },
  tags: {
    title: 'Etiquetas de paciente', one: 'etiqueta', placeholder: 'Deportista',
    help: 'Etiquetas para clasificar y filtrar pacientes.',
    renameNote: 'Al cambiar el nombre también se actualiza en todos los pacientes que la tienen.',
  },
};
const keyOf = (i: CatalogItem) => i.id ?? i.name;

function ItemSheet({ kind, open, onClose, item }: { kind: CatalogKind; open: boolean; onClose: () => void; item: CatalogItem | null }) {
  const toast = useToast();
  const info = INFO[kind];
  const withDuration = kind === 'session-types';
  const [name, setName] = useState('');
  const [duration, setDuration] = useState('50');
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? ''); setDuration(String(item?.default_duration_min ?? 50)); setActive(item?.active ?? true);
    setErrors({}); setFormError(''); setBusy(false);
  }, [open, item]);

  const save = async () => {
    const e: Record<string, string> = {};
    const n = name.trim();
    const d = /^\d+$/.test(duration.trim()) ? Number(duration) : NaN;
    if (n.length < 2) e.name = 'Escribe el nombre.';
    if (withDuration && !(d >= 5 && d <= 480)) e.default_duration_min = 'La duración va de 5 a 480 minutos.';
    setErrors(e); setFormError('');
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      if (!item) {
        await api.post(`/api/catalogs/${kind}`, withDuration ? { name: n, default_duration_min: d } : { name: n });
      } else if (withDuration) {
        await api.patch(`/api/catalogs/${kind}`, { id: item.id, name: n, default_duration_min: d, active });
      } else {
        await api.patch(`/api/catalogs/${kind}`, { name: item.name, ...(n !== item.name ? { new_name: n } : {}), active });
      }
      toast(item ? 'Cambios guardados' : `Se agregó "${n}"`);
      // Los selectores de toda la app leen /api/meta: se refrescan junto con las listas que muestran estos nombres.
      refresh('/api/catalogs', '/api/meta', '/api/patients', '/api/studies');
      onClose();
    } catch (err) {
      const ae = err as ApiError;
      if (ae.code === 'duplicate') setErrors({ name: ae.message });
      else if (ae.fields) setErrors(ae.fields);
      else setFormError(ae.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={item ? `Editar ${info.one}` : `Agregar ${info.one}`}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Guardar</Button></>}>
      <form className="stack md" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {formError && <Notice tone="red">{formError}</Notice>}
        <Field label="Nombre" error={errors.name ?? errors.new_name}>
          <Input value={name} maxLength={60} invalid={!!(errors.name ?? errors.new_name)} onChange={(e) => { setName(e.target.value); setErrors({}); }} placeholder={info.placeholder} />
        </Field>
        {withDuration && (
          <Field label="Duración habitual (minutos)" error={errors.default_duration_min}>
            <Input inputMode="numeric" autoComplete="off" value={duration} invalid={!!errors.default_duration_min} onChange={(e) => { setDuration(e.target.value.replace(/\D/g, '').slice(0, 3)); setErrors({}); }} />
          </Field>
        )}
        {item && (
          <Checkbox checked={active} onChange={(e) => setActive(e.target.checked)}
            label={<><b style={{ fontWeight: 600 }}>Activo</b>: aparece como opción en los selectores. Al desactivarlo deja de ofrecerse, pero lo ya capturado no cambia.</>} />
        )}
        {item && name.trim() !== item.name && name.trim().length >= 2 && <Notice>{info.renameNote}</Notice>}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
}

function CatalogCard({ kind }: { kind: CatalogKind }) {
  const toast = useToast();
  const info = INFO[kind];
  const url = `/api/catalogs/${kind}`;
  const { data, error, mutate } = useApi<CatalogItem[]>(url);
  const [sheet, setSheet] = useState<{ item: CatalogItem | null } | null>(null);
  const [moving, setMoving] = useState(false);

  const move = async (index: number, delta: -1 | 1) => {
    if (!data || moving) return;
    const next = [...data];
    const j = index + delta;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    setMoving(true);
    try {
      // Se muestra el orden nuevo de inmediato y se confirma con lo que responde el servidor.
      await mutate(api.patch<CatalogItem[]>(url, { order: next.map(keyOf) }), { optimisticData: next, rollbackOnError: true, revalidate: false });
      refresh('/api/meta');
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setMoving(false);
    }
  };

  return (
    <Card title={info.title} blue action={<button type="button" className="btn-link" onClick={() => setSheet({ item: null })}>+ Agregar</button>}>
      <p className="t-small" style={{ marginBottom: 12 }}>{info.help}</p>
      {error && !data ? <ErrorNote error={error} retry={() => mutate()} />
        : !data ? <Skeleton rows={4} />
        : data.length === 0 ? <Empty>No hay elementos. Agrega el primero con &quot;+ Agregar&quot;.</Empty>
        : (
          <div className="stack sm">
            {data.map((it, i) => (
              <div key={keyOf(it)} className="row" style={{ gap: 8, padding: '8px 10px' }}>
                <div className="hstack" style={{ gap: 4, flex: 'none' }}>
                  <button type="button" className="btn-icon" style={{ width: 34, height: 40 }} disabled={i === 0 || moving} onClick={() => move(i, -1)} aria-label={`Subir ${it.name}`}>↑</button>
                  <button type="button" className="btn-icon" style={{ width: 34, height: 40 }} disabled={i === data.length - 1 || moving} onClick={() => move(i, 1)} aria-label={`Bajar ${it.name}`}>↓</button>
                </div>
                <div className="grow" style={{ opacity: it.active ? 1 : 0.6 }}>
                  <div className="t-strong" style={{ overflowWrap: 'anywhere', lineHeight: 1.3 }}>{it.name}</div>
                  {(it.default_duration_min !== undefined || !it.active) && (
                    <div className="t-small" style={{ marginTop: 3 }}>
                      {it.default_duration_min !== undefined ? `${it.default_duration_min} min` : ''}{it.default_duration_min !== undefined && !it.active ? ' · ' : ''}{!it.active ? 'No se ofrece en los selectores' : ''}
                    </div>
                  )}
                </div>
                {!it.active && <Badge>Inactivo</Badge>}
                <Button size="sm" onClick={() => setSheet({ item: it })} aria-label={`Editar ${it.name}`}>Editar</Button>
              </div>
            ))}
          </div>
        )}
      <ItemSheet kind={kind} open={!!sheet} onClose={() => setSheet(null)} item={sheet?.item ?? null} />
    </Card>
  );
}

// CFG-05 / AGE-06 · Catálogos que alimentan los selectores de toda la aplicación.
export function CatalogsTab() {
  return (
    <div className="grid-cards" style={{ alignItems: 'start', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))' }}>
      <CatalogCard kind="session-types" />
      <CatalogCard kind="study-types" />
      <CatalogCard kind="tags" />
    </div>
  );
}
