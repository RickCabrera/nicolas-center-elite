// QA-02 · Integración de la API probada como dueño y como fisioterapeuta.
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET as clinicGET, PATCH as clinicPATCH, POST as clinicPOST } from '@/app/api/clinic/route';
import { GET as metaGET } from '@/app/api/meta/route';
import { GET as locationsGET, POST as locationsPOST } from '@/app/api/locations/route';
import { PATCH as locationPATCH } from '@/app/api/locations/[id]/route';
import { GET as catalogGET, PATCH as catalogPATCH, POST as catalogPOST } from '@/app/api/catalogs/[kind]/route';
import { GET as auditGET } from '@/app/api/audit/route';
import { GET as exportPatientGET } from '@/app/api/export/patient/[id]/route';
import { GET as backupGET } from '@/app/api/export/backup/route';
import { GET as arcoGET, POST as arcoPOST } from '@/app/api/arco/route';
import { PATCH as arcoPATCH } from '@/app/api/arco/[id]/route';
import { GET as privacyGET } from '@/app/api/privacy/route';
import { GET as cronGET } from '@/app/api/cron/daily/route';
import { readSession } from '@/lib/auth/session';
import { env } from '@/lib/env';
import { storage } from '@/lib/storage';
import { DEFAULT_TEMPLATES } from '@/modules/settings/default-templates';
import { SETTING_DEFAULTS, fillTemplate, unknownMarkers } from '@/modules/settings/shared';
import { toCsv } from '@/modules/settings/server';
import { call, fixtures, sqlAs, sqlSystem, type Fixtures } from '../helpers';

// tests/helpers.ts → resetData() ejecuta `set local session_replication_role`, que el rol nce_admin de este
// entorno no puede usar (no es superusuario) y aborta la transacción de limpieza. TRUNCATE no dispara
// triggers por fila, así que aquí esa sentencia se omite; todo lo demás de @/lib/db pasa intacto.
vi.mock('@/lib/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/db')>();
  const skipReplicaRole = (tx: import('@/lib/db').Tx) => new Proxy(tx, {
    get(target, prop) {
      if (prop !== 'unsafe') return Reflect.get(target, prop);
      return (query: string, ...rest: never[]) =>
        /session_replication_role/.test(query) ? Promise.resolve([]) : (target.unsafe as (...a: unknown[]) => unknown)(query, ...rest);
    },
  });
  return { ...real, asSystem: ((fn, actor) => real.asSystem((tx) => fn(skipReplicaRole(tx)), actor)) as typeof real.asSystem };
});

let fx: Fixtures;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const SIGNATURE = 'data:image/png;base64,' + PNG.toString('base64');

beforeAll(async () => {
  fx = await fixtures();
});
afterAll(async () => {
  // Deja la clínica como la entregan las migraciones.
  await sqlSystem((tx) => tx`update clinic set name = 'Nicolas Center Elite', logo_path = null, settings = ${tx.json(SETTING_DEFAULTS as never)},
    privacy_notice = ${DEFAULT_TEMPLATES.privacy_notice}, rx_footer = ${DEFAULT_TEMPLATES.rx_footer}`);
});

const billingState = async (patientId: string) =>
  (await sqlAs(fx.owner, (tx) => tx<{ state: string }[]>`select state from patient_billing where patient_id = ${patientId}`))[0].state;
const zipOf = async (res: Response) => unzipSync(new Uint8Array(await res.arrayBuffer()));

describe('CFG-07 · textos originales', () => {
  it('default-templates.ts coincide con lo que siembra 0006_base_data.sql', async () => {
    const [c] = await sqlSystem((tx) => tx`select privacy_notice, privacy_notice_short, consent_template, biometric_consent, rx_footer from clinic`);
    expect(c).toEqual(DEFAULT_TEMPLATES);
  });
  it('resuelve marcadores y detecta los que no existen', () => {
    expect(fillTemplate('{{clinica}} · {{ domicilio }} · {{otro}}', { clinica: 'NCE', domicilio: 'Av. 1' })).toBe('NCE · Av. 1 · {{otro}}');
    expect(unknownMarkers('{{clinica}} {{clinca}}', ['clinica'])).toEqual(['clinca']);
  });
});

