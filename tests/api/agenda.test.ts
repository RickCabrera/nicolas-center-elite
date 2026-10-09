// QA-02 · Integración de la API probada como dueño y como fisioterapeuta.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, localToInstant, todayIso, weekday } from '@/lib/dates';
import { GET as LIST, POST as CREATE } from '@/app/api/appointments/route';
import { GET as ONE, PATCH as EDIT } from '@/app/api/appointments/[id]/route';
import { POST as CANCEL } from '@/app/api/appointments/[id]/cancel/route';
import { POST as STATUS } from '@/app/api/appointments/[id]/status/route';
import { GET as DAYS } from '@/app/api/appointments/days/route';
import { GET as HOURS, PUT as PUT_HOURS } from '@/app/api/schedule/hours/route';
import { GET as BLOCKS, POST as ADD_BLOCK } from '@/app/api/schedule/blocks/route';
import { DELETE as DEL_BLOCK } from '@/app/api/schedule/blocks/[id]/route';
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
const day = (n: number) => addDays(todayIso(), n);
const D1 = day(3);

const book = (as: TestUser, over: Record<string, unknown> = {}) =>
  call(CREATE, { as, url: '/api/appointments', body: { patient_id: fx.patientA1, date: D1, time: '10:00', duration_min: 50, type_name: 'Fisioterapia', ...over } });
const list = (as: TestUser, q: string) => call(LIST, { as, url: `/api/appointments?${q}` });

beforeAll(async () => { fx = await fixtures(); });
beforeEach(async () => {
  await sqlSystem(async (tx) => {
    await tx.unsafe(`truncate attendance_events, time_blocks, therapist_hours, appointments cascade`);
  });
});

