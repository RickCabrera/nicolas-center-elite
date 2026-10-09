// QA-02 · Integración de la API probada como dueño y como fisioterapeuta.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { GET as LIST, POST as CREATE } from '@/app/api/patients/route';
import { GET as DETAIL, PATCH } from '@/app/api/patients/[id]/route';
import { POST as STATUS } from '@/app/api/patients/[id]/status/route';
import { POST as ASSIGN } from '@/app/api/patients/[id]/assign/route';
import { POST as REASSIGN } from '@/app/api/patients/reassign/route';
import { POST as IMPORT } from '@/app/api/patients/import/route';
import { addDays, todayIso } from '@/lib/dates';
import { call, fixtures, sqlSystem, type Fixtures, type TestUser } from '../helpers';

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
const list = (as: TestUser, qs = '') => call(LIST, { as, url: `/api/patients${qs}` });
const names = (r: { data: { items: { full_name: string }[] } }) => r.data.items.map((i) => i.full_name);

const adult = (over: Record<string, unknown> = {}) => ({
  full_name: 'Zoila Alta Nueva', birth_date: '12/04/1988', sex: 'F', phone: '271 123 4567',
  emergency_name: 'Pedro Alta', emergency_phone: '2717654321', reason: 'Esguince de tobillo',
  location_id: fx.cordoba, ...over,
});

beforeAll(async () => {
  fx = await fixtures();
  await sqlSystem(async (tx) => {
    await tx`update patients set tags = '{Deportista}', reason = 'Lesión de menisco al correr' where id = ${fx.patientA1}`;
    await tx`insert into clinical_profiles (patient_id, diagnosis) values (${fx.patientB1}, 'Diagnóstico viejo: bursitis')`;
    await tx`insert into clinical_profiles (patient_id, diagnosis) values (${fx.patientB1}, 'Espondilólisis lumbar')`;
  });
});

describe('PAC-01 · listado', () => {
  it('cada rol ve su carga: A 2, B 1, dueño 3', async () => {
    const a = await list(fx.therapistA);
    expect(a.status).toBe(200);
    expect(a.data.items).toHaveLength(2);
    expect(a.data.total).toBe(2);
    expect(a.data.total_scope).toBe(2);
    expect((await list(fx.therapistB)).data.items).toHaveLength(1);
    const o = await list(fx.owner);
    expect(o.data.items).toHaveLength(3);
    expect(o.data.total_scope).toBe(3);
  });

  it('sin sesión responde 401', async () => {
    expect((await call(LIST, { url: '/api/patients' })).status).toBe(401);
  });

  it('cada renglón trae edad calculada, sede, fisioterapeuta con título y cobranza', async () => {
    const o = await list(fx.owner);
    const a1 = o.data.items.find((i: { id: string }) => i.id === fx.patientA1);
    expect(a1).toMatchObject({
      full_name: 'Ana Prueba Uno', birth_date: '1990-05-10', location_name: 'Córdoba', therapist_id: fx.therapistA.id,
      therapist_name: 'L.F.T. Karla Ocampo', plan_name: 'Mensual Elite', billing_state: 'pagado', status: 'active', tags: ['Deportista'],
    });
    expect(a1.record_number).toMatch(/^NCE-\d{6}$/);
    expect(a1.age).toBeGreaterThanOrEqual(35);
    expect(a1.next_due_date).toBe(addDays(todayIso(), 20));
    const b1 = o.data.items.find((i: { id: string }) => i.id === fx.patientB1);
    expect(b1.billing_state).toBe('vencido');
  });

  it('filtra por edad', async () => {
    expect(names(await list(fx.owner, '?age=ninos'))).toEqual(['Beto Prueba Dos']);
    expect(names(await list(fx.owner, '?age=adultos'))).toEqual(['Ana Prueba Uno']);
    expect(names(await list(fx.owner, '?age=mayores'))).toEqual(['Carmen Prueba Tres']);
    expect((await list(fx.owner, '?age=bebes')).status).toBe(400);
  });

  it('filtra por etiqueta', async () => {
    const r = await list(fx.owner, '?tag=Deportista');
    expect(names(r)).toEqual(['Ana Prueba Uno']);
    expect(r.data.total).toBe(1);
    expect(r.data.total_scope).toBe(3);
  });

  it('busca sin acentos en nombre, motivo, expediente y diagnóstico vigente', async () => {
    expect(names(await list(fx.owner, '?q=CARMÉN'))).toEqual(['Carmen Prueba Tres']);
    expect(names(await list(fx.owner, '?q=lesion de menisco'))).toEqual(['Ana Prueba Uno']);
    expect(names(await list(fx.owner, '?q=espondilolisis'))).toEqual(['Carmen Prueba Tres']);
    expect(names(await list(fx.owner, '?q=bursitis'))).toEqual([]);            // solo la última versión del perfil
    const rec = (await list(fx.owner)).data.items[0].record_number as string;
    expect((await list(fx.owner, `?q=${rec.toLowerCase()}`)).data.items).toHaveLength(1);
    expect(names(await list(fx.owner, '?q=%25'))).toEqual([]);                 // los comodines se buscan literales
    expect(names(await list(fx.therapistA, '?q=espondilolisis'))).toEqual([]); // el de B no existe para A
  });

  it('therapist_id solo filtra para el dueño; location_id filtra para todos', async () => {
    expect(names(await list(fx.owner, `?therapist_id=${fx.therapistB.id}`))).toEqual(['Carmen Prueba Tres']);
    expect((await list(fx.therapistA, `?therapist_id=${fx.therapistB.id}`)).data.items).toHaveLength(2);
    expect(names(await list(fx.owner, `?location_id=${fx.orizaba}`))).toEqual(['Carmen Prueba Tres']);
  });

  it('pagina con limit y offset', async () => {
    const r = await list(fx.owner, '?limit=1&offset=1');
    expect(names(r)).toEqual(['Beto Prueba Dos']);
    expect(r.data.total).toBe(3);
  });
});