describe('CFG-01 · clínica', () => {
  it('cualquier usuario la lee; solo el dueño recibe parámetros y plantillas', async () => {
    expect((await call(clinicGET)).status).toBe(401);
    const t = await call(clinicGET, { as: fx.therapistA });
    expect(t.status).toBe(200);
    expect(t.data).toMatchObject({ name: 'Nicolas Center Elite', logo_url: null });
    expect(t.data.settings).toBeUndefined();
    expect(t.data.privacy_notice).toBeUndefined();
    const o = await call(clinicGET, { as: fx.owner });
    expect(o.data.settings).toEqual(SETTING_DEFAULTS);
    expect(o.data.consent_template).toContain('{{firmante}}');
  });

  it('el fisioterapeuta no puede modificarla', async () => {
    expect((await call(clinicPATCH, { as: fx.therapistA, method: 'PATCH', body: { name: 'Otra' } })).status).toBe(403);
    expect((await call(clinicPOST, { as: fx.therapistA, body: { logo: 'request' } })).status).toBe(403);
    expect((await call(clinicGET, { as: fx.owner })).data.name).toBe('Nicolas Center Elite');
  });

  it('guarda los datos y /api/meta refleja el nombre', async () => {
    const r = await call(clinicPATCH, { as: fx.owner, method: 'PATCH', body: { name: '  Nicolas Center Elite Fisio ', legal_name: 'NCE S.A. de C.V.', tagline: 'Fisioterapia', phone: '271 712 0000', email: 'Contacto@NCE.mx' } });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ name: 'Nicolas Center Elite Fisio', legal_name: 'NCE S.A. de C.V.', phone: '271 712 0000', email: 'contacto@nce.mx' });
    const meta = await call(metaGET, { as: fx.therapistB });
    expect(meta.data.clinic.name).toBe('Nicolas Center Elite Fisio');
  });

  it('valida nombre, correo y cuerpo vacío', async () => {
    const bad = await call(clinicPATCH, { as: fx.owner, method: 'PATCH', body: { name: ' ', email: 'no-es-correo' } });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.error!.fields!)).toEqual(expect.arrayContaining(['name', 'email']));
    expect((await call(clinicPATCH, { as: fx.owner, method: 'PATCH', body: {} })).status).toBe(400);
  });

  it('logo: boleto de subida, validación del archivo y URL firmada', async () => {
    const t = await call(clinicPOST, { as: fx.owner, body: { logo: 'request' } });
    expect(t.status).toBe(200);
    expect(t.data.path).toMatch(/^clinic\/logo-\d+\.png$/);
    expect(t.data.ticket.driver).toBe('local');

    // aún no se sube nada → no existe
    expect((await call(clinicPATCH, { as: fx.owner, method: 'PATCH', body: { logo_path: t.data.path } })).status).toBe(400);
    // un archivo que no es imagen se rechaza y se borra
    await storage.write(t.data.path, Buffer.from('<script>alert(1)</script>'), 'image/png');
    const notImage = await call(clinicPATCH, { as: fx.owner, method: 'PATCH', body: { logo_path: t.data.path } });
    expect(notImage.status).toBe(400);
    expect(notImage.error!.message).toContain('PNG, JPG o WEBP');
    expect(await storage.size(t.data.path)).toBeNull();
    // más de 2 MB se rechaza
    await storage.write(t.data.path, Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]), 'image/png');
    expect((await call(clinicPATCH, { as: fx.owner, method: 'PATCH', body: { logo_path: t.data.path } })).error!.message).toContain('2 MB');
    // rutas fuera de clinic/ no se aceptan
    expect((await call(clinicPATCH, { as: fx.owner, method: 'PATCH', body: { logo_path: 'patients/x/y.png' } })).status).toBe(400);

    await storage.write(t.data.path, PNG, 'image/png');
    const ok = await call(clinicPATCH, { as: fx.owner, method: 'PATCH', body: { logo_path: t.data.path } });
    expect(ok.status).toBe(200);
    expect(ok.data.logo_url).toContain(encodeURIComponent(t.data.path));
    expect((await call(clinicGET, { as: fx.therapistA })).data.logo_url).toContain('/api/files/get');

    const off = await call(clinicPATCH, { as: fx.owner, method: 'PATCH', body: { logo_path: null } });
    expect(off.data.logo_url).toBeNull();
    expect(await storage.size(t.data.path)).toBeNull();
  });
});

describe('CFG-06 · parámetros', () => {
  it('rechaza llaves desconocidas, valores fuera de rango y tipos incorrectos', async () => {
    const unknown = await call(clinicPATCH, { as: fx.owner, method: 'PATCH', body: { settings: { due_soon_days: 10, modo_dios: true } } });
    expect(unknown.status).toBe(400);
    expect(unknown.error!.message).toContain('modo_dios');
    for (const settings of [{ due_soon_days: 0 }, { due_soon_days: 31 }, { due_soon_days: 7.5 }, { attendance_tolerance_min: 10 }, { idle_minutes: 241 }, { idle_minutes: '30' }, { staff_alternate_in_out: 'si' }]) {
      const r = await call(clinicPATCH, { as: fx.owner, method: 'PATCH', body: { settings } });
      expect(r.status, JSON.stringify(settings)).toBe(400);
    }
    const [c] = await sqlSystem((tx) => tx`select settings from clinic`);
    expect(c.settings).toEqual(SETTING_DEFAULTS); // nada de lo anterior se guardó
    expect((await call(clinicPATCH, { as: fx.therapistA, method: 'PATCH', body: { settings: { due_soon_days: 10 } } })).status).toBe(403);
  });

  it('due_soon_days cambia el estado de pago calculado, sin desplegar nada', async () => {
    expect(await billingState(fx.patientA1)).toBe('pagado'); // vence en 20 días, aviso a 7
    const r = await call(clinicPATCH, { as: fx.owner, method: 'PATCH', body: { settings: { due_soon_days: 25 } } });
    expect(r.status).toBe(200);
    expect(r.data.settings).toEqual({ ...SETTING_DEFAULTS, due_soon_days: 25 }); // mezcla: lo demás se conserva
    expect(await billingState(fx.patientA1)).toBe('por_vencer');
    expect(await billingState(fx.patientB1)).toBe('vencido');
    await call(clinicPATCH, { as: fx.owner, method: 'PATCH', body: { settings: { due_soon_days: 7 } } });
    expect(await billingState(fx.patientA1)).toBe('pagado');
  });

  it('idle_minutes decide cuándo readSession cierra una sesión inactiva', async () => {
    const idle = (min: number) => sqlSystem((tx) => tx`
      update sessions set last_seen_at = now() - make_interval(mins => ${min}) where user_id = ${fx.physician.id}`);
    await idle(10);
    expect((await readSession(fx.physician.token))?.id).toBe(fx.physician.id); // 10 min < 30
    await call(clinicPATCH, { as: fx.owner, method: 'PATCH', body: { settings: { idle_minutes: 5 } } });
    await idle(10);
    expect(await readSession(fx.physician.token)).toBeNull(); // 10 min > 5 → sesión cerrada
    expect((await call(clinicGET, { as: fx.physician })).status).toBe(401);
    const back = await call(clinicPATCH, { as: fx.owner, method: 'PATCH', body: { settings: { idle_minutes: 30, patient_alternate_in_out: true } } });
    expect(back.data.settings).toMatchObject({ idle_minutes: 30, patient_alternate_in_out: true });
    await call(clinicPATCH, { as: fx.owner, method: 'PATCH', body: { settings: { patient_alternate_in_out: false } } });
  });
});

