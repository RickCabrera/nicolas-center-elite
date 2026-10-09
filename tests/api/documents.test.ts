// QA-02 · Integración de la API probada como dueño y como fisioterapeuta.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { GET as LIST, POST as ISSUE } from '@/app/api/documents/route';
import { GET as DETAIL } from '@/app/api/documents/[id]/route';
import { POST as CANCEL } from '@/app/api/documents/[id]/cancel/route';
import { GET as PDF } from '@/app/api/documents/[id]/pdf/route';
import { POST as PRINT } from '@/app/api/documents/[id]/print/route';
import { GET as CONTROLLED } from '@/app/api/documents/controlled/route';
import { call, fixtures, sqlAs, sqlSystem, type Fixtures, type TestUser } from '../helpers';

// tests/helpers.ts → resetData() hace `set local session_replication_role`, que el rol nce_admin de este
// entorno no puede ejecutar (no es superusuario) y aborta la transacción de limpieza. TRUNCATE no dispara
// triggers de fila, así que aquí esa sentencia se omite; todo lo demás de @/lib/db pasa intacto.
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
let patientP1: string; // paciente de la médica (Córdoba)

const exercise = { kind: 'exercise', name: 'Puente de glúteo', dose: '3 series de 12', frequency: 'Diario', duration: '4 semanas' };
const med = { kind: 'medication', name: 'Naproxeno', presentation: 'Tabletas 500 mg, caja con 20', dose: '500 mg', route: 'Oral', frequency: 'Cada 12 h', duration: '7 días', instructions: 'Tomar con alimentos.' };
const issue = (as: TestUser, body: Record<string, unknown>) => call(ISSUE, { as, url: '/api/documents', body });
const indications = (as: TestUser, patient_id: string, extra: Record<string, unknown> = {}) =>
  issue(as, { kind: 'indications', patient_id, items: [exercise], ...extra });

beforeAll(async () => {
  fx = await fixtures();
  // La médica de fixtures no tiene pacientes: se le asigna uno propio con SQL de sistema.
  patientP1 = await sqlSystem(async (tx) => {
    await tx`select set_config('app.user_id', ${fx.owner.id}, true), set_config('app.user_role', 'owner', true)`;
    const [p] = await tx<{ id: string }[]>`
      insert into patients (full_name, sex, birth_date, phone, location_id, therapist_id, reason, created_by)
      values ('Dario Prueba Cuatro', 'M', '1984-08-02', '271 000 0001', ${fx.cordoba}, ${fx.physician.id}, 'Lumbalgia', ${fx.owner.id})
      returning id`;
    return p.id;
  });
});

