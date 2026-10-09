// QA-02 · Integración de la API probada como dueño y como fisioterapeuta.
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { GET as profileGET, POST as profilePOST } from '@/app/api/patients/[id]/profile/route';
import { GET as exercisesGET, POST as exercisesPOST } from '@/app/api/patients/[id]/exercises/route';
import { PATCH as exercisePATCH } from '@/app/api/patients/[id]/exercises/[exerciseId]/route';
import { POST as reorderPOST } from '@/app/api/patients/[id]/exercises/reorder/route';
import * as notesRoute from '@/app/api/patients/[id]/notes/route';
import { GET as consentsGET, POST as consentsPOST } from '@/app/api/patients/[id]/consents/route';
import { GET as consentPdfGET } from '@/app/api/patients/[id]/consents/[consentId]/pdf/route';
import { GET as summaryGET } from '@/app/api/patients/[id]/summary/route';
import { GET as accessLogGET } from '@/app/api/patients/[id]/access-log/route';
import { hashPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { call, resetData, sqlSystem, TEST_PASSWORD, type CoreFixtures as Fixtures, type TestUser } from '../helpers';

const { GET: notesGET, POST: notesPOST } = notesRoute;

/**
 * Mismos datos que `fixtures()` de tests/helpers.ts. Se arman aquí porque `resetData()` del helper hace
 * `set local session_replication_role = replica`, que exige superusuario: con el rol `nce_admin` de la base
 * local la transacción completa falla ("permission denied to set parameter"). TRUNCATE no dispara los
 * triggers por fila de conservación ni de inmutabilidad, así que no hace falta ese parámetro.
 */
async function fixtures(): Promise<Fixtures> {
  // Parte de los datos base: otra prueba pudo renombrar un plan o cambiar el domicilio de una sede,
  // y el orden en que corren los archivos no está garantizado.
  await resetData();
  const hash = await hashPassword(TEST_PASSWORD);
  return sqlSystem(async (tx) => {
    await tx.unsafe(`truncate audit_log, attendance_events, enrollments, device_commands, devices, payments, memberships,
      document_items, documents, folio_counters, time_blocks, therapist_hours, appointments, studies, consents,
      evolution_notes, exercises, clinical_profiles, patient_assignments, patients, email_outbox,
      webauthn_challenges, passkeys, auth_tokens, sessions, users, arco_requests restart identity cascade`);
    const locs = await tx<{ id: string; code: string }[]>`select id, code from locations`;
    const cordoba = locs.find((l) => l.code === 'COR')!.id;
    const orizaba = locs.find((l) => l.code === 'ORI')!.id;
    const planRows = await tx<{ id: string; name: string }[]>`select id, name from membership_plans`;
    const plans = Object.fromEntries(planRows.map((p) => [p.name, p.id]));
    const makeUser = async (u: { username: string; role: 'owner' | 'therapist'; full_name: string; title?: string; location_id?: string; license?: string; physician?: boolean }): Promise<TestUser> => {
      const [row] = await tx<{ id: string }[]>`
        insert into users (username, email, password_hash, role, full_name, title, location_id, license_number, license_institution, is_physician)
        values (${u.username}, ${u.username + '@prueba.mx'}, ${hash}, ${u.role}, ${u.full_name}, ${u.title ?? ''}, ${u.location_id ?? null},
                ${u.license ?? null}, ${u.license ? 'Universidad Veracruzana' : null}, ${u.physician ?? false})
        returning id`;
      const { token } = await createSession(tx, row.id, { method: 'password' });
      return { id: row.id, role: u.role, username: u.username, token, location_id: u.location_id ?? null };
    };
    const owner = await makeUser({ username: 'dueno', role: 'owner', full_name: 'Nicolas Herrera' });
    const therapistA = await makeUser({ username: 'karla', role: 'therapist', full_name: 'Karla Ocampo', title: 'L.F.T.', location_id: cordoba, license: '11223344' });
    const therapistB = await makeUser({ username: 'diego', role: 'therapist', full_name: 'Diego Salinas', title: 'L.F.T.', location_id: orizaba, license: '55667788' });
    const physician = await makeUser({ username: 'mariana', role: 'therapist', full_name: 'Mariana Reyes', title: 'Dra.', location_id: cordoba, license: '99887766', physician: true });
    await tx`select set_config('app.user_id', ${owner.id}, true), set_config('app.user_role', 'owner', true)`;
    const patient = async (p: { name: string; birth: string; ther: string; loc: string; guardian?: string; plan: string; due: number; sessions?: number }) => {
      const [row] = await tx<{ id: string }[]>`
        insert into patients (full_name, sex, birth_date, phone, location_id, therapist_id, guardian_name, guardian_relationship, reason, created_by)
        values (${p.name}, 'F', ${p.birth}, '271 000 0000', ${p.loc}, ${p.ther}, ${p.guardian ?? ''}, ${p.guardian ? 'Madre' : ''}, 'Motivo de prueba', ${owner.id})
        returning id`;
      await tx`insert into memberships (patient_id, plan_id, next_due_date, sessions_remaining)
               values (${row.id}, ${plans[p.plan]}, mx_today() + ${p.due}::int, ${p.sessions ?? null})`;
      return row.id;
    };
    const patientA1 = await patient({ name: 'Ana Prueba Uno', birth: '1990-05-10', ther: therapistA.id, loc: cordoba, plan: 'Mensual Elite', due: 20 });
    const patientA2 = await patient({ name: 'Beto Prueba Dos', birth: '2016-03-14', ther: therapistA.id, loc: cordoba, guardian: 'Lucía Prueba', plan: 'Paquete 10 sesiones', due: 40, sessions: 10 });
    const patientB1 = await patient({ name: 'Carmen Prueba Tres', birth: '1955-01-30', ther: therapistB.id, loc: orizaba, plan: 'Plan Senior', due: -5 });
    return { owner, therapistA, therapistB, physician, cordoba, orizaba, plans, patientA1, patientA2, patientB1 };
  });
}

let fx: Fixtures;
let signature: string; // firma trazada (PNG con trazo)
let blank: string;     // lienzo sin trazo

beforeAll(async () => {
  fx = await fixtures();
  const stroke = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="160"><path d="M20 120 C 80 10, 120 150, 200 60 S 320 20, 440 110" fill="none" stroke="#14161a" stroke-width="3"/></svg>`);
  signature = 'data:image/png;base64,' + (await sharp(stroke).png().toBuffer()).toString('base64');
  blank = 'data:image/png;base64,' +
    (await sharp({ create: { width: 480, height: 160, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()).toString('base64');
});

const P = (id: string, extra: Record<string, string> = {}) => ({ id, ...extra });

describe('EXP-02 · perfil clínico versionado', () => {
  it('cada POST crea una versión nueva y current es la última', async () => {
    const empty = await call(profileGET, { as: fx.therapistA, params: P(fx.patientA1) });
    expect(empty.status).toBe(200);
    expect(empty.data).toEqual({ current: null, versions: [] });

    const v1 = await call(profilePOST, { as: fx.therapistA, params: P(fx.patientA1), body: { diagnosis: 'Esguince de tobillo grado I', treatment_plan: 'Movilidad' } });
    expect(v1.status).toBe(200);
    expect(v1.data.version).toBe(1);
    expect(v1.data.created_by).toBe(fx.therapistA.id);
    expect(v1.data.created_by_name).toBe('L.F.T. Karla Ocampo');

    const v2 = await call(profilePOST, { as: fx.owner, params: P(fx.patientA1), body: { diagnosis: 'Esguince de tobillo grado II', background: 'Sin alergias', condition: 'Dolor al apoyar', examination: 'Edema leve', treatment_plan: 'Fortalecimiento' } });
    expect(v2.data.version).toBe(2);

    const r = await call(profileGET, { as: fx.therapistA, params: P(fx.patientA1) });
    expect(r.data.current.version).toBe(2);
    expect(r.data.current.diagnosis).toBe('Esguince de tobillo grado II');
    expect(r.data.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(r.data.versions[1]).toMatchObject({ version: 1, created_by_name: 'L.F.T. Karla Ocampo' });
    expect(Object.keys(r.data.versions[0]).sort()).toEqual(['created_at', 'created_by_name', 'id', 'version']);

    const old = await call(profileGET, { as: fx.therapistA, params: P(fx.patientA1), url: '/api/x?version=1' });
    expect(old.data.diagnosis).toBe('Esguince de tobillo grado I');
    expect((await call(profileGET, { as: fx.therapistA, params: P(fx.patientA1), url: '/api/x?version=9' })).status).toBe(404);
  });

  it('rechaza un perfil vacío y al fisioterapeuta ajeno', async () => {
    expect((await call(profilePOST, { as: fx.therapistA, params: P(fx.patientA1), body: {} })).status).toBe(400);
    expect((await call(profileGET, { as: fx.therapistB, params: P(fx.patientA1) })).status).toBe(404);
    expect((await call(profilePOST, { as: fx.therapistB, params: P(fx.patientA1), body: { diagnosis: 'x' } })).status).toBe(404);
    expect((await call(profileGET, { as: null, params: P(fx.patientA1) })).status).toBe(401);
    expect((await call(profileGET, { as: fx.therapistA, params: P('no-es-uuid') })).status).toBe(404);
  });
});

describe('EXP-01 / EXP-08 · bitácora de accesos', () => {
  it('abrir el expediente deja un solo evento view aunque se abra dos veces seguidas', async () => {
    await call(profileGET, { as: fx.therapistA, params: P(fx.patientA2) });
    await call(profileGET, { as: fx.therapistA, params: P(fx.patientA2) });
    await Promise.all([1, 2, 3].map(() => call(profileGET, { as: fx.therapistA, params: P(fx.patientA2) })));
    const views = await sqlSystem((tx) => tx`
      select actor_id, actor_name, summary from audit_log where action = 'view' and patient_id = ${fx.patientA2}`);
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ actor_id: fx.therapistA.id, actor_name: 'L.F.T. Karla Ocampo', summary: 'Abrió el expediente' });

    // Otro usuario sí genera su propio evento.
    await call(profileGET, { as: fx.owner, params: P(fx.patientA2) });
    const [{ n }] = await sqlSystem((tx) => tx`select count(*)::int as n from audit_log where action = 'view' and patient_id = ${fx.patientA2}`);
    expect(n).toBe(2);
  });

  it('pasados 10 minutos se registra de nuevo', async () => {
    await sqlSystem(async (tx) => {
      // La bitácora es inmutable: solo para simular el paso del tiempo se suspende su trigger dentro de la transacción.
      await tx.unsafe(`alter table audit_log disable trigger audit_log_immutable`);
      await tx`update audit_log set at = now() - interval '11 minutes' where action = 'view' and patient_id = ${fx.patientA2} and actor_id = ${fx.therapistA.id}`;
      await tx.unsafe(`alter table audit_log enable trigger audit_log_immutable`);
    });
    await call(profileGET, { as: fx.therapistA, params: P(fx.patientA2) });
    const [{ n }] = await sqlSystem((tx) => tx`
      select count(*)::int as n from audit_log where action = 'view' and patient_id = ${fx.patientA2} and actor_id = ${fx.therapistA.id}`);
    expect(n).toBe(2);
  });

  it('un acceso denegado no deja evento', async () => {
    await call(profileGET, { as: fx.therapistB, params: P(fx.patientA2) });
    const [{ n }] = await sqlSystem((tx) => tx`select count(*)::int as n from audit_log where action = 'view' and actor_id = ${fx.therapistB.id}`);
    expect(n).toBe(0);
  });

  it('access-log es solo del dueño y lista los eventos del paciente', async () => {
    expect((await call(accessLogGET, { as: fx.therapistA, params: P(fx.patientA2) })).status).toBe(403);
    const r = await call(accessLogGET, { as: fx.owner, params: P(fx.patientA2), url: '/api/x?limit=2' });
    expect(r.status).toBe(200);
    expect(r.data.limit).toBe(2);
    expect(r.data.items).toHaveLength(2);
    expect(r.data.total).toBeGreaterThanOrEqual(3);
    expect(r.data.items[0]).toMatchObject({ action: 'view', actor_name: 'L.F.T. Karla Ocampo', summary: 'Abrió el expediente' });
    expect(Object.keys(r.data.items[0])).toEqual(expect.arrayContaining(['action', 'at', 'actor_name', 'table_name', 'summary']));
    const page2 = await call(accessLogGET, { as: fx.owner, params: P(fx.patientA2), url: '/api/x?limit=2&offset=2' });
    expect(page2.data.items[0].id).not.toBe(r.data.items[0].id);
    const all = await call(accessLogGET, { as: fx.owner, params: P(fx.patientA2) });
    expect(all.data.items.every((e: { action: string }) => typeof e.action === 'string')).toBe(true);
    expect(all.data.items.some((e: { action: string; table_name: string }) => e.action === 'insert' && e.table_name === 'patients')).toBe(true);
  });
});

describe('EXP-03 · ejercicios', () => {
  it('alta, edición, reordenar y quitar sin borrar', async () => {
    const a = await call(exercisesPOST, { as: fx.therapistA, params: P(fx.patientA1), body: { name: 'Puente de glúteo', dosage: '3 × 12' } });
    const b = await call(exercisesPOST, { as: fx.therapistA, params: P(fx.patientA1), body: { name: 'Sentadilla asistida' } });
    const c = await call(exercisesPOST, { as: fx.therapistA, params: P(fx.patientA1), body: { name: 'Propiocepción en bosu', dosage: '2 min' } });
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
    expect(b.data.dosage).toBe('');
    expect((await call(exercisesPOST, { as: fx.therapistA, params: P(fx.patientA1), body: { name: '   ' } })).status).toBe(400);

    let list = await call(exercisesGET, { as: fx.therapistA, params: P(fx.patientA1) });
    expect(list.data.map((e: { name: string }) => e.name)).toEqual(['Puente de glúteo', 'Sentadilla asistida', 'Propiocepción en bosu']);

    const edit = await call(exercisePATCH, { as: fx.therapistA, method: 'PATCH', params: P(fx.patientA1, { exerciseId: b.data.id }), body: { dosage: '3 × 10' } });
    expect(edit.status).toBe(200);
    expect(edit.data).toMatchObject({ name: 'Sentadilla asistida', dosage: '3 × 10', active: true });

    const re = await call(reorderPOST, { as: fx.therapistA, params: P(fx.patientA1), body: { ids: [c.data.id, a.data.id, b.data.id] } });
    expect(re.status).toBe(200);
    expect(re.data.map((e: { name: string }) => e.name)).toEqual(['Propiocepción en bosu', 'Puente de glúteo', 'Sentadilla asistida']);
    expect((await call(reorderPOST, { as: fx.therapistA, params: P(fx.patientA1), body: { ids: [a.data.id, a.data.id] } })).status).toBe(400);

    const off = await call(exercisePATCH, { as: fx.therapistA, method: 'PATCH', params: P(fx.patientA1, { exerciseId: a.data.id }), body: { active: false } });
    expect(off.data.active).toBe(false);
    list = await call(exercisesGET, { as: fx.therapistA, params: P(fx.patientA1) });
    expect(list.data.map((e: { name: string }) => e.name)).toEqual(['Propiocepción en bosu', 'Sentadilla asistida']);
    const [row] = await sqlSystem((tx) => tx`select active from exercises where id = ${a.data.id}`);
    expect(row.active).toBe(false); // sigue en la base

    // Un ejercicio nuevo se agrega al final.
    const d = await call(exercisesPOST, { as: fx.therapistA, params: P(fx.patientA1), body: { name: 'Marcha lateral con liga' } });
    list = await call(exercisesGET, { as: fx.therapistA, params: P(fx.patientA1) });
    expect(list.data.at(-1).id).toBe(d.data.id);
  });

  it('el fisioterapeuta B no ve ni toca los ejercicios del paciente de A', async () => {
    const list = await call(exercisesGET, { as: fx.owner, params: P(fx.patientA1) });
    const id = list.data[0].id;
    expect((await call(exercisesGET, { as: fx.therapistB, params: P(fx.patientA1) })).status).toBe(404);
    expect((await call(exercisesPOST, { as: fx.therapistB, params: P(fx.patientA1), body: { name: 'Intruso' } })).status).toBe(404);
    expect((await call(exercisePATCH, { as: fx.therapistB, method: 'PATCH', params: P(fx.patientA1, { exerciseId: id }), body: { name: 'Intruso' } })).status).toBe(404);
    expect((await call(reorderPOST, { as: fx.therapistB, params: P(fx.patientA1), body: { ids: [id] } })).status).toBe(404);
    // Tampoco colándolo por la ruta de su propio paciente.
    expect((await call(exercisePATCH, { as: fx.therapistB, method: 'PATCH', params: P(fx.patientB1, { exerciseId: id }), body: { name: 'Intruso' } })).status).toBe(404);
    expect((await call(reorderPOST, { as: fx.therapistB, params: P(fx.patientB1), body: { ids: [id] } })).status).toBe(400);
    const [row] = await sqlSystem((tx) => tx`select name from exercises where id = ${id}`);
    expect(row.name).not.toBe('Intruso');
  });
});

describe('EXP-04 · notas de evolución', () => {
  it('no existe PATCH ni DELETE', () => {
    expect(Object.keys(notesRoute).sort()).toEqual(['GET', 'POST']);
  });

  it('se firma con el usuario de la sesión aunque el cliente mande otro autor', async () => {
    const r = await call(notesPOST, {
      as: fx.therapistA, params: P(fx.patientA1),
      body: { body: 'Tolera carga parcial.', pain_level: 4, range_of_motion: 'Flexión 110°',
        author_id: fx.therapistB.id, author_name: 'Otra persona', author_license: '000', signature_hash: 'falsa', noted_at: '2020-01-01T00:00:00Z' },
    });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ author_id: fx.therapistA.id, author_name: 'L.F.T. Karla Ocampo', author_license: '11223344', pain_level: 4, range_of_motion: 'Flexión 110°' });
    expect(r.data.signature_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(r.data.noted_at).getFullYear()).toBeGreaterThan(2020);
  });

  it('valida el contenido y la cita', async () => {
    expect((await call(notesPOST, { as: fx.therapistA, params: P(fx.patientA1), body: { body: '  ' } })).status).toBe(400);
    expect((await call(notesPOST, { as: fx.therapistA, params: P(fx.patientA1), body: { body: 'x', pain_level: 11 } })).status).toBe(400);

    const [mine] = await sqlSystem((tx) => tx`
      insert into appointments (patient_id, therapist_id, location_id, starts_at, duration_min, type_name)
      values (${fx.patientA1}, ${fx.therapistA.id}, ${fx.cordoba}, now() + interval '1 day', 50, 'Fisioterapia') returning id`);
    const [other] = await sqlSystem((tx) => tx`
      insert into appointments (patient_id, therapist_id, location_id, starts_at, duration_min, type_name)
      values (${fx.patientA2}, ${fx.therapistA.id}, ${fx.cordoba}, now() + interval '2 days', 50, 'Fisioterapia') returning id`);
    const bad = await call(notesPOST, { as: fx.therapistA, params: P(fx.patientA1), body: { body: 'Nota con cita ajena', appointment_id: other.id } });
    expect(bad.status).toBe(400);
    expect(bad.error?.fields?.appointment_id).toBeTruthy();
    const ok = await call(notesPOST, { as: fx.therapistA, params: P(fx.patientA1), body: { body: 'Nota ligada a su cita', appointment_id: mine.id, pain_level: 2 } });
    expect(ok.status).toBe(200);
    expect(ok.data.appointment_id).toBe(mine.id);
  });

  it('la adenda queda anidada bajo la nota original y la lista va de la más reciente a la más antigua', async () => {
    const before = await call(notesGET, { as: fx.therapistA, params: P(fx.patientA1) });
    expect(before.data).toHaveLength(2);
    expect(before.data[0].body).toBe('Nota ligada a su cita');
    const first = before.data[1];

    const ad = await call(notesPOST, { as: fx.owner, params: P(fx.patientA1), body: { body: 'Corrección: la flexión fue de 100°.', addendum_of: first.id, pain_level: 9 } });
    expect(ad.status).toBe(200);
    expect(ad.data).toMatchObject({ addendum_of: first.id, author_id: fx.owner.id, pain_level: null });
    // Una adenda sobre otra adenda cuelga de la nota original.
    const ad2 = await call(notesPOST, { as: fx.therapistA, params: P(fx.patientA1), body: { body: 'Segunda precisión.', addendum_of: ad.data.id } });
    expect(ad2.data.addendum_of).toBe(first.id);

    const after = await call(notesGET, { as: fx.therapistA, params: P(fx.patientA1) });
    expect(after.data).toHaveLength(2);
    const n = after.data.find((x: { id: string }) => x.id === first.id);
    expect(n.addenda.map((a: { body: string }) => a.body)).toEqual(['Corrección: la flexión fue de 100°.', 'Segunda precisión.']);
    expect(after.data[0].addenda).toEqual([]);

    // La adenda no puede colgarse de una nota de otro paciente.
    const cross = await call(notesPOST, { as: fx.therapistA, params: P(fx.patientA2), body: { body: 'x', addendum_of: first.id } });
    expect(cross.status).toBe(400);
  });

  it('el fisioterapeuta B recibe 404 en las notas del paciente de A', async () => {
    expect((await call(notesGET, { as: fx.therapistB, params: P(fx.patientA1) })).status).toBe(404);
    expect((await call(notesPOST, { as: fx.therapistB, params: P(fx.patientA1), body: { body: 'Intruso' } })).status).toBe(404);
    const [{ n }] = await sqlSystem((tx) => tx`select count(*)::int as n from evolution_notes where author_id = ${fx.therapistB.id}`);
    expect(n).toBe(0);
  });
});

describe('EXP-10 / PAC-08 · consentimientos', () => {
  it('la plantilla llega con clínica, domicilio y paciente resueltos', async () => {
    const t = await call(consentsGET, { as: fx.therapistA, params: P(fx.patientA1), url: '/api/x?template=privacy' });
    expect(t.status).toBe(200);
    expect(t.data.body).toContain('Nicolas Center Elite, con domicilio en Córdoba, Veracruz');
    expect(t.data.body).not.toContain('{{clinica}}');
    expect(t.data.is_minor).toBe(false);
    const inf = await call(consentsGET, { as: fx.therapistA, params: P(fx.patientA2), url: '/api/x?template=informed' });
    expect(inf.data.body).toContain('Beto Prueba Dos');
    expect(inf.data.body).toContain('{{firmante}}');
    expect(inf.data).toMatchObject({ is_minor: true, guardian_name: 'Lucía Prueba', guardian_relationship: 'Madre' });
    expect((await call(consentsGET, { as: fx.therapistA, params: P(fx.patientA1), url: '/api/x?template=otro' })).status).toBe(400);
  });

  it('POST guarda el snapshot armado por el servidor con todos los marcadores resueltos', async () => {
    const r = await call(consentsPOST, {
      as: fx.therapistA, params: P(fx.patientA2),
      body: { kind: 'informed', signer_name: 'Lucía Prueba', signer_relationship: 'Madre', signature_png: signature, body_snapshot: 'TEXTO DEL CLIENTE' },
    });
    expect(r.status).toBe(200);
    expect(r.data.body_snapshot).toContain('Yo, Lucía Prueba, en mi carácter de madre de Beto Prueba Dos');
    expect(r.data.body_snapshot).toContain('personal de Nicolas Center Elite');
    expect(r.data.body_snapshot).not.toMatch(/\{\{|\}\}/);
    expect(r.data.body_snapshot).not.toContain('TEXTO DEL CLIENTE');
    expect(r.data).toMatchObject({ recorded_by: fx.therapistA.id, recorded_by_name: 'L.F.T. Karla Ocampo', signer_relationship: 'Madre' });
    expect(r.data.signature_png).toBeUndefined();

    const self = await call(consentsPOST, { as: fx.therapistA, params: P(fx.patientA1), body: { kind: 'biometric', signer_name: 'Ana Prueba Uno', signer_relationship: 'Paciente', signature_png: signature } });
    expect(self.status).toBe(200);
    expect(self.data.body_snapshot).toContain('Yo, Ana Prueba Uno, por mi propio derecho, en mi carácter de paciente, autorizo');
    expect(self.data.body_snapshot).not.toMatch(/\{\{|\}\}/);

    const list = await call(consentsGET, { as: fx.therapistA, params: P(fx.patientA2) });
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({ kind: 'informed', signer_name: 'Lucía Prueba', signer_relationship: 'Madre', recorded_by_name: 'L.F.T. Karla Ocampo' });
    expect(list.data[0].signed_at).toBeTruthy();
    expect(list.data[0].signature_png).toBeUndefined();
    expect(list.data[0].body_snapshot).toBeUndefined();
  });

  it('firma vacía o inválida → 400', async () => {
    const base = { kind: 'privacy', signer_name: 'Ana Prueba Uno', signer_relationship: 'Paciente' };
    for (const signature_png of ['', blank, 'data:image/png;base64,', 'data:image/jpeg;base64,/9j/4AAQ', 'data:image/png;base64,' + Buffer.from('no soy un png, de verdad que no lo soy, lo juro por lo mas sagrado').toString('base64'),
      'data:image/png;base64,' + 'A'.repeat(310 * 1024)]) {
      const r = await call(consentsPOST, { as: fx.therapistA, params: P(fx.patientA1), body: { ...base, signature_png } });
      expect(r.status, signature_png.slice(0, 40)).toBe(400);
    }
    const [{ n }] = await sqlSystem((tx) => tx`select count(*)::int as n from consents where patient_id = ${fx.patientA1} and kind = 'privacy'`);
    expect(n).toBe(0);
  });

  it('valida firmante, parentesco y que un menor no firme por sí mismo', async () => {
    const ok = { kind: 'privacy', signer_name: 'Lucía Prueba', signer_relationship: 'Madre', signature_png: signature };
    expect((await call(consentsPOST, { as: fx.therapistA, params: P(fx.patientA2), body: { ...ok, signer_name: 'L' } })).status).toBe(400);
    expect((await call(consentsPOST, { as: fx.therapistA, params: P(fx.patientA2), body: { ...ok, signer_relationship: 'Vecino' } })).status).toBe(400);
    expect((await call(consentsPOST, { as: fx.therapistA, params: P(fx.patientA2), body: { ...ok, kind: 'otro' } })).status).toBe(400);
    const minor = await call(consentsPOST, { as: fx.therapistA, params: P(fx.patientA2), body: { ...ok, signer_name: 'Beto Prueba Dos', signer_relationship: 'Paciente' } });
    expect(minor.status).toBe(400);
    expect(minor.error?.fields?.signer_relationship).toBeTruthy();
  });

  it('el PDF responde application/pdf y deja rastro; B no accede a nada', async () => {
    const list = await call(consentsGET, { as: fx.owner, params: P(fx.patientA2) });
    const id = list.data[0].id;
    const pdf = await call(consentPdfGET, { as: fx.therapistA, params: P(fx.patientA2, { consentId: id }) });
    expect(pdf.status).toBe(200);
    expect(pdf.res.headers.get('content-type')).toBe('application/pdf');
    const bytes = Buffer.from(await pdf.res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(2000);

    expect((await call(consentPdfGET, { as: fx.therapistB, params: P(fx.patientA2, { consentId: id }) })).status).toBe(404);
    expect((await call(consentPdfGET, { as: fx.therapistB, params: P(fx.patientB1, { consentId: id }) })).status).toBe(404);
    expect((await call(consentsGET, { as: fx.therapistB, params: P(fx.patientA2) })).status).toBe(404);
    expect((await call(consentsGET, { as: fx.therapistB, params: P(fx.patientA2), url: '/api/x?template=privacy' })).status).toBe(404);
    expect((await call(consentsPOST, { as: fx.therapistB, params: P(fx.patientA2), body: { kind: 'privacy', signer_name: 'Lucía Prueba', signer_relationship: 'Madre', signature_png: signature } })).status).toBe(404);
  });
});

describe('EXP-07 · resumen clínico en PDF', () => {
  it('responde application/pdf y deja un evento export', async () => {
    const r = await call(summaryGET, { as: fx.therapistA, params: P(fx.patientA1) });
    expect(r.status).toBe(200);
    expect(r.res.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await r.res.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    const events = await sqlSystem((tx) => tx`
      select actor_id, summary from audit_log where action = 'export' and patient_id = ${fx.patientA1}`);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor_id: fx.therapistA.id, summary: 'Generó resumen clínico' });
  });

  it('funciona con un expediente vacío y niega el del paciente ajeno', async () => {
    const r = await call(summaryGET, { as: fx.therapistB, params: P(fx.patientB1) });
    expect(r.status).toBe(200);
    expect(r.res.headers.get('content-type')).toBe('application/pdf');
    const denied = await call(summaryGET, { as: fx.therapistB, params: P(fx.patientA1) });
    expect(denied.status).toBe(404);
    const [{ n }] = await sqlSystem((tx) => tx`select count(*)::int as n from audit_log where action = 'export' and patient_id = ${fx.patientA1}`);
    expect(n).toBe(1);
  });
});