describe('CFG-07 · plantillas', () => {
  it('guarda cada texto y valida vacíos y marcadores', async () => {
    const notice = 'AVISO NUEVO\n\n{{clinica}} con domicilio en {{domicilio}} cuida sus datos.';
    const r = await call(clinicPATCH, { as: fx.owner, method: 'PATCH', body: { privacy_notice: notice, rx_footer: '' } });
    expect(r.status).toBe(200);
    expect(r.data.privacy_notice).toBe(notice);
    expect(r.data.rx_footer).toBe('');
    expect(r.data.consent_template).toBe(DEFAULT_TEMPLATES.consent_template); // lo que no se manda no cambia

    expect((await call(clinicPATCH, { as: fx.owner, method: 'PATCH', body: { consent_template: '   ' } })).status).toBe(400);
    const typo = await call(clinicPATCH, { as: fx.owner, method: 'PATCH', body: { biometric_consent: 'Yo, {{firmnte}}, autorizo a {{clinica}} el uso de mi huella.' } });
    expect(typo.status).toBe(400);
    expect(typo.error!.fields!.biometric_consent).toContain('marcador');
    // {{paciente}} no existe en el aviso de privacidad (es un texto general)
    expect((await call(clinicPATCH, { as: fx.owner, method: 'PATCH', body: { privacy_notice_short: 'Estimado {{paciente}}, cuidamos sus datos personales.' } })).status).toBe(400);
    expect((await call(clinicPATCH, { as: fx.therapistB, method: 'PATCH', body: { rx_footer: 'x' } })).status).toBe(403);
  });

  it('el aviso público sale con los marcadores resueltos', async () => {
    await sqlSystem((tx) => tx`update locations set street = 'Av. 1 No. 123', neighborhood = 'Centro', zip = '94500' where code = 'COR'`);
    const r = await call(privacyGET); // sin sesión
    expect(r.status).toBe(200);
    expect(r.data.clinic_name).toBe('Nicolas Center Elite Fisio');
    expect(r.data.notice).toContain('Nicolas Center Elite Fisio con domicilio en Av. 1 No. 123, Centro, 94500 Córdoba, Veracruz (sede Córdoba) y Orizaba, Veracruz (sede Orizaba)');
    expect(r.data.notice).not.toContain('{{');
    expect(r.data.notice_short).not.toContain('{{');
    expect(Object.keys(r.data).sort()).toEqual(['clinic_name', 'notice', 'notice_short']);
  });
});

describe('CFG-02 · sedes', () => {
  let xalapa: string;
  it('todos las leen; el dueño ve de qué depende cada una', async () => {
    const t = await call(locationsGET, { as: fx.therapistA });
    expect(t.status).toBe(200);
    expect(t.data.map((l: { code: string }) => l.code).sort()).toEqual(['COR', 'ORI']);
    expect(t.data[0].active_patients).toBeUndefined();
    const o = await call(locationsGET, { as: fx.owner });
    expect(o.data.find((l: { code: string }) => l.code === 'COR')).toMatchObject({ active_patients: 2, active_users: 2, documents_count: 0 });
  });

  it('alta: valida, exige dueño y rechaza clave o nombre repetidos con 409', async () => {
    expect((await call(locationsPOST, { as: fx.therapistA, body: { code: 'XAL', name: 'Xalapa' } })).status).toBe(403);
    expect((await call(locationsPOST, { as: fx.owner, body: { code: 'X1', name: 'Xalapa' } })).status).toBe(400);
    expect((await call(locationsPOST, { as: fx.owner, body: { code: 'XAL', name: 'Xalapa', zip: '91' } })).status).toBe(400);
    const dupCode = await call(locationsPOST, { as: fx.owner, body: { code: 'cor', name: 'Córdoba Norte' } });
    expect(dupCode.status).toBe(409);
    expect(dupCode.error!.message).toBe('Ya existe una sede con esa clave.');
    expect((await call(locationsPOST, { as: fx.owner, body: { code: 'ORB', name: 'Orizaba' } })).status).toBe(409);

    const ok = await call(locationsPOST, { as: fx.owner, body: { code: 'xal', name: 'Xalapa', street: 'Av. Xalapa 10', city: 'Xalapa', zip: '91000', phone: '228 000 0000', hours: 'L-V 8:00-20:00' } });
    expect(ok.status).toBe(200);
    expect(ok.data).toMatchObject({ code: 'XAL', name: 'Xalapa', state: 'Veracruz', active: true });
    xalapa = ok.data.id;
  });

  it('edita; no desactiva una sede con pacientes o usuarios activos (409 con el conteo)', async () => {
    const edit = await call(locationPATCH, { as: fx.owner, method: 'PATCH', params: { id: fx.cordoba }, body: { phone: '271 111 2233', hours: 'L-S 7:00-21:00' } });
    expect(edit.status).toBe(200);
    expect(edit.data).toMatchObject({ phone: '271 111 2233', hours: 'L-S 7:00-21:00' });
    expect((await call(locationPATCH, { as: fx.therapistA, method: 'PATCH', params: { id: fx.cordoba }, body: { phone: '1' } })).status).toBe(403);

    const off = await call(locationPATCH, { as: fx.owner, method: 'PATCH', params: { id: fx.cordoba }, body: { active: false } });
    expect(off.status).toBe(409);
    expect(off.error!.code).toBe('location_in_use');
    expect(off.error!.message).toContain('2 pacientes activos');
    expect(off.error!.message).toContain('2 usuarios activos asignados');

    // una sede sin nadie sí se desactiva y se reactiva
    const offX = await call(locationPATCH, { as: fx.owner, method: 'PATCH', params: { id: xalapa }, body: { active: false } });
    expect(offX.data.active).toBe(false);
    expect((await call(locationPATCH, { as: fx.owner, method: 'PATCH', params: { id: xalapa }, body: { active: true } })).data.active).toBe(true);
    expect((await call(locationPATCH, { as: fx.owner, method: 'PATCH', params: { id: 'no-es-uuid' }, body: { name: 'Otra' } })).status).toBe(404);
  });

  it('la clave se puede cambiar solo mientras la sede no tenga documentos emitidos', async () => {
    const free = await call(locationPATCH, { as: fx.owner, method: 'PATCH', params: { id: xalapa }, body: { code: 'xlp' } });
    expect(free.data.code).toBe('XLP');
    await sqlAs(fx.therapistA, (tx) => tx`insert into documents (kind, patient_id) values ('indications', ${fx.patientA1})`);
    const locked = await call(locationPATCH, { as: fx.owner, method: 'PATCH', params: { id: fx.cordoba }, body: { code: 'CBA' } });
    expect(locked.status).toBe(409);
    expect(locked.error!.message).toContain('1 documento emitido');
    // mandar la misma clave junto con otros campos no estorba
    expect((await call(locationPATCH, { as: fx.owner, method: 'PATCH', params: { id: fx.cordoba }, body: { code: 'COR', city: 'Córdoba' } })).status).toBe(200);
  });
});

