/**
 * Lógica de servidor del módulo de huella: lectores, cola de órdenes al agente puente,
 * ingreso de eventos (webhook y puente por el mismo camino) y enrolamiento.
 *
 * HUE-16 · Privacidad: la plantilla de la huella (fingerData) JAMÁS llega a la nube. Aquí solo se
 * maneja el número de persona en el lector (hik_employee_no) y la fecha de enrolamiento.
 */
import type { NextRequest } from 'next/server';
import type { Tx } from '@/lib/db';
import { sha256 } from '@/lib/crypto';
import { env } from '@/lib/env';
import { AppError, forbidden, notFound } from '@/lib/errors';
import { dedupeKey, isVerifiedAccess, type HikEvent } from './hik-parser';

// ───────── lectores ─────────
export type DeviceRow = {
  id: string; name: string; location_id: string; location_name: string;
  model: string; serial: string; firmware: string;
  host: string; port: number; use_https: boolean; username: string; has_password: boolean;
  active: boolean;
  online: boolean; bridge_online: boolean;
  last_event_at: Date | null; last_webhook_at: Date | null; bridge_seen_at: Date | null; bridge_version: string | null;
  device_reachable: boolean | null; device_checked_at: Date | null; last_sync_at: Date | null; last_error: string | null;
  created_at: Date;
};

/**
 * HUE-01 · Estado calculado:
 *   online        = hubo webhook/latido o evento en los últimos 3 min, o el puente vio al lector hace < 2 min
 *   bridge_online = el puente preguntó por órdenes hace < 90 s
 */
export async function listDevices(tx: Tx, opts: { id?: string; locationId?: string | null; onlyActive?: boolean } = {}): Promise<DeviceRow[]> {
  return tx<DeviceRow[]>`
    select d.id, d.name, d.location_id, l.name as location_name, d.model, d.serial, d.firmware,
           d.host, d.port, d.use_https, d.username, (d.password_enc is not null) as has_password, d.active,
           (coalesce(greatest(d.last_webhook_at, d.last_event_at) > now() - interval '3 minutes', false)
             or coalesce(d.device_reachable and d.device_checked_at > now() - interval '2 minutes', false)) as online,
           coalesce(d.bridge_seen_at > now() - interval '90 seconds', false) as bridge_online,
           d.last_event_at, d.last_webhook_at, d.bridge_seen_at, d.bridge_version,
           d.device_reachable, d.device_checked_at, d.last_sync_at, d.last_error, d.created_at
    from devices d join locations l on l.id = d.location_id
    where true
      ${opts.id ? tx`and d.id = ${opts.id}` : tx``}
      ${opts.locationId ? tx`and d.location_id = ${opts.locationId}` : tx``}
      ${opts.onlyActive ? tx`and d.active` : tx``}
    order by d.active desc, l.name, d.name`;
}

export type AuthDevice = { id: string; name: string; location_id: string };

/** Webhook: el lector se identifica por el hash del token de su URL. */
export async function deviceByWebhookToken(tx: Tx, token: string | undefined): Promise<AuthDevice | null> {
  if (!token || token.length < 16 || token.length > 200) return null;
  const [d] = await tx<AuthDevice[]>`select id, name, location_id from devices where webhook_token_hash = ${sha256(token)} and active`;
  return d ?? null;
}

/** Puente: `Authorization: Bearer <bridge_token>`. 401 si no coincide con un lector activo. */
export async function deviceByBridgeToken(tx: Tx, req: NextRequest): Promise<AuthDevice> {
  const h = req.headers.get('authorization') ?? '';
  const m = h.match(/^Bearer\s+(\S{16,200})$/i);
  const [d] = m ? await tx<AuthDevice[]>`select id, name, location_id from devices where bridge_token_hash = ${sha256(m[1])} and active` : [];
  if (!d) throw new AppError(401, 'unauthorized', 'Token del agente puente inválido.');
  return d;
}

