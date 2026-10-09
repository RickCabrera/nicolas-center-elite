'use client';
/**
 * EST-02 · Hoja "Subir estudio": subida real en tres pasos (registrar → subir directo al almacenamiento
 * con el boleto → confirmar). EST-05 · Antes de subir se genera la miniatura en el navegador.
 */
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { PatientPicker, useMeta } from '@/components/meta';
import { Button, Field, Input, Notice, Select, Sheet, useToast } from '@/components/ui';
import { api, ApiError, refresh } from '@/lib/client';
import { todayIso } from '@/lib/dates';
import { fileSize } from '@/lib/format';
import { uploadWithTicket } from '@/lib/upload-client';
import { baseName, fileProblem, formatLabel, STUDY_ACCEPT, STUDY_FORMATS_LABEL, STUDY_MAX_BYTES, studyMime } from './file-rules';
import { makeThumbnail } from './thumbs';
import type { CreatedStudy } from './types';

export function UploadStudySheet({ open, onClose, patientId, onDone }: { open: boolean; onClose: () => void; patientId?: string; onDone?: () => void }) {
  const { meta } = useMeta();
  const toast = useToast();
  const [patient, setPatient] = useState(patientId ?? '');
  const [type, setType] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayIso());
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const autoTitle = useRef('');       // último título puesto automáticamente (para no pisar lo que escribió la persona)
  const pickInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setPatient(patientId ?? '');
    setType('');
    setTitle('');
    setDate(todayIso());
    setFile(null);
    setErrors({});
    setFailure(null);
    setDragging(false);
    setBusy(false);
    setProgress(0);
    setStage('');
    autoTitle.current = '';
  }, [open, patientId]);

  // Mientras sube no se cierra (ni con Escape, que la hoja registra una sola vez al abrir).
  const busyRef = useRef(false);
  busyRef.current = busy;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const close = useCallback(() => { if (!busyRef.current) closeRef.current(); }, []);

  const clearError = (k: string) => setErrors((e) => (e[k] ? { ...e, [k]: '' } : e));
  const choose = (f: File | null | undefined) => {
    if (!f || busy) return;
    setFailure(null);
    const problem = fileProblem(f);
    if (problem) {
      setFile(null);
      setErrors((e) => ({ ...e, file: problem }));
      return;
    }
    setFile(f);
    clearError('file');
    // El nombre se prellena con el del archivo, salvo que ya se haya escrito otro a mano.
    setTitle((current) => {
      if (current.trim() && current !== autoTitle.current) return current;
      autoTitle.current = baseName(f.name).replace(/[_]+/g, ' ').slice(0, 160);
      return autoTitle.current;
    });
    clearError('title');
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    choose(e.dataTransfer.files?.[0]);
  };

  const types = (meta?.study_types ?? []).filter((t) => t.active);
  const today = todayIso();

  const submit = async () => {
    if (busy) return;
    const errs: Record<string, string> = {};
    if (!patient) errs.patient_id = 'Selecciona un paciente.';
    if (!type) errs.type_name = 'Selecciona el tipo de estudio.';
    if (!title.trim()) errs.title = 'Escribe el nombre del estudio.';
    if (!date) errs.study_date = 'Elige la fecha del estudio.';
    else if (date > today) errs.study_date = 'La fecha del estudio no puede ser futura.';
    if (!file) errs.file = 'Elige el archivo que vas a subir.';
    else { const p = fileProblem(file); if (p) errs.file = p; }
    setErrors(errs);
    setFailure(null);
    if (Object.keys(errs).length || !file) return;

    setBusy(true);
    setProgress(0);
    setStage('Preparando el archivo…');
    try {
      const mime = studyMime(file.name, file.type)!;
      const thumb = await makeThumbnail(file, mime);
      const created = await api.post<CreatedStudy>('/api/studies', {
        patient_id: patient, type_name: type, title: title.trim(), file_name: file.name, mime: file.type || undefined,
        size_bytes: file.size, study_date: date, with_thumb: !!thumb,
      });
      setStage('Subiendo…');
      await uploadWithTicket(created.upload, file, (f) => setProgress(Math.min(f, 1) * 0.94));
      setProgress(0.95);
      if (thumb && created.thumb_upload) {
        // La miniatura es opcional: si falla, el estudio se guarda igual y la tarjeta muestra el mosaico.
        await uploadWithTicket(created.thumb_upload, thumb).catch(() => {});
      }
      setProgress(0.98);
      setStage('Verificando…');
      await api.post(`/api/studies/${created.study.id}/complete`);
      setProgress(1);
      toast(`Estudio subido · ${title.trim()}`);
      refresh('/api/studies');
      onDone?.();
      busyRef.current = false;
      closeRef.current();
    } catch (e) {
      if (e instanceof ApiError && e.fields && Object.keys(e.fields).length) setErrors(e.fields);
      setFailure((e as Error).message || 'No se pudo subir el estudio. Intenta de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  const pct = Math.round(progress * 100);
  return (
    <Sheet open={open} onClose={close} title="Subir estudio"
      footer={<>
        <Button size="lg" onClick={close} disabled={busy}>Cancelar</Button>
        <Button size="lg" variant="primary" loading={busy} onClick={submit} style={{ flex: 2 }}>{busy ? 'Subiendo' : 'Subir'}</Button>
      </>}>
      <form className="stack md" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <div className="grid-form">
          {!patientId && (
            <Field label="Paciente" error={errors.patient_id}>
              <PatientPicker value={patient} onChange={(id) => { setPatient(id); clearError('patient_id'); }} invalid={!!errors.patient_id} />
            </Field>
          )}
          <Field label="Tipo de estudio" error={errors.type_name}>
            <Select value={type} onChange={(e) => { setType(e.target.value); clearError('type_name'); }} invalid={!!errors.type_name} disabled={busy}>
              <option value="">{meta ? 'Selecciona el tipo' : 'Cargando…'}</option>
              {types.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
            </Select>
          </Field>
          {patientId && (
            <Field label="Fecha del estudio" error={errors.study_date}>
              <Input type="date" value={date} max={today} onChange={(e) => { setDate(e.target.value); clearError('study_date'); }} invalid={!!errors.study_date} disabled={busy} />
            </Field>
          )}
        </div>
        <div className="grid-form">
          <Field label="Nombre del estudio" error={errors.title}>
            <Input value={title} onChange={(e) => { setTitle(e.target.value); clearError('title'); }} placeholder="Ej. Rx rodilla izquierda"
              invalid={!!errors.title} maxLength={160} disabled={busy} />
          </Field>
          {!patientId && (
            <Field label="Fecha del estudio" error={errors.study_date}>
              <Input type="date" value={date} max={today} onChange={(e) => { setDate(e.target.value); clearError('study_date'); }} invalid={!!errors.study_date} disabled={busy} />
            </Field>
          )}
        </div>

        <div role="group" aria-label="Archivo del estudio"
          onDragEnter={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = busy ? 'none' : 'copy'; }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
          onDrop={onDrop}
          style={{
            marginTop: 2, padding: file ? 14 : '20px 16px', borderRadius: 12, textAlign: 'center', transition: 'border-color .15s, background .15s',
            border: `1px dashed ${errors.file ? 'var(--red)' : dragging ? 'var(--blue)' : 'var(--line)'}`,
            background: dragging ? 'rgba(46, 155, 255, .09)' : 'transparent',
          }}>
          {file ? (
            <div className="hstack" style={{ gap: 12, textAlign: 'left' }}>
              <span className="pill blue" style={{ flex: 'none' }}>{formatLabel(studyMime(file.name, file.type) ?? '', file.name)}</span>
              <div className="grow">
                <div className="t-strong ellipsis" title={file.name}>{file.name}</div>
                <div className="t-mono dim" style={{ marginTop: 5 }}>{fileSize(file.size)}</div>
              </div>
              {!busy && <button type="button" className="btn-link" onClick={() => { setFile(null); pickInput.current?.focus(); }}>Quitar</button>}
            </div>
          ) : (
            <>
              <div className="t-sub">{dragging ? 'Suelta el archivo para elegirlo' : 'Arrastra el archivo aquí'}</div>
              <div className="t-label" style={{ marginTop: 6, color: 'var(--ink-5)' }}>{STUDY_FORMATS_LABEL} · hasta {STUDY_MAX_BYTES / 1024 / 1024} MB</div>
            </>
          )}
          {!busy && (
            <div className="hstack wrap" style={{ justifyContent: 'center', marginTop: 14 }}>
              <Button size="sm" onClick={() => pickInput.current?.click()}>{file ? 'Cambiar archivo' : 'Elegir archivo'}</Button>
              <Button size="sm" onClick={() => cameraInput.current?.click()}>Tomar foto</Button>
            </div>
          )}
          {busy && (
            <div style={{ marginTop: 14, textAlign: 'left' }}>
              <div className="hstack between">
                <span className="t-small" aria-live="polite">{stage}</span>
                <span className="t-mono blue">{pct} %</span>
              </div>
              <div role="progressbar" aria-label="Progreso de la subida" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
                style={{ marginTop: 8, height: 8, borderRadius: 999, background: 'rgba(255, 255, 255, .1)', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, var(--blue-deep), var(--blue-hi))', boxShadow: '0 0 12px rgba(46, 155, 255, .7)', transition: 'width .2s ease' }} />
              </div>
            </div>
          )}
        </div>
        {errors.file && <div role="alert" style={{ font: '500 12.5px/1.35 var(--f-body)', color: 'var(--red)', marginTop: -4 }}>{errors.file}</div>}
        {failure && failure !== errors.file && <Notice tone="red">{failure}</Notice>}

        <input ref={pickInput} type="file" accept={STUDY_ACCEPT} className="sr-only" tabIndex={-1} aria-label="Elegir archivo"
          onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-label="Tomar foto"
          onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