describe('CFG-05 / AGE-06 · catálogos', () => {
  const K = (kind: string) => ({ kind });
  it('lectura para todos, escritura solo del dueño, catálogo inexistente → 404', async () => {
    const r = await call(catalogGET, { as: fx.therapistA, params: K('session-types') });
    expect(r.status).toBe(200);
    expect(r.data.map((s: { name: string }) => s.name)).toEqual(['Fisioterapia', 'Readaptación deportiva', 'Ejercicio personalizado', 'Valoración inicial']);
    expect((await call(catalogPOST, { as: fx.therapistA, params: K('tags'), body: { name: 'Adulto mayor' } })).status).toBe(403);
    expect((await call(catalogPATCH, { as: fx.therapistA, method: 'PATCH', params: K('tags'), body: { name: 'Deportista', active: false } })).status).toBe(403);
    expect((await call(catalogGET, { as: fx.owner, params: K('usuarios') })).status).toBe(404);
  });

  it('tipos de sesión: alta, renombre, duración, desactivar y orden', async () => {
    const add = await call(catalogPOST, { as: fx.owner, params: K('session-types'), body: { name: 'Punción seca', default_duration_min: 30 } });
    expect(add.status).toBe(200);
    expect(add.data).toMatchObject({ name: 'Punción seca', default_duration_min: 30, position: 5, active: true });
    expect((await call(catalogPOST, { as: fx.owner, params: K('session-types'), body: { name: 'puncion seca' } })).status).toBe(409); // sin acentos ni mayúsculas
    expect((await call(catalogPOST, { as: fx.owner, params: K('session-types'), body: { name: 'Larga', default_duration_min: 600 } })).status).toBe(400);

    const up = await call(catalogPATCH, { as: fx.owner, method: 'PATCH', params: K('session-types'), body: { id: add.data.id, name: 'Punción seca guiada', default_duration_min: 40, active: false } });
    expect(up.data).toMatchObject({ name: 'Punción seca guiada', default_duration_min: 40, active: false });
    expect((await call(catalogPATCH, { as: fx.owner, method: 'PATCH', params: K('session-types'), body: { id: add.data.id, name: 'Fisioterapia' } })).status).toBe(409);

    const before = (await call(catalogGET, { as: fx.owner, params: K('session-types') })).data as { id: string; name: string }[];
    const order = [before[4].id, ...before.slice(0, 4).map((s) => s.id)];
    const sorted = await call(catalogPATCH, { as: fx.owner, method: 'PATCH', params: K('session-types'), body: { order } });
    expect(sorted.data.map((s: { name: string }) => s.name)[0]).toBe('Punción seca guiada');
    expect(sorted.data.map((s: { position: number }) => s.position)).toEqual([1, 2, 3, 4, 5]);
    // /api/meta (los selectores de toda la app) ve el cambio
    const meta = await call(metaGET, { as: fx.therapistA });
    expect(meta.data.session_types[0]).toMatchObject({ name: 'Punción seca guiada', active: false });
  });

  it('renombrar una etiqueta actualiza a los pacientes que la tienen (incluidos los de otros fisioterapeutas)', async () => {
    await sqlSystem((tx) => tx`update patients set tags = '{Deportista,Dolor crónico}' where id = ${fx.patientA1}`);
    await sqlSystem((tx) => tx`update patients set tags = '{Deportista}' where id = ${fx.patientB1}`);
    const r = await call(catalogPATCH, { as: fx.owner, method: 'PATCH', params: K('tags'), body: { name: 'Deportista', new_name: 'Atleta' } });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ name: 'Atleta', active: true });
    const rows = await sqlSystem((tx) => tx<{ id: string; tags: string[] }[]>`select id, tags from patients where id in (${fx.patientA1}, ${fx.patientB1}, ${fx.patientA2})`);
    expect(rows.find((p) => p.id === fx.patientA1)!.tags).toEqual(['Atleta', 'Dolor crónico']);
    expect(rows.find((p) => p.id === fx.patientB1)!.tags).toEqual(['Atleta']);
    expect(rows.find((p) => p.id === fx.patientA2)!.tags).toEqual([]);
    const names = (await call(catalogGET, { as: fx.therapistB, params: K('tags') })).data.map((t: { name: string }) => t.name);
    expect(names).toContain('Atleta');
    expect(names).not.toContain('Deportista');

    expect((await call(catalogPATCH, { as: fx.owner, method: 'PATCH', params: K('tags'), body: { name: 'Atleta', new_name: 'Neurológico' } })).status).toBe(409);
    expect((await call(catalogPATCH, { as: fx.owner, method: 'PATCH', params: K('tags'), body: { name: 'No existe', active: false } })).status).toBe(404);
    const off = await call(catalogPATCH, { as: fx.owner, method: 'PATCH', params: K('tags'), body: { name: 'Neurológico', active: false } });
    expect(off.data.active).toBe(false);
    const add = await call(catalogPOST, { as: fx.owner, params: K('tags'), body: { name: 'Adulto mayor' } });
    expect(add.data).toMatchObject({ name: 'Adulto mayor', position: 5 });
  });

  it('renombrar un tipo de estudio actualiza los estudios ya guardados', async () => {
    await sqlSystem((tx) => tx`insert into studies (patient_id, type_name, title, file_name, storage_path, mime, size_bytes, status)
      values (${fx.patientB1}, 'Radiografía', 'Rx de rodilla', 'rodilla.png', ${`patients/${fx.patientB1}/s1/rodilla.png`}, 'image/png', 72, 'ready')`);
    const r = await call(catalogPATCH, { as: fx.owner, method: 'PATCH', params: K('study-types'), body: { name: 'Radiografía', new_name: 'Rayos X' } });
    expect(r.status).toBe(200);
    const [s] = await sqlSystem((tx) => tx`select type_name from studies where patient_id = ${fx.patientB1}`);
    expect(s.type_name).toBe('Rayos X');
    expect((await call(catalogPATCH, { as: fx.owner, method: 'PATCH', params: K('study-types'), body: { name: 'Rayos X', default_duration_min: 30 } })).status).toBe(400);
  });
});