// ───────── datos de conexión ─────────
/** URL del webhook y valores exactos a capturar en el lector (Configuration → Network → HTTP Listening). */
export function connectionData(webhookToken: string, bridgeToken: string) {
  const base = env().APP_URL.replace(/\/+$/, '');
  const u = new URL(base);
  const https = u.protocol === 'https:';
  const path = `${u.pathname.replace(/\/+$/, '')}/api/hik/events/${webhookToken}`;
  const bridge_config = { cloud_url: base, bridge_token: bridgeToken };
  return {
    webhook_url: `${base}/api/hik/events/${webhookToken}`,
    listener: {
      protocol: https ? 'HTTPS' : 'HTTP',
      host: u.hostname,
      port: u.port ? Number(u.port) : https ? 443 : 80,
      path,
    },
    bridge_token: bridgeToken,
    bridge_config,
    bridge_config_json: JSON.stringify(bridge_config, null, 2),
  };
}

// ───────── ingreso de eventos (HUE-03 / HUE-04) ─────────
export type IngestResult = { received: number; created: number; ignored: number };

/**
 * Registra las lecturas válidas con `register_attendance`. Webhook y puente usan la MISMA llave de
 * idempotencia, así que el mismo evento por los dos caminos crea una sola asistencia.
 * Cada evento va en su propio savepoint: uno malo no tumba a los demás.
 */
export async function ingestEvents(tx: Tx, device: AuthDevice, events: HikEvent[], source: 'device' | 'bridge'): Promise<IngestResult> {
  const res: IngestResult = { received: events.length, created: 0, ignored: 0 };
  const seen = new Set<string>();
  let clockProblem = false;
  for (const e of events) {
    if (!isVerifiedAccess(e)) { res.ignored++; continue; }
    // Un lector con la hora desfasada al futuro no debe sembrar asistencias imposibles.
    if (e.occurredAt.getTime() > Date.now() + 10 * 60 * 1000) { res.ignored++; clockProblem = true; continue; }
    const key = dedupeKey(device.id, e);
    try {
      const [row] = await tx.savepoint((sp) => sp<{ id: string; is_new: boolean }[]>`
        select (r).id as id, ((r).created_at = now() and (r).dedupe_key = ${key}) as is_new
        from (select register_attendance(${device.id}, ${e.employeeNo}, ${e.occurredAt}, ${source}, ${key}, ${e.verifyMode}) as r) x`) as unknown as { id: string; is_new: boolean }[];
      if (row?.is_new && !seen.has(row.id)) { seen.add(row.id); res.created++; } else res.ignored++;
    } catch (err) {
      res.ignored++;
      console.error('[huella] no se pudo registrar un evento:', (err as Error).message);
    }
  }
  if (clockProblem) {
    await tx`update devices set last_error = 'El lector envió una fecha futura. Sincroniza la hora del lector.' where id = ${device.id}`;
  }
  return res;
}

// ───────── cola de órdenes (HUE-06) ─────────
export type CommandKind = 'ping' | 'sync_time' | 'upsert_person' | 'enroll_fingerprint' | 'delete_person' | 'backfill_events' | 'configure_listener' | 'list_persons';

export async function enqueueCommand(sys: Tx, c: {
  deviceId: string; kind: CommandKind; payload?: Record<string, unknown>; createdBy?: string | null;
  personType?: 'patient' | 'staff' | null; patientId?: string | null; userId?: string | null;
}): Promise<string> {
  const [row] = await sys<{ id: string }[]>`
    insert into device_commands (device_id, kind, payload, person_type, patient_id, user_id, created_by)
    values (${c.deviceId}, ${c.kind}, ${sys.json((c.payload ?? {}) as never)}, ${c.personType ?? null}, ${c.patientId ?? null}, ${c.userId ?? null}, ${c.createdBy || null})
    returning id`;
  return row.id;
}

/** Minutos que una orden de enrolamiento puede esperar al puente antes de caducar. */
export const ENROLL_TTL_MIN = 10;
export const MAX_ATTEMPTS = 3;

/**
 * Mantenimiento de la cola antes de entregar órdenes:
 *  · un enrolamiento que nadie atendió en 10 min caduca (que el lector pida un dedo horas después,
 *    sin nadie supervisando, permitiría enrolar a la persona equivocada);
 *  · una orden `running` sin respuesta en 2 min vuelve a `pending` hasta 3 intentos; luego `error`.
 *    El enrolamiento no se reintenta solo, por la misma razón.
 * El contador de intentos vive en `result.attempts` mientras la orden no termina.
 */
