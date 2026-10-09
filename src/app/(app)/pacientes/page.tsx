'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMeta } from '@/components/meta';
import { PageHeader } from '@/components/shell';
import { Avatar, Badge, BillingBadge, Button, Chip, Empty, ErrorNote, Input, Skeleton } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { qs, useApi } from '@/lib/client';
import { initials, shortName } from '@/lib/format';
import { ImportPatientsSheet } from '@/modules/patients/import-sheet';
import { NewPatientSheet } from '@/modules/patients/new-patient-sheet';
import type { PatientList, PatientListItem } from '@/modules/patients/types';

const PAGE = 60;
const MAX = 480;   // la API entrega hasta 500 por petición
type Filter = 'todos' | 'ninos' | 'adultos' | 'mayores' | 'deportistas';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'todos', label: 'Todos' }, { key: 'ninos', label: 'Niños' }, { key: 'adultos', label: 'Adultos' },
  { key: 'mayores', label: 'Adultos mayores' }, { key: 'deportistas', label: 'Deportistas' },
];

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const ageLabel = (n: number) => (n < 1 ? 'Menor de 1 año' : n === 1 ? '1 año' : `${n} años`);

function PatientCard({ p, owner, clinical }: { p: PatientListItem; owner: boolean; clinical: boolean }) {
  return (
    <Link href={`/pacientes/${p.id}`} className="card" style={{ padding: 14 }}>
      <div className="stack md">
        <div className="hstack" style={{ gap: 12 }}>
          <Avatar text={initials(p.full_name)} />
          <div className="grow">
            <div className="t-name ellipsis">{p.full_name}</div>
            <div className="t-sub ellipsis" style={{ marginTop: 2, lineHeight: 1.3 }}>{ageLabel(p.age)} · {p.location_name}</div>
          </div>
          {p.status === 'inactive' ? <Badge>Baja</Badge> : <BillingBadge state={p.billing_state} />}
        </div>
        {/* AUTH-10 · El motivo de consulta es clínico: recepción no lo recibe ni lo ve. */}
        {clinical && (
          <div className="t-sub" style={{ color: 'var(--ink-2)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>
            {p.reason || 'Sin motivo de consulta registrado'}
          </div>
        )}
        <div className="hstack wrap" style={{ gap: 6 }}>
          <span className="pill">{p.plan_name ?? 'Sin plan'}</span>
          {owner && <span className="pill gold">FISIO: {shortName(p.therapist_name)}</span>}
        </div>
      </div>
    </Link>
  );
}

// PAC-02 · Lista de pacientes: buscador, filtros por edad/etiqueta y (dueño y recepción) por fisioterapeuta.
export default function Pacientes() {
  const user = useUser();
  const { meta } = useMeta();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('todos');
  const [therapist, setTherapist] = useState('');
  const [inactive, setInactive] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const q = useDebounced(query.trim());

  useEffect(() => { setLimit(PAGE); }, [q, filter, therapist, inactive]);

  const { data, error, isLoading, mutate } = useApi<PatientList>('/api/patients' + qs({
    q,
    age: filter === 'ninos' || filter === 'adultos' || filter === 'mayores' ? filter : '',
    tag: filter === 'deportistas' ? 'Deportista' : '',
    therapist_id: user.isFront ? therapist : '',
    status: inactive ? 'inactive' : '',
    limit,
  }));

  const filtered = !!q || filter !== 'todos' || !!therapist || inactive;
  const clear = () => { setQuery(''); setFilter('todos'); setTherapist(''); setInactive(false); };
  const therapists = (meta?.therapists ?? []).filter((t) => t.active);
  const scope = data?.total_scope;

  const title = user.isFront ? 'Todos los pacientes' : 'Mis pacientes';
  const sub = user.isFront
    ? `${scope === undefined ? '' : `${scope} ${scope === 1 ? 'expediente' : 'expedientes'} · `}${user.isReception ? 'vista de recepción' : 'vista de dueño'}`
    : `Filtrado a tu carga · ${shortName(user.display_name)}`;
  const count = !data ? ' '
    : inactive ? `${data.total} ${data.total === 1 ? 'paciente dado de baja' : 'pacientes dados de baja'}`
    : `${data.total} de ${data.total_scope} pacientes`;

  return (
    <div className="page">
      <PageHeader title={title} sub={sub} />

      <div className="hstack wrap">
        <Input className="round" style={{ flex: 1, minWidth: 200 }} type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={user.isClinical ? 'Buscar por nombre o lesión...' : 'Buscar por nombre o expediente...'}
          aria-label={user.isClinical ? 'Buscar pacientes por nombre, lesión, diagnóstico o número de expediente' : 'Buscar pacientes por nombre o número de expediente'} />
        <Button variant="primary" style={{ minHeight: 48, padding: '0 18px' }} onClick={() => setShowNew(true)}>+ Nuevo paciente</Button>
        {user.isFront && <Button style={{ minHeight: 48 }} onClick={() => setShowImport(true)}>Importar CSV</Button>}
      </div>

      <div className="scroll-x" role="group" aria-label="Filtrar por grupo">
        {FILTERS.filter((f) => user.isClinical || f.key !== 'deportistas').map((f) => <Chip key={f.key} on={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</Chip>)}
      </div>

      {user.isFront && (
        <div className="scroll-x" role="group" aria-label="Filtrar por fisioterapeuta">
          <Chip square on={!therapist} onClick={() => setTherapist('')}>Todos los fisios</Chip>
          {therapists.map((t) => (
            <Chip key={t.id} square on={therapist === t.id} onClick={() => setTherapist(t.id)} title={t.display_name}>{shortName(t.display_name)}</Chip>
          ))}
          <Chip square on={inactive} onClick={() => setInactive((v) => !v)} style={{ marginLeft: 'auto' }}>Dados de baja</Chip>
        </div>
      )}

      <div className="t-label" style={{ fontWeight: 500, lineHeight: 1 }} aria-live="polite">{count}</div>

      {error && !data ? (
        <ErrorNote error={error} retry={() => mutate()} />
      ) : !data || (isLoading && !data) ? (
        <div className="grid-cards" aria-busy="true" aria-label="Cargando pacientes">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} rows={1} height={132} />)}
        </div>
      ) : data.items.length === 0 ? (
        <Empty>
          {filtered ? (
            <>
              {inactive && !q && filter === 'todos' && !therapist ? 'No hay pacientes dados de baja.' : 'Ningún paciente coincide con la búsqueda o los filtros.'}{' '}
              <button type="button" className="btn-link" onClick={clear} style={{ marginLeft: 6 }}>Quitar filtros</button>
            </>
          ) : user.isFront
            ? 'Aún no hay pacientes registrados. Da de alta al primero con «+ Nuevo paciente» o carga tu lista con «Importar CSV».'
            : 'Aún no tienes pacientes asignados. Registra al primero con «+ Nuevo paciente».'}
        </Empty>
      ) : (
        <>
          {error && <ErrorNote error={error} retry={() => mutate()} />}
          <div className="grid-cards">
            {data.items.map((p) => <PatientCard key={p.id} p={p} owner={user.isFront} clinical={user.isClinical} />)}
          </div>
          {data.items.length < data.total && (limit < MAX
            ? <Button onClick={() => setLimit((n) => Math.min(n + PAGE, MAX))} loading={isLoading} style={{ alignSelf: 'center' }}>
                Mostrar más ({data.total - data.items.length} restantes)
              </Button>
            : <div className="t-small" style={{ textAlign: 'center' }}>Se muestran los primeros {MAX}. Usa el buscador o los filtros para encontrar a los demás.</div>
          )}
        </>
      )}

      <NewPatientSheet open={showNew} onClose={() => setShowNew(false)} />
      {user.isFront && <ImportPatientsSheet open={showImport} onClose={() => setShowImport(false)} />}
    </div>
  );
}