describe('CFG-09 · auditoría', () => {
  let eventId: string;
  it('es solo del dueño', async () => {
    expect((await call(auditGET, { as: fx.therapistA, url: '/api/audit' })).status).toBe(403);
    expect((await call(auditGET, { url: '/api/audit' })).status).toBe(401);
  });

  it('lista con filtros y dice qué campos cambiaron', async () => {
    await sqlAs(fx.therapistA, (tx) => tx`update patients set phone = '271 999 8877', address = 'Calle 5 No. 20' where id = ${fx.patientA1}`);
    const r = await call(auditGET, { as: fx.owner, url: `/api/audit?table=patients&action=update&actor_id=${fx.therapistA.id}` });
    expect(r.status).toBe(200);
    expect(r.data.total).toBe(1);
    expect(r.data.items[0]).toMatchObject({
      actor_name: 'L.F.T. Karla Ocampo', action: 'update', table_name: 'patients', row_id: fx.patientA1,
      patient_id: fx.patientA1, patient_name: 'Ana Prueba Uno', changed: ['address', 'phone'],
    });
    expect(r.data.items[0].before).toBeUndefined(); // el detalle solo viaja al abrir un evento
    eventId = r.data.items[0].id;

    const all = await call(auditGET, { as: fx.owner, url: '/api/audit?limit=5' });
    expect(all.data.items).toHaveLength(5);
    expect(all.data.total).toBeGreaterThan(20);
    const page2 = await call(auditGET, { as: fx.owner, url: '/api/audit?limit=5&offset=5' });
    expect(page2.data.items[0].id).not.toBe(all.data.items[0].id);

    const byPatient = await call(auditGET, { as: fx.owner, url: `/api/audit?patient_id=${fx.patientB1}` });
    expect(byPatient.data.total).toBeGreaterThan(0);
    expect(byPatient.data.items.every((i: { patient_id: string }) => i.patient_id === fx.patientB1)).toBe(true);
    const byTable = await call(auditGET, { as: fx.owner, url: '/api/audit?table=locations&action=insert' });
    expect(byTable.data.items.map((i: { row_label: string }) => i.row_label)).toEqual(['Xalapa']);
    const byText = await call(auditGET, { as: fx.owner, url: '/api/audit?q=carmen' });
    expect(byText.data.total).toBeGreaterThan(0);
    expect(byText.data.items.every((i: { patient_name: string }) => i.patient_name === 'Carmen Prueba Tres')).toBe(true);

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
    expect((await call(auditGET, { as: fx.owner, url: `/api/audit?from=${today}&to=${today}` })).data.total).toBe(all.data.total);
    expect((await call(auditGET, { as: fx.owner, url: '/api/audit?to=2020-01-01' })).data.total).toBe(0);
    expect((await call(auditGET, { as: fx.owner, url: '/api/audit?from=ayer' })).status).toBe(400);
  });

  it('detalle de un evento con antes y después; catálogo de filtros', async () => {
    const d = await call(auditGET, { as: fx.owner, url: `/api/audit?id=${eventId}` });
    expect(d.status).toBe(200);
    expect(d.data.before.phone).toBe('271 000 0000');
    expect(d.data.after.phone).toBe('271 999 8877');
    expect(d.data.after.address).toBe('Calle 5 No. 20');
    expect(d.data.after.search).toBeUndefined();
    expect((await call(auditGET, { as: fx.owner, url: '/api/audit?id=99999999' })).status).toBe(404);
    const f = await call(auditGET, { as: fx.owner, url: '/api/audit?facets=1' });
    expect(f.data.actors.map((a: { name: string }) => a.name)).toEqual(expect.arrayContaining(['L.F.T. Karla Ocampo', 'Nicolas Herrera']));
    expect(f.data.tables).toEqual(expect.arrayContaining(['patients', 'clinic', 'locations']));
    expect(f.data.actions).toEqual(expect.arrayContaining(['insert', 'update']));
  });
});

