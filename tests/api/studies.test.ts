// QA-02 · Integración de la API probada como dueño y como fisioterapeuta.
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { GET as LIST, POST as CREATE } from '@/app/api/studies/route';
import { GET as DETAIL, PATCH } from '@/app/api/studies/[id]/route';
import { POST as COMPLETE } from '@/app/api/studies/[id]/complete/route';
import { POST as ARCHIVE } from '@/app/api/studies/[id]/archive/route';
import { GET as FILE_GET } from '@/app/api/files/get/route';
import { PUT as FILE_PUT } from '@/app/api/files/upload/route';
import { MAX_UPLOAD_BYTES, storage } from '@/lib/storage';
import { sampleDicom, sampleJpeg, samplePdf } from '../../scripts/lib/sample-files';
import { call, fixtures, sqlSystem, type Fixtures, type TestUser } from '../helpers';

// tests/helpers.ts → resetData() ejecuta `set local session_replication_role`, que exige superusuario; el rol
// nce_admin de este entorno no lo es y la transacción de limpieza se aborta. TRUNCATE no dispara triggers
// por fila, así que aquí solo se omite esa sentencia; todo lo demás de @/lib/db pasa intacto.
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
beforeAll(async () => { fx = await fixtures(); });

const origin = 'http://localhost:3000';
const put = (url: string, body: Buffer, type = 'application/octet-stream') =>
  FILE_PUT(new NextRequest(origin + url, { method: 'PUT', body: new Uint8Array(body), headers: { 'content-type': type, 'content-length': String(body.length) }, duplex: 'half' } as never));
const fetchFile = (url: string) => FILE_GET(new NextRequest(origin + url));

type NewStudy = { patient_id: string; type_name?: string; title?: string; file_name?: string; mime?: string; size_bytes?: number; study_date?: string; with_thumb?: boolean };
const create = (as: TestUser, s: NewStudy) => call(CREATE, {
  as, url: '/api/studies',
  body: { type_name: 'Radiografía', title: 'Rx de prueba', file_name: 'rx.jpg', size_bytes: 1000, with_thumb: false, ...s },
});
const list = (as: TestUser, query = '') => call(LIST, { as, url: `/api/studies${query}` });
const detail = (as: TestUser, id: string) => call(DETAIL, { as, url: `/api/studies/${id}`, params: { id } });
const complete = (as: TestUser, id: string) => call(COMPLETE, { as, url: `/api/studies/${id}/complete`, method: 'POST', params: { id } });
const archive = (as: TestUser, id: string, body: unknown) => call(ARCHIVE, { as, url: `/api/studies/${id}/archive`, body, params: { id } });

/** Flujo completo de subida con el controlador local; devuelve el id del estudio ya `ready`. */
async function upload(as: TestUser, s: NewStudy, file: Buffer, thumb?: Buffer): Promise<string> {
  const r = await create(as, { size_bytes: file.length, with_thumb: !!thumb, ...s });
  expect(r.status).toBe(200);
  expect((await put(r.data.upload.url, file)).status).toBe(200);
  if (thumb) expect((await put(r.data.thumb_upload.url, thumb, 'image/jpeg')).status).toBe(200);
  const c = await complete(as, r.data.study.id);
  expect(c.status).toBe(200);
  return r.data.study.id;
}