describe('PAC-03 / PAC-04 / PAC-06 · alta', () => {
  it('el fisioterapeuta se autoasigna aunque mande otro therapist_id, y se crea la membresía', async () => {
    const r = await call(CREATE, { as: fx.therapistA, body: adult({ therapist_id: fx.therapistB.id, plan_id: fx.plans['Mensual Básica'], curp: 'aaaa880412mvzrrn09', tags: ['Deportista'] }) });
    expect(r.status).toBe(200);
    const d = await call(DETAIL, { as: fx.therapistA, params: { id: r.data.id } });
    expect(d.data).toMatchObject({
      therapist_id: fx.therapistA.id, therapist_name: 'Karla Ocampo', therapist_display: 'L.F.T. Karla Ocampo',
      birth_date: '1988-04-12', curp: 'AAAA880412MVZRRN09', plan_name: 'Mensual Básica', plan_kind: 'monthly',
      billing_state: 'por_vencer', next_due_date: todayIso(), tags: ['Deportista'], location_name: 'Córdoba',
      consents: { privacy: false, informed: false, biometric: false },
    });
    expect(d.data.search).toBeUndefined();
    expect((await call(DETAIL, { as: fx.therapistB, params: { id: r.data.id } })).status).toBe(404);
    const hist = await sqlSystem((tx) => tx`select therapist_id, changed_by from patient_assignments where patient_id = ${r.data.id}`);
    expect(hist).toEqual([{ therapist_id: fx.therapistA.id, changed_by: fx.therapistA.id }]);
  });

  it('el dueño debe elegir un fisioterapeuta activo', async () => {
    const none = await call(CREATE, { as: fx.owner, body: adult({ full_name: 'Sin Fisio' }) });
    expect(none.status).toBe(400);
    expect(none.error?.fields?.therapist_id).toBeTruthy();
    const bad = await call(CREATE, { as: fx.owner, body: adult({ full_name: 'Sin Fisio', therapist_id: fx.owner.id }) });
    expect(bad.error?.fields?.therapist_id).toBeTruthy();
    const ok = await call(CREATE, { as: fx.owner, body: adult({ full_name: 'Con Fisio Elegido', therapist_id: fx.therapistB.id, location_id: fx.orizaba }) });
    expect(ok.status).toBe(200);
    expect(names(await list(fx.therapistB))).toContain('Con Fisio Elegido');
    expect((await call(DETAIL, { as: fx.owner, params: { id: ok.data.id } })).data.billing_state).toBe('sin_plan');
  });

  it('un menor no se guarda sin tutor: 400 con el campo', async () => {
    const kid = adult({ full_name: 'Niño Sin Tutor', birth_date: addDays(todayIso(), -365 * 9) });
    const r = await call(CREATE, { as: fx.therapistA, body: kid });
    expect(r.status).toBe(400);
    expect(r.error?.fields).toMatchObject({ guardian_name: expect.any(String), guardian_relationship: expect.any(String), guardian_phone: expect.any(String) });
    const n = await sqlSystem((tx) => tx`select 1 from patients where full_name = 'Niño Sin Tutor'`);
    expect(n).toHaveLength(0);
    const ok = await call(CREATE, { as: fx.therapistA, body: { ...kid, guardian_name: 'Rosa Tutor', guardian_relationship: 'Madre', guardian_phone: '271 555 0000' } });
    expect(ok.status).toBe(200);
  });

  it('valida por campo: nombre, fecha, sexo, teléfono, correo, CURP, sede, etiqueta y plan', async () => {
    const r = await call(CREATE, { as: fx.therapistA, body: { full_name: ' ', birth_date: '31/02/1990', phone: '123', email: 'no-es-correo', curp: 'CORTA', location_id: 'x' } });
    expect(r.status).toBe(400);
    expect(Object.keys(r.error!.fields!).sort()).toEqual(['birth_date', 'curp', 'email', 'full_name', 'location_id', 'phone']);
    const r2 = await call(CREATE, { as: fx.therapistA, body: adult({ sex: null, birth_date: addDays(todayIso(), 3), tags: ['Inventada'], plan_id: '00000000-0000-4000-8000-000000000001' }) });
    expect(r2.status).toBe(400);
    expect(Object.keys(r2.error!.fields!).sort()).toEqual(['birth_date', 'plan_id', 'sex', 'tags']);
  });
});