export async function maintainQueue(sys: Tx, deviceId: string) {
  await sys`
    update device_commands set status = 'error', error = 'expired', finished_at = now()
    where device_id = ${deviceId} and kind = 'enroll_fingerprint' and status = 'pending'
      and created_at < now() - make_interval(mins => ${ENROLL_TTL_MIN})`;
  const failed = await sys<{ id: string; kind: string; patient_id: string | null; user_id: string | null }[]>`
    update device_commands set status = 'error', error = 'no_response', finished_at = now()
    where device_id = ${deviceId} and status = 'running' and started_at < now() - interval '2 minutes'
      and (kind = 'enroll_fingerprint' or coalesce((result ->> 'attempts')::int, 1) >= ${MAX_ATTEMPTS})
    returning id, kind, patient_id, user_id`;
  for (const f of failed) {
    if (f.kind === 'enroll_fingerprint') await markEnrollmentFailed(sys, deviceId, f.patient_id, f.user_id);
  }
  await sys`
    update device_commands set status = 'pending', started_at = null
    where device_id = ${deviceId} and status = 'running' and started_at < now() - interval '2 minutes'`;
  await sys`
    update enrollments e set status = 'failed'
    where e.device_id = ${deviceId} and e.status = 'pending'
      and not exists (select 1 from device_commands c where c.device_id = e.device_id and c.kind = 'enroll_fingerprint'
                       and c.status in ('pending','running')
                       and (c.patient_id = e.patient_id or c.user_id = e.user_id))`;
}

async function markEnrollmentFailed(sys: Tx, deviceId: string, patientId: string | null, userId: string | null) {
  await sys`
    update enrollments set status = 'failed'
    where device_id = ${deviceId} and status = 'pending'
      and ((${patientId}::uuid is not null and patient_id = ${patientId}::uuid) or (${userId}::uuid is not null and user_id = ${userId}::uuid))`;
}

/** HUE-16 · Busca en profundidad cualquier clave que parezca plantilla biométrica y la elimina. */
export function stripBiometric(value: unknown, depth = 0): { found: boolean; clean: unknown } {
  if (depth > 12 || value === null || typeof value !== 'object') return { found: false, clean: value };
  if (Array.isArray(value)) {
    let found = false;
    const clean = value.map((v) => { const r = stripBiometric(v, depth + 1); found ||= r.found; return r.clean; });
    return { found, clean };
  }
  let found = false;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (/finger[_-]?(print)?[_-]?(data|template)|face[_-]?data|biometric/i.test(k)) { found = true; continue; }
    // Defensa adicional: un texto largo en base64 bajo cualquier otra clave también se trata como plantilla.
    if (typeof v === 'string' && v.length > 400 && /^[A-Za-z0-9+/=_\-\s]+$/.test(v)) { found = true; continue; }
    const r = stripBiometric(v, depth + 1);
    found ||= r.found;
    clean[k] = r.clean;
  }
  return { found, clean };
}

type CommandRow = {
  id: string; device_id: string; kind: CommandKind; status: string; payload: Record<string, unknown>;
  person_type: 'patient' | 'staff' | null; patient_id: string | null; user_id: string | null;
};