describe('EST-02 · subida en tres pasos', () => {
  it('POST → subir con el boleto → complete → aparece en el listado', async () => {
    const jpg = await sampleJpeg(1, 300, 360);
    const thumb = await sampleJpeg(1, 120, 140);
    const r = await create(fx.therapistA, {
      patient_id: fx.patientA1, title: 'Rx rodilla izquierda', file_name: 'Radiografía rodilla (izq).JPG', mime: 'image/jpeg',
      size_bytes: jpg.length + 5, study_date: '2026-01-15', with_thumb: true,
    });
    expect(r.status).toBe(200);
    const { study, upload: ticket, thumb_upload } = r.data;
    expect(study).toMatchObject({ status: 'pending', patient_id: fx.patientA1, type_name: 'Radiografía', title: 'Rx rodilla izquierda',
      file_name: 'Radiografía rodilla (izq).JPG', mime: 'image/jpeg', study_date: '2026-01-15', uploaded_by: fx.therapistA.id,
      uploaded_by_name: 'L.F.T. Karla Ocampo', patient_name: 'Ana Prueba Uno' });
    // EST-01: la respuesta no expone rutas de almacenamiento.
    expect(study).not.toHaveProperty('storage_path');
    expect(study).not.toHaveProperty('thumb_path');
    expect(ticket.driver).toBe('local');
    expect(thumb_upload.driver).toBe('local');

    const [row] = await sqlSystem((tx) => tx`select storage_path, thumb_path, status from studies where id = ${study.id}`);
    expect(row.storage_path).toBe(`patients/${fx.patientA1}/${study.id}/Radiografia_rodilla_izq.jpg`);
    expect(row.thumb_path).toBe(`patients/${fx.patientA1}/${study.id}/thumb.jpg`);

    // Mientras está pendiente no se lista ni se puede abrir.
    expect((await list(fx.therapistA)).data).toEqual([]);
    expect((await detail(fx.therapistA, study.id)).status).toBe(404);

    expect((await put(ticket.url, jpg, 'image/jpeg')).status).toBe(200);
    expect((await put(thumb_upload.url, thumb, 'image/jpeg')).status).toBe(200);
    const done = await complete(fx.therapistA, study.id);
    expect(done.status).toBe(200);
    expect(done.data).toMatchObject({ status: 'ready', size_bytes: jpg.length, has_thumb: true }); // tamaño real, no el declarado
    expect((await complete(fx.therapistA, study.id)).status).toBe(200); // idempotente

    const l = await list(fx.therapistA);
    expect(l.status).toBe(200);
    expect(l.data).toHaveLength(1);
    expect(l.data[0]).toMatchObject({ id: study.id, patient_name: 'Ana Prueba Uno', title: 'Rx rodilla izquierda' });
    // El listado trae la miniatura firmada, pero nunca la URL del archivo ni rutas.
    expect(l.data[0].thumb_url).toContain('thumb.jpg');
    for (const k of ['file_url', 'download_url', 'storage_path', 'thumb_path']) expect(l.data[0]).not.toHaveProperty(k);
    const t = await fetchFile(l.data[0].thumb_url);
    expect(t.status).toBe(200);
    expect(Buffer.from(await t.arrayBuffer()).equals(thumb)).toBe(true);
  });

  it('complete sin archivo → 400 y sigue sin listarse; con archivo vacío también', async () => {
    const r = await create(fx.therapistA, { patient_id: fx.patientA2, title: 'Nunca llegó' });
    const c = await complete(fx.therapistA, r.data.study.id);
    expect(c.status).toBe(400);
    expect(c.error?.message).toMatch(/no terminó de subirse/);
    expect((await put(r.data.upload.url, Buffer.alloc(0))).status).toBeLessThan(500);
    expect((await complete(fx.therapistA, r.data.study.id)).status).toBe(400);
    expect((await list(fx.owner, `?patient_id=${fx.patientA2}`)).data).toEqual([]);
  });

  it('si la miniatura no llegó, complete la descarta', async () => {
    const pdfLike = await sampleJpeg(2, 80, 80);
    const r = await create(fx.therapistA, { patient_id: fx.patientA2, title: 'Sin miniatura', with_thumb: true });
    await put(r.data.upload.url, pdfLike);
    const c = await complete(fx.therapistA, r.data.study.id);
    expect(c.data).toMatchObject({ status: 'ready', has_thumb: false, thumb_url: null });
    const [row] = await sqlSystem((tx) => tx`select thumb_path from studies where id = ${r.data.study.id}`);
    expect(row.thumb_path).toBeNull();
  });

  it('valida tipo de archivo, tamaño, tipo de estudio, fecha y paciente', async () => {
    const exe = await create(fx.therapistA, { patient_id: fx.patientA1, file_name: 'instalador.exe' });
    expect(exe.status).toBe(400);
    expect(exe.error?.fields?.file).toMatch(/no se admite/);
    // Una extensión prohibida no pasa aunque declare ser imagen.
    expect((await create(fx.therapistA, { patient_id: fx.patientA1, file_name: 'instalador.exe', mime: 'image/jpeg' })).status).toBe(400);

    const big = await create(fx.therapistA, { patient_id: fx.patientA1, file_name: 'rm.dcm', size_bytes: MAX_UPLOAD_BYTES + 1 });
    expect(big.status).toBe(400);
    expect(big.error?.message).toMatch(/200 MB/);
    expect((await create(fx.therapistA, { patient_id: fx.patientA1, size_bytes: 0 })).status).toBe(400);

    const type = await create(fx.therapistA, { patient_id: fx.patientA1, type_name: 'Tipo inventado' });
    expect(type.status).toBe(400);
    expect(type.error?.fields?.type_name).toBeTruthy();

    expect((await create(fx.therapistA, { patient_id: fx.patientA1, study_date: '2999-01-01' })).status).toBe(400);
    expect((await create(fx.therapistA, { patient_id: fx.patientA1, title: '   ' })).status).toBe(400);
    expect((await create(fx.therapistA, { patient_id: 'no-es-uuid' })).status).toBe(400);
    expect((await create(null as never, { patient_id: fx.patientA1 })).status).toBe(401);

    // Los tipos permitidos sí pasan (PDF nunca lleva miniatura; DICOM sin MIME declarado).
    const pdf = await create(fx.therapistA, { patient_id: fx.patientA1, file_name: 'informe.pdf', with_thumb: true });
    expect(pdf.status).toBe(200);
    expect(pdf.data.study.mime).toBe('application/pdf');
    expect(pdf.data.thumb_upload).toBeUndefined();
    const dcm = await create(fx.therapistA, { patient_id: fx.patientA1, file_name: 'IM0001.DCM' });
    expect(dcm.data.study.mime).toBe('application/dicom');
  });
});

