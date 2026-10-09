'use client';
import { useState } from 'react';
import { Button, Confirm, Empty, ErrorNote, Field, Input, Skeleton, useToast } from '@/components/ui';
import { ApiError, api, useApi } from '@/lib/client';
import type { Exercise } from './types';

/**
 * EXP-03 · Ejercicios del plan: lista como el mockup (barra azul, nombre, dosis) y modo edición para
 * agregar, corregir, subir o bajar y quitar. Quitar desactiva el ejercicio; no se borra del expediente.
 */
export function Exercises({ patientId }: { patientId: string }) {
  const toast = useToast();
  const url = `/api/patients/${patientId}/exercises`;
  const { data, error, isLoading, mutate } = useApi<Exercise[]>(url);
  const [editing, setEditing] = useState(false);
  const [rowEdit, setRowEdit] = useState<{ id: string; name: string; dosage: string } | null>(null);
  const [rowErr, setRowErr] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState({ name: '', dosage: '' });
  const [draftErr, setDraftErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Exercise | null>(null);
  const list = data ?? [];

  const fail = (e: unknown) => toast(e instanceof Error ? e.message : 'No se pudo guardar. Intenta de nuevo.', 'error');

  const add = async () => {
    if (!draft.name.trim()) { setDraftErr({ name: 'Escribe el nombre del ejercicio.' }); return; }
    setBusy('add');
    try {
      await api.post(url, { name: draft.name.trim(), dosage: draft.dosage.trim() });
      setDraft({ name: '', dosage: '' });
      setDraftErr({});
      await mutate();
      toast('Ejercicio agregado');
    } catch (e) {
      if (e instanceof ApiError && e.fields) setDraftErr(e.fields); else fail(e);
    } finally { setBusy(null); }
  };

  const saveRow = async () => {
    if (!rowEdit) return;
    if (!rowEdit.name.trim()) { setRowErr({ name: 'Escribe el nombre del ejercicio.' }); return; }
    setBusy(rowEdit.id);
    try {
      await api.patch(`${url}/${rowEdit.id}`, { name: rowEdit.name.trim(), dosage: rowEdit.dosage.trim() });
      setRowEdit(null);
      setRowErr({});
      await mutate();
      toast('Ejercicio actualizado');
    } catch (e) {
      if (e instanceof ApiError && e.fields) setRowErr(e.fields); else fail(e);
    } finally { setBusy(null); }
  };

  const move = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    setBusy('order');
    try {
      await mutate(api.post<Exercise[]>(`${url}/reorder`, { ids: next.map((e) => e.id) }), { optimisticData: next, rollbackOnError: true, revalidate: false });
    } catch (e) { fail(e); } finally { setBusy(null); }
  };

  const remove = async () => {
    if (!removing) return;
    try {
      await api.patch(`${url}/${removing.id}`, { active: false });
      setRemoving(null);
      await mutate();
      toast('Ejercicio quitado del plan');
    } catch (e) { fail(e); }
  };

  return (
    <div className="stack sm" style={{ marginTop: 14 }}>
      <div className="hstack between">
        <div className="t-label">Ejercicios{list.length ? ` · ${list.length}` : ''}</div>
        <button type="button" className="btn-link" onClick={() => { setEditing(!editing); setRowEdit(null); setDraftErr({}); }} aria-pressed={editing}>
          {editing ? 'Terminar edición' : 'Editar ejercicios'}
        </button>
      </div>

      {isLoading && !data && <Skeleton rows={2} height={44} />}
      {!data && <ErrorNote error={error} retry={() => mutate()} />}
      {data && !list.length && !editing && <Empty>Sin ejercicios en el plan. Usa “Editar ejercicios” para agregar el primero.</Empty>}

      {list.map((ex, i) => rowEdit?.id === ex.id ? (
        <div key={ex.id} className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="grid-form" style={{ flex: '1 1 240px', minWidth: 0 }}>
          <Field label="Ejercicio" error={rowErr.name}>
            <Input value={rowEdit.name} onChange={(e) => setRowEdit({ ...rowEdit, name: e.target.value })} invalid={!!rowErr.name} maxLength={120} autoFocus
              onKeyDown={(e) => e.key === 'Enter' && saveRow()} />
          </Field>
          <Field label="Dosis" error={rowErr.dosage}>
            <Input value={rowEdit.dosage} onChange={(e) => setRowEdit({ ...rowEdit, dosage: e.target.value })} invalid={!!rowErr.dosage} maxLength={120} placeholder="3 × 12"
              onKeyDown={(e) => e.key === 'Enter' && saveRow()} />
          </Field>
          </div>
          <div className="hstack">
            <Button size="sm" onClick={() => { setRowEdit(null); setRowErr({}); }}>Cancelar</Button>
            <Button size="sm" variant="primary" loading={busy === ex.id} onClick={saveRow}>Guardar</Button>
          </div>
        </div>
      ) : (
        <div key={ex.id} className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="bar" />
          <div style={{ flex: '1 1 150px', minWidth: 0 }}>
            <div className="t-strong" style={{ overflowWrap: 'anywhere' }}>{ex.name}</div>
            {ex.dosage && <div className="t-small" style={{ overflowWrap: 'anywhere' }}>{ex.dosage}</div>}
          </div>
          {editing && (
            <div className="hstack" style={{ gap: 6, marginLeft: 'auto' }}>
              <button type="button" className="btn-icon" onClick={() => move(i, -1)} disabled={i === 0 || busy === 'order'} aria-label={`Subir ${ex.name}`} title="Subir">↑</button>
              <button type="button" className="btn-icon" onClick={() => move(i, 1)} disabled={i === list.length - 1 || busy === 'order'} aria-label={`Bajar ${ex.name}`} title="Bajar">↓</button>
              <Button size="sm" onClick={() => { setRowEdit({ id: ex.id, name: ex.name, dosage: ex.dosage }); setRowErr({}); }} aria-label={`Editar ${ex.name}`}>Editar</Button>
              <Button size="sm" variant="danger" onClick={() => setRemoving(ex)} aria-label={`Quitar ${ex.name}`}>Quitar</Button>
            </div>
          )}
        </div>
      ))}

      {editing && data && (
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="grid-form" style={{ flex: '1 1 240px', minWidth: 0 }}>
          <Field label="Nuevo ejercicio" error={draftErr.name}>
            <Input value={draft.name} onChange={(e) => { setDraft({ ...draft, name: e.target.value }); setDraftErr({}); }} invalid={!!draftErr.name} maxLength={120}
              placeholder="Ej. Puente de glúteo" onKeyDown={(e) => e.key === 'Enter' && add()} />
          </Field>
          <Field label="Dosis" error={draftErr.dosage}>
            <Input value={draft.dosage} onChange={(e) => setDraft({ ...draft, dosage: e.target.value })} invalid={!!draftErr.dosage} maxLength={120}
              placeholder="3 × 12 · diario" onKeyDown={(e) => e.key === 'Enter' && add()} />
          </Field>
          </div>
          <Button variant="primary" loading={busy === 'add'} onClick={add}>Agregar</Button>
        </div>
      )}

      <Confirm open={!!removing} onClose={() => setRemoving(null)} onConfirm={remove} danger title="Quitar ejercicio" confirmLabel="Quitar"
        message={removing ? <>Se quitará <b>{removing.name}</b> del plan del paciente. Queda en el historial del expediente.</> : null} />
    </div>
  );
}