describe('detalle y PAC-05 · edición, baja y reactivación', () => {
  it('B recibe 404 al pedir o editar un paciente de A; un id que no es uuid también es 404', async () => {
    expect((await call(DETAIL, { as: fx.therapistB, params: { id: fx.patientA1 } })).status).toBe(404);
    const p = await call(PATCH, { as: fx.therapistB, method: 'PATCH', params: { id: fx.patientA1 }, body: { reason: 'intruso' } });
    expect(p.status).toBe(404);
    expect((await call(STATUS, { as: fx.therapistB, params: { id: fx.patientA1 }, body: { status: 'inactive', reason: 'intruso' } })).status).toBe(404);
    expect((await call(DETAIL, { as: fx.owner, params: { id: 'nada' } })).status).toBe(404);
    const [row] = await sqlSystem((tx) => tx`select reason, status from patients where id = ${fx.patientA1}`);
    expect(row).toEqual({ reason: 'Lesión de menisco al correr', status: 'active' });
  });

  it('edita solo lo enviado y conserva lo demás', async () => {
    const r = await call(PATCH, { as: fx.therapistA, method: 'PATCH', params: { id: fx.patientA1 }, body: { phone: '(271) 111-2233', address: 'Av. 1 No. 20, Centro', therapist_id: fx.therapistB.id } });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ phone: '(271) 111-2233', address: 'Av. 1 No. 20, Centro', full_name: 'Ana Prueba Uno', reason: 'Lesión de menisco al correr', tags: ['Deportista'], therapist_id: fx.therapistA.id });
  });

  it('al editar, un menor tampoco puede quedarse sin tutor', async () => {
    const r = await call(PATCH, { as: fx.therapistA, method: 'PATCH', params: { id: fx.patientA2 }, body: { guardian_name: '' } });
    expect(r.status).toBe(400);
    expect(r.error?.fields?.guardian_name).toBeTruthy();
    const bad = await call(PATCH, { as: fx.owner, method: 'PATCH', params: { id: fx.patientA1 }, body: { birth_date: 'ayer' } });
    expect(bad.error?.fields?.birth_date).toBeTruthy();
  });

  it('la baja exige motivo, saca al paciente de la lista y su expediente sigue accesible; reactivar limpia', async () => {
    const no = await call(STATUS, { as: fx.therapistA, params: { id: fx.patientA1 }, body: { status: 'inactive' } });
    expect(no.status).toBe(400);
    expect(no.error?.fields?.reason).toBeTruthy();

    const off = await call(STATUS, { as: fx.therapistA, params: { id: fx.patientA1 }, body: { status: 'inactive', reason: 'Alta médica' } });
    expect(off.status).toBe(200);
    expect(off.data).toMatchObject({ status: 'inactive', deactivation_reason: 'Alta médica', future_appointments: 0 });
    expect(off.data.deactivated_at).toBeTruthy();

    expect(names(await list(fx.therapistA))).not.toContain('Ana Prueba Uno');
    expect(names(await list(fx.owner, '?status=inactive'))).toEqual(['Ana Prueba Uno']);
    expect(names(await list(fx.owner, '?status=all'))).toContain('Ana Prueba Uno');
    const d = await call(DETAIL, { as: fx.therapistA, params: { id: fx.patientA1 } });
    expect(d.status).toBe(200);
    expect(d.data.status).toBe('inactive');

    const on = await call(STATUS, { as: fx.owner, params: { id: fx.patientA1 }, body: { status: 'active' } });
    expect(on.data).toMatchObject({ status: 'active', deactivated_at: null, deactivation_reason: null });
    expect(names(await list(fx.therapistA))).toContain('Ana Prueba Uno');
  });

  it('el detalle refleja los consentimientos firmados', async () => {
    await sqlSystem((tx) => tx`insert into consents (patient_id, kind, body_snapshot, signer_name, signature_png)
                                values (${fx.patientA1}, 'privacy', 'Aviso', 'Ana Prueba Uno', 'data:image/png;base64,AA')`);
    const d = await call(DETAIL, { as: fx.owner, params: { id: fx.patientA1 } });
    expect(d.data.consents).toEqual({ privacy: true, informed: false, biometric: false });
  });
});

