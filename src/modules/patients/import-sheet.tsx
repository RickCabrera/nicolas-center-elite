'use client';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Checkbox, Notice, Sheet, useToast } from '@/components/ui';
import { api, ApiError, refresh } from '@/lib/client';
import { IMPORT_COLUMNS, toCsv } from './csv';
import type { ImportPreview } from './types';

const SAMPLE: string[][] = [
  [...IMPORT_COLUMNS],
  ['Ana López Hernández', '12/04/1988', 'F', '271 123 4567', 'ana@correo.com', 'Av. 1 No. 20, Centro, Córdoba', '', 'Pedro López', '271 765 4321', '', '', '', 'Córdoba', 'usuario.del.fisio', 'Mensual Elite', 'Esguince de tobillo grado II', 'Deportista'],
  ['Luis Pérez Ramos', '03/09/2015', 'M', '', '', 'Calle 5 No. 8, Orizaba', '', 'Rosa Ramos', '272 111 2233', 'Rosa Ramos', 'Madre', '272 111 2233', 'Orizaba', 'usuario.del.fisio', 'Paquete 10 sesiones', 'Pie plano, dolor al correr', 'Deportista|Post-quirúrgico'],
];
const MAX_SHOWN = 150;

/** Lee el archivo como UTF-8; si no lo es (Excel suele guardar en Windows-1252), lo reinterpreta. */
async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

function downloadTemplate() {
  const blob = new Blob(['﻿' + toCsv(SAMPLE)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'plantilla-pacientes.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** PAC-09 · Hoja "Importar pacientes" (solo dueño): archivo → vista previa con errores por fila → importar. */
export function ImportPatientsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [skip, setSkip] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setFileName(''); setCsv(''); setPreview(null); setSkip(false); setError(''); setBusy(null); }
  }, [open]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name); setPreview(null); setSkip(false); setError(''); setCsv('');
    if (file.size > 3_000_000) { setError('El archivo es demasiado grande. Divídelo en partes de hasta 2,000 pacientes.'); return; }
    setBusy('preview');
    try {
      const text = await readText(file);
      setCsv(text);
      setPreview(await api.post<ImportPreview>('/api/patients/import', { csv: text, commit: false }));
    } catch (err) {
      setError((err as ApiError).message || 'No se pudo leer el archivo.');
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';   // permite volver a elegir el mismo archivo ya corregido
    }
  };

  const commit = async () => {
    if (!preview || busy) return;
    setBusy('commit'); setError('');
    try {
      const r = await api.post<{ inserted: number }>('/api/patients/import', { csv, commit: true, skip_invalid: skip });
      toast(`${r.inserted} ${r.inserted === 1 ? 'paciente importado' : 'pacientes importados'}`);
      refresh('/api/patients');
      onClose();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(null);
    }
  };

  const bad = preview?.rows.filter((r) => !r.ok) ?? [];
  const good = preview?.rows.filter((r) => r.ok) ?? [];
  const shown = [...bad, ...good].slice(0, MAX_SHOWN);   // primero las filas con error
  const canImport = !!preview && preview.valid > 0 && (preview.invalid === 0 || skip);

  return (
    <Sheet open={open} onClose={onClose} title="Importar pacientes" wide>
      <div className="stack md">
        <div className="t-body">
          Sube un archivo CSV con un paciente por fila. Antes de guardar verás una vista previa con los errores de cada fila.
        </div>
        <div className="hstack wrap">
          <input ref={input} type="file" accept=".csv,text/csv,text/plain" hidden
            onChange={(e) => pick(e.target.files?.[0])} />
          <Button variant="gold" loading={busy === 'preview'} onClick={() => input.current?.click()}>
            {fileName ? 'Elegir otro archivo' : 'Elegir archivo CSV'}
          </Button>
          <button type="button" className="btn-link" onClick={downloadTemplate}>Descargar plantilla de ejemplo</button>
        </div>
        {fileName && <div className="t-small ellipsis">Archivo: {fileName}</div>}
        {!preview && !error && (
          <div className="t-small">
            Columnas: {IMPORT_COLUMNS.join(', ')}. Obligatorias: nombre, fecha_nacimiento (DD/MM/AAAA), sede y fisioterapeuta
            (su usuario o su nombre). En menores de edad también los datos del tutor. Las etiquetas se separan con «|». Máximo 2,000 filas.
          </div>
        )}
        {error && <Notice tone="red"><span role="alert">{error}</span></Notice>}

        {preview && (
          <>
            <div className="hstack wrap" aria-live="polite">
              <Badge tone="green">{preview.valid} {preview.valid === 1 ? 'válida' : 'válidas'}</Badge>
              {preview.invalid > 0 && <Badge tone="red">{preview.invalid} con error</Badge>}
            </div>
            {preview.invalid > 0 && (
              <Notice tone="gold">
                <div className="stack sm">
                  <span>Corrige el archivo y vuelve a subirlo, o importa solo las filas válidas.</span>
                  {preview.valid > 0 && (
                    <Checkbox checked={skip} onChange={(e) => setSkip(e.target.checked)}
                      label={`Omitir ${preview.invalid === 1 ? 'la fila con error' : `las ${preview.invalid} filas con error`}`} />
                  )}
                </div>
              </Notice>
            )}
            <div className="table-wrap" style={{ maxHeight: '42vh', overflowY: 'auto' }}>
              <table className="table">
                <thead>
                  <tr><th className="num">Línea</th><th>Paciente</th><th>Nacimiento</th><th>Sede</th><th>Fisioterapeuta</th><th>Membresía</th></tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.line} style={r.ok ? undefined : { background: 'rgba(255, 107, 107, .08)' }}>
                      <td className="num">{r.line}</td>
                      <td style={{ minWidth: 200 }}>
                        <div className="t-strong" style={{ overflowWrap: 'anywhere' }}>{r.data.full_name || '(sin nombre)'}</div>
                        {r.errors.map((m, i) => <div key={i} className="red" style={{ marginTop: 4, fontSize: 12.5, overflowWrap: 'anywhere' }}>{m}</div>)}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.data.birth_date || '—'}</td>
                      <td>{r.data.location_name || '—'}</td>
                      <td>{r.data.therapist_name || '—'}</td>
                      <td>{r.data.plan_name || 'Sin membresía'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.rows.length > shown.length && (
              <div className="t-small">Se muestran {shown.length} de {preview.rows.length} filas (primero las que tienen error).</div>
            )}
          </>
        )}
      </div>
      <div className="sheet-foot">
        <Button size="lg" onClick={onClose}>Cancelar</Button>
        <Button size="lg" variant="primary" style={{ flex: 2 }} disabled={!canImport} loading={busy === 'commit'} onClick={commit}>
          {preview ? `Importar ${preview.valid} ${preview.valid === 1 ? 'paciente' : 'pacientes'}` : 'Importar pacientes'}
        </Button>
      </div>
    </Sheet>
  );
}