const short = (v: unknown, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Cierra una orden con la respuesta del puente y aplica sus efectos (HUE-05/06/07/13). */
export async function applyCommandResult(sys: Tx, cmd: CommandRow, ok: boolean, result: Record<string, unknown> | null, error: string | null) {
  await sys`
    update device_commands set status = ${ok ? 'done' : 'error'}, result = ${result ? sys.json(result as never) : null},
           error = ${ok ? null : (error || 'error').slice(0, 300)}, finished_at = now()
    where id = ${cmd.id}`;

  // La orden de configurar el aviso lleva la URL con el token: no se conserva una vez cerrada.
  if (cmd.kind === 'configure_listener') await sys`update device_commands set payload = '{}'::jsonb where id = ${cmd.id}`;

  const who = cmd.patient_id ? sys`patient_id = ${cmd.patient_id}` : sys`user_id = ${cmd.user_id}`;
  const hasPerson = !!(cmd.patient_id || cmd.user_id);

  if (cmd.kind === 'enroll_fingerprint' && hasPerson) {
    if (ok) {
      const employeeNo = short(cmd.payload.employee_no, 64);
      await sys`
        insert into enrollments (device_id, person_type, patient_id, user_id, employee_no, status, enrolled_at, removed_at)
        values (${cmd.device_id}, ${cmd.person_type}, ${cmd.patient_id}, ${cmd.user_id}, ${employeeNo}, 'enrolled', now(), null)
        on conflict (device_id, employee_no) do update set status = 'enrolled', enrolled_at = now(), removed_at = null`;
      if (cmd.patient_id) await sys`update patients set fingerprint_enrolled_at = now() where id = ${cmd.patient_id}`;
      else await sys`update users set fingerprint_enrolled_at = now() where id = ${cmd.user_id}`;
    } else {
      await markEnrollmentFailed(sys, cmd.device_id, cmd.patient_id, cmd.user_id);
    }
  }

  if (cmd.kind === 'delete_person' && ok && hasPerson) {
    await sys`update enrollments set status = 'removed', removed_at = now() where device_id = ${cmd.device_id} and ${who}`;
    const [left] = await sys<{ n: number }[]>`select count(*)::int as n from enrollments where ${who} and status = 'enrolled'`;
    if (left.n === 0) {
      if (cmd.patient_id) await sys`update patients set fingerprint_enrolled_at = null where id = ${cmd.patient_id} and fingerprint_enrolled_at is not null`;
      else await sys`update users set fingerprint_enrolled_at = null where id = ${cmd.user_id} and fingerprint_enrolled_at is not null`;
    }
  }

  if (cmd.kind === 'ping') {
    if (ok) {
      const model = short(result?.model), serial = short(result?.serial), firmware = short(result?.firmware);
      await sys`
        update devices set device_reachable = true, device_checked_at = now(), last_error = null,
               model = case when ${model} <> '' then ${model} else model end,
               serial = case when ${serial} <> '' then ${serial} else serial end,
               firmware = case when ${firmware} <> '' then ${firmware} else firmware end
        where id = ${cmd.device_id}`;
    } else {
      await sys`update devices set device_reachable = false, device_checked_at = now() where id = ${cmd.device_id}`;
    }
  }

  if ((cmd.kind === 'sync_time' || cmd.kind === 'backfill_events') && ok) {
    await sys`update devices set last_sync_at = now() where id = ${cmd.device_id}`;
  }

  if (ok) {
    if (cmd.kind !== 'ping') await sys`update devices set last_error = null where id = ${cmd.device_id} and last_error is not null`;
  } else {
    await sys`update devices set last_error = ${translateDeviceError(error)} where id = ${cmd.device_id}`;
  }
}

// ───────── mensajes del lector en español ─────────
export const DEVICE_ERRORS: Record<string, string> = {
  capture_timeout: 'Se agotó el tiempo: nadie colocó el dedo en el lector. Intenta de nuevo.',
  low_quality: 'La huella salió con baja calidad. Limpia el dedo y el sensor, e intenta de nuevo.',
  capture_failed: 'El lector no pudo capturar la huella. Intenta de nuevo.',
  setup_failed: 'El lector capturó la huella pero no pudo guardarla. Intenta de nuevo.',
  fingerprint_duplicate: 'Esa huella ya está registrada a nombre de otra persona en el lector.',
  person_failed: 'El lector no aceptó el alta de la persona.',
  delete_failed: 'El lector no pudo eliminar a la persona.',
  device_unreachable: 'El agente puente no pudo conectarse al lector. Revisa que esté encendido y en la red.',
  device_timeout: 'El lector no respondió a tiempo. Revisa que esté encendido y en la red.',
  auth_failed: 'El lector rechazó el usuario o la contraseña. Revísalos en Configuración.',
  device_not_configured: 'Faltan la dirección o la contraseña del lector. Captúralas en Configuración.',
  device_busy: 'El lector está ocupado. Espera unos segundos e intenta de nuevo.',
  device_full: 'El lector ya no tiene espacio para más personas o huellas.',
  not_supported: 'El lector no admite esta operación con su firmware actual.',
  device_enroll_timeout: 'No se registró ninguna huella en la pantalla del lector a tiempo. Intenta de nuevo.',
  fingerprint_query_failed: 'El lector no permitió consultar las huellas registradas.',
  person_search_failed: 'El lector no entregó la lista de personas.',
  listener_not_supported: 'El lector no aceptó la configuración automática del aviso de eventos. Captúrala a mano con los "Datos de conexión".',
  time_failed: 'El lector no aceptó el cambio de hora.',
  search_failed: 'El lector no pudo entregar su historial de eventos.',
  cloud_unreachable: 'El agente puente leyó los eventos pero no pudo enviarlos. Los enviará cuando vuelva el internet.',
  bad_payload: 'La orden llegó incompleta al agente puente.',
  unknown_command: 'El agente puente no reconoce esta orden. Actualiza el agente.',
  expired: 'La orden caducó porque el agente puente no estuvo conectado. Vuelve a intentarlo.',
  no_response: 'El agente puente no respondió. Revisa que esté funcionando en la PC de recepción.',
  biometric_rejected: 'Se rechazó la respuesta del agente puente porque incluía datos biométricos.',
  cancelled: 'La orden se canceló.',
};

/** 'capture_timeout: detalle' → mensaje listo para mostrarse. */
export function translateDeviceError(raw: string | null | undefined): string {
  if (!raw) return 'El lector reportó un error.';
  const code = raw.split(':')[0].trim();
  if (DEVICE_ERRORS[code]) return DEVICE_ERRORS[code];
  if (/\s/.test(raw) && /[áéíóúñ]|\bagente\b|\blector\b/i.test(raw)) return raw; // ya viene en español
  return `El lector reportó un error (${raw.slice(0, 80)}).`;
}

// ───────── personas y enrolamiento (HUE-07 / HUE-13) ─────────
/** Nombre para el lector: sin acentos, solo ASCII imprimible, máximo 32 caracteres. */
export function asciiName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ñ/g, 'n').replace(/Ñ/g, 'N')
    .replace(/[^\x20-\x7e]/g, '').replace(/["<>&]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32).trim();
}

export type Person = {
  type: 'patient' | 'staff'; id: string; name: string; location_id: string | null;
  employee_no: string; enrolled_at: Date | null; active: boolean;
};

/**
 * Carga a la persona validando el permiso: paciente vía RLS (si no es suyo, no existe);
 * personal solo el dueño o el propio usuario.
 */
export async function loadPerson(db: Tx, user: { id: string; role: string }, personType: 'patient' | 'staff', personId: string): Promise<Person> {
  if (personType === 'patient') {
    const [p] = await db<{ id: string; full_name: string; location_id: string; hik_employee_no: string; fingerprint_enrolled_at: Date | null; status: string }[]>`
      select id, full_name, location_id, hik_employee_no, fingerprint_enrolled_at, status from patients where id = ${personId}`;
    if (!p) throw notFound('Paciente no encontrado.');
    return { type: 'patient', id: p.id, name: p.full_name, location_id: p.location_id, employee_no: p.hik_employee_no, enrolled_at: p.fingerprint_enrolled_at, active: p.status === 'active' };
  }
  if (user.role !== 'owner' && user.id !== personId) throw forbidden('Solo el dueño puede administrar la huella de otra persona del equipo.');
  const [u] = await db<{ id: string; full_name: string; location_id: string | null; hik_employee_no: string; fingerprint_enrolled_at: Date | null; active: boolean }[]>`
    select id, full_name, location_id, hik_employee_no, fingerprint_enrolled_at, active from users where id = ${personId}`;
  if (!u) throw notFound('Persona no encontrada.');
  return { type: 'staff', id: u.id, name: u.full_name, location_id: u.location_id, employee_no: u.hik_employee_no, enrolled_at: u.fingerprint_enrolled_at, active: u.active };
}

/** Lector donde se enrola: el indicado, el activo de la sede de la persona o, si solo hay uno activo, ese. */
export async function pickDevice(sys: Tx, person: Person, deviceId?: string | null): Promise<DeviceRow | null> {
  if (deviceId) {
    const [d] = await listDevices(sys, { id: deviceId, onlyActive: true });
    return d ?? null;
  }
  if (person.location_id) {
    const [d] = await listDevices(sys, { locationId: person.location_id, onlyActive: true });
    return d ?? null;
  }
  const all = await listDevices(sys, { onlyActive: true });
  return all.length === 1 ? all[0] : null;
}

/**
 * HUE-13 · Encola el borrado de la persona en cada lector donde esté dada de alta.
 * Otros módulos la llaman al dar de baja a un paciente o a un usuario.
 * `tx` debe ser una transacción de SISTEMA (device_commands no es accesible al rol de aplicación).
 * La marca `fingerprint_enrolled_at` se limpia cuando el puente confirma el borrado; si la persona
 * no está en ningún lector activo, se limpia de inmediato.
 */
export async function queuePersonRemoval(
  tx: Tx,
  { personType, personId, createdBy }: { personType: 'patient' | 'staff'; personId: string; createdBy?: string | null },
): Promise<{ command_ids: string[] }> {
  const who = personType === 'patient' ? tx`patient_id = ${personId}` : tx`user_id = ${personId}`;
  // Un enrolamiento que aún no empieza ya no tiene sentido.
  await tx`update device_commands set status = 'cancelled', error = 'cancelled', finished_at = now()
           where kind = 'enroll_fingerprint' and status = 'pending' and ${who}`;
  const whoE = personType === 'patient' ? tx`e.patient_id = ${personId}` : tx`e.user_id = ${personId}`;
  const rows = await tx<{ device_id: string; employee_no: string; active: boolean }[]>`
    select e.device_id, e.employee_no, d.active from enrollments e join devices d on d.id = e.device_id
    where ${whoE} and e.status <> 'removed'`;
  const ids: string[] = [];
  for (const r of rows) {
    if (!r.active) {
      await tx`update enrollments set status = 'removed', removed_at = now() where device_id = ${r.device_id} and employee_no = ${r.employee_no}`;
      continue;
    }
    const [dup] = await tx<{ id: string }[]>`
      select id from device_commands where device_id = ${r.device_id} and kind = 'delete_person' and status in ('pending','running') and ${who} limit 1`;
    if (dup) { ids.push(dup.id); continue; }
    ids.push(await enqueueCommand(tx, {
      deviceId: r.device_id, kind: 'delete_person', payload: { employee_no: r.employee_no }, createdBy,
      personType, patientId: personType === 'patient' ? personId : null, userId: personType === 'staff' ? personId : null,
    }));
  }
  if (!ids.length) {
    if (personType === 'patient') await tx`update patients set fingerprint_enrolled_at = null where id = ${personId} and fingerprint_enrolled_at is not null`;
    else await tx`update users set fingerprint_enrolled_at = null where id = ${personId} and fingerprint_enrolled_at is not null`;
  }
  return { command_ids: ids };
}

// ───────── asistencias: consulta común ─────────
export type AttendanceItem = {
  id: string; person_type: 'patient' | 'staff' | 'unknown'; patient_id: string | null; user_id: string | null;
  employee_no: string | null; person_name: string; role_label: string;
  location_id: string; location_name: string; occurred_at: Date; direction: 'in' | 'out';
  source: 'device' | 'bridge' | 'manual' | 'simulator'; verify_mode: string; manual_reason: string | null;
  recorded_by_name: string | null; appointment_id: string | null; session_consumed: boolean;
  billing_state: string | null;
};

/** Columnas y joins de una asistencia tal como la muestra la pantalla (HUE-10 / HUE-15). Corre bajo RLS. */
export const attendanceSelect = (db: Tx) => db`
  select e.id, e.person_type, e.patient_id, e.user_id, e.employee_no,
         coalesce(nullif(e.person_name, ''), 'Sin nombre') as person_name,
         case e.person_type
           when 'patient' then 'Paciente'
           when 'staff' then case when u.role = 'owner' then 'Dirección' else 'Fisioterapeuta' end
           else 'No reconocido' end as role_label,
         e.location_id, l.name as location_name, e.occurred_at, e.direction, e.source, e.verify_mode,
         e.manual_reason, nullif(trim(coalesce(rb.title, '') || ' ' || coalesce(rb.full_name, '')), '') as recorded_by_name,
         e.appointment_id, e.session_consumed,
         case when e.person_type = 'patient' then pb.state end as billing_state
  from attendance_events e
  join locations l on l.id = e.location_id
  left join users u on u.id = e.user_id
  left join users rb on rb.id = e.recorded_by
  left join patient_billing pb on pb.patient_id = e.patient_id`;