describe('CFG-10 · exportar datos', () => {
  let studyPath: string;
  beforeAll(async () => {
    studyPath = `patients/${fx.patientA1}/estudio1/rx-torax.png`;
    await storage.write(studyPath, PNG, 'image/png');
    await sqlAs(fx.therapistA, async (tx) => {
      await tx`insert into clinical_profiles (patient_id, diagnosis, treatment_plan) values (${fx.patientA1}, 'Lumbalgia mecánica', 'Fortalecimiento')`;
      await tx`insert into exercises (patient_id, name, dosage) values (${fx.patientA1}, 'Puente de glúteo', '3x12')`;
      await tx`insert into evolution_notes (patient_id, body, pain_level, author_id, author_name, signature_hash) values (${fx.patientA1}, 'Evoluciona bien', 3, ${fx.therapistA.id}, '', '')`;
      await tx`insert into consents (patient_id, kind, body_snapshot, signer_name, signature_png) values (${fx.patientA1}, 'informed', 'Texto firmado', 'Ana Prueba Uno', ${SIGNATURE})`;
      await tx`insert into studies (patient_id, type_name, title, file_name, storage_path, mime, size_bytes, status)
               values (${fx.patientA1}, 'Rayos X', 'Rx de tórax', 'rx tórax.png', ${studyPath}, 'image/png', ${PNG.length}, 'ready')`;
      await tx`insert into studies (patient_id, type_name, title, file_name, storage_path, mime, size_bytes, status)
               values (${fx.patientA1}, 'Documento', 'Laboratorio perdido', 'lab.pdf', ${`patients/${fx.patientA1}/estudio2/lab.pdf`}, 'application/pdf', 100, 'ready')`;
    });
    await sqlSystem((tx) => tx`insert into devices (name, location_id, password_enc, webhook_token_hash, webhook_token_enc, bridge_token_hash, bridge_token_enc)
      values ('Recepción', ${fx.cordoba}, 'SECRETO-LECTOR-ENC', 'SECRETO-HASH-1', 'SECRETO-WEBHOOK-ENC', 'SECRETO-HASH-2', 'SECRETO-PUENTE-ENC')`);
  });

  it('expediente de un paciente: solo dueño, ZIP con todo y sin secretos', async () => {
    expect((await call(exportPatientGET, { as: fx.therapistA, params: { id: fx.patientA1 } })).status).toBe(403);
    expect((await call(exportPatientGET, { as: fx.owner, params: { id: '00000000-0000-4000-8000-000000000000' } })).status).toBe(404);

    const r = await call(exportPatientGET, { as: fx.owner, params: { id: fx.patientA1 } });
    expect(r.status).toBe(200);
    expect(r.res.headers.get('content-type')).toBe('application/zip');
    expect(r.res.headers.get('content-disposition')).toMatch(/attachment; filename="expediente-NCE-\d{6}-\d{4}-\d{2}-\d{2}\.zip"/);
    const zip = await zipOf(r.res);
    const names = Object.keys(zip);
    expect(names).toEqual(expect.arrayContaining(['expediente.json', 'resumen.txt', 'LEEME.txt', 'faltantes.txt']));

    const raw = strFromU8(zip['expediente.json']);
    expect(raw).not.toContain('password_hash');
    expect(raw).not.toContain('scrypt$');
    expect(raw).not.toContain('signature_png');
    expect(raw).not.toContain('data:image/png;base64');
    const json = JSON.parse(raw);
    expect(json.patient).toMatchObject({ full_name: 'Ana Prueba Uno', therapist_name: 'L.F.T. Karla Ocampo', location_name: 'Córdoba' });
    expect(json.patient.search).toBeUndefined();
    expect(json.clinical_profiles[0]).toMatchObject({ version: 1, diagnosis: 'Lumbalgia mecánica' });
    expect(json.exercises).toHaveLength(1);
    expect(json.evolution_notes[0]).toMatchObject({ body: 'Evoluciona bien', author_name: 'L.F.T. Karla Ocampo' });
    expect(json.documents).toHaveLength(1);
    expect(json.documents[0].items).toEqual([]);
    expect(json.memberships[0].plan_name).toBe('Mensual Elite');
    expect(json.payments).toEqual([]);
    expect(json.studies).toHaveLength(2);

    // firma del consentimiento: archivo aparte, idéntico al original
    const sigFile = json.consents[0].signature_file as string;
    expect(sigFile).toMatch(/^consentimientos\/informed-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.png$/);
    expect(Buffer.from(zip[sigFile]).equals(PNG)).toBe(true);
    // estudio real incluido; el que no se pudo leer queda listado
    const studyFile = json.studies.find((s: { title: string }) => s.title === 'Rx de tórax').export_file as string;
    expect(studyFile).toMatch(/^estudios\/\d{4}-\d{2}-\d{2}_[0-9a-f]{8}_rx_torax\.png$/);
    expect(Buffer.from(zip[studyFile]).equals(PNG)).toBe(true);
    expect(json.studies.find((s: { title: string }) => s.title === 'Laboratorio perdido').export_file).toBeNull();
    expect(strFromU8(zip['faltantes.txt'])).toContain('Laboratorio perdido');
    expect(strFromU8(zip['resumen.txt'])).toContain('Diagnóstico: Lumbalgia mecánica');
    expect(strFromU8(zip['LEEME.txt'])).toContain('estudios/');

    const [ev] = await sqlSystem((tx) => tx`select actor_id, summary from audit_log where action = 'export' and patient_id = ${fx.patientA1}`);
    expect(ev.actor_id).toBe(fx.owner.id);
    expect(ev.summary).toContain('Ana Prueba Uno');
  });

  it('respaldo general: un CSV por tabla, sin contraseñas ni credenciales de lectores', async () => {
    expect((await call(backupGET, { as: fx.therapistA })).status).toBe(403);
    const r = await call(backupGET, { as: fx.owner });
    expect(r.status).toBe(200);
    expect(r.res.headers.get('content-type')).toBe('application/zip');
    const zip = await zipOf(r.res);
    expect(Object.keys(zip).sort()).toEqual(['LEEME.txt', 'asistencias.csv', 'bitacora.csv', 'citas.csv', 'consentimientos.csv', 'documentos.csv',
      'documentos_renglones.csv', 'ejercicios.csv', 'estudios.csv', 'membresias.csv', 'notas_evolucion.csv', 'pacientes.csv', 'pagos.csv',
      'perfiles_clinicos.csv', 'planes.csv', 'sedes.csv', 'usuarios.csv']);

    const everything = Object.values(zip).map((b) => Buffer.from(b).toString('latin1')).join('\n');
    for (const secret of ['scrypt$', 'password_hash', 'password_enc', 'token_enc', 'token_hash', 'SECRETO-', 'data:image/png;base64']) {
      expect(everything.includes(secret), secret).toBe(false);
    }
    const [u] = await sqlSystem((tx) => tx<{ password_hash: string }[]>`select password_hash from users limit 1`);
    expect(u.password_hash.startsWith('scrypt$')).toBe(true); // la búsqueda anterior sí busca el formato real
    expect(everything.includes(u.password_hash)).toBe(false);

    const patients = strFromU8(zip['pacientes.csv']);
    expect([...zip['pacientes.csv'].slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM para Excel
    expect(patients.split('\r\n')[0]).toContain('record_number,full_name');
    expect(patients.split('\r\n').filter(Boolean)).toHaveLength(4); // encabezado + 3 pacientes
    expect(patients).toContain('Atleta; Dolor crónico');
    const users = strFromU8(zip['usuarios.csv']);
    expect(users).toContain('karla@prueba.mx');
    expect(strFromU8(zip['pagos.csv']).split('\r\n')[0]).toContain('receipt_number'); // tabla vacía: conserva encabezados
    expect(strFromU8(zip['bitacora.csv'])).toContain('Exportó el expediente completo');
    expect(strFromU8(zip['LEEME.txt'])).toContain('Supabase');

    const [{ n }] = await sqlSystem((tx) => tx<{ n: number }[]>`select count(*)::int as n from audit_log where action = 'export' and summary like 'Descargó el respaldo%'`);
    expect(n).toBe(1);
  });

  it('el CSV escapa comas, comillas y saltos de línea', () => {
    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(toCsv(['a', 'b'], [{ a: 'uno, dos', b: 'dijo "hola"\nadiós' }, { a: null, b: new Date('2026-01-02T03:04:05Z') }]));
    expect(csv).toBe('﻿a,b\r\n"uno, dos","dijo ""hola""\nadiós"\r\n,2026-01-02T03:04:05.000Z\r\n');
  });
});

describe('LEG-03 · solicitudes ARCO', () => {
  const form = { requester_name: 'Regina Solís', contact: 'regina@correo.mx', kind: 'acceso', details: 'Quiero una copia de mi expediente clínico.' };
  let id: string;

  it('cualquier persona sin sesión puede presentar una solicitud', async () => {
    const r = await call(arcoPOST, { body: form, headers: { 'x-forwarded-for': '201.10.10.1' } });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ received: true, response_days: 20 });
    id = r.data.id;
    const [row] = await sqlSystem((tx) => tx`select requester_name, kind, status from arco_requests where id = ${id}`);
    expect(row).toMatchObject({ requester_name: 'Regina Solís', kind: 'acceso', status: 'recibida' });
  });

  it('valida longitudes y tipo', async () => {
    const bad = await call(arcoPOST, { body: { requester_name: 'R', contact: '1', kind: 'borrar', details: 'corto' }, headers: { 'x-forwarded-for': '201.10.10.2' } });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.error!.fields!).sort()).toEqual(['contact', 'details', 'kind', 'requester_name']);
    expect((await call(arcoPOST, { body: { ...form, details: 'x'.repeat(3001) }, headers: { 'x-forwarded-for': '201.10.10.2' } })).status).toBe(400);
  });

  it('límite anti-abuso: 5 por hora desde la misma IP; otra IP no se ve afectada', async () => {
    const from = (ip: string) => call(arcoPOST, { body: form, headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` } });
    for (let i = 0; i < 5; i++) expect((await from('189.20.30.40')).status, `envío ${i + 1}`).toBe(200);
    const blocked = await from('189.20.30.40');
    expect(blocked.status).toBe(429);
    expect(blocked.error!.code).toBe('rate_limited');
    expect((await from('189.20.30.41')).status).toBe(200);
    const [{ n }] = await sqlSystem((tx) => tx<{ n: number }[]>`select count(*)::int as n from arco_requests`);
    expect(n).toBe(7); // 1 + 5 + 1: la bloqueada no se guardó
    // la IP no queda guardada en claro
    const [{ leaked }] = await sqlSystem((tx) => tx<{ leaked: number }[]>`select count(*)::int as leaked from audit_log where coalesce(row_id, '') || summary like '%189.20.30%'`);
    expect(leaked).toBe(0);
    // pasada la hora vuelve a aceptar
    await sqlSystem(async (tx) => {
      // La bitácora es inmutable: solo para simular el paso del tiempo se suspende su candado dentro de esta transacción.
      await tx.unsafe('alter table audit_log disable trigger audit_log_immutable');
      await tx`update audit_log set at = at - interval '61 minutes' where action = 'arco_submit'`;
      await tx.unsafe('alter table audit_log enable trigger audit_log_immutable');
    });
    expect((await from('189.20.30.40')).status).toBe(200);
  });

  it('un robot que llena el campo trampa recibe respuesta pero no se guarda', async () => {
    const [{ n: before }] = await sqlSystem((tx) => tx<{ n: number }[]>`select count(*)::int as n from arco_requests`);
    const r = await call(arcoPOST, { body: { ...form, website: 'http://spam.example' }, headers: { 'x-forwarded-for': '201.10.10.9' } });
    expect(r.status).toBe(200);
    const [{ n: after }] = await sqlSystem((tx) => tx<{ n: number }[]>`select count(*)::int as n from arco_requests`);
    expect(after).toBe(before);
  });

  it('la bandeja y el seguimiento son solo del dueño', async () => {
    expect((await call(arcoGET, { as: fx.therapistA, url: '/api/arco' })).status).toBe(403);
    expect((await call(arcoGET, { url: '/api/arco' })).status).toBe(401);
    expect((await call(arcoPATCH, { as: fx.therapistA, method: 'PATCH', params: { id }, body: { status: 'resuelta', resolution: 'Entregado' } })).status).toBe(403);

    const list = await call(arcoGET, { as: fx.owner, url: '/api/arco' });
    expect(list.data.pending).toBe(8);
    expect(list.data.items).toHaveLength(8);

    const working = await call(arcoPATCH, { as: fx.owner, method: 'PATCH', params: { id }, body: { status: 'en_proceso' } });
    expect(working.data).toMatchObject({ status: 'en_proceso', resolved_at: null });
    const noNote = await call(arcoPATCH, { as: fx.owner, method: 'PATCH', params: { id }, body: { status: 'resuelta' } });
    expect(noNote.status).toBe(400);
    expect(noNote.error!.fields!.resolution).toBeTruthy();
    const done = await call(arcoPATCH, { as: fx.owner, method: 'PATCH', params: { id }, body: { status: 'resuelta', resolution: 'Se entregó copia del expediente en recepción.' } });
    expect(done.data.status).toBe('resuelta');
    expect(done.data.resolved_at).toBeTruthy();
    expect((await call(arcoGET, { as: fx.owner, url: '/api/arco' })).data.pending).toBe(7);
    expect((await call(arcoGET, { as: fx.owner, url: '/api/arco?status=resuelta' })).data.items).toHaveLength(1);
    expect((await call(arcoPATCH, { as: fx.owner, method: 'PATCH', params: { id: '00000000-0000-4000-8000-000000000000' }, body: { status: 'en_proceso' } })).status).toBe(404);
  });
});

describe('DEP-01 / PAG-03 · tarea diaria', () => {
  it('sin token o con token equivocado no corre', async () => {
    expect((await call(cronGET, { url: '/api/cron/daily' })).status).toBe(401);
    expect((await call(cronGET, { url: '/api/cron/daily', headers: { authorization: 'Bearer otro-secreto' } })).status).toBe(401);
    expect((await call(cronGET, { url: '/api/cron/daily', headers: { authorization: 'cron-de-pruebas' } })).status).toBe(401);
  });

  it('sin CRON_SECRET configurado responde 503 aunque llegue cualquier token', async () => {
    const e = env();
    const saved = e.CRON_SECRET;
    e.CRON_SECRET = '';
    try {
      const r = await call(cronGET, { url: '/api/cron/daily', headers: { authorization: 'Bearer ' } });
      expect(r.status).toBe(503);
      expect(r.error!.code).toBe('not_configured');
    } finally {
      e.CRON_SECRET = saved;
    }
  });

  it('con el token ejecuta la limpieza y marca "no asistió" la cita vieja', async () => {
    const [old] = await sqlSystem((tx) => tx<{ id: string }[]>`
      insert into appointments (patient_id, therapist_id, location_id, starts_at, duration_min, type_name)
      values (${fx.patientA1}, ${fx.therapistA.id}, ${fx.cordoba}, now() - interval '3 days', 50, 'Fisioterapia') returning id`);
    const [future] = await sqlSystem((tx) => tx<{ id: string }[]>`
      insert into appointments (patient_id, therapist_id, location_id, starts_at, duration_min, type_name)
      values (${fx.patientA1}, ${fx.therapistA.id}, ${fx.cordoba}, now() + interval '3 days', 50, 'Fisioterapia') returning id`);
    const r = await call(cronGET, { url: '/api/cron/daily', headers: { authorization: 'Bearer cron-de-pruebas' } });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ no_show: 1, sessions_purged: 0, tokens_purged: 0 });
    const rows = await sqlSystem((tx) => tx<{ id: string; status: string }[]>`select id, status from appointments where id in (${old.id}, ${future.id})`);
    expect(rows.find((a) => a.id === old.id)!.status).toBe('no_show');
    expect(rows.find((a) => a.id === future.id)!.status).toBe('scheduled');
    // volver a correrla no hace daño
    expect((await call(cronGET, { url: '/api/cron/daily', headers: { authorization: 'Bearer cron-de-pruebas' } })).data.no_show).toBe(0);
  });
});
