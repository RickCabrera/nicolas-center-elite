'use client';
import { DevicePersonsSheet } from './device-persons';
import { useEffect, useState } from 'react';
import { useMeta } from '@/components/meta';
import { Button, Card, Checkbox, Confirm, Empty, ErrorNote, Field, Input, KV, Notice, Select, Sheet, Skeleton, useForm, useToast } from '@/components/ui';
import { api, ApiError, refresh, useApi } from '@/lib/client';
import { addDays, fmtDateTime, fmtTime, isoDate, todayIso } from '@/lib/dates';
import type { CommandStatus, Device, DeviceSecrets } from './types';
import { waitForCommand } from './use-command';

const DEFAULT_MODEL = 'DS-K1T321EFWX-B';
type Kind = 'ping' | 'sync_time' | 'backfill_events' | 'configure_listener';
type Activity = { tone?: 'green' | 'gold' | 'red'; text: string };

/** Hoy → 'HH:MM'; otro día → 'DD/MM/AAAA HH:MM'; nunca → 'sin registro'. */
export function when(d: string | null | undefined, never = 'sin registro'): string {
  if (!d) return never;
  return isoDate(d) === todayIso() ? fmtTime(d) : fmtDateTime(d);
}

const KIND_DONE: Record<Kind, string> = {
  ping: 'Conexión correcta.',
  sync_time: 'Hora del lector sincronizada.',
  backfill_events: 'Eventos recuperados.',
  configure_listener: 'El lector quedó configurado para avisar cada lectura.',
};
const KIND_QUEUED: Record<Kind, string> = {
  ping: 'El agente puente no está conectado; la prueba se ejecutará cuando vuelva.',
  sync_time: 'El agente puente no está conectado; la hora se sincronizará cuando vuelva.',
  backfill_events: 'El agente puente no está conectado; los eventos se recuperarán cuando vuelva.',
  configure_listener: 'El agente puente no está conectado; el lector se configurará cuando vuelva.',
};

function doneText(kind: Kind, c: CommandStatus): string {
  const r = c.result ?? {};
  if (kind === 'ping') {
    const parts = [r.model, r.serial && `serie ${r.serial}`, r.firmware && `firmware ${r.firmware}`].filter(Boolean);
    const skew = typeof r.clock_skew_seconds === 'number' && Math.abs(r.clock_skew_seconds) > 60
      ? ` El reloj del lector difiere ${Math.round(Math.abs(r.clock_skew_seconds) / 60)} min: sincroniza la hora.` : '';
    return `Conexión correcta${parts.length ? ': ' + parts.join(' · ') : ''}.${skew}`;
  }
  if (kind === 'backfill_events') {
    const n = Number(r.created ?? 0);
    return `Eventos recuperados: ${Number(r.sent ?? 0)} leídos del lector, ${n} asistencia${n === 1 ? '' : 's'} nueva${n === 1 ? '' : 's'}.`;
  }
  return KIND_DONE[kind];
}

/**
 * HUE-01 / CFG-04 · Lectores de huella en Configuración: estado real del lector y de su agente puente,
 * prueba de conexión, sincronización de hora, recuperación de eventos y datos de conexión.
 */
