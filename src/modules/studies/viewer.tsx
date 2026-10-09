'use client';
/**
 * EST-04 · Visor de estudios: imagen con zoom, PDF en línea y DICOM básico con ventana/nivel.
 * EST-01 · El archivo se pide con la URL firmada (5 min) que entrega GET /api/studies/[id]; cada apertura
 *          y cada descarga quedan en la bitácora. EST-06 · El dueño puede archivar o restaurar desde aquí.
 */
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useMeta } from '@/components/meta';
import { Button, Chip, Confirm, ErrorNote, Field, Input, KV, Notice, Select, Sheet, Skeleton, useToast } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { api, ApiError, refresh } from '@/lib/client';
import { fmtDate, fmtDateTime, todayIso } from '@/lib/dates';
import { fileSize } from '@/lib/format';
import type { DicomImage, DicomResult } from './dicom';
import { formatLabel, kindOf } from './file-rules';
import type { Study, StudyDetail } from './types';

const STAGE: CSSProperties = {
  position: 'relative', height: 'min(58vh, 540px)', minHeight: 240, background: '#06080c',
  border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden',
};
const CENTER: CSSProperties = { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, textAlign: 'center' };

// En desarrollo React monta dos veces: se comparte la misma petición para no duplicar el acceso en la bitácora.
const inflight = new Map<string, { at: number; promise: Promise<StudyDetail> }>();
function fetchDetail(id: string, fresh = false): Promise<StudyDetail> {
  const hit = inflight.get(id);
  if (!fresh && hit && Date.now() - hit.at < 1500) return hit.promise;
  const promise = api.get<StudyDetail>(`/api/studies/${id}`);
  inflight.set(id, { at: Date.now(), promise });
  return promise;
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'same-origin' });
  } catch {
    throw new Error('Sin conexión. No se pudo descargar el archivo.');
  }
  if (res.status === 403) throw new Error('El enlace del archivo caducó.');
  if (!res.ok) throw new Error('No se pudo descargar el archivo.');
  return res.arrayBuffer();
}

function StageMessage({ children }: { children: ReactNode }) {
  return <div style={CENTER}><div className="t-sub" style={{ maxWidth: 420 }}>{children}</div></div>;
}
function StageLoading({ label }: { label: string }) {
  return <div style={CENTER} aria-busy="true"><span className="spinner" aria-hidden="true" style={{ color: 'var(--blue)' }} /><span className="t-sub" style={{ marginLeft: 10 }}>{label}</span></div>;
}

// ───────── imagen con zoom básico ─────────
function ImageViewer({ url, alt, onRetry }: { url: string; alt: string; onRetry: () => void }) {
  const img = useRef<HTMLImageElement>(null);
  const [zoom, setZoom] = useState<number | null>(null); // null = ajustada al visor
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const step = (factor: number) => {
    const el = img.current;
    if (!el || !natural) return;
    const current = zoom ?? el.clientWidth / natural.w;
    setZoom(Math.min(8, Math.max(0.05, current * factor)));
  };
  if (failed) {
    return (
      <div style={STAGE}>
        <StageMessage>No se pudo cargar la imagen. <button type="button" className="btn-link" onClick={onRetry} style={{ marginLeft: 6 }}>Reintentar</button></StageMessage>
      </div>
    );
  }
  return (
    <div className="stack sm">
      <div style={{ ...STAGE, overflow: 'auto', display: 'flex' }} tabIndex={0} aria-label="Imagen del estudio">
        { }
        <img ref={img} src={url} alt={alt} draggable={false}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          onError={() => setFailed(true)}
          style={zoom === null || !natural
            ? { margin: 'auto', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }
            : { margin: 'auto', flex: 'none', width: Math.round(natural.w * zoom), height: 'auto', maxWidth: 'none' }} />
        {!natural && <StageLoading label="Cargando imagen…" />}
      </div>
      <div className="hstack wrap" role="group" aria-label="Zoom">
        <button type="button" className="btn-icon" onClick={() => step(1 / 1.25)} disabled={!natural} aria-label="Alejar">−</button>
        <button type="button" className="btn-icon" onClick={() => step(1.25)} disabled={!natural} aria-label="Acercar">+</button>
        <Button size="sm" onClick={() => setZoom(null)} disabled={zoom === null}>Ajustar</Button>
        <span className="t-mono dim" aria-live="polite" style={{ marginLeft: 4 }}>{zoom === null ? 'Ajustada' : `${Math.round(zoom * 100)} %`}</span>
      </div>
    </div>
  );
}

