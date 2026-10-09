// AUTH-10 · Rol "Recepción": lo administrativo de todos los pacientes sí; lo clínico, la configuración y lo
// exclusivo del dueño responden 403. Se prueba la API completa, con sesión real de recepción.
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as apptGET, PATCH as apptPATCH } from '@/app/api/appointments/[id]/route';
import { POST as apptCancelPOST } from '@/app/api/appointments/[id]/cancel/route';
import { POST as apptStatusPOST } from '@/app/api/appointments/[id]/status/route';
import { GET as apptsGET, POST as apptsPOST } from '@/app/api/appointments/route';
import { GET as arcoGET } from '@/app/api/arco/route';
import { GET as attReportGET } from '@/app/api/attendance/report/route';
import { GET as attGET, POST as attPOST } from '@/app/api/attendance/route';
import { GET as attStatusGET } from '@/app/api/attendance/status/route';
import { GET as auditGET } from '@/app/api/audit/route';
import { GET as membershipGET, PATCH as membershipPATCH } from '@/app/api/billing/memberships/[patientId]/route';
import { POST as linkActionPOST } from '@/app/api/billing/payment-links/[id]/route';
import { GET as linksGET, POST as linksPOST } from '@/app/api/billing/payment-links/route';
import { GET as receiptGET } from '@/app/api/billing/payments/[id]/receipt/route';
import { POST as voidPOST } from '@/app/api/billing/payments/[id]/void/route';
import { GET as paymentsGET, POST as paymentsPOST } from '@/app/api/billing/payments/route';
import { GET as reportGET } from '@/app/api/billing/report/route';
import { GET as boardGET } from '@/app/api/billing/route';
import { GET as billingSettingsGET, PATCH as billingSettingsPATCH } from '@/app/api/billing/settings/route';
import { GET as taxGET } from '@/app/api/billing/tax-profiles/[patientId]/route';
import { POST as catalogPOST } from '@/app/api/catalogs/[kind]/route';
import { GET as clinicGET, PATCH as clinicPATCH } from '@/app/api/clinic/route';
import { GET as dashboardGET } from '@/app/api/dashboard/route';
import { GET as devicesGET } from '@/app/api/devices/route';
import { GET as documentGET } from '@/app/api/documents/[id]/route';
import { GET as documentPdfGET } from '@/app/api/documents/[id]/pdf/route';
import { GET as documentsGET, POST as documentsPOST } from '@/app/api/documents/route';
import { GET as enrollGET } from '@/app/api/enrollments/route';
import { GET as backupGET } from '@/app/api/export/backup/route';
import { GET as exportPatientGET } from '@/app/api/export/patient/[id]/route';
import { GET as invoicesGET } from '@/app/api/invoices/route';
import { POST as locationsPOST } from '@/app/api/locations/route';
import { GET as metaGET } from '@/app/api/meta/route';
import { GET as accessLogGET } from '@/app/api/patients/[id]/access-log/route';
import { POST as assignPOST } from '@/app/api/patients/[id]/assign/route';
import { GET as consentPdfGET } from '@/app/api/patients/[id]/consents/[consentId]/pdf/route';
import { GET as consentsGET, POST as consentsPOST } from '@/app/api/patients/[id]/consents/route';
import { GET as exercisesGET, POST as exercisesPOST } from '@/app/api/patients/[id]/exercises/route';
import { GET as notesGET, POST as notesPOST } from '@/app/api/patients/[id]/notes/route';
import { GET as profileGET, POST as profilePOST } from '@/app/api/patients/[id]/profile/route';
import { GET as patientGET, PATCH as patientPATCH } from '@/app/api/patients/[id]/route';
import { POST as statusPOST } from '@/app/api/patients/[id]/status/route';
import { GET as summaryGET } from '@/app/api/patients/[id]/summary/route';
import { POST as importPOST } from '@/app/api/patients/import/route';
import { GET as optionsGET } from '@/app/api/patients/options/route';
import { POST as reassignPOST } from '@/app/api/patients/reassign/route';
import { GET as patientsGET, POST as patientsPOST } from '@/app/api/patients/route';
import { GET as plansGET } from '@/app/api/plans/route';
import { GET as ownProfileGET } from '@/app/api/profile/route';
import { DELETE as blockDELETE } from '@/app/api/schedule/blocks/[id]/route';
import { GET as blocksGET, POST as blocksPOST } from '@/app/api/schedule/blocks/route';
import { GET as hoursGET, PUT as hoursPUT } from '@/app/api/schedule/hours/route';
import { GET as studyGET } from '@/app/api/studies/[id]/route';
import { GET as studiesGET, POST as studiesPOST } from '@/app/api/studies/route';
import { POST as deactivatePOST } from '@/app/api/users/[id]/deactivate/route';
import { GET as userGET, PATCH as userPATCH } from '@/app/api/users/[id]/route';
import { GET as usersGET, POST as usersPOST } from '@/app/api/users/route';
import { GET as workloadGET } from '@/app/api/users/workload/route';
import { todayIso } from '@/lib/dates';
import { FakeProviders } from '../fakes/providers';
import { call, fixtures, sqlAs, sqlSystem, type Fixtures, type TestUser } from '../helpers';