export function DevicesSettings(_props: Record<string, never> = {}) {
  const toast = useToast();
  const list = useApi<Device[]>('/api/devices', { refreshInterval: 10000 });
  const [form, setForm] = useState<{ device: Device | null } | null>(null);
  const [secretsFor, setSecretsFor] = useState<Device | null>(null);
  const [personsFor, setPersonsFor] = useState<Device | null>(null);
  const [backfillFor, setBackfillFor] = useState<Device | null>(null);
  const [retire, setRetire] = useState<Device | null>(null);
  const [busy, setBusy] = useState<Record<string, Kind | undefined>>({});
  const [activity, setActivity] = useState<Record<string, Activity | undefined>>({});

  const note = (id: string, a: Activity | undefined) => setActivity((s) => ({ ...s, [id]: a }));

  /** Encola una orden y espera hasta 20 s. Si el puente está desconectado lo dice de inmediato. */
  const run = async (d: Device, kind: Kind, payload?: Record<string, string>) => {
    setBusy((s) => ({ ...s, [d.id]: kind }));
    note(d.id, undefined);
    try {
      const r = await api.post<{ command_id: string; bridge_online: boolean }>(`/api/devices/${d.id}/command`, { kind, payload });
      if (!r.bridge_online) {
        note(d.id, { tone: 'gold', text: KIND_QUEUED[kind] });
        return;
      }
      const res = await waitForCommand(r.command_id, { timeoutMs: kind === 'backfill_events' ? 60000 : 20000, intervalMs: 1200 });
      if (res.outcome === 'done') {
        note(d.id, { tone: 'green', text: doneText(kind, res.command) });
        toast(KIND_DONE[kind]);
      } else if (res.outcome === 'error') {
        note(d.id, { tone: 'red', text: res.message });
      } else {
        note(d.id, { tone: 'gold', text: 'El agente puente no respondió a tiempo. La orden sigue en cola y se ejecutará cuando responda.' });
      }
    } catch (e) {
      note(d.id, { tone: 'red', text: (e as ApiError).message });
    } finally {
      setBusy((s) => ({ ...s, [d.id]: undefined }));
      void list.mutate();
      void refresh('/api/attendance');
    }
  };

  const setActive = async (d: Device, active: boolean) => {
    try {
      await api.patch(`/api/devices/${d.id}`, { active });
      toast(active ? 'Lector reactivado' : 'Lector dado de baja');
      setRetire(null);
      await list.mutate();
      void refresh('/api/attendance/status');
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  const devices = list.data ?? [];
  const active = devices.filter((d) => d.active);
  const retired = devices.filter((d) => !d.active);

  return (
    <Card blue title="Lector de huellas"
      action={<button type="button" className="btn-link" onClick={() => setForm({ device: null })}>+ Agregar lector</button>}>
      {list.isLoading && !list.data ? <Skeleton rows={2} height={120} />
        : list.error && !list.data ? <ErrorNote error={list.error} retry={() => list.mutate()} />
        : devices.length === 0 ? (
          <Empty>
            Todavía no hay lectores. Agrega el lector de recepción para recibir asistencias y registrar huellas.
            Después de agregarlo se muestran los datos para conectarlo.
          </Empty>
        ) : (
          <div className="stack">
            {active.map((d) => {
              const b = busy[d.id];
              const a = activity[d.id];
              return (
                <div key={d.id} className="stack md" style={{ padding: 12, border: '1px solid rgba(255,255,255,.11)', borderTopColor: 'rgba(255,255,255,.3)', borderRadius: 12, background: 'var(--glass-row)' }}>
                  <div className="hstack" style={{ gap: 12 }}>
                    <span className={`dot ${d.online ? 'green' : 'red'}`} style={{ width: 10, height: 10, animation: d.online ? 'pulse 2s ease-in-out infinite' : undefined }} aria-hidden="true" />
                    <div className="grow">
                      <div className="t-strong ellipsis">{d.online ? 'Conectado' : 'Sin conexión'} · {d.name}</div>
                      <div className="t-small">
                        {d.location_name} · última lectura {when(d.last_event_at)} · última sincronización {when(d.last_sync_at)}
                      </div>
                    </div>
                  </div>

                  <div className="grid-kv">
                    <KV label="Lector">{d.online ? <span style={{ color: 'var(--green)' }}>En línea</span> : <span style={{ color: 'var(--red)' }}>Sin conexión</span>}</KV>
                    <KV label="Agente puente">
                      {d.bridge_online ? <span style={{ color: 'var(--green)' }}>Conectado{d.bridge_version ? ` · v${d.bridge_version}` : ''}</span>
                        : <span style={{ color: 'var(--red)' }}>{d.bridge_seen_at ? `Desconectado · visto ${when(d.bridge_seen_at)}` : 'Nunca se ha conectado'}</span>}
                    </KV>
                    <KV label="Modelo">{d.model || '—'}</KV>
                    <KV label="Serie">{d.serial || '—'}</KV>
                    <KV label="Firmware">{d.firmware || '—'}</KV>
                    <KV label="Dirección en la red">{d.host ? `${d.use_https ? 'https' : 'http'}://${d.host}:${d.port}` : 'Sin capturar'}</KV>
                    <KV label="Última lectura">{when(d.last_event_at)}</KV>
                    <KV label="Última sincronización">{when(d.last_sync_at)}</KV>
                  </div>

                  {(!d.host || !d.has_password) && (
                    <Notice tone="gold">Falta capturar {!d.host ? 'la dirección' : 'la contraseña'} del lector. Sin eso el agente puente no puede registrar huellas ni recuperar eventos.</Notice>
                  )}
                  {d.last_error && !a && <Notice tone="red">{d.last_error}</Notice>}
                  {a && <Notice tone={a.tone}>{a.text}</Notice>}

                  <div className="hstack wrap">
                    <Button size="sm" loading={b === 'ping'} disabled={!!b} onClick={() => run(d, 'ping')}>Probar conexión</Button>
                    <Button size="sm" loading={b === 'sync_time'} disabled={!!b} onClick={() => run(d, 'sync_time')}>Sincronizar hora</Button>
                    <Button size="sm" loading={b === 'backfill_events'} disabled={!!b} onClick={() => setBackfillFor(d)}>Recuperar eventos</Button>
                    <Button size="sm" onClick={() => setPersonsFor(d)}>Personas en el lector</Button>
                    <Button size="sm" onClick={() => setSecretsFor(d)}>Datos de conexión</Button>
                    <Button size="sm" onClick={() => setForm({ device: d })}>Editar</Button>
                    <Button size="sm" variant="danger" onClick={() => setRetire(d)}>Dar de baja</Button>
                  </div>
                </div>
              );
            })}

            {retired.length > 0 && (
              <div className="stack sm">
                <div className="t-label">Dados de baja</div>
                {retired.map((d) => (
                  <div key={d.id} className="row" style={{ opacity: 0.8 }}>
                    <span className="dot off" aria-hidden="true" />
                    <div className="grow">
                      <div className="t-strong ellipsis">{d.name}</div>
                      <div className="t-small ellipsis">{d.location_name}{d.model ? ` · ${d.model}` : ''}</div>
                    </div>
                    <Button size="sm" onClick={() => setActive(d, true)}>Reactivar</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      <DeviceSheet state={form} onClose={() => setForm(null)}
        onSaved={(d, created) => { setForm(null); void list.mutate(); void refresh('/api/attendance/status'); if (created) setSecretsFor(d); }} />
      <DevicePersonsSheet device={personsFor} onClose={() => setPersonsFor(null)} />
      <SecretsSheet device={secretsFor} onClose={() => setSecretsFor(null)}
        onConfigure={(d) => { setSecretsFor(null); void run(d, 'configure_listener'); }} />
      <BackfillSheet device={backfillFor} onClose={() => setBackfillFor(null)}
        onGo={(d, from, to) => { setBackfillFor(null); void run(d, 'backfill_events', { from, to }); }} />
      <Confirm open={!!retire} onClose={() => setRetire(null)} danger title="Dar de baja el lector" confirmLabel="Dar de baja"
        message={<>El lector <b>{retire?.name}</b> dejará de recibir asistencias y su agente puente ya no podrá conectarse. El historial de asistencias se conserva y puedes reactivarlo después.</>}
        onConfirm={async () => { if (retire) await setActive(retire, false); }} />
    </Card>
  );
}

// ───────── alta / edición ─────────
type FormValues = { name: string; location_id: string; model: string; serial: string; host: string; port: string; use_https: boolean; username: string; password: string };
const emptyForm: FormValues = { name: '', location_id: '', model: DEFAULT_MODEL, serial: '', host: '', port: '', use_https: true, username: 'admin', password: '' };

function DeviceSheet({ state, onClose, onSaved }: { state: { device: Device | null } | null; onClose: () => void; onSaved: (d: Device, created: boolean) => void }) {
  const { meta } = useMeta();
  const toast = useToast();
  const f = useForm<FormValues>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const device = state?.device ?? null;
  const locations = (meta?.locations ?? []).filter((l) => l.active || l.id === device?.location_id);

  useEffect(() => {
    if (!state) return;
    setFailure(null);
    f.reset(device
      ? { name: device.name, location_id: device.location_id, model: device.model, serial: device.serial, host: device.host, port: String(device.port), use_https: device.use_https, username: device.username, password: '' }
      : { ...emptyForm, name: 'Lector de recepción' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const save = async () => {
    const v = f.values;
    const errors: Record<string, string> = {};
    if (!v.name.trim()) errors.name = 'Escribe un nombre para el lector.';
    if (!v.location_id) errors.location_id = 'Selecciona la sede.';
    if (v.port && !/^\d{1,5}$/.test(v.port.trim())) errors.port = 'Puerto inválido.';
    if (Object.keys(errors).length) { f.setErrors(errors); return; }
    setSaving(true);
    setFailure(null);
    const body: Record<string, unknown> = {
      name: v.name, location_id: v.location_id, model: v.model, serial: v.serial, host: v.host.trim(),
      use_https: v.use_https, username: v.username || 'admin',
      port: v.port.trim() ? Number(v.port) : v.use_https ? 443 : 80,
    };
    if (v.password) body.password = v.password;
    try {
      const saved = device ? await api.patch<Device>(`/api/devices/${device.id}`, body) : await api.post<Device>('/api/devices', body);
      toast(device ? 'Lector actualizado' : 'Lector agregado');
      onSaved(saved, !device);
    } catch (e) {
      const err = e as ApiError;
      if (err.fields) f.setErrors(err.fields);
      setFailure(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={!!state} onClose={onClose} title={device ? 'Editar lector' : 'Agregar lector'}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={saving} onClick={save}>{device ? 'Guardar' : 'Agregar lector'}</Button></>}>
      <form className="stack md" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="grid-form">
          <Field label="Nombre" error={f.errors.name}><Input {...f.bind('name')} placeholder="Lector de recepción" maxLength={80} /></Field>
          <Field label="Sede" error={f.errors.location_id}>
            <Select {...f.bind('location_id')}>
              <option value="">Selecciona la sede</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          <Field label="Modelo" error={f.errors.model}><Input {...f.bind('model')} placeholder={DEFAULT_MODEL} maxLength={80} /></Field>
          <Field label="Número de serie" error={f.errors.serial} hint="Opcional: se llena solo al probar la conexión."><Input {...f.bind('serial')} maxLength={80} /></Field>
        </div>
        <div className="t-label" style={{ marginTop: 4 }}>Acceso al lector en la red de la clínica</div>
        <div className="grid-form">
          <Field label="IP o nombre del lector" error={f.errors.host} hint="Por ejemplo 192.168.80.212 (sin http://)."><Input {...f.bind('host')} placeholder="192.168.80.212" inputMode="url" autoCapitalize="none" autoCorrect="off" maxLength={120} /></Field>
          <Field label="Puerto" error={f.errors.port} hint={f.values.use_https ? 'Por defecto 443.' : 'Por defecto 80.'}><Input {...f.bind('port')} placeholder={f.values.use_https ? '443' : '80'} inputMode="numeric" maxLength={5} /></Field>
          <Field label="Usuario" error={f.errors.username}><Input {...f.bind('username')} autoCapitalize="none" autoCorrect="off" maxLength={60} /></Field>
          <Field label="Contraseña" error={f.errors.password} hint={device?.has_password ? 'Déjala vacía para conservar la actual.' : 'La del usuario administrador del lector.'}>
            <Input type="password" {...f.bind('password')} autoComplete="new-password" placeholder={device?.has_password ? 'Sin cambios' : ''} maxLength={120} />
          </Field>
        </div>
        <Checkbox label="El lector usa HTTPS (certificado propio del equipo)" checked={f.values.use_https} onChange={(e) => f.set('use_https', e.target.checked)} />
        <div className="t-small">
          La contraseña se guarda cifrada y solo se entrega al agente puente de la PC de recepción, que es quien habla con el lector.
        </div>
        {failure && <Notice tone="red">{failure}</Notice>}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

// ───────── datos de conexión ─────────
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function CopyRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const toast = useToast();
  return (
    <div className="kv">
      <div className="hstack between">
        <div className="t-label">{label}</div>
        <button type="button" className="btn-link" onClick={async () => toast((await copyText(value)) ? 'Copiado' : 'No se pudo copiar; selecciónalo a mano', undefined)}>Copiar</button>
      </div>
      <div style={{ fontFamily: mono ? 'var(--f-mono)' : undefined, fontSize: mono ? 12.5 : undefined, overflowWrap: 'anywhere', userSelect: 'all' }}>{value}</div>
    </div>
  );
}

function SecretsSheet({ device, onClose, onConfigure }: { device: Device | null; onClose: () => void; onConfigure: (d: Device) => void }) {
  const toast = useToast();
  const [data, setData] = useState<DeviceSecrets | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [regen, setRegen] = useState<'webhook' | 'bridge' | null>(null);

  const load = async (d: Device) => {
    setError(null);
    try { setData(await api.get<DeviceSecrets>(`/api/devices/${d.id}/secrets`)); } catch (e) { setError(e as ApiError); }
  };
  // Los secretos no se guardan en caché: se piden al abrir y se sueltan al cerrar.
  useEffect(() => {
    setData(null);
    if (device) void load(device);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device?.id]);

  const rotate = async () => {
    if (!device || !regen) return;
    try {
      setData(await api.post<DeviceSecrets>(`/api/devices/${device.id}/secrets`, { regenerate: regen }));
      toast(regen === 'webhook' ? 'Nueva URL generada: actualízala en el lector' : 'Nuevo token generado: actualiza config.json en la PC de recepción');
      setRegen(null);
      void refresh('/api/devices');
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  const download = () => {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([data.bridge_config_json + '\n'], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'config.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Sheet open={!!device} onClose={onClose} wide title={`Datos de conexión · ${device?.name ?? ''}`}>
      {error ? <ErrorNote error={error} retry={() => device && load(device)} />
        : !data ? <Skeleton rows={4} />
        : (
          <div className="stack lg">
            <Notice tone="gold">Estos datos son secretos: quien los tenga puede enviar asistencias a nombre del lector. Cada consulta queda en la bitácora.</Notice>

            <section className="stack md">
              <h4 className="t-h3 blue">1. Agente puente (PC de recepción)</h4>
              <div className="t-small">
                Guarda este contenido como <b>config.json</b> dentro de la carpeta <b>bridge</b> en la PC de recepción y corre <span className="t-mono">node bridge.mjs --check</span>.
                El agente registra huellas, sincroniza la hora y recupera asistencias aunque el aviso del lector falle.
              </div>
              <pre style={{ margin: 0, padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,.14)', background: 'rgba(0,0,0,.35)', font: '500 12.5px/1.5 var(--f-mono)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'all' }}>{data.bridge_config_json}</pre>
              <div className="hstack wrap">
                <Button size="sm" variant="primary" onClick={async () => toast((await copyText(data.bridge_config_json)) ? 'config.json copiado' : 'No se pudo copiar; selecciónalo a mano')}>Copiar</Button>
                <Button size="sm" onClick={download}>Descargar config.json</Button>
                <Button size="sm" variant="danger" onClick={() => setRegen('bridge')}>Regenerar token</Button>
              </div>
            </section>

            <section className="stack md">
              <h4 className="t-h3 blue">2. Aviso de eventos del lector (HTTP Listening)</h4>
              <div className="t-small">
                En la página del lector: <b>Configuration → Network → Advanced → HTTP Listening</b> (en algunas versiones, &quot;HTTP Host&quot;). Captura exactamente estos valores y guarda.
              </div>
              <div className="grid-kv">
                <CopyRow label="Protocolo" value={data.listener.protocol} />
                <CopyRow label="IP o dominio del servidor" value={data.listener.host} />
                <CopyRow label="Puerto" value={String(data.listener.port)} />
              </div>
              <CopyRow label="URL (ruta)" value={data.listener.path} />
              <CopyRow label="URL completa del webhook" value={data.webhook_url} />
              <div className="hstack wrap">
                <Button size="sm" disabled={!device?.bridge_online} title={device?.bridge_online ? undefined : 'Requiere el agente puente conectado'} onClick={() => device && onConfigure(device)}>Configurar el lector automáticamente</Button>
                <Button size="sm" variant="danger" onClick={() => setRegen('webhook')}>Regenerar URL</Button>
              </div>
              {!device?.bridge_online && <div className="t-small">La configuración automática requiere el agente puente conectado. Mientras tanto puedes capturar los valores a mano.</div>}
            </section>
          </div>
        )}
      <Confirm open={!!regen} onClose={() => setRegen(null)} onConfirm={rotate} danger
        title={regen === 'webhook' ? 'Regenerar URL del webhook' : 'Regenerar token del agente'} confirmLabel="Regenerar"
        message={regen === 'webhook'
          ? 'La URL actual dejará de funcionar de inmediato. Tendrás que capturar la nueva en el lector (o usar "Configurar el lector automáticamente").'
          : 'El agente puente dejará de conectarse hasta que pegues el nuevo config.json en la PC de recepción.'} />
    </Sheet>
  );
}

// ───────── recuperar eventos ─────────
function BackfillSheet({ device, onClose, onGo }: { device: Device | null; onClose: () => void; onGo: (d: Device, from: string, to: string) => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    if (!device) return;
    setTo(todayIso());
    setFrom(addDays(todayIso(), -7));
  }, [device]);
  const bad = !from || !to || from > to;
  return (
    <Sheet open={!!device} onClose={onClose} title="Recuperar eventos del lector"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={bad} onClick={() => device && onGo(device, from, to)}>Recuperar</Button></>}>
      <div className="stack md">
        <div className="t-body">
          El agente puente lee el historial guardado en <b>{device?.name}</b> y registra las asistencias que falten. Las que ya existen no se duplican.
        </div>
        <div className="grid-form">
          <Field label="Desde"><Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Hasta" error={from && to && from > to ? 'Debe ser igual o posterior a la fecha inicial.' : undefined}><Input type="date" value={to} max={todayIso()} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        {!device?.bridge_online && <Notice tone="gold">El agente puente no está conectado; la recuperación se ejecutará cuando vuelva.</Notice>}
      </div>
    </Sheet>
  );
}