describe('emisión de indicaciones (REC-01, REC-04, REC-05)', () => {
  let docId: string;

  it('el fisioterapeuta emite indicaciones de su paciente; firma él aunque el cuerpo mande otro emisor', async () => {
    const r = await issue(fx.therapistA, {
      kind: 'indications', patient_id: fx.patientA1, diagnosis: 'Esguince de tobillo grado I',
      general_indications: 'Evitar impacto por dos semanas.',
      issuer_id: fx.therapistB.id, issuer_name: 'Otra Persona', folio: 'COR-IND-999999',
      items: [exercise, { kind: 'physical_agent', name: 'Crioterapia local', dose: '15 minutos', frequency: '3 veces al día' }, { kind: 'home_care', name: 'Elevar la pierna al descansar' }],
    });
    expect(r.status).toBe(200);
    docId = r.data.id;
    expect(r.data.folio).toBe('COR-IND-000001');
    expect(r.data.folio_number).toBe(1);
    expect(r.data.issuer_id).toBe(fx.therapistA.id);
    expect(r.data.issuer_name).toBe('Karla Ocampo');
    expect(r.data.issuer_title).toBe('L.F.T.');
    expect(r.data.issuer_license).toBe('11223344');
    expect(r.data.issuer_institution).toBe('Universidad Veracruzana');
    expect(r.data.patient_name).toBe('Ana Prueba Uno');
    expect(r.data.patient_sex).toBe('F');
    expect(r.data.patient_age).toBeGreaterThan(30);
    expect(r.data.location_name).toBeTruthy();
    expect(r.data.location_address).toBeTruthy();
    expect(r.data.diagnosis).toBe('Esguince de tobillo grado I');
    expect(r.data.status).toBe('issued');
    expect(r.data.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.data.can_cancel).toBe(true);
    expect(r.data.items.map((i: { kind: string }) => i.kind)).toEqual(['exercise', 'physical_agent', 'home_care']);
    expect(r.data.items[0]).toMatchObject({ name: 'Puente de glúteo', dose: '3 series de 12', position: 0 });
  });

  it('valida: paciente, renglones mínimos y máximos, nombre obligatorio', async () => {
    expect((await issue(fx.therapistA, { kind: 'indications', patient_id: fx.patientA1, items: [] })).status).toBe(400);
    expect((await issue(fx.therapistA, { kind: 'indications', items: [exercise] })).status).toBe(400);
    expect((await issue(fx.therapistA, { kind: 'otra', patient_id: fx.patientA1, items: [exercise] })).status).toBe(400);
    const many = await issue(fx.therapistA, { kind: 'indications', patient_id: fx.patientA1, items: Array.from({ length: 21 }, () => exercise) });
    expect(many.status).toBe(400);
    expect(many.error?.fields?.items).toMatch(/20/);
    const noName = await issue(fx.therapistA, { kind: 'indications', patient_id: fx.patientA1, items: [exercise, { kind: 'home_care', name: '  ' }] });
    expect(noName.status).toBe(400);
    expect(noName.error?.fields?.['items.1.name']).toBeTruthy();
  });

  it('las indicaciones no admiten medicamentos (ruta y base)', async () => {
    const r = await issue(fx.therapistA, { kind: 'indications', patient_id: fx.patientA1, items: [exercise, med] });
    expect([400, 403]).toContain(r.status);
    expect(r.error?.fields?.['items.1.kind']).toMatch(/medicamentos/);
    // La base lo rechaza aunque alguien se salte la ruta.
    await expect(sqlAs(fx.therapistA, async (tx) => {
      const [d] = await tx<{ id: string }[]>`
        insert into documents (kind, patient_id, folio_number, folio, issuer_id, issuer_name, clinic_name, location_name, location_address, patient_name, patient_age)
        values ('indications', ${fx.patientA1}, 0, '', ${fx.therapistA.id}, '', '', '', '', '', 0) returning id`;
      await tx`insert into document_items (document_id, kind, name) values (${d.id}, 'medication', 'Ibuprofeno')`;
    })).rejects.toThrow(/no pueden incluir medicamentos/);
  });

  it('una emisión rechazada no consume folio', async () => {
    const r = await indications(fx.therapistA, fx.patientA2);
    expect(r.status).toBe(200);
    expect(r.data.folio).toBe('COR-IND-000002');
    expect(r.data.patient_name).toBe('Beto Prueba Dos');
  });

  it('el fisioterapeuta no emite sobre un paciente ajeno', async () => {
    const r = await indications(fx.therapistA, fx.patientB1);
    expect(r.status).toBe(404);
  });

  it('el dueño sin cédula no puede emitir (ni indicaciones ni receta)', async () => {
    const a = await indications(fx.owner, fx.patientA1);
    expect(a.status).toBe(400);
    expect(a.error?.code).toBe('license_required');
    expect(a.error?.message).toMatch(/cédula/);
    const b = await issue(fx.owner, { kind: 'prescription', patient_id: fx.patientA1, items: [med] });
    expect(b.status).toBe(403);
  });

  it('sin sesión responde 401', async () => {
    expect((await call(ISSUE, { url: '/api/documents', body: { kind: 'indications', patient_id: fx.patientA1, items: [exercise] } })).status).toBe(401);
    expect((await call(LIST, { url: '/api/documents' })).status).toBe(401);
  });

  it('documento emitido: no admite renglones nuevos ni cambios por SQL bajo el rol del emisor', async () => {
    await expect(sqlAs(fx.therapistA, (tx) => tx`insert into document_items (document_id, kind, name) values (${docId}, 'exercise', 'Extra')`))
      .rejects.toThrow(/ya emitido/);
    await expect(sqlAs(fx.therapistA, (tx) => tx`update documents set diagnosis = 'Otro' where id = ${docId}`)).rejects.toThrow(/no puede modificarse/);
    await expect(sqlAs(fx.therapistA, (tx) => tx`update documents set issuer_name = 'Otro' where id = ${docId}`)).rejects.toThrow(/no puede modificarse/);
    await expect(sqlAs(fx.therapistA, (tx) => tx`update documents set content_hash = 'x' where id = ${docId}`)).rejects.toThrow(/huella/i);
    await expect(sqlAs(fx.therapistA, (tx) => tx`update document_items set name = 'Otro' where document_id = ${docId}`)).rejects.toThrow();
    await expect(sqlAs(fx.therapistA, (tx) => tx`delete from documents where id = ${docId}`)).rejects.toThrow();
    const r = await call(DETAIL, { as: fx.therapistA, params: { id: docId } });
    expect(r.data.diagnosis).toBe('Esguince de tobillo grado I');
    expect(r.data.items).toHaveLength(3);
  });
});