const fake = new FakeProviders();
let fx: Fixtures;
let rec: TestUser;
let signature: string;
let noteId: string;
let studyId: string;
let documentId: string;
let blockId: string;

const P = (id: string, extra: Record<string, string> = {}) => ({ id, ...extra });
const patientRow = async (id: string) =>
  (await sqlSystem((tx) => tx<{ therapist_id: string; location_id: string; reason: string; tags: string[]; status: string; phone: string; created_by: string }[]>`
    select therapist_id, location_id, reason, tags, status, phone, created_by from patients where id = ${id}`))[0];

beforeAll(async () => {
  await fake.start();
  Object.assign(process.env, { STRIPE_SECRET_KEY: 'sk_test_nce', STRIPE_WEBHOOK_SECRET: 'whsec_pruebas_nce', STRIPE_API_BASE: fake.base });
  fx = await fixtures();
  rec = fx.reception;
  await sqlSystem((tx) => tx`update membership_plans set active = true`);
  const stroke = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="160"><path d="M20 120 C 80 10, 120 150, 200 60 S 320 20, 440 110" fill="none" stroke="#14161a" stroke-width="3"/></svg>`);
  signature = 'data:image/png;base64,' + (await sharp(stroke).png().toBuffer()).toString('base64');

  // Información clínica que ya existe en el expediente de Ana (la escribe su fisioterapeuta).
  await sqlAs(fx.therapistA, async (tx) => {
    await tx`insert into clinical_profiles (patient_id, diagnosis, created_by, created_by_name) values (${fx.patientA1}, 'Lumbalgia mecánica', ${fx.therapistA.id}, 'Karla')`;
    await tx`insert into exercises (patient_id, name, created_by) values (${fx.patientA1}, 'Bird dog', ${fx.therapistA.id})`;
    const [n] = await tx<{ id: string }[]>`
      insert into evolution_notes (patient_id, body, author_id, author_name, signature_hash)
      values (${fx.patientA1}, 'Dolor 6/10 en flexión lumbar', ${fx.therapistA.id}, '', '') returning id`;
    noteId = n.id;
    const [d] = await tx<{ id: string }[]>`insert into documents (kind, patient_id) values ('indications', ${fx.patientA1}) returning id`;
    documentId = d.id;
    await tx`insert into document_items (document_id, kind, name) values (${d.id}, 'exercise', 'Puente de glúteo')`;
  });
  await sqlSystem(async (tx) => {
    const [s] = await tx<{ id: string }[]>`
      insert into studies (patient_id, type_name, title, file_name, storage_path, mime, size_bytes, status)
      values (${fx.patientA1}, 'Resonancia', 'RM lumbar', 'rm.pdf', ${'patients/' + fx.patientA1 + '/x/rm.pdf'}, 'application/pdf', 10, 'ready') returning id`;
    studyId = s.id;
    const [b] = await tx<{ id: string }[]>`
      insert into time_blocks (user_id, starts_at, ends_at, reason) values (${fx.therapistB.id}, now() + interval '20 days', now() + interval '21 days', 'Congreso') returning id`;
    blockId = b.id;
  });
});
afterAll(() => fake.stop());

describe('AUTH-10 · recepción: pacientes', () => {
  it('lista y busca a todos los pacientes de todas las sedes, sin motivo de consulta ni etiquetas', async () => {
    const all = await call(patientsGET, { as: rec, url: '/api/patients' });
    expect(all.status).toBe(200);
    expect(all.data.total).toBe(3);
    expect(all.data.items.map((p: { reason: string; tags: string[] }) => [p.reason, p.tags])).toEqual([['', []], ['', []], ['', []]]);
    expect(all.data.items.map((p: { therapist_id: string }) => p.therapist_id)).toEqual(expect.arrayContaining([fx.therapistA.id, fx.therapistB.id]));

    const byName = await call(patientsGET, { as: rec, url: '/api/patients?q=carmen' });
    expect(byName.data.items.map((p: { full_name: string }) => p.full_name)).toEqual(['Carmen Prueba Tres']);
    // El motivo y el diagnóstico son clínicos: su búsqueda no los alcanza (el dueño sí).
    for (const q of ['motivo', 'lumbalgia']) {
      expect((await call(patientsGET, { as: rec, url: `/api/patients?q=${q}` })).data.total).toBe(0);
      expect((await call(patientsGET, { as: fx.owner, url: `/api/patients?q=${q}` })).data.total).toBeGreaterThan(0);
    }
    const byTherapist = await call(patientsGET, { as: rec, url: `/api/patients?therapist_id=${fx.therapistB.id}` });
    expect(byTherapist.data.items).toHaveLength(1);
    expect((await call(optionsGET, { as: rec })).data).toHaveLength(3);
  });

  it('da de alta eligiendo sede y fisioterapeuta; lo que mande como motivo o etiquetas se ignora', async () => {
    const body = {
      full_name: 'Daniela Mostrador', birth_date: '12/04/1988', sex: 'F', phone: '271 555 0101', location_id: fx.orizaba,
      therapist_id: fx.therapistB.id, plan_id: fx.plans['Mensual Básica'], reason: 'Dolor de rodilla', tags: ['Deportista'],
    };
    const r = await call(patientsPOST, { as: rec, body });
    expect(r.status).toBe(200);
    expect(await patientRow(r.data.id)).toMatchObject({
      therapist_id: fx.therapistB.id, location_id: fx.orizaba, reason: '', tags: [], status: 'active', created_by: rec.id,
    });
    const [m] = await sqlSystem((tx) => tx`select created_by from memberships where patient_id = ${r.data.id}`);
    expect(m.created_by).toBe(rec.id);

    const missing = await call(patientsPOST, { as: rec, body: { ...body, full_name: 'Sin Fisio', therapist_id: null } });
    expect(missing.status).toBe(400);
    expect(missing.error!.fields).toHaveProperty('therapist_id');
    // No puede asignar pacientes a otra cuenta de recepción ni al dueño.
    const wrong = await call(patientsPOST, { as: rec, body: { ...body, full_name: 'Mal Asignado', therapist_id: rec.id } });
    expect(wrong.status).toBe(400);
  });

  it('ve la ficha general y edita datos de contacto, pero no lo clínico, ni la baja, ni la reasignación', async () => {
    const g = await call(patientGET, { as: rec, params: P(fx.patientB1) });
    expect(g.status).toBe(200);
    expect(g.data).toMatchObject({ full_name: 'Carmen Prueba Tres', reason: '', tags: [], billing_state: 'vencido' });

    const e = await call(patientPATCH, {
      as: rec, method: 'PATCH', params: P(fx.patientB1),
      body: { phone: '272 111 2233', address: 'Sur 5 No. 10', emergency_name: 'Hugo', location_id: fx.cordoba, reason: 'Editado por recepción', tags: ['Deportista'] },
    });
    expect(e.status).toBe(200);
    expect(e.data).toMatchObject({ phone: '272 111 2233', address: 'Sur 5 No. 10', location_id: fx.cordoba, reason: '', tags: [] });
    expect(await patientRow(fx.patientB1)).toMatchObject({ phone: '272 111 2233', reason: 'Motivo de prueba', tags: [], therapist_id: fx.therapistB.id });

    expect((await call(statusPOST, { as: rec, params: P(fx.patientB1), body: { status: 'inactive', reason: 'Se mudó' } })).status).toBe(403);
    expect((await call(assignPOST, { as: rec, params: P(fx.patientB1), body: { therapist_id: fx.therapistA.id } })).status).toBe(403);
    expect((await call(reassignPOST, { as: rec, body: { patient_ids: [fx.patientB1], to_therapist_id: fx.therapistA.id } })).status).toBe(403);
    expect(await patientRow(fx.patientB1)).toMatchObject({ status: 'active', therapist_id: fx.therapistB.id });
  });

  it('importa CSV como el dueño, sin las columnas clínicas', async () => {
    const csv = 'nombre,fecha_nacimiento,sexo,sede,fisioterapeuta,motivo,etiquetas\nElena Importada,03/02/1979,F,Córdoba,karla,Hombro doloroso,Deportista\n';
    const preview = await call(importPOST, { as: rec, body: { csv } });
    expect(preview.status).toBe(200);
    expect(preview.data).toMatchObject({ valid: 1, invalid: 0 });
    expect(preview.data.rows[0].data).toMatchObject({ full_name: 'Elena Importada', reason: '', tags: [] });
    const done = await call(importPOST, { as: rec, body: { csv, commit: true } });
    expect(done.data.inserted).toBe(1);
    const [p] = await sqlSystem((tx) => tx`select reason, tags, therapist_id from patients where full_name = 'Elena Importada'`);
    expect(p).toEqual({ reason: '', tags: [], therapist_id: fx.therapistA.id });
    expect((await call(importPOST, { as: fx.therapistA, body: { csv } })).status).toBe(403);
  });

  it('firma el aviso de privacidad y los consentimientos del alta, y descarga su PDF', async () => {
    const tpl = await call(consentsGET, { as: rec, params: P(fx.patientB1), url: '/x?template=privacy' });
    expect(tpl.status).toBe(200);
    const s = await call(consentsPOST, {
      as: rec, params: P(fx.patientB1), body: { kind: 'privacy', signer_name: 'Carmen Prueba Tres', signer_relationship: 'Paciente', signature_png: signature },
    });
    expect(s.status).toBe(200);
    expect(s.data).toMatchObject({ kind: 'privacy', recorded_by: rec.id, recorded_by_name: 'Rocío Morales' });
    const list = await call(consentsGET, { as: rec, params: P(fx.patientB1) });
    expect(list.data).toHaveLength(1);
    const pdf = await call(consentPdfGET, { as: rec, params: P(fx.patientB1, { consentId: s.data.id }) });
    expect(pdf.status).toBe(200);
    expect(pdf.res.headers.get('content-type')).toContain('application/pdf');
    // Estado de la huella del paciente (para registrarla en el lector).
    const info = await call(enrollGET, { as: rec, url: `/x?person_type=patient&person_id=${fx.patientB1}` });
    expect(info.status).toBe(200);
    expect(info.data).toMatchObject({ person_type: 'patient', has_consent: false });
    // La huella de otra persona del equipo solo la administra el dueño.
    expect((await call(enrollGET, { as: rec, url: `/x?person_type=staff&person_id=${fx.therapistA.id}` })).status).toBe(403);
  });
});

describe('AUTH-10 · recepción: agenda', () => {
  it('agenda, reprograma, marca asistencia y cancela citas de cualquier fisioterapeuta', async () => {
    const today = todayIso();
    const a = await call(apptsPOST, { as: rec, body: { patient_id: fx.patientB1, date: today, time: '23:00', duration_min: 30, type_name: 'Fisioterapia' } });
    expect(a.status).toBe(200);
    expect(a.data).toMatchObject({ therapist_id: fx.therapistB.id, patient_id: fx.patientB1, status: 'scheduled' });
    // Con otro fisioterapeuta distinto al asignado.
    const b = await call(apptsPOST, {
      as: rec, body: { patient_id: fx.patientA1, therapist_id: fx.physician.id, date: today, time: '22:00', duration_min: 30, type_name: 'Valoración inicial' },
    });
    expect(b.data.therapist_id).toBe(fx.physician.id);
    const [row] = await sqlSystem((tx) => tx`select created_by from appointments where id = ${b.data.id}`);
    expect(row.created_by).toBe(rec.id);

    const list = await call(apptsGET, { as: rec, url: `/x?from=${today}&to=${today}` });
    expect(list.data.map((x: { id: string }) => x.id)).toEqual(expect.arrayContaining([a.data.id, b.data.id]));
    expect((await call(apptGET, { as: rec, params: P(a.data.id) })).status).toBe(200);

    const moved = await call(apptPATCH, { as: rec, method: 'PATCH', params: P(a.data.id), body: { time: '23:20', therapist_id: fx.therapistA.id } });
    expect(moved.status).toBe(200);
    expect(moved.data).toMatchObject({ time: '23:20', therapist_id: fx.therapistA.id });
    expect((await call(apptPATCH, { as: rec, method: 'PATCH', params: P(a.data.id), body: { therapist_id: rec.id } })).status).toBe(400);

    const attended = await call(apptStatusPOST, { as: rec, params: P(a.data.id), body: { status: 'attended' } });
    expect(attended.data.status).toBe('attended');
    const noShow = await call(apptStatusPOST, { as: rec, params: P(a.data.id), body: { status: 'no_show' } });
    expect(noShow.data.status).toBe('no_show');
    const cancelled = await call(apptCancelPOST, { as: rec, params: P(b.data.id), body: { reason: 'El paciente avisó que no viene' } });
    expect(cancelled.data.appointment.status).toBe('cancelled');
  });

  it('consulta horarios y bloqueos de todos, pero no los modifica', async () => {
    expect((await call(hoursGET, { as: rec, url: `/x?user_id=${fx.therapistB.id}` })).status).toBe(200);
    const blocks = await call(blocksGET, { as: rec, url: `/x?user_id=${fx.therapistB.id}` });
    expect(blocks.status).toBe(200);
    expect(blocks.data.map((b: { id: string }) => b.id)).toEqual([blockId]);
    expect((await call(blocksGET, { as: rec })).data).toHaveLength(1);

    expect((await call(hoursPUT, { as: rec, method: 'PUT', body: { user_id: fx.therapistB.id, hours: [] } })).status).toBe(403);
    expect((await call(hoursPUT, { as: rec, method: 'PUT', body: { user_id: rec.id, hours: [] } })).status).toBe(403);
    expect((await call(blocksPOST, { as: rec, body: { user_id: fx.therapistB.id, from_date: '2031-01-01', to_date: '2031-01-02' } })).status).toBe(403);
    expect((await call(blockDELETE, { as: rec, method: 'DELETE', params: P(blockId) })).status).toBe(403);
    expect((await sqlSystem((tx) => tx`select 1 from time_blocks where id = ${blockId}`))).toHaveLength(1);
  });
});

describe('AUTH-10 · recepción: mensualidades', () => {
  let paymentId: string;

  it('ve el tablero, registra un pago, consulta el historial y descarga el recibo', async () => {
    const board = await call(boardGET, { as: rec, url: '/api/billing' });
    expect(board.status).toBe(200);
    expect(board.data.rows.length).toBeGreaterThanOrEqual(3);

    const pay = await call(paymentsPOST, { as: rec, body: { patient_id: fx.patientB1, method: 'cash' } });
    expect(pay.status).toBe(200);
    expect(pay.data.state).toBe('pagado');
    expect(pay.data.payment).toMatchObject({ amount_cents: 120000, recorded_by: rec.id, recorded_by_name: 'Rocío Morales' });
    paymentId = pay.data.payment.id;

    const m = await call(membershipGET, { as: rec, params: { patientId: fx.patientB1 } });
    expect(m.status).toBe(200);
    expect(m.data.payments).toHaveLength(1);
    expect((await call(paymentsGET, { as: rec, url: `/x?patient_id=${fx.patientB1}` })).data.total).toBe(1);
    const receipt = await call(receiptGET, { as: rec, params: P(paymentId) });
    expect(receipt.status).toBe(200);
    expect(receipt.res.headers.get('content-type')).toContain('application/pdf');
  });

  it('asigna o cambia el plan, pausa y reanuda', async () => {
    const patch = (body: unknown) => call(membershipPATCH, { as: rec, method: 'PATCH', params: { patientId: fx.patientA1 }, body });
    const changed = await patch({ action: 'change_plan', plan_id: fx.plans['Mensual Básica'] });
    expect(changed.status).toBe(200);
    expect(changed.data.membership.plan_name).toBe('Mensual Básica');
    expect((await patch({ action: 'pause' })).data.state).toBe('pausado');
    expect((await patch({ action: 'resume' })).data.membership.membership_status).toBe('active');
  });

  it('genera y cancela links de cobro en línea; aplicar o reembolsar un pago en revisión es del dueño', async () => {
    const cfg = await call(billingSettingsGET, { as: rec });
    expect(cfg.status).toBe(200);
    expect(cfg.data.integrations).toEqual({ stripe: { configured: true, live: false } });
    expect(Object.keys(cfg.data.settings).sort()).toEqual(['online_payments_enabled', 'oxxo_days', 'oxxo_enabled', 'payment_link_hours']);

    const link = await call(linksPOST, { as: rec, body: { patient_id: fx.patientA2, methods: ['card'] } });
    expect(link.status).toBe(200);
    expect(link.data.link).toMatchObject({ status: 'open', created_by: rec.id, created_by_name: 'Rocío Morales' });
    expect((await call(linksGET, { as: rec, url: '/x?status=active' })).data.total).toBe(1);

    for (const action of ['apply', 'refund']) {
      const r = await call(linkActionPOST, { as: rec, params: P(link.data.link.id), body: { action } });
      expect(r.status).toBe(403);
    }
    const cancel = await call(linkActionPOST, { as: rec, params: P(link.data.link.id), body: { action: 'cancel' } });
    expect(cancel.status).toBe(200);
    expect(cancel.data.link.status).toBe('cancelled');
  });

  it('no anula pagos, no ve ingresos ni facturación, y no ve el historial global de pagos', async () => {
    for (const r of [
      await call(voidPOST, { as: rec, params: P(paymentId), body: { reason: 'Captura duplicada' } }),
      await call(reportGET, { as: rec, url: '/api/billing/report' }),
      await call(reportGET, { as: rec, url: '/api/billing/report?format=csv' }),
      await call(paymentsGET, { as: rec, url: '/api/billing/payments' }),
      await call(invoicesGET, { as: rec, url: '/api/invoices' }),
      await call(taxGET, { as: rec, params: { patientId: fx.patientB1 } }),
      await call(billingSettingsPATCH, { as: rec, method: 'PATCH', body: { oxxo_enabled: false } }),
      await call(plansGET, { as: rec }),
    ]) expect(r.status).toBe(403);
    const [p] = await sqlSystem((tx) => tx`select voided_at from payments where id = ${paymentId}`);
    expect(p.voided_at).toBeNull();
  });
});

describe('AUTH-10 · recepción: huella e inicio', () => {
  it('registra a mano la asistencia de cualquier paciente; la del personal y sus reportes son del dueño', async () => {
    const r = await call(attPOST, { as: rec, body: { person_type: 'patient', person_id: fx.patientA2, reason: 'El lector no reconoció la huella', location_id: fx.orizaba } });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ person_type: 'patient', source: 'manual', location_id: fx.orizaba, recorded_by_name: 'Rocío Morales' });

    const list = await call(attGET, { as: rec, url: '/api/attendance' });
    expect(list.status).toBe(200);
    expect(list.data.items.map((e: { id: string }) => e.id)).toContain(r.data.id);
    expect((await call(attStatusGET, { as: rec })).status).toBe(200);

    expect((await call(attPOST, { as: rec, body: { person_type: 'staff', person_id: fx.therapistA.id, reason: 'Olvidó registrar' } })).status).toBe(403);
    expect((await call(attGET, { as: rec, url: `/x?user_id=${fx.therapistA.id}` })).status).toBe(403);
    expect((await call(attReportGET, { as: rec, url: '/api/attendance/report' })).status).toBe(403);
    expect((await call(devicesGET, { as: rec })).status).toBe(403);
  });

  it('su tablero trae las citas de hoy de todos, los pagos por atender y las asistencias de hoy', async () => {
    const d = await call(dashboardGET, { as: rec, url: '/api/dashboard' });
    expect(d.status).toBe(200);
    expect(d.data.stats.patients_active).toBeGreaterThanOrEqual(3);
    expect(d.data.stats.appointments_today).toBeGreaterThanOrEqual(1);
    expect(d.data.stats.attendance_today).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(d.data.due_payments)).toBe(true);
    expect(d.data.today_appointments.length).toBeGreaterThanOrEqual(1);
    const byLoc = await call(dashboardGET, { as: rec, url: `/api/dashboard?location_id=${fx.orizaba}` });
    expect(byLoc.data.location_name).toBe('Orizaba');
    // Catálogos y su propio perfil.
    const meta = await call(metaGET, { as: rec });
    expect(meta.data.reception.map((u: { id: string }) => u.id)).toEqual([rec.id]);
    expect(meta.data.therapists.map((u: { id: string }) => u.id)).not.toContain(rec.id);
    expect((await call(ownProfileGET, { as: rec })).data).toMatchObject({ role: 'reception', username: 'rocio' });
    expect((await call(clinicGET, { as: rec })).data).not.toHaveProperty('settings');
  });
});

describe('AUTH-10 · recepción: nada clínico, ni por API (403) ni por RLS (sin filas)', () => {
  it('perfil clínico, notas, ejercicios, estudios, recetas, resumen PDF y exportación responden 403', async () => {
    const id = fx.patientA1;
    const calls = [
      call(profileGET, { as: rec, params: P(id) }),
      call(profilePOST, { as: rec, params: P(id), body: { diagnosis: 'Escrito por recepción' } }),
      call(notesGET, { as: rec, params: P(id) }),
      call(notesPOST, { as: rec, params: P(id), body: { body: 'Nota de recepción' } }),
      call(exercisesGET, { as: rec, params: P(id) }),
      call(exercisesPOST, { as: rec, params: P(id), body: { name: 'Sentadilla' } }),
      call(summaryGET, { as: rec, params: P(id) }),
      call(studiesGET, { as: rec, url: '/api/studies' }),
      call(studiesPOST, { as: rec, body: { patient_id: id, type_name: 'Radiografía', title: 'Rx', file_name: 'rx.jpg', mime: 'image/jpeg', size_bytes: 10 } }),
      call(studyGET, { as: rec, params: P(studyId) }),
      call(documentsGET, { as: rec, url: '/api/documents' }),
      call(documentsPOST, { as: rec, body: { kind: 'indications', patient_id: id, items: [{ kind: 'exercise', name: 'Puente' }] } }),
      call(documentGET, { as: rec, params: P(documentId) }),
      call(documentPdfGET, { as: rec, params: P(documentId) }),
      call(accessLogGET, { as: rec, params: P(id) }),
      call(exportPatientGET, { as: rec, params: P(id) }),
    ];
    for (const r of await Promise.all(calls)) {
      expect(r.status).toBe(403);
      expect(r.error!.code).toBe('forbidden');
    }
    // Nada cambió ni quedó registrado como acceso al expediente.
    const [n] = await sqlSystem((tx) => tx<{ notes: number; profiles: number; views: number }[]>`
      select (select count(*)::int from evolution_notes where patient_id = ${id}) as notes,
             (select count(*)::int from clinical_profiles where patient_id = ${id}) as profiles,
             (select count(*)::int from audit_log where actor_id = ${rec.id} and action = 'view') as views`);
    expect(n).toEqual({ notes: 1, profiles: 1, views: 0 });
    expect(noteId).toBeTruthy();
  });

  it('la cita no revela si tiene nota de evolución', async () => {
    const today = todayIso();
    const a = await sqlSystem(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into appointments (patient_id, therapist_id, location_id, starts_at, duration_min, ends_at, type_name)
        values (${fx.patientA1}, ${fx.therapistA.id}, ${fx.cordoba}, now() - interval '3 days', 30, now(), 'Fisioterapia') returning id`;
      await tx`select set_config('app.user_id', ${fx.therapistA.id}, true)`;
      await tx`insert into evolution_notes (patient_id, appointment_id, body, author_id, author_name, signature_hash)
               values (${fx.patientA1}, ${row.id}, 'Nota ligada a la cita', ${fx.therapistA.id}, '', '')`;
      return row.id;
    });
    expect((await call(apptGET, { as: fx.owner, params: P(a) })).data.has_note).toBe(true);
    expect((await call(apptGET, { as: rec, params: P(a) })).data.has_note).toBe(false);
    expect(today).toBeTruthy();
  });

  it('Equipo, Configuración, auditoría, ARCO y respaldos responden 403', async () => {
    for (const r of [
      await call(usersGET, { as: rec, url: '/api/users' }),
      await call(usersPOST, { as: rec, body: { full_name: 'Otra Persona', username: 'otra.persona', email: 'otra@prueba.mx', location_id: fx.cordoba } }),
      await call(userGET, { as: rec, params: P(fx.therapistA.id) }),
      await call(userPATCH, { as: rec, method: 'PATCH', params: P(rec.id), body: { full_name: 'Dueña Nueva' } }),
      await call(workloadGET, { as: rec, url: '/api/users/workload' }),
      await call(deactivatePOST, { as: rec, params: P(fx.therapistA.id), body: {} }),
      await call(clinicPATCH, { as: rec, method: 'PATCH', body: { name: 'Otra clínica' } }),
      await call(catalogPOST, { as: rec, params: { kind: 'tags' }, body: { name: 'Etiqueta nueva' } }),
      await call(locationsPOST, { as: rec, body: { code: 'XAL', name: 'Xalapa' } }),
      await call(auditGET, { as: rec, url: '/api/audit' }),
      await call(arcoGET, { as: rec, url: '/api/arco' }),
      await call(backupGET, { as: rec }),
    ]) expect(r.status).toBe(403);
  });
});