// ───────── PDF en línea ─────────
function PdfViewer({ url, title, onRetry }: { url: string; title: string; onRetry: () => void }) {
  // El PDF se descarga con la URL firmada y se muestra desde memoria (blob:). Así el visor funciona igual
  // con el almacenamiento local y con el de producción, y el enlace "abrir en pestaña" no caduca a los 5 minutos.
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    setBlobUrl(null);
    setError(null);
    fetchBytes(url)
      .then((buf) => {
        if (!alive) return;
        made = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
        setBlobUrl(made);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [url]);
  return (
    <div className="stack sm">
      <div style={{ ...STAGE, background: '#1a1d22' }}>
        {error ? (
          <StageMessage>{error} <button type="button" className="btn-link" onClick={onRetry} style={{ marginLeft: 6 }}>Reintentar</button></StageMessage>
        ) : !blobUrl ? (
          <StageLoading label="Cargando documento…" />
        ) : (
          <object data={blobUrl} type="application/pdf" aria-label={title} style={{ width: '100%', height: '100%', display: 'block' }}>
            <StageMessage>Este navegador no muestra PDF dentro de la página. Ábrelo en una pestaña nueva.</StageMessage>
          </object>
        )}
      </div>
      <div className="hstack wrap">
        {blobUrl
          ? <a className="btn sm" href={blobUrl} target="_blank" rel="noopener noreferrer">Abrir en pestaña nueva</a>
          : <Button size="sm" disabled>Abrir en pestaña nueva</Button>}
        <span className="t-small">Si el documento no se ve aquí, ábrelo en una pestaña nueva.</span>
      </div>
    </div>
  );
}

// ───────── DICOM básico ─────────
const RANGE: CSSProperties = { width: '100%', minHeight: 32, accentColor: 'var(--blue)', cursor: 'pointer' };

function DicomViewer({ url, onRetry }: { url: string; onRetry: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const lib = useRef<typeof import('./dicom') | null>(null);
  const [result, setResult] = useState<DicomResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState({ center: 0, width: 1, invert: false });

  useEffect(() => {
    let alive = true;
    setResult(null);
    setError(null);
    (async () => {
      try {
        // dicom-parser solo se carga en el navegador y solo cuando se abre un DICOM.
        const [buf, mod] = await Promise.all([fetchBytes(url), import('./dicom')]);
        if (!alive) return;
        lib.current = mod;
        const r = mod.decodeDicom(buf);
        if (r.ok) setView({ center: r.image.windowCenter, width: r.image.windowWidth, invert: false });
        setResult(r);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'No se pudo abrir el estudio.');
      }
    })();
    return () => { alive = false; };
  }, [url]);

  const image: DicomImage | null = result?.ok ? result.image : null;
  useEffect(() => {
    const el = canvas.current;
    if (!image || !el || !lib.current) return;
    const raf = requestAnimationFrame(() => {
      const ctx = el.getContext('2d');
      if (!ctx || !lib.current) return;
      const data = ctx.createImageData(image.cols, image.rows);
      data.data.set(lib.current.renderDicom(image, view));
      ctx.putImageData(data, 0, 0);
    });
    return () => cancelAnimationFrame(raf);
  }, [image, view]);

  if (error) {
    return <div style={STAGE}><StageMessage>{error} <button type="button" className="btn-link" onClick={onRetry} style={{ marginLeft: 6 }}>Reintentar</button></StageMessage></div>;
  }
  if (!result) return <div style={STAGE}><StageLoading label="Abriendo estudio DICOM…" /></div>;

  const header = result.ok ? result.image : result.header;
  const facts = [
    header?.modality && `Modalidad ${header.modality}`,
    header?.patientName && `Paciente en el archivo: ${header.patientName}`,
    image && `${image.cols} × ${image.rows} px`,
    image && `${image.bitsStored} bits`,
    image && image.frames > 1 && `Cuadro 1 de ${image.frames}`,
  ].filter(Boolean) as string[];

  if (!image) {
    return (
      <div className="stack sm">
        <div style={{ ...STAGE, height: 'auto', minHeight: 180 }}>
          <div style={{ ...CENTER, position: 'static', minHeight: 180 }}>
            <div style={{ maxWidth: 440 }}>
              <div className="t-strong">{result.ok ? '' : result.message}.</div>
              <div className="t-sub" style={{ marginTop: 8 }}>Descárgalo para abrirlo en un visor DICOM completo.</div>
            </div>
          </div>
        </div>
        {facts.length > 0 && <div className="t-small">{facts.join(' · ')}</div>}
      </div>
    );
  }

  // Deslizadores "naturales": más brillo = nivel (centro) más bajo; más contraste = ventana más angosta.
  const span = Math.max(image.max - image.min, 1);
  const cMin = image.min - span * 0.25, cMax = image.max + span * 0.25;
  const wMin = Math.max(span / 400, image.values ? 0.01 : 1), wMax = span * 2;
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  const brightness = clamp(cMin + cMax - view.center, cMin, cMax);
  const contrast = clamp(wMin + wMax - view.width, wMin, wMax);
  const fmt = (v: number) => (Math.abs(v) >= 100 || Number.isInteger(v) ? Math.round(v).toString() : v.toFixed(1));
  const gray = !!image.values;
  const changed = view.invert || view.center !== image.windowCenter || view.width !== image.windowWidth;

  return (
    <div className="stack sm">
      <div style={{ ...STAGE, display: 'flex', background: '#000' }}>
        <canvas ref={canvas} width={image.cols} height={image.rows} role="img" aria-label="Imagen DICOM"
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
      </div>
      {facts.length > 0 && <div className="t-small">{facts.join(' · ')}</div>}
      <div className="grid-form" style={{ alignItems: 'end' }}>
        {gray && (
          <>
            <label className="field">
              <span>Brillo · nivel {fmt(view.center)}</span>
              <input type="range" style={RANGE} min={cMin} max={cMax} step="any" value={brightness}
                onChange={(e) => setView((v) => ({ ...v, center: cMin + cMax - Number(e.target.value) }))} />
            </label>
            <label className="field">
              <span>Contraste · ventana {fmt(view.width)}</span>
              <input type="range" style={RANGE} min={wMin} max={wMax} step="any" value={contrast}
                onChange={(e) => setView((v) => ({ ...v, width: Math.max(wMin + wMax - Number(e.target.value), wMin) }))} />
            </label>
          </>
        )}
        <div className="hstack wrap">
          <Chip on={view.invert} onClick={() => setView((v) => ({ ...v, invert: !v.invert }))}>Invertir</Chip>
          <Button size="sm" disabled={!changed} onClick={() => setView({ center: image.windowCenter, width: image.windowWidth, invert: false })}>Restablecer</Button>
        </div>
      </div>
    </div>
  );
}

// ───────── corregir metadatos (PATCH) ─────────
function EditStudySheet({ study, open, onClose, onSaved }: { study: Study; open: boolean; onClose: () => void; onSaved: (s: Study) => void }) {
  const { meta } = useMeta();
  const toast = useToast();
  const [title, setTitle] = useState(study.title);
  const [type, setType] = useState(study.type_name);
  const [date, setDate] = useState(study.study_date);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setTitle(study.title); setType(study.type_name); setDate(study.study_date); setErrors({}); }
  }, [open, study]);
  const types = (meta?.study_types ?? []).filter((t) => t.active || t.name === study.type_name).map((t) => t.name);
  if (!types.includes(study.type_name)) types.unshift(study.type_name);

  const save = async () => {
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = 'Escribe el nombre del estudio.';
    if (!date) errs.study_date = 'Elige la fecha del estudio.';
    else if (date > todayIso()) errs.study_date = 'La fecha del estudio no puede ser futura.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const saved = await api.patch<Study>(`/api/studies/${study.id}`, { title: title.trim(), type_name: type, study_date: date });
      toast('Datos del estudio actualizados');
      refresh('/api/studies');
      onSaved(saved);
    } catch (e) {
      const err = e as ApiError;
      setErrors(err.fields && Object.keys(err.fields).length ? err.fields : { _: err.message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Corregir datos del estudio"
      footer={<><Button onClick={onClose} disabled={busy}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save} style={{ flex: 2 }}>Guardar</Button></>}>
      <form className="stack md" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label="Nombre del estudio" error={errors.title}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} invalid={!!errors.title} maxLength={160} />
        </Field>
        <div className="grid-form">
          <Field label="Tipo de estudio" error={errors.type_name}>
            <Select value={type} onChange={(e) => setType(e.target.value)} invalid={!!errors.type_name}>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Fecha del estudio" error={errors.study_date}>
            <Input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} invalid={!!errors.study_date} />
          </Field>
        </div>
        {errors._ && <Notice tone="red">{errors._}</Notice>}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