describe('AGE-01 · crear y listar citas', () => {
  it('el dueño agenda; por defecto con el fisioterapeuta asignado y en la sede de este', async () => {
    const r = await book(fx.owner, { notes: 'Traer vendaje' });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({
      patient_id: fx.patientA1, therapist_id: fx.therapistA.id, location_id: fx.cordoba, status: 'scheduled',
      date: D1, time: '10:00', duration_min: 50, type_name: 'Fisioterapia', notes: 'Traer vendaje',
      patient_name: 'Ana Prueba Uno', therapist_name: 'L.F.T. Karla Ocampo', therapist_short: 'Karla', has_note: false,
    });
    expect(new Date(r.data.starts_at).toISOString()).toBe(localToInstant(D1, '10:00').toISOString());
    expect(new Date(r.data.ends_at).getTime() - new Date(r.data.starts_at).getTime()).toBe(50 * 60000);
  });

  it('el dueño puede elegir otro fisioterapeuta: la cita toma la sede de ese fisioterapeuta', async () => {
    const r = await book(fx.owner, { therapist_id: fx.therapistB.id });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ therapist_id: fx.therapistB.id, location_id: fx.orizaba });
  });

  it('el fisioterapeuta agenda a su paciente; aunque mande otro fisioterapeuta, queda a su nombre', async () => {
    const r = await book(fx.therapistA, { therapist_id: fx.therapistB.id });
    expect(r.status).toBe(200);
    expect(r.data.therapist_id).toBe(fx.therapistA.id);
  });

  it('el fisioterapeuta no puede agendar a un paciente ajeno', async () => {
    const r = await book(fx.therapistA, { patient_id: fx.patientB1 });
    expect(r.status).toBe(404);
    const n = await sqlSystem((tx) => tx`select count(*)::int as n from appointments`);
    expect(n[0].n).toBe(0);
  });

  it('valida los datos y señala el campo', async () => {
    const r = await book(fx.owner, { time: '25:00', type_name: ' ' });
    expect(r.status).toBe(400);
    expect(r.error?.fields).toHaveProperty('time');
    expect(r.error?.fields).toHaveProperty('type_name');
    expect((await book(fx.owner, { date: '2026-02-31' })).status).toBe(400);
    expect((await call(CREATE, { url: '/api/appointments', body: {} })).status).toBe(401);
  });

  it('en el pasado: el fisioterapeuta no; el dueño sí (captura retroactiva)', async () => {
    const t = await book(fx.therapistA, { date: day(-2) });
    expect(t.status).toBe(400);
    expect(t.error?.fields).toHaveProperty('date');
    expect((await book(fx.owner, { date: day(-2) })).status).toBe(200);
  });

  it('empalme del fisioterapeuta → 409 overlap', async () => {
    expect((await book(fx.owner)).status).toBe(200);
    const r = await book(fx.owner, { patient_id: fx.patientA2, time: '10:30' });
    expect(r.status).toBe(409);
    expect(r.error?.code).toBe('overlap');
    expect(r.error?.message).toMatch(/fisioterapeuta ya tiene una cita/i);
  });

  it('empalme del paciente con otro fisioterapeuta → 409 overlap', async () => {
    expect((await book(fx.owner, { therapist_id: fx.therapistB.id })).status).toBe(200);
    const r = await book(fx.therapistA, { time: '10:20' });
    expect(r.status).toBe(409);
    expect(r.error?.code).toBe('overlap');
    expect(r.error?.message).toMatch(/paciente ya tiene una cita/i);
  });

  it('una cita contigua (empieza justo cuando termina la otra) sí se permite', async () => {
    expect((await book(fx.owner)).status).toBe(200);
    expect((await book(fx.owner, { time: '10:50' })).status).toBe(200);
    expect((await book(fx.owner, { patient_id: fx.patientA2, time: '09:10' })).status).toBe(200);
  });

  it('visibilidad por rol y filtros del listado', async () => {
    await book(fx.owner);                                                   // A1 con A
    await book(fx.owner, { patient_id: fx.patientB1, time: '09:00' });      // B1 con B
    await book(fx.owner, { patient_id: fx.patientA2, time: '12:00', date: day(4) });
    const all = await list(fx.owner, `from=${D1}&to=${day(4)}`);
    expect(all.data.map((a: any) => a.time)).toEqual(['09:00', '10:00', '12:00']);
    const a = await list(fx.therapistA, `from=${D1}&to=${day(4)}`);
    expect(a.data).toHaveLength(2);
    expect(a.data.every((x: any) => x.therapist_id === fx.therapistA.id)).toBe(true);
    // Aunque pida las de B, RLS no se las entrega.
    expect((await list(fx.therapistA, `from=${D1}&to=${day(4)}&therapist_id=${fx.therapistB.id}`)).data).toHaveLength(0);
    expect((await list(fx.owner, `from=${D1}&to=${day(4)}&therapist_id=${fx.therapistB.id}`)).data).toHaveLength(1);
    expect((await list(fx.owner, `from=${D1}&to=${day(4)}&patient_id=${fx.patientA2}`)).data).toHaveLength(1);
    // Una cita ajena no existe para el otro fisioterapeuta.
    const idB = all.data[0].id;
    expect((await call(ONE, { as: fx.therapistA, params: { id: idB } })).status).toBe(404);
    expect((await call(ONE, { as: fx.therapistB, params: { id: idB } })).status).toBe(200);
    expect((await call(EDIT, { as: fx.therapistA, params: { id: idB }, method: 'PATCH', body: { notes: 'x' } })).status).toBe(404);
    expect((await call(CANCEL, { as: fx.therapistA, params: { id: idB }, body: { reason: 'No es mía' } })).status).toBe(404);
    expect((await call(STATUS, { as: fx.therapistA, params: { id: idB }, body: { status: 'no_show' } })).status).toBe(404);
  });

  it('el rango es obligatorio y de máximo 62 días', async () => {
    expect((await list(fx.owner, `from=${D1}`)).status).toBe(400);
    expect((await list(fx.owner, `from=${D1}&to=${addDays(D1, 61)}`)).status).toBe(200);
    expect((await list(fx.owner, `from=${D1}&to=${addDays(D1, 62)}`)).status).toBe(400);
    expect((await list(fx.owner, `from=${D1}&to=${addDays(D1, -1)}`)).status).toBe(400);
  });

  it('has_note refleja la nota de evolución ligada a la cita (AGE-09)', async () => {
    const c = await book(fx.therapistA, { date: todayIso(), time: '23:00', duration_min: 30 });
    expect(c.status).toBe(200);
    await sqlSystem(async (tx) => {
      await tx`select set_config('app.user_id', ${fx.therapistA.id}, true)`;
      await tx`insert into evolution_notes (patient_id, appointment_id, body, author_id, author_name, signature_hash)
               values (${fx.patientA1}, ${c.data.id}, 'Evoluciona bien', ${fx.therapistA.id}, '', '')`;
    });
    const r = await call(ONE, { as: fx.therapistA, params: { id: c.data.id } });
    expect(r.data.has_note).toBe(true);
  });
});

