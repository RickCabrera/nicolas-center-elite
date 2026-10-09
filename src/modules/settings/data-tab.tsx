'use client';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, KV, Notice, Select, Sheet, Skeleton, Textarea, useToast } from '@/components/ui';
import { api, ApiError, refresh, useApi } from '@/lib/client';
import { fmtDate, fmtDateTime, isoDate, addDays, weekday } from '@/lib/dates';
import { ARCO_KIND_LABEL, ARCO_RESPONSE_DAYS, ARCO_STATUS_LABEL, ARCO_STATUSES, type ArcoStatus } from './shared';
import type { ArcoRequest } from './types';

/** Descarga un archivo de la API mostrando el error en español si algo falla. */
async function download(url: string, fallbackName: string) {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'same-origin' });
  } catch {
    throw new Error('Sin conexión. Revisa tu internet e intenta de nuevo.');
  }
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new Error(j?.error?.message ?? 'No se pudo generar el archivo. Intenta de nuevo.');
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = href; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
  return name;
}

type PatientOpt = { id: string; full_name: string; record_number: string; status: string };

// CFG-10 · Exportar el expediente completo de un paciente.
function ExportPatient() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  // Incluye pacientes inactivos: quien ya no viene también puede pedir su expediente.
  const { data, error } = useApi<{ items: PatientOpt[]; total: number }>(`/api/patients?status=all&limit=200${term ? `&q=${encodeURIComponent(term)}` : ''}`, { revalidateOnFocus: false });
  const items = data?.items ?? [];
  useEffect(() => { if (id && data && !items.some((p) => p.id === id)) setId(''); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = async () => {
    setBusy(true);
    try {
      const name = await download(`/api/export/patient/${id}`, 'expediente.zip');
      toast(`Descargado: ${name}`);
      refresh('/api/audit');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Exportar expediente de un paciente" blue>
      <div className="stack md">
        <p className="t-sub">
          Descarga un archivo ZIP con todo lo que la clínica tiene de un paciente: ficha, perfil clínico con sus versiones, notas, consentimientos firmados,
          citas, recetas, pagos, asistencias y los archivos de sus estudios. Sirve para entregar el expediente a su titular (derecho de acceso) o a otro profesional.
        </p>
        <Field label="Buscar paciente">
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o número de expediente" />
        </Field>
        <Field label="Paciente" error={error ? error.message : undefined}
          hint={data && data.total > items.length ? `Se muestran ${items.length} de ${data.total}. Escribe parte del nombre para acotar.` : undefined}>
          <Select value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">{!data ? 'Cargando…' : items.length ? 'Selecciona un paciente' : 'Sin resultados'}</option>
            {items.map((p) => <option key={p.id} value={p.id}>{p.full_name} · {p.record_number}{p.status === 'inactive' ? ' (inactivo)' : ''}</option>)}
          </Select>
        </Field>
        <div className="hstack wrap">
          <Button variant="primary" loading={busy} disabled={!id} onClick={go}>Descargar expediente (ZIP)</Button>
        </div>
        <p className="t-small">
          Incluye hasta 150 MB de archivos de estudios; si hay más, el ZIP lo dice en su archivo LEEME. Puede tardar un momento. La descarga queda registrada en la bitácora.
        </p>
      </div>
    </Card>
  );
}

// CFG-10 · Respaldo general en CSV.
function Backup() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const name = await download('/api/export/backup', 'respaldo.zip');
      toast(`Descargado: ${name}`);
      refresh('/api/audit');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Respaldo general (CSV)" blue>
      <div className="stack md">
        <p className="t-sub">
          Descarga un ZIP con una hoja de cálculo (CSV) por cada tabla: pacientes, perfiles clínicos, ejercicios, notas, consentimientos, citas, recetas e indicaciones,
          planes, membresías, pagos, asistencias, usuarios, sedes, la lista de estudios y la bitácora de los últimos 12 meses. Se abre con Excel o Google Sheets.
        </p>
        <Notice>
          No incluye los archivos de los estudios ni contraseñas o credenciales de los lectores. El respaldo completo de la base de datos y de los archivos
          se hace desde el proveedor (Supabase → Database → Backups y Storage); este archivo es para consultar o llevarte tu información, no para restaurar el sistema.
        </Notice>
        <div className="hstack wrap">
          <Button variant="primary" loading={busy} onClick={go}>Descargar respaldo (ZIP)</Button>
        </div>
        <p className="t-small">Contiene datos personales sensibles: guárdalo en un lugar con acceso restringido. La descarga queda registrada en la bitácora.</p>
      </div>
    </Card>
  );
}