describe('receta médica (REC-02, REC-06)', () => {
  let rxId: string;

  it('el fisioterapeuta no puede emitir receta → 403 con el fundamento legal', async () => {
    const r = await issue(fx.therapistA, { kind: 'prescription', patient_id: fx.patientA1, items: [med] });
    expect(r.status).toBe(403);
    expect(r.error?.message).toMatch(/28 Bis/);
    // La base también lo impide.
    await expect(sqlAs(fx.therapistA, (tx) => tx`
      insert into documents (kind, patient_id, folio_number, folio, issuer_id, issuer_name, clinic_name, location_name, location_address, patient_name, patient_age)
      values ('prescription', ${fx.patientA1}, 0, '', ${fx.therapistA.id}, '', '', '', '', '', 0)`)).rejects.toThrow(/28 Bis/);
  });

  it('la médica emite receta de su paciente con folio RX propio', async () => {
    const r = await issue(fx.physician, { kind: 'prescription', patient_id: patientP1, diagnosis: 'Lumbalgia mecánica', items: [med, { ...med, name: 'Paracetamol', dose: '500 mg', frequency: 'Cada 8 h' }] });
    expect(r.status).toBe(200);
    rxId = r.data.id;
    expect(r.data.folio).toBe('COR-RX-000001');
    expect(r.data.issuer_name).toBe('Mariana Reyes');
    expect(r.data.issuer_title).toBe('Dra.');
    expect(r.data.issuer_license).toBe('99887766');
    expect(r.data.patient_sex).toBe('M');
    expect(r.data.items).toHaveLength(2);
    expect(r.data.items[0]).toMatchObject({ kind: 'medication', name: 'Naproxeno', presentation: 'Tabletas 500 mg, caja con 20', route: 'Oral', duration: '7 días' });
  });

  it('la médica no emite sobre un paciente que no es suyo', async () => {
    const r = await issue(fx.physician, { kind: 'prescription', patient_id: fx.patientA1, items: [med] });
    expect([403, 404]).toContain(r.status);
  });

  it('exige nombre, dosis, vía, frecuencia y duración con mensaje por campo', async () => {
    const r = await issue(fx.physician, { kind: 'prescription', patient_id: patientP1, items: [med, { kind: 'medication', name: 'Ibuprofeno' }] });
    expect(r.status).toBe(400);
    expect(Object.keys(r.error?.fields ?? {}).sort()).toEqual(['items.1.dose', 'items.1.duration', 'items.1.frequency', 'items.1.route']);
    const r2 = await issue(fx.physician, { kind: 'prescription', patient_id: patientP1, items: [{ ...med, name: '' }] });
    expect(r2.error?.fields?.['items.0.name']).toMatch(/genérica/);
  });

  it('la receta solo admite medicamentos', async () => {
    const r = await issue(fx.physician, { kind: 'prescription', patient_id: patientP1, items: [med, exercise] });
    expect(r.status).toBe(400);
    expect(r.error?.fields?.['items.1.kind']).toBeTruthy();
  });

  it('medicamento controlado → 400 controlled_substance (ruta y base)', async () => {
    for (const name of ['Tramadol 50 mg', 'clonazepam', 'CLONAZEPAM gotas', 'Codeína']) {
      const r = await issue(fx.physician, { kind: 'prescription', patient_id: patientP1, items: [med, { ...med, name }] });
      expect(r.status).toBe(400);
      expect(r.error?.code).toBe('controlled_substance');
      expect(r.error?.message).toMatch(/recetario especial/);
      expect(r.error?.fields?.['items.1.name']).toBeTruthy();
    }
    await expect(sqlAs(fx.physician, async (tx) => {
      const [d] = await tx<{ id: string }[]>`
        insert into documents (kind, patient_id, folio_number, folio, issuer_id, issuer_name, clinic_name, location_name, location_address, patient_name, patient_age)
        values ('prescription', ${patientP1}, 0, '', ${fx.physician.id}, '', '', '', '', '', 0) returning id`;
      await tx`insert into document_items (document_id, kind, name) values (${d.id}, 'medication', 'Tramadol 50 mg')`;
    })).rejects.toThrow(/controlado/);
    const c = await call(CONTROLLED, { as: fx.physician, url: '/api/documents/controlled?name=Tramadol%2050%20mg' });
    expect(c.data).toMatchObject({ controlled: true, match: 'tramadol' });
    const n = await call(CONTROLLED, { as: fx.physician, url: '/api/documents/controlled?name=Naproxeno' });
    expect(n.data.controlled).toBe(false);
    const all = await call(CONTROLLED, { as: fx.therapistA, url: '/api/documents/controlled' });
    expect(all.data.names).toContain('clonazepam');
  });

  it('los intentos rechazados no consumieron folio; duplicar emite folio nuevo con la firma de quien emite', async () => {
    const r = await issue(fx.physician, { kind: 'prescription', patient_id: patientP1, items: [med], duplicated_from: rxId });
    expect(r.status).toBe(200);
    expect(r.data.folio).toBe('COR-RX-000002');
    expect(r.data.duplicated_from).toBe(rxId);
    expect(r.data.id).not.toBe(rxId);
    const bad = await issue(fx.physician, { kind: 'indications', patient_id: patientP1, items: [exercise], duplicated_from: rxId });
    expect(bad.status).toBe(400);
  });

  it('la médica también emite indicaciones, con su propio consecutivo por tipo', async () => {
    const r = await indications(fx.physician, patientP1);
    expect(r.status).toBe(200);
    expect(r.data.folio).toBe('COR-IND-000003');
  });
});