describe('AGE-02 · conteo por día local', () => {
  it('una cita a las 23:30 hora de México cuenta en ese día, no en el siguiente (UTC)', async () => {
    const c = await book(fx.owner, { time: '23:30', duration_min: 20 });
    expect(c.status).toBe(200);
    expect(new Date(c.data.starts_at).toISOString().slice(0, 10)).toBe(addDays(D1, 1));   // en UTC ya es mañana
    expect(c.data.date).toBe(D1);
    await book(fx.owner, { patient_id: fx.patientB1, time: '08:00' });
    const cancelled = await book(fx.owner, { patient_id: fx.patientA2, time: '12:00' });
    await call(CANCEL, { as: fx.owner, params: { id: cancelled.data.id }, body: { reason: 'Prueba de conteo' } });

    const d = await call(DAYS, { as: fx.owner, url: `/api/appointments/days?from=${day(0)}&to=${day(13)}` });
    expect(d.data).toEqual([{ date: D1, count: 2 }]);
    const dA = await call(DAYS, { as: fx.therapistA, url: `/api/appointments/days?from=${day(0)}&to=${day(13)}` });
    expect(dA.data).toEqual([{ date: D1, count: 1 }]);
    expect((await list(fx.owner, `from=${D1}&to=${D1}`)).data).toHaveLength(2);
    expect((await list(fx.owner, `from=${addDays(D1, 1)}&to=${addDays(D1, 1)}`)).data).toHaveLength(0);
  });
});

