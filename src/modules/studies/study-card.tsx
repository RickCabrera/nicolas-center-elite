'use client';
import { useState } from 'react';
import { fmtDate } from '@/lib/dates';
import { formatLabel } from './file-rules';
import type { Study } from './types';

/**
 * La miniatura llega con una URL firmada nueva en cada lectura del listado. Para que las imágenes no se
 * vuelvan a descargar (ni parpadeen) con cada revalidación, se conserva la primera URL de cada estudio
 * mientras siga vigente (se firman por 10 minutos; aquí se reutilizan hasta 8).
 */
const thumbCache = new Map<string, { url: string; at: number }>();
function stableThumbUrl(study: Study): string | null {
  if (!study.thumb_url) { thumbCache.delete(study.id); return null; }
  const hit = thumbCache.get(study.id);
  if (hit && Date.now() - hit.at < 8 * 60 * 1000) return hit.url;
  thumbCache.set(study.id, { url: study.thumb_url, at: Date.now() });
  return study.thumb_url;
}

const STRIPES = 'repeating-linear-gradient(135deg, #161a1f 0 8px, #12161a 8px 16px)';

/** EST-05 · Miniatura real si existe; si no, mosaico rayado con el tipo de estudio y el formato. */
export function StudyThumb({ study, height }: { study: Study; height: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  const url = stableThumbUrl(study);
  const format = formatLabel(study.mime, study.file_name);
  const showImage = !!url && failed !== url;
  return (
    <div style={{ position: 'relative', height, background: STRIPES, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '0 10px', overflow: 'hidden' }}>
      {showImage ? (
         
        <img src={url} alt="" loading="lazy" decoding="async"
          onError={() => { thumbCache.delete(study.id); setFailed(url); }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', background: '#0b0d11' }} />
      ) : (
        <span className="ellipsis" style={{ maxWidth: '100%', font: '600 10px/1.2 var(--f-mono)', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-5)' }}>
          {study.type_name}
        </span>
      )}
      <span className="pill" style={showImage
        ? { position: 'absolute', right: 8, bottom: 8, padding: '4px 8px', fontSize: 9.5, background: 'rgba(8, 10, 14, .78)', color: 'var(--ink-2)' }
        : { padding: '4px 9px', fontSize: 9.5 }}>
        {format}
      </span>
    </div>
  );
}

/**
 * Tarjeta de un estudio (EST-03). `flat` es la variante del expediente (dentro de una tarjeta);
 * la normal es la de la pantalla global, que además muestra el nombre del paciente.
 */
export function StudyTile({ study, onOpen, showPatient, flat }: { study: Study; onOpen: (id: string) => void; showPatient?: boolean; flat?: boolean }) {
  return (
    <button type="button" className={flat ? 'row' : 'card'} onClick={() => onOpen(study.id)}
      aria-label={`Abrir ${study.title}${showPatient ? ` de ${study.patient_name}` : ''}`}
      style={{ display: 'block', padding: 0, overflow: 'hidden', borderRadius: flat ? 12 : 16, opacity: study.archived_at ? 0.82 : 1 }}>
      <StudyThumb study={study} height={flat ? 104 : 108} />
      <div style={{ padding: flat ? '10px 12px' : '11px 12px 13px', minWidth: 0 }}>
        <div className="ellipsis" style={{ font: '600 13px/1.2 var(--f-body)' }}>{study.title}</div>
        {showPatient && (
          <div className="ellipsis" style={{ marginTop: 4, font: '400 12px/1.3 var(--f-body)', color: 'var(--ink-4)' }}>{study.patient_name}</div>
        )}
        <div style={{ marginTop: flat ? 3 : 4, font: '500 11.5px/1 var(--f-mono)', color: flat ? 'var(--ink-3)' : 'var(--ink-5)' }}>
          {fmtDate(study.study_date)}
        </div>
      </div>
    </button>
  );
}

export function StudyGrid({ studies, onOpen, showPatient, flat }: { studies: Study[]; onOpen: (id: string) => void; showPatient?: boolean; flat?: boolean }) {
  return (
    <div className="grid-tiles">
      {studies.map((s) => <StudyTile key={s.id} study={s} onOpen={onOpen} showPatient={showPatient} flat={flat} />)}
    </div>
  );
}

/** Marcadores de carga con la misma forma que las tarjetas. */
export function StudyGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid-tiles" aria-busy="true" aria-label="Cargando estudios">
      {Array.from({ length: count }, (_, i) => <div key={i} className="skeleton" style={{ minHeight: 172, borderRadius: 16 }} />)}
    </div>
  );
}
