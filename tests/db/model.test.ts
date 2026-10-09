import { beforeAll, describe, expect, it } from 'vitest';
import { fixtures, sqlAs, sqlSystem, type Fixtures } from '../helpers';

/**
 * Modelo de datos (DB-01 … DB-11) e infraestructura de base (INF-03, INF-04).
 * Verifica en la base real las reglas que el backlog pide "a nivel base", no en la app.
 */
let fx: Fixtures;
beforeAll(async () => { fx = await fixtures(); });

describe('INF-03 · migraciones versionadas', () => {
  it('cada migración aplicada queda registrada con su huella', async () => {
    const rows = await sqlSystem((tx) => tx<{ name: string; checksum: string }[]>`select name, checksum from schema_migrations order by name`);
    expect(rows.map((r) => r.name)).toContain('0001_base.sql');
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.checksum))).toBe(true);
  });
});

describe('DB-01 · clínica y sedes', () => {
  it('una sola fila de clínica y las dos sedes con clave', async () => {
    const [c] = await sqlSystem((tx) => tx`select count(*)::int as n from clinic`);
    expect(c.n).toBe(1);
    await expect(sqlSystem((tx) => tx`insert into clinic (id, name) values (false, 'Otra')`)).rejects.toThrow();
    const locs = await sqlSystem((tx) => tx<{ code: string }[]>`select code from locations order by code`);
    expect(locs.map((l) => l.code)).toEqual(['COR', 'ORI']);
  });
});

describe('DB-02 · perfiles de usuario', () => {
  it('un rol válido por usuario; usuario y correo únicos sin importar mayúsculas', async () => {
    await expect(sqlSystem((tx) => tx`insert into users (username, email, role, full_name) values ('x1', 'x1@a.mx', 'admin', 'X')`)).rejects.toThrow();
    await expect(sqlSystem((tx) => tx`insert into users (username, email, role, full_name) values ('KARLA', 'otro@a.mx', 'therapist', 'X')`)).rejects.toThrow(/users_username_key/);
  });
});

describe('DB-03 · pacientes', () => {
  it('número de expediente automático, CURP con formato y tutor obligatorio para menores', async () => {
    const [p] = await sqlSystem((tx) => tx<{ record_number: string }[]>`select record_number from patients where id = ${fx.patientA1}`);
    expect(p.record_number).toMatch(/^NCE-\d{6}$/);
    await expect(sqlSystem((tx) => tx`update patients set curp = 'abc' where id = ${fx.patientA1}`)).rejects.toThrow();
    await expect(sqlSystem((tx) => tx`update patients set guardian_name = '' where id = ${fx.patientA2}`)).rejects.toThrow(/tutor/);
  });
});

describe('DB-04 · notas de evolución inmutables', () => {
  it('no admiten UPDATE ni DELETE, ni siquiera del dueño de las tablas', async () => {
    const [n] = await sqlAs(fx.therapistA, (tx) => tx<{ id: string }[]>`
      insert into evolution_notes (patient_id, body, author_id, author_name, signature_hash)
      values (${fx.patientA1}, 'Nota de prueba', ${fx.therapistA.id}, '', '') returning id`);
    await expect(sqlSystem((tx) => tx`update evolution_notes set body = 'cambiada' where id = ${n.id}`)).rejects.toThrow(/inmutable/);
    await expect(sqlSystem((tx) => tx`delete from evolution_notes where id = ${n.id}`)).rejects.toThrow(/5 años/);
  });
});

describe('DB-05 · citas', () => {
  it('la base impide dos citas empalmadas del mismo fisioterapeuta', async () => {
    const ins = (start: string) => sqlSystem((tx) => tx`
      insert into appointments (patient_id, therapist_id, location_id, starts_at, duration_min, ends_at, type_name)
      values (${fx.patientA1}, ${fx.therapistA.id}, ${fx.cordoba}, ${start}::timestamptz, 50, now(), 'Fisioterapia')`);
    await ins('2030-01-07T16:00:00Z');
    await expect(ins('2030-01-07T16:30:00Z')).rejects.toThrow(/appointments_no_therapist_overlap/);
  });
});

describe('DB-06 · folio consecutivo por sede', () => {
  it('next_folio no repite ni salta bajo concurrencia', async () => {
    const got = await Promise.all(Array.from({ length: 12 }, () =>
      sqlSystem((tx) => tx<{ n: number }[]>`select next_folio(${fx.orizaba}, 'prueba') as n`)));
    expect(got.map((r) => r[0].n).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });
});

describe('DB-07 · estudios', () => {
  it('cada archivo tiene paciente, tipo, fecha y quién lo subió', async () => {
    const cols = await sqlSystem((tx) => tx<{ column_name: string; is_nullable: string }[]>`
      select column_name, is_nullable from information_schema.columns where table_name = 'studies'
      and column_name in ('patient_id', 'type_name', 'study_date', 'storage_path', 'uploaded_by')`);
    expect(cols.filter((c) => c.column_name !== 'uploaded_by').every((c) => c.is_nullable === 'NO')).toBe(true);
    expect(cols.map((c) => c.column_name)).toContain('uploaded_by');
  });
});

describe('DB-08 · pagos guardan copia del precio', () => {
  it('el pago conserva plan y monto aunque el plan cambie de precio y nombre', async () => {
    const [m] = await sqlSystem((tx) => tx<{ id: string }[]>`select id from memberships where patient_id = ${fx.patientA1}`);
    await sqlSystem((tx) => tx`
      insert into payments (patient_id, membership_id, plan_name, plan_kind, amount_cents, method, prev_due_date, new_due_date)
      values (${fx.patientA1}, ${m.id}, 'Mensual Elite', 'monthly', 240000, 'cash', current_date, current_date + 30)`);
    await sqlSystem((tx) => tx`update membership_plans set price_cents = 999900, name = 'Elite Plus' where name = 'Mensual Elite'`);
    const [p] = await sqlSystem((tx) => tx`select plan_name, amount_cents from payments where membership_id = ${m.id}`);
    expect(p).toEqual({ plan_name: 'Mensual Elite', amount_cents: 240000 });
    await expect(sqlSystem((tx) => tx`update payments set amount_cents = 1 where membership_id = ${m.id}`)).rejects.toThrow(/no puede modificarse/);
  });
});

describe('DB-09 · lectores y asistencia', () => {
  it('la asistencia se deduplica por llave', async () => {
    const reg = () => sqlSystem((tx) => tx<{ id: string }[]>`
      select (register_attendance(null, null, now(), 'manual', 'llave-unica-1', '', ${fx.patientA1}, null, null, 'prueba', null)).id`);
    const [a] = await reg();
    const [b] = await reg();
    expect(a.id).toBe(b.id);
  });
});

describe('DB-11 · índices para listas y panel', () => {
  it('existen los índices de búsqueda y de día local', async () => {
    const idx = await sqlSystem((tx) => tx<{ indexname: string }[]>`select indexname from pg_indexes where schemaname = 'public'`);
    const names = idx.map((i) => i.indexname);
    for (const n of ['patients_therapist_idx', 'patients_name_idx', 'appointments_day_idx', 'attendance_day_idx', 'audit_log_at_idx']) {
      expect(names).toContain(n);
    }
  });
});

describe('INF-04 · sesión y RLS por transacción', () => {
  it('sin identidad de usuario el rol de aplicación no ve pacientes', async () => {
    const rows = await sqlSystem(async (tx) => {
      await tx`set local role nce_app`;
      return tx`select id from patients`;
    });
    expect(rows).toEqual([]);
  });
});