describe('AGE-07 · horario laboral y bloqueos', () => {
  const week = (start: string, end: string) => [1, 2, 3, 4, 5, 6, 0].map((w) => ({ weekday: w, start_time: start, end_time: end }));

  it('PUT reemplaza el horario; valida fin > inicio y traslapes', async () => {
    const r = await call(PUT_HOURS, { as: fx.therapistA, method: 'PUT', body: { user_id: fx.therapistA.id, hours: week('09:00', '14:00') } });
    expect(r.status).toBe(200);
    expect(r.data).toHaveLength(7);
    const r2 = await call(PUT_HOURS, { as: fx.owner, method: 'PUT', body: { user_id: fx.therapistA.id, hours: [
      { weekday: 1, start_time: '16:00', end_time: '20:00' }, { weekday: 1, start_time: '09:00', end_time: '14:00' }] } });
    expect(r2.status).toBe(200);
    const g = await call(HOURS, { as: fx.therapistB, url: `/api/schedule/hours?user_id=${fx.therapistA.id}` });
    expect(g.data).toEqual([{ weekday: 1, start_time: '09:00', end_time: '14:00' }, { weekday: 1, start_time: '16:00', end_time: '20:00' }]);

    const bad = await call(PUT_HOURS, { as: fx.owner, method: 'PUT', body: { user_id: fx.therapistA.id, hours: [{ weekday: 2, start_time: '14:00', end_time: '09:00' }] } });
    expect(bad.status).toBe(400);
    const overlap = await call(PUT_HOURS, { as: fx.owner, method: 'PUT', body: { user_id: fx.therapistA.id, hours: [
      { weekday: 2, start_time: '09:00', end_time: '14:00' }, { weekday: 2, start_time: '13:00', end_time: '18:00' }] } });
    expect(overlap.status).toBe(400);
    expect(overlap.error?.message).toMatch(/traslapan/);
    // Los rechazos no tocaron lo guardado.
    expect((await call(HOURS, { as: fx.therapistA, url: '/api/schedule/hours' })).data).toHaveLength(2);
  });

  it('un fisioterapeuta no puede editar el horario ni los bloqueos de otro (403)', async () => {
    const r = await call(PUT_HOURS, { as: fx.therapistA, method: 'PUT', body: { user_id: fx.therapistB.id, hours: week('09:00', '14:00') } });
    expect(r.status).toBe(403);
    const b = await call(ADD_BLOCK, { as: fx.therapistA, body: { user_id: fx.therapistB.id, from_date: D1, to_date: day(5), reason: 'x' } });
    expect(b.status).toBe(403);
    expect((await call(BLOCKS, { as: fx.therapistA, url: `/api/schedule/blocks?user_id=${fx.therapistB.id}` })).status).toBe(403);
  });

  it('fuera del horario laboral → 409 outside_hours; dentro sí agenda', async () => {
    await call(PUT_HOURS, { as: fx.owner, method: 'PUT', body: { user_id: fx.therapistA.id, hours: week('09:00', '14:00') } });
    const late = await book(fx.owner, { time: '15:00' });
    expect(late.status).toBe(409);
    expect(late.error?.code).toBe('outside_hours');
    expect(late.error?.message).toMatch(/fuera del horario laboral/);
    expect((await book(fx.owner, { time: '13:30' })).status).toBe(409);        // termina 14:20
    expect((await book(fx.therapistA, { time: '13:10' })).status).toBe(200);   // termina 14:00 exacto
    // Otro fisioterapeuta sin horario definido no tiene restricción.
    expect((await book(fx.owner, { patient_id: fx.patientB1, time: '21:00' })).status).toBe(200);
  });

  it('dentro de un bloqueo → 409 con el motivo; al quitarlo se puede agendar', async () => {
    const b = await call(ADD_BLOCK, { as: fx.therapistA, body: { user_id: fx.therapistA.id, from_date: D1, to_date: addDays(D1, 2), reason: 'Vacaciones' } });
    expect(b.status).toBe(200);
    const r = await book(fx.owner);
    expect(r.status).toBe(409);
    expect(r.error?.code).toBe('outside_hours');
    expect(r.error?.message).toMatch(/bloqueo.*Vacaciones/);

    const mine = await call(BLOCKS, { as: fx.therapistA, url: `/api/schedule/blocks?from=${D1}&to=${D1}` });
    expect(mine.data).toHaveLength(1);
    expect((await call(BLOCKS, { as: fx.therapistB, url: '/api/schedule/blocks' })).data).toHaveLength(0);
    expect((await call(BLOCKS, { as: fx.owner, url: `/api/schedule/blocks?user_id=${fx.therapistA.id}` })).data).toHaveLength(1);

    expect((await call(DEL_BLOCK, { as: fx.therapistB, method: 'DELETE', params: { id: b.data.id } })).status).toBe(404);
    expect((await call(DEL_BLOCK, { as: fx.therapistA, method: 'DELETE', params: { id: b.data.id } })).status).toBe(200);
    expect((await book(fx.owner)).status).toBe(200);
  });

  it('bloquear sobre citas programadas → 409 con la lista, salvo force', async () => {
    await book(fx.owner);
    const body = { user_id: fx.therapistA.id, from_date: D1, from_time: '09:00', to_date: D1, to_time: '12:00', reason: 'Permiso' };
    const r = await call(ADD_BLOCK, { as: fx.therapistA, body });
    expect(r.status).toBe(409);
    expect(r.error?.code).toBe('has_appointments');
    expect(r.error?.message).toMatch(/1 cita programada.*Ana Prueba Uno/);
    expect((await call(ADD_BLOCK, { as: fx.therapistA, body: { ...body, force: true } })).status).toBe(200);
    expect((await call(ADD_BLOCK, { as: fx.therapistA, body: { ...body, to_time: '08:00' } })).status).toBe(400);
  });
});