describe('PAC-04 · asignación', () => {
  it('assign y reassign son solo del dueño', async () => {
    const a = await call(ASSIGN, { as: fx.therapistA, params: { id: fx.patientA2 }, body: { therapist_id: fx.therapistA.id } });
    expect(a.status).toBe(403);
    const r = await call(REASSIGN, { as: fx.therapistA, body: { patient_ids: [fx.patientB1], to_therapist_id: fx.therapistA.id } });
    expect(r.status).toBe(403);
    expect((await call(DETAIL, { as: fx.therapistA, params: { id: fx.patientB1 } })).status).toBe(404);
  });

  it('el destino debe ser un fisioterapeuta activo', async () => {
    const own = await call(ASSIGN, { as: fx.owner, params: { id: fx.patientA2 }, body: { therapist_id: fx.owner.id } });
    expect(own.status).toBe(400);
    expect(own.error?.fields?.therapist_id).toBeTruthy();
    await sqlSystem((tx) => tx`update users set active = false where id = ${fx.physician.id}`);
    const off = await call(REASSIGN, { as: fx.owner, body: { patient_ids: [fx.patientA2], to_therapist_id: fx.physician.id } });
    expect(off.status).toBe(400);
    expect(off.error?.fields?.to_therapist_id).toBeTruthy();
    await sqlSystem((tx) => tx`update users set active = true where id = ${fx.physician.id}`);
    const ghost = await call(REASSIGN, { as: fx.owner, body: { patient_ids: ['00000000-0000-4000-8000-000000000009'], to_therapist_id: fx.therapistB.id } });
    expect(ghost.status).toBe(400);
  });

  it('assign mueve el acceso y deja historial', async () => {
    const r = await call(ASSIGN, { as: fx.owner, params: { id: fx.patientA2 }, body: { therapist_id: fx.therapistB.id } });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ therapist_id: fx.therapistB.id, therapist_display: 'L.F.T. Diego Salinas', moved: 1 });
    expect((await call(DETAIL, { as: fx.therapistA, params: { id: fx.patientA2 } })).status).toBe(404);
    expect((await call(DETAIL, { as: fx.therapistB, params: { id: fx.patientA2 } })).status).toBe(200);
    const hist = await sqlSystem((tx) => tx`select therapist_id, to_at is null as current, changed_by from patient_assignments where patient_id = ${fx.patientA2} order by from_at, to_at nulls last`);
    expect(hist).toEqual([
      { therapist_id: fx.therapistA.id, current: false, changed_by: fx.owner.id },
      { therapist_id: fx.therapistB.id, current: true, changed_by: fx.owner.id },
    ]);
  });

  it('reassign masivo mueve pacientes y sus citas futuras sin empalme; reporta las que chocan', async () => {
    // patientA2 y patientB1 son de B; se regresan a A. A ya tiene una cita que choca con una de B1.
    const day = addDays(todayIso(), 3);
    const at = (h: number) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00-06:00`);
    const ids = await sqlSystem(async (tx) => {
      const mk = async (patient: string, ther: string, when: Date, status = 'scheduled') => {
        const [a] = await tx<{ id: string }[]>`
          insert into appointments (patient_id, therapist_id, location_id, starts_at, duration_min, type_name, status)
          values (${patient}, ${ther}, ${fx.cordoba}, ${when}, 50, 'Fisioterapia', ${status}) returning id`;
        return a.id;
      };
      return {
        free: await mk(fx.patientA2, fx.therapistB.id, at(10)),          // se mueve
        clash: await mk(fx.patientB1, fx.therapistB.id, at(12)),         // choca con la de A
        busyA: await mk(fx.patientA1, fx.therapistA.id, at(12)),
        past: await mk(fx.patientB1, fx.therapistB.id, new Date(Date.now() - 86400000 * 2), 'attended'),
        cancelled: await mk(fx.patientB1, fx.therapistB.id, at(16), 'cancelled'),
        blocked: await mk(fx.patientB1, fx.therapistB.id, at(18)),       // A tiene un bloqueo a esa hora
      };
    });
    await sqlSystem((tx) => tx`insert into time_blocks (user_id, starts_at, ends_at, reason) values (${fx.therapistA.id}, ${at(17)}, ${at(20)}, 'Curso')`);

    const r = await call(REASSIGN, { as: fx.owner, body: { patient_ids: [fx.patientA2, fx.patientB1, fx.patientA1], to_therapist_id: fx.therapistA.id } });
    expect(r.status).toBe(200);
    expect(r.data.moved).toBe(2);                       // A1 ya era de A
    expect(r.data.appointments_moved).toBe(1);
    expect(r.data.appointments_conflict).toHaveLength(2);
    expect(r.data.appointments_conflict[0]).toMatchObject({ id: ids.clash, patient_name: 'Carmen Prueba Tres', starts_at: at(12).toISOString() });
    expect(r.data.appointments_conflict[1]).toMatchObject({ id: ids.blocked });
    expect(r.data.appointments_conflict[1].reason).toContain('bloqueo');

    const appts = await sqlSystem((tx) => tx<{ id: string; therapist_id: string }[]>`select id, therapist_id from appointments`);
    const ther = (id: string) => appts.find((a) => a.id === id)!.therapist_id;
    expect(ther(ids.free)).toBe(fx.therapistA.id);
    expect(ther(ids.clash)).toBe(fx.therapistB.id);
    expect(ther(ids.past)).toBe(fx.therapistB.id);
    expect(ther(ids.cancelled)).toBe(fx.therapistB.id);
    expect(ther(ids.blocked)).toBe(fx.therapistB.id);

    expect((await call(DETAIL, { as: fx.therapistA, params: { id: fx.patientB1 } })).status).toBe(200);
    expect((await call(DETAIL, { as: fx.therapistB, params: { id: fx.patientB1 } })).status).toBe(404);
  });
});

describe('PAC-09 · importación CSV', () => {
  const header = 'Nombre;Fecha de nacimiento;Sexo;Teléfono;Correo;Domicilio;CURP;Emergencia nombre;Emergencia teléfono;Tutor nombre;Tutor parentesco;Tutor teléfono;Sede;Fisioterapeuta;Membresía;Motivo;Etiquetas';
  const csv = [
    '﻿' + header,
    'Importada Uno;05/11/1979;F;2711112233;uno@correo.mx;"Calle 3; No. 4";;Luis Uno;2712223344;;;;Córdoba;karla;Mensual Elite;"Dolor lumbar\ncrónico";deportista|Dolor crónico',
    'Importado Menor;2015-06-01;masculino;;;;;;;;;;ORI;L.F.T. Diego Salinas;;Pie plano;',
    'Importada Dos;31/12/1960;;;;;;;;;;;cordoba;Diego Salinas;plan senior;;',
    ';01/01/1990;F;;;;;;;;;;Xalapa;nadie;Plan Platino;;Rara',
    'Ana Prueba Uno;10/05/1990;F;;;;;;;;;;Córdoba;karla;;;',
    'Importada Uno;05/11/1979;F;;;;;;;;;;Córdoba;karla;;;',
  ].join('\r\n');

  it('solo el dueño', async () => {
    expect((await call(IMPORT, { as: fx.therapistA, body: { csv, commit: false } })).status).toBe(403);
  });

  it('la vista previa marca los errores por fila y no inserta nada', async () => {
    const before = await sqlSystem((tx) => tx`select count(*)::int as n from patients`);
    const r = await call(IMPORT, { as: fx.owner, body: { csv, commit: false } });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ valid: 2, invalid: 4 });
    const [r1, r2, r3, r4, r5, r6] = r.data.rows;
    expect(r1).toMatchObject({ line: 2, ok: true, errors: [], data: { full_name: 'Importada Uno', birth_date: '05/11/1979', location_name: 'Córdoba', therapist_name: 'L.F.T. Karla Ocampo', plan_name: 'Mensual Elite', tags: ['Deportista', 'Dolor crónico'], reason: 'Dolor lumbar\ncrónico' } });
    expect(r2).toMatchObject({ line: 4, ok: false });                      // la fila anterior ocupa dos líneas
    expect(r2.errors.join(' ')).toContain('tutor_nombre');
    expect(r3).toMatchObject({ ok: true, data: { location_name: 'Córdoba', therapist_name: 'L.F.T. Diego Salinas', plan_name: 'Plan Senior' } });
    expect(r4.ok).toBe(false);
    expect(r4.errors.map((e: string) => e.split(':')[0]).sort()).toEqual(['etiquetas', 'fisioterapeuta', 'membresia', 'nombre', 'sede']);
    expect(r5.errors[0]).toMatch(/Ya existe un paciente.*NCE-/);
    expect(r6.errors[0]).toContain('línea 2');
    const after = await sqlSystem((tx) => tx`select count(*)::int as n from patients`);
    expect(after).toEqual(before);
  });

  it('rechaza archivos sin las columnas obligatorias, vacíos o con más de 2,000 filas', async () => {
    const noCols = await call(IMPORT, { as: fx.owner, body: { csv: 'nombre,telefono\nAna,1' } });
    expect(noCols.status).toBe(400);
    expect(noCols.error?.message).toContain('fecha_nacimiento');
    expect((await call(IMPORT, { as: fx.owner, body: { csv: header } })).status).toBe(400);
    expect((await call(IMPORT, { as: fx.owner, body: { csv: '' } })).status).toBe(400);
    const big = 'nombre,fecha_nacimiento,sede,fisioterapeuta\n' + Array.from({ length: 2001 }, (_, i) => `Paciente ${i},01/01/1990,COR,karla`).join('\n');
    const tooMany = await call(IMPORT, { as: fx.owner, body: { csv: big } });
    expect(tooMany.status).toBe(400);
    expect(tooMany.error?.message).toContain('2,000');
  });

  it('commit: con inválidas no inserta salvo skip_invalid; después ya no se duplican', async () => {
    const blocked = await call(IMPORT, { as: fx.owner, body: { csv, commit: true } });
    expect(blocked.status).toBe(400);
    expect(await sqlSystem((tx) => tx`select 1 from patients where full_name like 'Importad%'`)).toHaveLength(0);

    const done = await call(IMPORT, { as: fx.owner, body: { csv, commit: true, skip_invalid: true } });
    expect(done.status).toBe(200);
    expect(done.data).toMatchObject({ inserted: 2, skipped: 4 });

    const rows = await sqlSystem((tx) => tx`
      select p.full_name, p.birth_date, p.sex, p.address, p.tags, p.reason, p.therapist_id, p.location_id, p.created_by, b.plan_name, b.state
      from patients p left join patient_billing b on b.patient_id = p.id where p.full_name like 'Importad%' order by p.full_name`);
    expect(rows).toEqual([
      { full_name: 'Importada Dos', birth_date: '1960-12-31', sex: null, address: '', tags: [], reason: '', therapist_id: fx.therapistB.id, location_id: fx.cordoba, created_by: fx.owner.id, plan_name: 'Plan Senior', state: 'por_vencer' },
      { full_name: 'Importada Uno', birth_date: '1979-11-05', sex: 'F', address: 'Calle 3; No. 4', tags: ['Deportista', 'Dolor crónico'], reason: 'Dolor lumbar\ncrónico', therapist_id: fx.therapistA.id, location_id: fx.cordoba, created_by: fx.owner.id, plan_name: 'Mensual Elite', state: 'por_vencer' },
    ]);

    const again = await call(IMPORT, { as: fx.owner, body: { csv, commit: false } });
    expect(again.data).toMatchObject({ valid: 0, invalid: 6 });
    const none = await call(IMPORT, { as: fx.owner, body: { csv, commit: true, skip_invalid: true } });
    expect(none.status).toBe(400);
  });

  it('commit sin errores inserta todo', async () => {
    const clean = 'nombre,fecha_nacimiento,sexo,sede,fisioterapeuta\n"Limpio, Importado",02/02/1985,M,ORI,diego\n';
    const r = await call(IMPORT, { as: fx.owner, body: { csv: clean, commit: true } });
    expect(r.data).toMatchObject({ inserted: 1, skipped: 0 });
    expect(names(await list(fx.therapistB))).toContain('Limpio, Importado');
  });
});

describe('HUE-13 · baja del lector al dar de baja', () => {
  it('encola delete_person en el lector donde el paciente está enrolado', async () => {
    const { POST: statusPOST } = await import('@/app/api/patients/[id]/status/route');
    const fx = await fixtures();
    await sqlSystem(async (tx) => {
      const [d] = await tx<{ id: string }[]>`
        insert into devices (name, location_id, webhook_token_hash, webhook_token_enc, bridge_token_hash, bridge_token_enc)
        values ('Recepción', ${fx.cordoba}, 'h1', 'e1', 'h2', 'e2') returning id`;
      await tx`insert into enrollments (device_id, person_type, patient_id, employee_no, status, enrolled_at)
               select ${d.id}, 'patient', id, hik_employee_no, 'enrolled', now() from patients where id = ${fx.patientA1}`;
    });
    const r = await call(statusPOST, { as: fx.therapistA, params: { id: fx.patientA1 }, body: { status: 'inactive', reason: 'Alta médica' } });
    expect(r.status).toBe(200);
    const cmds = await sqlSystem((tx) => tx`select kind, status from device_commands where patient_id = ${fx.patientA1}`);
    expect(cmds).toEqual([{ kind: 'delete_person', status: 'pending' }]);
  });
});
