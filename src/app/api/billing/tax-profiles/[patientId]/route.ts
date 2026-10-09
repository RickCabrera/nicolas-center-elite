import { z } from 'zod';
import { route } from '@/lib/api';
import { notFound } from '@/lib/errors';
import { requirePatient } from '@/modules/billing/server';
import { TaxProfileSchema } from '@/modules/invoicing/schema';
import { getTaxProfile, saveTaxProfile } from '@/modules/invoicing/server';

// FAC-01 · Datos fiscales del paciente (solo dueño).
export const GET = route({ auth: 'owner' }, async ({ db, params }) => {
  if (!z.uuid().safeParse(params.patientId).success) throw notFound('Paciente no encontrado.');
  await requirePatient(db, params.patientId);
  return { profile: await getTaxProfile(db, params.patientId) };
});

export const PUT = route({ auth: 'owner', body: TaxProfileSchema }, async ({ db, user, params, body }) => {
  if (!z.uuid().safeParse(params.patientId).success) throw notFound('Paciente no encontrado.');
  await requirePatient(db, params.patientId);
  return { profile: await saveTaxProfile(db, user, params.patientId, body) };
});