describe('AGE-04 · cancelar y reprogramar', () => {
  it('cancelar exige motivo, conserva la cita en el historial y libera el horario', async () => {
    const c = await book(fx.therapistA);
    expect((await call(CANCEL, { as: fx.therapistA, params: { id: c.data.id }, body: {} })).status).toBe(400);
    expect((await call(CANCEL, { as: fx.therapistA, params: { id: c.data.id }, body: { reason: ' ' } })).status).toBe(400);
    const r = await call(CANCEL, { as: fx.therapistA, params: { id: c.data.id }, body: { reason: 'El paciente avisó que no viene' } });
    expect(r.status).toBe(200);
    expect(r.data.appointment).toMatchObject({ status: 'cancelled', cancel_reason: 'El paciente avisó que no viene' });
    expect(r.data.appointment.cancelled_at).toBeTruthy();

    expect((await list(fx.owner, `from=${D1}&to=${D1}`)).data).toHaveLength(0);
    const withC = await list(fx.owner, `from=${D1}&to=${D1}&include_cancelled=1`);
    expect(withC.data).toHaveLength(1);
    expect(withC.data[0].status).toBe('cancelled');
    expect((await list(fx.owner, `from=${D1}&to=${D1}&status=cancelled`)).data).toHaveLength(1);

    expect((await book(fx.owner, { patient_id: fx.patientA2 })).status).toBe(200);          // mismo hueco, ya libre
    expect((await call(CANCEL, { as: fx.owner, params: { id: c.data.id }, body: { reason: 'Otra vez' } })).status).toBe(409);
    expect((await call(EDIT, { as: fx.owner, params: { id: c.data.id }, method: 'PATCH', body: { time: '11:00' } })).status).toBe(409);
  });

  it('reprogramar mueve la cita y valida empalmes, horario y pasado', async () => {
    const a = await book(fx.owner);
    const b = await book(fx.owner, { patient_id: fx.patientA2, time: '12:00' });
    const clash = await call(EDIT, { as: fx.therapistA, params: { id: b.data.id }, method: 'PATCH', body: { time: '10:30' } });
    expect(clash.status).toBe(409);
    expect(clash.error?.code).toBe('overlap');
    const ok = await call(EDIT, { as: fx.therapistA, params: { id: b.data.id }, method: 'PATCH', body: { date: day(4), time: '10:30', duration_min: 30, type_name: 'Valoración inicial', notes: 'Cambio' } });
    expect(ok.status).toBe(200);
    expect(ok.data).toMatchObject({ date: day(4), time: '10:30', duration_min: 30, type_name: 'Valoración inicial', notes: 'Cambio' });
    expect(new Date(ok.data.ends_at).getTime() - new Date(ok.data.starts_at).getTime()).toBe(30 * 60000);
    // Alargarla sobre sí misma no es empalme.
    expect((await call(EDIT, { as: fx.owner, params: { id: a.data.id }, method: 'PATCH', body: { duration_min: 90 } })).status).toBe(200);

    expect((await call(EDIT, { as: fx.therapistA, params: { id: a.data.id }, method: 'PATCH', body: { date: day(-3) } })).status).toBe(400);
    await call(PUT_HOURS, { as: fx.owner, method: 'PUT', body: { user_id: fx.therapistA.id, hours: [{ weekday: weekday(D1), start_time: '09:00', end_time: '14:00' }] } });
    const out = await call(EDIT, { as: fx.therapistA, params: { id: a.data.id }, method: 'PATCH', body: { time: '18:00' } });
    expect(out.status).toBe(409);
    expect(out.error?.code).toBe('outside_hours');
    // Editar solo las notas no revalida el horario.
    expect((await call(EDIT, { as: fx.therapistA, params: { id: ok.data.id }, method: 'PATCH', body: { notes: 'Solo notas' } })).status).toBe(200);
  });

  it('solo el dueño cambia el fisioterapeuta de una cita', async () => {
    const a = await book(fx.owner);
    const t = await call(EDIT, { as: fx.therapistA, params: { id: a.data.id }, method: 'PATCH', body: { therapist_id: fx.physician.id } });
    expect(t.status).toBe(200);
    expect(t.data.therapist_id).toBe(fx.therapistA.id);
    const o = await call(EDIT, { as: fx.owner, params: { id: a.data.id }, method: 'PATCH', body: { therapist_id: fx.therapistB.id } });
    expect(o.status).toBe(200);
    expect(o.data).toMatchObject({ therapist_id: fx.therapistB.id, location_id: fx.orizaba });
  });
});

