'use client';
import { useEffect, useState } from 'react';
import { useMeta } from '@/components/meta';
import { PageHeader } from '@/components/shell';
import { Button, Chip, Empty, ErrorNote, Input } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { qs, useApi } from '@/lib/client';
import { StudyGrid, StudyGridSkeleton } from '@/modules/studies/study-card';
import type { Study } from '@/modules/studies/types';
import { UploadStudySheet } from '@/modules/studies/upload-sheet';
import { StudyViewer } from '@/modules/studies/viewer';

const PAGE = 60;

// EST-03 · Estudios y archivos de todos los pacientes que el usuario puede ver.
export default function Estudios() {
  const user = useUser();
  const { meta } = useMeta();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [archived, setArchived] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(q.trim()); setLimit(PAGE); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  // Enlace directo a un estudio: /estudios?ver=<id>
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('ver');
    if (id) setViewing(id);
  }, []);

  const { data, error, isLoading, mutate } = useApi<Study[]>(
    `/api/studies${qs({ q: search, type, archived: user.isOwner && archived ? 1 : undefined, limit })}`,
  );
  const types = (meta?.study_types ?? []).filter((t) => t.active || t.name === type).map((t) => t.name);
  const filtered = !!search || !!type;
  const pick = (fn: () => void) => { fn(); setLimit(PAGE); };

  return (
    <div className="page">
      <PageHeader title="Estudios y archivos" sub={user.isOwner ? 'Archivos de todos los pacientes' : 'Archivos de tus pacientes'} />

      <div className="hstack wrap">
        <Input className="round" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por paciente, tipo o archivo…"
          aria-label="Buscar estudios" style={{ flex: 1, minWidth: 200 }} />
        <Button variant="gold" onClick={() => setUploading(true)} style={{ minHeight: 48, padding: '0 18px' }}>+ Subir estudio</Button>
      </div>

      <div className="scroll-x" role="group" aria-label="Filtrar por tipo">
        <Chip on={!type} onClick={() => pick(() => setType(''))}>Todos</Chip>
        {types.map((t) => <Chip key={t} on={type === t} onClick={() => pick(() => setType(type === t ? '' : t))}>{t}</Chip>)}
        {user.isOwner && <Chip square on={archived} onClick={() => pick(() => setArchived(!archived))}>Archivados</Chip>}
      </div>

      {error && !data ? (
        <ErrorNote error={error} retry={() => mutate()} />
      ) : !data ? (
        <StudyGridSkeleton />
      ) : data.length === 0 ? (
        <Empty>
          {filtered
            ? `Ningún estudio${archived ? ' archivado' : ''} coincide con la búsqueda.`
            : archived
              ? 'No hay estudios archivados.'
              : `Todavía no hay estudios${user.isOwner ? '' : ' de tus pacientes'}. Sube el primero con «+ Subir estudio».`}
        </Empty>
      ) : (
        <>
          {error && <ErrorNote error={error} retry={() => mutate()} />}
          <StudyGrid studies={data} onOpen={setViewing} showPatient />
          {data.length >= limit && (
            <Button onClick={() => setLimit(limit + PAGE)} loading={isLoading} style={{ alignSelf: 'center' }}>Ver más estudios</Button>
          )}
        </>
      )}

      <UploadStudySheet open={uploading} onClose={() => setUploading(false)} />
      <StudyViewer studyId={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