/** Fecha límite de respuesta: 20 días hábiles (lunes a viernes) después de recibida. No descuenta días festivos. */
function arcoDeadline(createdAt: string): string {
  let d = isoDate(createdAt);
  for (let left = ARCO_RESPONSE_DAYS; left > 0;) {
    d = addDays(d, 1);
    const wd = weekday(d);
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}
const STATUS_TONE: Record<ArcoStatus, 'gold' | 'blue' | 'green' | 'red'> = { recibida: 'gold', en_proceso: 'blue', resuelta: 'green', rechazada: 'red' };

function ArcoSheet({ req, onClose }: { req: ArcoRequest | null; onClose: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<ArcoStatus>('en_proceso');
  const [resolution, setResolution] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!req) return;
    setStatus(req.status === 'recibida' ? 'en_proceso' : req.status); setResolution(req.resolution); setErr(''); setBusy(false);
  }, [req]);
  const closing = status === 'resuelta' || status === 'rechazada';

  const save = async () => {
    if (!req) return;
    if (closing && resolution.trim().length < 5) return setErr('Escribe cómo se resolvió o por qué se rechazó: es la constancia de la respuesta.');
    setBusy(true);
    try {
      await api.patch(`/api/arco/${req.id}`, { status, resolution });
      toast(`Solicitud ${ARCO_STATUS_LABEL[status].toLowerCase()}`);
      refresh('/api/arco');
      onClose();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={!!req} onClose={onClose} title="Solicitud de privacidad"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Guardar</Button></>}>
      {req && (
        <div className="stack md">
          <div className="grid-kv">
            <KV label="Solicitante">{req.requester_name}</KV>
            <KV label="Contacto">{req.contact}</KV>
            <KV label="Derecho">{ARCO_KIND_LABEL[req.kind]}</KV>
            <KV label="Recibida">{fmtDateTime(req.created_at)} h</KV>
            <KV label="Responder antes del" tone="gold">{fmtDate(arcoDeadline(req.created_at))}</KV>
            {req.resolved_at && <KV label="Cerrada">{fmtDateTime(req.resolved_at)} h</KV>}
          </div>
          <div>
            <div className="t-label">Lo que pide</div>
            <div className="t-body" style={{ marginTop: 6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{req.details || '—'}</div>
          </div>
          <Field label="Estado">
            <Select value={status} onChange={(e) => { setStatus(e.target.value as ArcoStatus); setErr(''); }}>
              {ARCO_STATUSES.map((s) => <option key={s} value={s}>{ARCO_STATUS_LABEL[s]}</option>)}
            </Select>
          </Field>
          <Field label={closing ? 'Nota de resolución' : 'Nota de seguimiento (opcional)'} error={err}
            hint="Qué se respondió, por qué medio y en qué fecha. Antes de entregar datos, confirma la identidad de quien los pide.">
            <Textarea value={resolution} maxLength={3000} invalid={!!err} onChange={(e) => { setResolution(e.target.value); setErr(''); }}
              placeholder={status === 'rechazada' ? 'Motivo del rechazo y fundamento' : 'Se entregó copia del expediente en recepción el…'} />
          </Field>
        </div>
      )}
    </Sheet>
  );
}

// LEG-03 · Bandeja de solicitudes ARCO recibidas desde /privacidad.
function ArcoInbox() {
  const { data, error, mutate } = useApi<{ items: ArcoRequest[]; pending: number }>('/api/arco');
  const [open, setOpen] = useState<ArcoRequest | null>(null);
  const [all, setAll] = useState(false);
  const closed = data?.items.filter((r) => r.status === 'resuelta' || r.status === 'rechazada') ?? [];
  const pending = data?.items.filter((r) => r.status === 'recibida' || r.status === 'en_proceso') ?? [];
  const shown = all ? [...pending, ...closed] : pending;
  const today = isoDate();

  return (
    <Card title="Solicitudes de privacidad (ARCO)" blue
      action={data ? <Badge tone={data.pending ? 'gold' : 'green'}>{data.pending ? `${data.pending} ${data.pending === 1 ? 'pendiente' : 'pendientes'}` : 'Al corriente'}</Badge> : undefined}>
      <div className="stack md">
        <p className="t-sub">
          Las personas ejercen sus derechos de Acceso, Rectificación, Cancelación y Oposición desde la página pública{' '}
          <a href="/privacidad" target="_blank" rel="noreferrer">/privacidad</a>, donde también está el aviso de privacidad. Tienes {ARCO_RESPONSE_DAYS} días hábiles para responder cada una.
        </p>
        {error && !data ? <ErrorNote error={error} retry={() => mutate()} />
          : !data ? <Skeleton rows={2} />
          : shown.length === 0 ? <Empty>{closed.length ? 'No hay solicitudes pendientes.' : 'Aún no se ha recibido ninguna solicitud.'}</Empty>
          : (
            <div className="stack sm">
              {shown.map((r) => {
                const due = arcoDeadline(r.created_at);
                const isOpen = r.status === 'recibida' || r.status === 'en_proceso';
                return (
                  <button key={r.id} type="button" className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 8 }} onClick={() => setOpen(r)}>
                    <span className="grow" style={{ flexBasis: 220 }}>
                      <span className="t-strong" style={{ display: 'block', overflowWrap: 'anywhere' }}>{r.requester_name}<span className="dim" style={{ fontWeight: 400 }}> · {ARCO_KIND_LABEL[r.kind]}</span></span>
                      <span className="t-small" style={{ display: 'block', marginTop: 4, overflowWrap: 'anywhere' }}>
                        Recibida el {fmtDate(r.created_at)}
                        {isOpen ? <> · <span className={due < today ? 'red' : undefined}>{due < today ? 'venció el' : 'responder antes del'} {fmtDate(due)}</span></> : r.resolved_at ? ` · cerrada el ${fmtDate(r.resolved_at)}` : ''}
                      </span>
                      <span className="t-small" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginTop: 4, color: 'var(--ink-2)', overflowWrap: 'anywhere' }}>{r.details}</span>
                    </span>
                    <Badge tone={STATUS_TONE[r.status]}>{ARCO_STATUS_LABEL[r.status]}</Badge>
                  </button>
                );
              })}
            </div>
          )}
        {closed.length > 0 && (
          <button type="button" className="btn-link" style={{ alignSelf: 'flex-start' }} onClick={() => setAll(!all)}>
            {all ? 'Ocultar las cerradas' : `Ver también las cerradas (${closed.length})`}
          </button>
        )}
      </div>
      <ArcoSheet req={open} onClose={() => setOpen(null)} />
    </Card>
  );
}

// CFG-10 / LEG-03 · Pestaña "Datos": exportaciones y solicitudes de privacidad.
export function DataTab() {
  return (
    <div className="stack">
      <ArcoInbox />
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <ExportPatient />
        <Backup />
      </div>
    </div>
  );
}