describe('AGE-08 · citas recurrentes', () => {
  it('crea la serie completa con un series_id común', async () => {
    const wd = weekday(D1);
    const r = await book(fx.therapistA, { repeat: { weekdays: [wd, (wd + 2) % 7], weeks: 3 } });
    expect(r.status).toBe(200);
    expect(r.data.created).toHaveLength(6);
    expect(r.data.conflicts).toEqual([]);
    expect(new Set(r.data.created.map((a: any) => a.series_id))).toEqual(new Set([r.data.series_id]));
    expect(r.data.created.map((a: any) => a.date)).toEqual([D1, addDays(D1, 2), addDays(D1, 7), addDays(D1, 9), addDays(D1, 14), addDays(D1, 16)]);
    expect(r.data.created.every((a: any) => a.time === '10:00')).toBe(true);
  });

  it('reporta los conflictos (empalme, horario, bloqueo) sin abortar las demás', async () => {
    const wd = weekday(D1);
    await book(fx.owner, { patient_id: fx.patientA2, date: addDays(D1, 7), time: '10:20' });                       // empalme en la 2.ª
    await call(ADD_BLOCK, { as: fx.owner, body: { user_id: fx.therapistA.id, from_date: addDays(D1, 14), to_date: addDays(D1, 15), reason: 'Congreso' } }); // bloqueo en la 3.ª
    const r = await book(fx.owner, { repeat: { weekdays: [wd], weeks: 4 } });
    expect(r.status).toBe(200);
    expect(r.data.created.map((a: any) => a.date)).toEqual([D1, addDays(D1, 21)]);
    expect(r.data.conflicts).toHaveLength(2);
    expect(r.data.conflicts[0]).toMatchObject({ date: addDays(D1, 7), time: '10:00' });
    expect(r.data.conflicts[0].reason).toMatch(/fisioterapeuta ya tiene una cita/);
    expect(r.data.conflicts[1]).toMatchObject({ date: addDays(D1, 14) });
    expect(r.data.conflicts[1].reason).toMatch(/bloqueo.*Congreso/);
    const n = await sqlSystem((tx) => tx`select count(*)::int as n from appointments where series_id = ${r.data.series_id}`);
    expect(n[0].n).toBe(2);
  });

  it('límites: máximo 60 citas y al menos un día; si nada se pudo, 409', async () => {
    expect((await book(fx.owner, { repeat: { weekdays: [0, 1, 2, 3, 4, 5, 6], weeks: 12 } })).status).toBe(400);
    expect((await book(fx.owner, { repeat: { weekdays: [], weeks: 2 } })).status).toBe(400);
    expect((await book(fx.owner, { repeat: { weekdays: [1], weeks: 13 } })).status).toBe(400);
    await book(fx.owner);
    const r = await book(fx.owner, { repeat: { weekdays: [weekday(D1)], weeks: 1 } });
    expect(r.status).toBe(409);
  });

  it('cancelar "esta y las siguientes" de la serie', async () => {
    const r = await book(fx.owner, { repeat: { weekdays: [weekday(D1)], weeks: 4 } });
    const ids = r.data.created.map((a: any) => a.id);
    const c = await call(CANCEL, { as: fx.therapistA, params: { id: ids[1] }, body: { reason: 'Alta del paciente', scope: 'following' } });
    expect(c.status).toBe(200);
    expect(c.data.cancelled).toBe(3);
    const rows = await sqlSystem((tx) => tx`select status from appointments where series_id = ${r.data.series_id} order by starts_at`);
    expect(rows.map((x: any) => x.status)).toEqual(['scheduled', 'cancelled', 'cancelled', 'cancelled']);
  });
});