describe('folios (REC-05)', () => {
  it('consecutivos por sede y por tipo', async () => {
    const r = await indications(fx.therapistB, fx.patientB1);
    expect(r.status).toBe(200);
    expect(r.data.folio).toBe('ORI-IND-000001');
  });

  it('10 emisiones simultáneas: sin repetidos ni huecos', async () => {
    const rs = await Promise.all(Array.from({ length: 10 }, () => indications(fx.therapistB, fx.patientB1)));
    expect(rs.map((r) => r.status)).toEqual(Array(10).fill(200));
    const numbers = rs.map((r) => r.data.folio_number as number).sort((a, b) => a - b);
    expect(numbers).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(new Set(rs.map((r) => r.data.folio)).size).toBe(10);
    const stored = await sqlSystem((tx) => tx<{ folio_number: number }[]>`
      select folio_number from documents where location_id = ${fx.orizaba} and kind = 'indications' order by folio_number`);
    expect(stored.map((s) => s.folio_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('simultáneas con rechazos intercalados: los rechazos no dejan huecos', async () => {
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      i % 2 ? issue(fx.therapistB, { kind: 'indications', patient_id: fx.patientB1, items: [{ kind: 'exercise', name: '' }] }) : indications(fx.therapistB, fx.patientB1)));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(5);
    const stored = await sqlSystem((tx) => tx<{ folio_number: number }[]>`
      select folio_number from documents where location_id = ${fx.orizaba} and kind = 'indications' order by folio_number`);
    expect(stored.map((s) => s.folio_number)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });
});

describe('lista, detalle y aislamiento (REC-09, REC-10)', () => {
  it('el dueño ve todo; cada profesional lo suyo', async () => {
    const all = await call(LIST, { as: fx.owner, url: '/api/documents?limit=200' });
    expect(all.status).toBe(200);
    expect(all.data.total).toBe(21);
    expect(all.data.items).toHaveLength(21);
    const a = await call(LIST, { as: fx.therapistA, url: '/api/documents' });
    expect(a.data.items.map((d: { folio: string }) => d.folio).sort()).toEqual(['COR-IND-000001', 'COR-IND-000002']);
    const b = await call(LIST, { as: fx.therapistB, url: '/api/documents?limit=200' });
    expect(b.data.total).toBe(16);
    expect(b.data.items.every((d: { patient_id: string }) => d.patient_id === fx.patientB1)).toBe(true);
  });

  it('forma de cada fila y resumen "y N más"', async () => {
    const a = await call(LIST, { as: fx.therapistA, url: '/api/documents?q=COR-IND-000001' });
    expect(a.data.items).toHaveLength(1);
    const row = a.data.items[0];
    expect(Object.keys(row).sort()).toEqual(['folio', 'id', 'issued_at', 'issuer_id', 'issuer_name', 'issuer_title', 'kind', 'patient_id', 'patient_name', 'status', 'summary'].sort());
    expect(row.summary).toBe('Puente de glúteo y 2 más');
    expect(row.patient_name).toBe('Ana Prueba Uno');
    const one = await call(LIST, { as: fx.therapistA, url: '/api/documents?q=cor-ind-000002' });
    expect(one.data.items[0].summary).toBe('Puente de glúteo');
  });

  it('filtros: paciente, tipo, búsqueda sin acentos, mine y paginación', async () => {
    const byPatient = await call(LIST, { as: fx.owner, url: `/api/documents?patient_id=${patientP1}` });
    expect(byPatient.data.items.map((d: { folio: string }) => d.folio).sort()).toEqual(['COR-IND-000003', 'COR-RX-000001', 'COR-RX-000002']);
    const rx = await call(LIST, { as: fx.owner, url: '/api/documents?kind=prescription' });
    expect(rx.data.total).toBe(2);
    const q = await call(LIST, { as: fx.owner, url: '/api/documents?q=DARIO%20pru' });
    expect(q.data.total).toBe(3);
    const mine = await call(LIST, { as: fx.owner, url: '/api/documents?mine=1' });
    expect(mine.data.total).toBe(0);
    const mineP = await call(LIST, { as: fx.physician, url: '/api/documents?mine=1' });
    expect(mineP.data.total).toBe(3);
    const page = await call(LIST, { as: fx.owner, url: '/api/documents?limit=5&offset=20' });
    expect(page.data.items).toHaveLength(1);
    expect((await call(LIST, { as: fx.owner, url: '/api/documents?kind=otro' })).status).toBe(400);
  });

  it('B no ve ni toca los documentos de pacientes de A', async () => {
    const a = await call(LIST, { as: fx.therapistA, url: '/api/documents' });
    const id = a.data.items[0].id;
    expect((await call(DETAIL, { as: fx.therapistB, params: { id } })).status).toBe(404);
    expect((await call(PDF, { as: fx.therapistB, params: { id } })).status).toBe(404);
    expect((await call(PRINT, { as: fx.therapistB, params: { id }, body: {} })).status).toBe(404);
    expect((await call(CANCEL, { as: fx.therapistB, params: { id }, body: { reason: 'No es mío' } })).status).toBe(404);
    const viaPatient = await call(LIST, { as: fx.therapistB, url: `/api/documents?patient_id=${fx.patientA1}` });
    expect(viaPatient.data.items).toHaveLength(0);
    expect((await call(DETAIL, { as: fx.therapistA, params: { id: 'no-es-uuid' } })).status).toBe(404);
  });

  it('si el paciente se reasigna, quien emitió conserva la lectura y el nuevo responsable también lo ve', async () => {
    const r = await indications(fx.therapistA, fx.patientA2);
    expect(r.status).toBe(200);
    await sqlSystem(async (tx) => {
      await tx`select set_config('app.user_id', ${fx.owner.id}, true), set_config('app.user_role', 'owner', true)`;
      await tx`update patients set therapist_id = ${fx.physician.id} where id = ${fx.patientA2}`;
    });
    expect((await call(DETAIL, { as: fx.therapistA, params: { id: r.data.id } })).status).toBe(200);
    const p = await call(DETAIL, { as: fx.physician, params: { id: r.data.id } });
    expect(p.status).toBe(200);
    expect(p.data.can_cancel).toBe(false); // lo ve, pero no lo emitió
    expect((await call(CANCEL, { as: fx.physician, params: { id: r.data.id }, body: { reason: 'Intento ajeno' } })).status).toBe(403);
    await sqlSystem(async (tx) => {
      await tx`select set_config('app.user_id', ${fx.owner.id}, true), set_config('app.user_role', 'owner', true)`;
      await tx`update patients set therapist_id = ${fx.therapistA.id} where id = ${fx.patientA2}`;
    });
  });
});

describe('cancelación y PDF (REC-05, REC-08)', () => {
  let id: string;
  let folio: string;

  it('PDF de un documento vigente y registro en bitácora', async () => {
    const r = await indications(fx.therapistA, fx.patientA1, { general_indications: 'Hielo 15 min — “reposo relativo”…' });
    id = r.data.id;
    folio = r.data.folio;
    const pdf = await call(PDF, { as: fx.therapistA, params: { id } });
    expect(pdf.status).toBe(200);
    expect(pdf.res.headers.get('content-type')).toBe('application/pdf');
    const bytes = Buffer.from(await pdf.res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1500);
    expect((await call(PRINT, { as: fx.therapistA, params: { id }, body: {} })).status).toBe(200);
    const log = await sqlSystem((tx) => tx<{ action: string; summary: string }[]>`
      select action, summary from audit_log where patient_id = ${fx.patientA1} and action in ('export', 'print') order by action`);
    expect(log.map((l) => l.action)).toEqual(['export', 'print']);
    expect(log[0].summary).toBe(`Descargó ${folio}`);
  });

  it('cancelar exige motivo', async () => {
    expect((await call(CANCEL, { as: fx.therapistA, params: { id }, body: {} })).status).toBe(400);
    const r = await call(CANCEL, { as: fx.therapistA, params: { id }, body: { reason: '  ' } });
    expect(r.status).toBe(400);
    expect(r.error?.fields?.reason).toBeTruthy();
  });

  it('el emisor cancela: conserva folio y contenido, y queda quién, cuándo y por qué', async () => {
    const r = await call(CANCEL, { as: fx.therapistA, params: { id }, body: { reason: 'Error en la dosificación' } });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ status: 'cancelled', folio, cancel_reason: 'Error en la dosificación', cancelled_by: fx.therapistA.id, can_cancel: false });
    expect(r.data.cancelled_at).toBeTruthy();
    expect(r.data.items).toHaveLength(1);
    const list = await call(LIST, { as: fx.therapistA, url: '/api/documents?status=cancelled' });
    expect(list.data.items.map((d: { folio: string }) => d.folio)).toEqual([folio]);
  });

  it('no se puede cancelar dos veces', async () => {
    const r = await call(CANCEL, { as: fx.therapistA, params: { id }, body: { reason: 'Otra vez' } });
    expect([400, 409]).toContain(r.status);
    const o = await call(CANCEL, { as: fx.owner, params: { id }, body: { reason: 'Otra vez' } });
    expect([400, 409]).toContain(o.status);
    await expect(sqlAs(fx.therapistA, (tx) => tx`update documents set status = 'issued', cancel_reason = null where id = ${id}`)).rejects.toThrow(/ya está cancelado/);
  });

  it('el folio cancelado no se reutiliza', async () => {
    const r = await indications(fx.therapistA, fx.patientA1);
    expect(r.data.folio_number).toBe(Number(folio.slice(-6)) + 1);
  });

  it('PDF de un documento cancelado', async () => {
    const pdf = await call(PDF, { as: fx.owner, params: { id }, url: '/api/documents/x/pdf?download=1' });
    expect(pdf.status).toBe(200);
    expect(pdf.res.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.res.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(Buffer.from(await pdf.res.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('el dueño puede cancelar un documento de otro; PDF de receta', async () => {
    const rx = await issue(fx.physician, { kind: 'prescription', patient_id: patientP1, items: [med] });
    expect(rx.status).toBe(200);
    const pdf = await call(PDF, { as: fx.physician, params: { id: rx.data.id } });
    expect(pdf.res.headers.get('content-type')).toBe('application/pdf');
    const d = await call(DETAIL, { as: fx.owner, params: { id: rx.data.id } });
    expect(d.data.can_cancel).toBe(true);
    const c = await call(CANCEL, { as: fx.owner, params: { id: rx.data.id }, body: { reason: 'Solicitud de la dirección' } });
    expect(c.status).toBe(200);
    expect(c.data.cancelled_by).toBe(fx.owner.id);
    expect(c.data.folio).toBe(rx.data.folio);
  });
});
