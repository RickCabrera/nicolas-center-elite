import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { asSystem, asUser, type Identity, type Tx } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { createSession, SESSION_COOKIE } from '@/lib/auth/session';

/**
 * Utilidades para pruebas de base de datos (tests/db) y de API (tests/api).
 *
 *   beforeAll(async () => { fx = await fixtures(); });
 *   const r = await call(GET, { as: fx.therapistA, url: '/api/patients' });
 *   expect(r.status).toBe(200); expect(r.data).toHaveLength(2);
 */
const DATA_TABLES = [
  'audit_log', 'attendance_events', 'enrollments', 'device_commands', 'devices',
  'invoice_payments', 'invoices', 'payment_links', 'provider_events', 'patient_tax_profiles', 'payments', 'memberships',
  'document_items', 'documents', 'folio_counters', 'time_blocks', 'therapist_hours', 'appointments', 'studies', 'consents',
  'evolution_notes', 'exercises', 'clinical_profiles', 'patient_assignments', 'patients', 'email_outbox',
  'webauthn_challenges', 'passkeys', 'auth_tokens', 'sessions', 'users', 'arco_requests',
  // Los datos base también se restauran: otra prueba pudo renombrar catálogos o cambiar parámetros.
  'clinic', 'locations', 'membership_plans', 'session_types', 'study_types', 'patient_tags', 'controlled_substances',
];
const BASE_DATA = readFileSync(join(process.cwd(), 'db/migrations/0006_base_data.sql'), 'utf8');

/** Borra todos los datos y vuelve a cargar los datos base (clínica, sedes, planes y catálogos). */
export async function resetData() {
  await asSystem(async (tx) => {
    await tx.unsafe(`truncate ${DATA_TABLES.join(', ')} restart identity cascade`);
    await tx.unsafe(BASE_DATA);
    await tx.unsafe(`truncate audit_log restart identity`);
  });
}

export type TestUser = Identity & { username: string; token: string; location_id: string | null };
export type Fixtures = {
  owner: TestUser;
  therapistA: TestUser; // Córdoba · fisioterapeuta con cédula
  therapistB: TestUser; // Orizaba · fisioterapeuta con cédula
  physician: TestUser;  // Córdoba · marcada como médico con cédula
  cordoba: string;
  orizaba: string;
  plans: Record<string, string>; // nombre → id
  patientA1: string; // de A, adulta, plan mensual al corriente
  patientA2: string; // de A, menor de edad, paquete de 10 sesiones
  patientB1: string; // de B, adulto mayor, mensualidad vencida
};

export const TEST_PASSWORD = 'Prueba2026segura';

async function makeUser(tx: Tx, u: { username: string; role: 'owner' | 'therapist'; full_name: string; title?: string; location_id?: string | null; license?: string | null; physician?: boolean; specialty?: string }, hash: string): Promise<TestUser> {
  const [row] = await tx<{ id: string }[]>`
    insert into users (username, email, password_hash, role, full_name, title, specialty, location_id, license_number, license_institution, is_physician)
    values (${u.username}, ${u.username + '@prueba.mx'}, ${hash}, ${u.role}, ${u.full_name}, ${u.title ?? ''}, ${u.specialty ?? ''},
            ${u.location_id ?? null}, ${u.license ?? null}, ${u.license ? 'Universidad Veracruzana' : null}, ${u.physician ?? false})
    returning id`;
  const { token } = await createSession(tx, row.id, { method: 'password' });
  return { id: row.id, role: u.role, username: u.username, token, location_id: u.location_id ?? null };
}

/** Deja la base con un dueño, tres profesionales y tres pacientes repartidos. Llama antes resetData(). */
export async function fixtures(): Promise<Fixtures> {
  await resetData();
  const hash = await hashPassword(TEST_PASSWORD);
  return asSystem(async (tx) => {
    const locs = await tx<{ id: string; code: string }[]>`select id, code from locations`;
    const cordoba = locs.find((l) => l.code === 'COR')!.id;
    const orizaba = locs.find((l) => l.code === 'ORI')!.id;
    const planRows = await tx<{ id: string; name: string }[]>`select id, name from membership_plans`;
    const plans = Object.fromEntries(planRows.map((p) => [p.name, p.id]));

    const owner = await makeUser(tx, { username: 'dueno', role: 'owner', full_name: 'Nicolas Herrera' }, hash);
    const therapistA = await makeUser(tx, { username: 'karla', role: 'therapist', full_name: 'Karla Ocampo', title: 'L.F.T.', location_id: cordoba, license: '11223344', specialty: 'Pediatría' }, hash);
    const therapistB = await makeUser(tx, { username: 'diego', role: 'therapist', full_name: 'Diego Salinas', title: 'L.F.T.', location_id: orizaba, license: '55667788', specialty: 'Columna' }, hash);
    const physician = await makeUser(tx, { username: 'mariana', role: 'therapist', full_name: 'Mariana Reyes', title: 'Dra.', location_id: cordoba, license: '99887766', physician: true, specialty: 'Medicina de rehabilitación' }, hash);

    await tx`select set_config('app.user_id', ${owner.id}, true), set_config('app.user_role', 'owner', true)`;
    const patient = async (p: { name: string; birth: string; ther: string; loc: string; guardian?: string; plan: string; due: number; sessions?: number | null }) => {
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

type Handler = (req: NextRequest, segment: { params: Promise<Record<string, string | string[]>> }) => Promise<Response>;
export type CallResult<T = any> = { status: number; ok: boolean; data: T; error: { code: string; message: string; fields?: Record<string, string> } | null; res: Response };

/** Invoca el handler de una ruta como lo haría el navegador (cookie de sesión, origen, JSON). */
export async function call<T = any>(
  handler: Handler,
  opts: { as?: TestUser | null; url?: string; method?: string; body?: unknown; params?: Record<string, string>; headers?: Record<string, string> } = {},
): Promise<CallResult<T>> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = { host: 'localhost:3000', origin: 'http://localhost:3000', ...opts.headers };
  if (opts.as) headers.cookie = `${SESSION_COOKIE}=${opts.as.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const req = new NextRequest(`http://localhost:3000${opts.url ?? '/'}`, {
    method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  let json: any = null;
  if (res.headers.get('content-type')?.includes('application/json')) json = await res.clone().json();
  return { status: res.status, ok: res.status < 400, data: json?.data as T, error: json?.error ?? null, res };
}

/** Atajos para consultar directo bajo la identidad de un usuario (RLS) o como sistema. */
export const sqlAs = <T>(u: Identity, fn: (tx: Tx) => Promise<T>) => asUser({ id: u.id, role: u.role }, fn);
export const sqlSystem = <T>(fn: (tx: Tx) => Promise<T>) => asSystem(fn);