describe('AGE-05 · estados', () => {
  it('marca manual: asistió, no asistió y deshacer', async () => {
    const c = await book(fx.therapistA, { date: todayIso(), time: '23:00', duration_min: 30 });
    expect(c.status).toBe(200);
    const att = await call(STATUS, { as: fx.therapistA, params: { id: c.data.id }, body: { status: 'attended' } });
    expect(att.status).toBe(200);
    expect(att.data.status).toBe('attended');
    expect(att.data.attended_at).toBeTruthy();
    const ns = await call(STATUS, { as: fx.owner, params: { id: c.data.id }, body: { status: 'no_show' } });
    expect(ns.data).toMatchObject({ status: 'no_show', attended_at: null });
    const undo = await call(STATUS, { as: fx.therapistA, params: { id: c.data.id }, body: { status: 'scheduled' } });
    expect(undo.data.status).toBe('scheduled');
    expect((await call(STATUS, { as: fx.owner, params: { id: c.data.id }, body: { status: 'cancelled' } })).status).toBe(400);
  });

  it('no se marca asistencia de una cita futura ni se cambia una cancelada', async () => {
    const c = await book(fx.owner);
    expect((await call(STATUS, { as: fx.owner, params: { id: c.data.id }, body: { status: 'attended' } })).status).toBe(400);
    await call(CANCEL, { as: fx.owner, params: { id: c.data.id }, body: { reason: 'Prueba' } });
    expect((await call(STATUS, { as: fx.owner, params: { id: c.data.id }, body: { status: 'scheduled' } })).status).toBe(409);
  });

  it('register_attendance marca "asistió" la cita cercana y no toca la que queda fuera de la tolerancia', async () => {
    const near = await book(fx.owner, { time: '10:00' });
    const far = await book(fx.owner, { time: '15:00' });
    const other = await book(fx.owner, { patient_id: fx.patientA2, time: '11:00' });
    const at = localToInstant(D1, '09:52');
    const ev = await sqlSystem((tx) => tx`select * from register_attendance(null, null, ${at}, 'simulator', 'prueba-agenda-1', '', ${fx.patientA1})`);
    expect(ev[0].appointment_id).toBe(near.data.id);
    const st = async (id: string) => (await call(ONE, { as: fx.owner, params: { id } })).data;
    expect(await st(near.data.id)).toMatchObject({ status: 'attended' });
    expect(new Date((await st(near.data.id)).attended_at).toISOString()).toBe(at.toISOString());
    expect((await st(far.data.id)).status).toBe('scheduled');          // a más de 90 min
    expect((await st(other.data.id)).status).toBe('scheduled');        // otro paciente

    // Una lectura lejos de cualquier cita no cambia nada.
    const ev2 = await sqlSystem((tx) => tx`select * from register_attendance(null, null, ${localToInstant(D1, '12:30')}, 'simulator', 'prueba-agenda-2', '', ${fx.patientA1})`);
    expect(ev2[0].appointment_id).toBeNull();
    expect((await st(far.data.id)).status).toBe('scheduled');
  });
});
