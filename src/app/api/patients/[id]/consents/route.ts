import { z } from 'zod';
import { route } from '@/lib/api';
import { badRequest } from '@/lib/errors';
import {
  CONSENT_KINDS, CONSENT_TITLE, RELATIONSHIPS, consentTemplate, requirePatient, resolveSigner, signatureProblem,
} from '@/modules/record/server';

const Query = z.object({ template: z.enum(CONSENT_KINDS).optional() });

// EXP-10 / PAC-08 · Consentimientos firmados del paciente (sin la imagen de la firma).
// `?template=privacy|informed|biometric` devuelve el texto a firmar con clínica, domicilio de la sede y paciente
// ya resueltos; {{firmante}} y {{parentesco}} se resuelven al firmar.
export const GET = route({ auth: 'user', query: Query }, async ({ db, params, query }) => {
  const patient = await requirePatient(db, params.id);
  if (query.template) {
    const t = await consentTemplate(db, patient, query.template);
    return {
      kind: query.template,
      title: CONSENT_TITLE[query.template],
      body: t.body.replaceAll('{{paciente}}', () => patient.full_name),
      patient_name: patient.full_name,
      patient_age: patient.age,
      is_minor: patient.age < 18,
      guardian_name: patient.guardian_name,
      guardian_relationship: patient.guardian_relationship,
    };
  }
  return db`
    select id, patient_id, kind, signer_name, signer_relationship, signed_at, recorded_by, recorded_by_name
    from consents where patient_id = ${patient.id}
    order by signed_at desc`;
});

const Body = z.object({
  kind: z.enum(CONSENT_KINDS, 'Tipo de documento no válido.'),
  signer_name: z.string().trim().min(3, 'Escribe el nombre completo de quien firma.').max(160, 'Máximo 160 caracteres.'),
  signer_relationship: z.enum(RELATIONSHIPS, 'Elige el parentesco de quien firma.'),
  signature_png: z.string().min(1, 'Falta la firma.'),
});

// EXP-10 / PAC-08 · Guarda el consentimiento firmado. El texto que queda en el expediente lo arma el servidor
// con la plantilla vigente (no se confía en el texto que muestre el cliente) y ya no puede modificarse.
export const POST = route({ auth: 'user', body: Body }, async ({ db, user, params, body }) => {
  const patient = await requirePatient(db, params.id);
  const problem = signatureProblem(body.signature_png);
  if (problem) throw badRequest(problem, { signature_png: problem });
  if (patient.age < 18 && body.signer_relationship === 'Paciente') {
    const msg = 'El paciente es menor de edad: debe firmar su madre, padre o tutor.';
    throw badRequest(msg, { signer_relationship: msg });
  }
  const t = await consentTemplate(db, patient, body.kind);
  const snapshot = resolveSigner(t.body, patient.full_name, body.signer_name, body.signer_relationship);
  const [row] = await db`
    insert into consents (patient_id, kind, body_snapshot, signer_name, signer_relationship, signature_png, recorded_by, recorded_by_name)
    values (${patient.id}, ${body.kind}, ${snapshot}, ${body.signer_name}, ${body.signer_relationship}, ${body.signature_png},
            ${user.id}, ${user.display_name})
    returning id, patient_id, kind, body_snapshot, signer_name, signer_relationship, signed_at, recorded_by, recorded_by_name`;
  return row;
});