describe('EST-01 / AUTH-06 · archivos privados y aislamiento por rol', () => {
  let idA: string, idB: string, idPdf: string;
  beforeAll(async () => {
    idA = await upload(fx.therapistA, { patient_id: fx.patientA1, title: 'Resonancia lumbar', type_name: 'Resonancia', file_name: 'rm lumbar.dcm' }, sampleDicom(1, 64, 64));
    idB = await upload(fx.therapistB, { patient_id: fx.patientB1, title: 'Ultrasonido de hombro', type_name: 'Ultrasonido', file_name: 'us_hombro.jpg' }, await sampleJpeg(3, 200, 200), await sampleJpeg(3, 80, 80));
    idPdf = await upload(fx.owner, { patient_id: fx.patientB1, title: 'Informe de laboratorio', type_name: 'Laboratorio', file_name: 'Informe análisis.pdf' }, await samplePdf('Informe', ['Línea 1']));
  });

  it('B no puede subir a un paciente de A (404) ni completar una subida ajena', async () => {
    expect((await create(fx.therapistB, { patient_id: fx.patientA1 })).status).toBe(404);
    const r = await create(fx.therapistA, { patient_id: fx.patientA1, title: 'Pendiente de A' });
    await put(r.data.upload.url, Buffer.from('datos'));
    expect((await complete(fx.therapistB, r.data.study.id)).status).toBe(404);
    const [row] = await sqlSystem((tx) => tx`select status from studies where id = ${r.data.study.id}`);
    expect(row.status).toBe('pending');
  });

  it('el listado respeta el rol: cada fisioterapeuta ve lo suyo y el dueño ve todo', async () => {
    const a = (await list(fx.therapistA)).data.map((s: any) => s.id);
    const b = (await list(fx.therapistB)).data.map((s: any) => s.id);
    const o = (await list(fx.owner)).data.map((s: any) => s.id);
    expect(a).toContain(idA);
    expect(a).not.toContain(idB);
    expect(a).not.toContain(idPdf);
    expect(b.sort()).toEqual([idB, idPdf].sort());
    expect(o).toEqual(expect.arrayContaining([idA, idB, idPdf]));
    // Ni filtrando por el paciente ajeno ni buscándolo por nombre aparece.
    expect((await list(fx.therapistB, `?patient_id=${fx.patientA1}`)).data).toEqual([]);
    expect((await list(fx.therapistB, '?q=lumbar')).data).toEqual([]);
    expect((await list(fx.therapistB, '?q=Ana%20Prueba%20Uno')).data).toEqual([]);
    expect((await list(null as never)).status).toBe(401);
  });

  it('B no obtiene el registro ni URL alguna del estudio de A; tampoco puede editarlo', async () => {
    const r = await detail(fx.therapistB, idA);
    expect(r.status).toBe(404);
    expect(r.data).toBeUndefined();
    expect(JSON.stringify(await r.res.clone().json())).not.toMatch(/files\/get|patients\//);
    const p = await call(PATCH, { as: fx.therapistB, url: `/api/studies/${idA}`, method: 'PATCH', body: { title: 'Hackeado' }, params: { id: idA } });
    expect(p.status).toBe(404);
    expect((await detail(fx.therapistA, 'no-es-uuid')).status).toBe(404);
  });

  it('el detalle entrega URLs firmadas que sirven el archivo, con el nombre original al descargar', async () => {
    const r = await detail(fx.owner, idPdf);
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ id: idPdf, patient_name: 'Carmen Prueba Tres', mime: 'application/pdf', url_expires_in: 300 });
    expect(r.data).not.toHaveProperty('storage_path');
    const f = await fetchFile(r.data.file_url);
    expect(f.status).toBe(200);
    expect(f.headers.get('content-type')).toBe('application/pdf');
    expect(f.headers.get('content-disposition')).toBeNull();
    expect(Buffer.from(await f.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    const d = await fetchFile(r.data.download_url);
    expect(d.status).toBe(200);
    expect(d.headers.get('content-disposition')).toBe(`attachment; filename*=UTF-8''${encodeURIComponent('Informe análisis.pdf')}`);
    await d.arrayBuffer();
    // La firma dura 5 minutos.
    const exp = Number(new URL(origin + r.data.file_url).searchParams.get('exp'));
    expect(exp - Date.now() / 1000).toBeGreaterThan(280);
    expect(exp - Date.now() / 1000).toBeLessThanOrEqual(301);
  });

  it('una URL con `exp` vencido o alterada responde 403', async () => {
    const r = await detail(fx.therapistA, idA);
    const url = new URL(origin + r.data.file_url);
    expect((await fetchFile(url.pathname + url.search)).status).toBe(200);

    const expired = new URL(url);
    expired.searchParams.set('exp', String(Math.floor(Date.now() / 1000) - 10));
    expect((await fetchFile(expired.pathname + expired.search)).status).toBe(403);

    // Alargar la vigencia sin volver a firmar tampoco sirve, ni reusar la firma para otro archivo.
    const extended = new URL(url);
    extended.searchParams.set('exp', String(Math.floor(Date.now() / 1000) + 99999));
    expect((await fetchFile(extended.pathname + extended.search)).status).toBe(403);
    const [other] = await sqlSystem((tx) => tx`select storage_path from studies where id = ${idB}`);
    const swapped = new URL(url);
    swapped.searchParams.set('path', other.storage_path);
    expect((await fetchFile(swapped.pathname + swapped.search)).status).toBe(403);
    // Y una firma realmente vencida (generada en el pasado) se rechaza.
    const old = await storage.signedUrl(other.storage_path, { expiresIn: -5 });
    expect((await fetchFile(old)).status).toBe(403);
  });

  it('abrir el detalle deja un evento `view` en la bitácora', async () => {
    const before = await sqlSystem((tx) => tx`select count(*)::int as n from audit_log where action = 'view' and row_id = ${idA}`);
    await detail(fx.therapistA, idA);
    const rows = await sqlSystem((tx) => tx`
      select actor_id, actor_name, action, table_name, row_id, patient_id, summary from audit_log
      where action = 'view' and row_id = ${idA} order by id desc`);
    expect(rows.length).toBe(before[0].n + 1);
    expect(rows[0]).toMatchObject({ actor_id: fx.therapistA.id, action: 'view', table_name: 'studies', row_id: idA,
      patient_id: fx.patientA1, summary: 'Abrió estudio: Resonancia lumbar' });
    // Un intento rechazado no deja rastro de acceso concedido.
    await detail(fx.therapistB, idA);
    const after = await sqlSystem((tx) => tx`select count(*)::int as n from audit_log where action = 'view' and row_id = ${idA}`);
    expect(after[0].n).toBe(before[0].n + 1);
  });
});

describe('EST-03 · búsqueda y filtros', () => {
  it('busca sin acentos por título, archivo, tipo y paciente; filtra por tipo y paciente; pagina', async () => {
    const ids = async (q: string) => (await list(fx.owner, q)).data.map((s: any) => s.title);
    expect(await ids('?q=LUMBAR')).toEqual(['Resonancia lumbar']);
    expect(await ids('?q=analisis')).toEqual(['Informe de laboratorio']);            // nombre de archivo, sin acento
    expect(await ids('?q=radiografia')).toEqual(expect.arrayContaining(['Rx rodilla izquierda'])); // tipo
    expect((await ids('?q=carmen')).sort()).toEqual(['Informe de laboratorio', 'Ultrasonido de hombro']); // paciente
    expect(await ids('?q=carmen%20hombro')).toEqual(['Ultrasonido de hombro']);      // varias palabras
    expect(await ids('?q=%25')).toEqual([]);                                         // % y _ no son comodines
    expect(await ids('?q=lumb_r')).toEqual([]);
    expect(await ids('?q=us_hombro')).toEqual(['Ultrasonido de hombro']);
    expect(await ids('?type=Ultrasonido')).toEqual(['Ultrasonido de hombro']);
    expect((await ids(`?patient_id=${fx.patientB1}`)).length).toBe(2);
    const all = await ids('');
    expect(await ids('?limit=2')).toEqual(all.slice(0, 2));
    expect(await ids('?limit=2&offset=2')).toEqual(all.slice(2, 4));
    expect((await list(fx.owner, '?patient_id=xyz')).status).toBe(400);
  });

  it('PATCH corrige título, tipo y fecha (quien ve al paciente)', async () => {
    const id = await upload(fx.therapistA, { patient_id: fx.patientA2, title: 'Titulo con eror' }, await sampleJpeg(5, 60, 60));
    const patch = (as: TestUser, body: unknown) => call(PATCH, { as, url: `/api/studies/${id}`, method: 'PATCH', body, params: { id } });
    const ok = await patch(fx.therapistA, { title: 'Título corregido', type_name: 'Tomografía', study_date: '2025-12-01' });
    expect(ok.status).toBe(200);
    expect(ok.data).toMatchObject({ title: 'Título corregido', type_name: 'Tomografía', study_date: '2025-12-01' });
    expect((await patch(fx.therapistA, { type_name: 'No existe' })).status).toBe(400);
    expect((await patch(fx.therapistA, { title: '' })).status).toBe(400);
    expect((await patch(fx.therapistA, { study_date: '2999-01-01' })).status).toBe(400);
    expect((await patch(fx.therapistB, { title: 'Ajeno' })).status).toBe(404);
    expect((await patch(fx.owner, { title: 'Por el dueño' })).data.title).toBe('Por el dueño');
  });
});

describe('EST-06 · archivar (solo dueño)', () => {
  it('fisioterapeuta 403; dueño archiva con motivo, desaparece del listado y vuelve al restaurar', async () => {
    const file = await sampleJpeg(7, 90, 90);
    const id = await upload(fx.therapistA, { patient_id: fx.patientA1, title: 'Estudio duplicado' }, file);
    const [before] = await sqlSystem((tx) => tx`select storage_path from studies where id = ${id}`);

    expect((await archive(fx.therapistA, id, { reason: 'Me equivoqué de paciente' })).status).toBe(403);
    expect((await archive(fx.owner, id, {})).status).toBe(400);            // motivo obligatorio
    expect((await archive(fx.owner, id, { reason: '  ' })).status).toBe(400);
    expect((await archive(fx.owner, id, { restore: true })).status).toBe(409); // no está archivado

    const a = await archive(fx.owner, id, { reason: 'Archivo duplicado' });
    expect(a.status).toBe(200);
    expect(a.data).toMatchObject({ archive_reason: 'Archivo duplicado', archived_by_name: 'Nicolas Herrera' });
    expect(a.data.archived_at).toBeTruthy();
    expect((await archive(fx.owner, id, { reason: 'Otra vez' })).status).toBe(409);

    // Nunca se borra la fila ni el archivo.
    const [row] = await sqlSystem((tx) => tx`select archived_by, archive_reason, storage_path from studies where id = ${id}`);
    expect(row).toMatchObject({ archived_by: fx.owner.id, archive_reason: 'Archivo duplicado', storage_path: before.storage_path });
    expect(await storage.size(before.storage_path)).toBe(file.length);

    const has = async (as: TestUser, q = '') => (await list(as, q)).data.some((s: any) => s.id === id);
    expect(await has(fx.owner)).toBe(false);
    expect(await has(fx.therapistA)).toBe(false);
    expect(await has(fx.owner, '?archived=1')).toBe(true);
    expect((await list(fx.owner, '?archived=1')).data.every((s: any) => s.archived_at)).toBe(true);
    // ?archived=1 es exclusivo del dueño, y un archivado no se abre siendo fisioterapeuta.
    expect((await list(fx.therapistA, '?archived=1')).status).toBe(403);
    expect((await detail(fx.therapistA, id)).status).toBe(404);
    expect((await detail(fx.owner, id)).status).toBe(200);

    expect((await archive(fx.therapistA, id, { restore: true })).status).toBe(403);
    const r = await archive(fx.owner, id, { restore: true });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ archived_at: null, archive_reason: null, archived_by_name: null });
    expect(await has(fx.therapistA)).toBe(true);
    expect(await has(fx.owner, '?archived=1')).toBe(false);
    expect((await detail(fx.therapistA, id)).status).toBe(200);
  });
});