describe('AUTH-10 · el dueño administra las cuentas de recepción desde Equipo', () => {
  it('invita a recepción sin cédula ni facultades, la edita y la desactiva sin reasignar pacientes', async () => {
    const created = await call(usersPOST, {
      as: fx.owner,
      body: { role: 'reception', full_name: 'Paola Mostrador', username: 'p.mostrador', email: 'paola@prueba.mx', location_id: fx.orizaba,
        specialty: 'Deportiva', license_number: '1234567', is_physician: true },
    });
    expect(created.status).toBe(200);
    expect(created.data.user).toMatchObject({ role: 'reception', specialty: '', license_number: null, is_physician: false, has_password: false });
    expect(created.data.invite_link).toMatch(/^http/);
    const id = created.data.user.id as string;

    const edited = await call(userPATCH, { as: fx.owner, method: 'PATCH', params: P(id), body: { phone: '2711234567', license_number: '7654321', is_physician: true } });
    expect(edited.status).toBe(200);
    expect(edited.data).toMatchObject({ phone: '2711234567', license_number: null, is_physician: false, role: 'reception' });

    const off = await call(deactivatePOST, { as: fx.owner, params: P(id), body: {} });
    expect(off.status).toBe(200);
    expect(off.data).toMatchObject({ patients_moved: 0, appointments_moved: 0 });
    expect(off.data.user.active).toBe(false);
  });

  it('al desactivar a recepción su sesión deja de servir', async () => {
    expect((await call(dashboardGET, { as: rec, url: '/api/dashboard' })).status).toBe(200);
    const off = await call(deactivatePOST, { as: fx.owner, params: P(rec.id), body: {} });
    expect(off.status).toBe(200);
    expect(off.data.sessions_revoked).toBeGreaterThanOrEqual(1);
    expect((await call(dashboardGET, { as: rec, url: '/api/dashboard' })).status).toBe(401);
  });
});