// ───────── hoja del visor ─────────
/**
 * Visor en hoja ancha. `studyId` null = cerrado. `patientLink` muestra "Ver expediente"
 * (se apaga cuando el visor ya está dentro del expediente del paciente).
 */
export function StudyViewer({ studyId, onClose, patientLink = true }: { studyId: string | null; onClose: () => void; patientLink?: boolean }) {
  const user = useUser();
  const toast = useToast();
  const [detail, setDetail] = useState<StudyDetail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback((id: string, fresh = false) => {
    let alive = true;
    setError(null);
    fetchDetail(id, fresh)
      .then((d) => { if (alive) { setDetail(d); setLoadedAt(Date.now()); } })
      .catch((e: ApiError) => { if (alive) { setDetail(null); setError(e); } });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    setDetail(null);
    setError(null);
    setEditing(false);
    setArchiving(false);
    if (!studyId) return;
    return load(studyId);
  }, [studyId, load]);

  // La hoja registra Escape una sola vez al abrir: con refs, Escape cierra primero la hoja hija (editar/archivar).
  const childOpen = useRef(false);
  childOpen.current = editing || archiving;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const close = useCallback(() => { if (!childOpen.current) closeRef.current(); }, []);

  const reload = () => { if (studyId) { setDetail(null); load(studyId, true); } };

  // EST-01 · La URL de descarga dura 5 minutos: si ya pasó tiempo se pide una nueva (y queda en la bitácora).
  const download = async () => {
    if (!detail) return;
    setDownloading(true);
    try {
      const fresh = Date.now() - loadedAt < 4 * 60 * 1000 ? detail : await fetchDetail(detail.id, true);
      const a = document.createElement('a');
      a.href = fresh.download_url;
      a.download = detail.file_name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      toast((e as Error).message || 'No se pudo descargar el archivo.', 'error');
    } finally {
      setDownloading(false);
    }
  };

  const archive = async (reason: string) => {
    if (!detail) return;
    try {
      await api.post(`/api/studies/${detail.id}/archive`, { reason });
      toast('Estudio archivado');
      refresh('/api/studies');
      setArchiving(false);
      closeRef.current();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const restore = async () => {
    if (!detail) return;
    setRestoring(true);
    try {
      const s = await api.post<Study>(`/api/studies/${detail.id}/archive`, { restore: true });
      setDetail({ ...detail, ...s });
      toast('Estudio restaurado');
      refresh('/api/studies');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setRestoring(false);
    }
  };

  const kind = detail ? kindOf(detail.mime) : null;
  return (
    <>
      <Sheet open={!!studyId} onClose={close} title={detail?.title ?? 'Estudio'} wide>
        {error ? (
          <ErrorNote error={error} retry={error.status === 404 ? undefined : reload} />
        ) : !detail ? (
          <Skeleton rows={1} height={320} />
        ) : (
          <div className="stack">
            {detail.archived_at && (
              <Notice tone="gold">
                Archivado el {fmtDate(detail.archived_at)}{detail.archived_by_name ? ` por ${detail.archived_by_name}` : ''}.
                {detail.archive_reason ? ` Motivo: ${detail.archive_reason}` : ''}
              </Notice>
            )}
            {kind === 'image' && <ImageViewer key={detail.file_url} url={detail.file_url} alt={detail.title} onRetry={reload} />}
            {kind === 'pdf' && <PdfViewer url={detail.file_url} title={detail.title} onRetry={reload} />}
            {kind === 'dicom' && <DicomViewer url={detail.file_url} onRetry={reload} />}

            <div className="grid-kv">
              <KV label="Paciente">{detail.patient_name}</KV>
              <KV label="Tipo">{detail.type_name}</KV>
              <KV label="Fecha del estudio">{fmtDate(detail.study_date)}</KV>
              <KV label="Tamaño">{fileSize(detail.size_bytes)} · {formatLabel(detail.mime, detail.file_name)}</KV>
              <KV label="Subido por">{detail.uploaded_by_name || '—'}</KV>
              <KV label="Subido el">{fmtDateTime(detail.created_at)}</KV>
            </div>
            <div className="t-small" style={{ overflowWrap: 'anywhere' }}>Archivo original: {detail.file_name}</div>

            <div className="hstack wrap">
              <Button variant="primary" loading={downloading} onClick={download}>Descargar</Button>
              {patientLink && <Link className="btn" href={`/pacientes/${detail.patient_id}?tab=estudios`} onClick={() => closeRef.current()}>Ver expediente</Link>}
              <Button onClick={() => setEditing(true)}>Corregir datos</Button>
              {user.isOwner && (detail.archived_at
                ? <Button variant="success" loading={restoring} onClick={restore}>Restaurar</Button>
                : <Button variant="danger" onClick={() => setArchiving(true)}>Archivar</Button>)}
            </div>
          </div>
        )}
      </Sheet>
      {detail && (
        <>
          <EditStudySheet study={detail} open={editing} onClose={() => setEditing(false)}
            onSaved={(s) => { setDetail({ ...detail, ...s }); setEditing(false); }} />
          <Confirm open={archiving} onClose={() => setArchiving(false)} onConfirm={archive} danger reason="required"
            title="Archivar estudio" confirmLabel="Archivar" reasonLabel="Motivo para archivar"
            message={<>«{detail.title}» dejará de aparecer en los listados y en el expediente. El archivo no se borra: puedes restaurarlo desde Estudios, en el filtro «Archivados».</>} />
        </>
      )}
    </>
  );
}
