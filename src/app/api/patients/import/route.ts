import { z } from 'zod';
import { route } from '@/lib/api';
import { logEvent } from '@/lib/audit';
import { badRequest } from '@/lib/errors';
import { createInitialMembership } from '@/modules/billing/membership';
import { analyzeImport } from '@/modules/patients/import';
import { insertPatient } from '@/modules/patients/server';

const Body = z.object({
  csv: z.string('Falta el contenido del archivo.').min(1, 'El archivo está vacío.'),
  commit: z.boolean().default(false),
  skip_invalid: z.boolean().default(false),
});

// PAC-09 · Importador CSV (solo dueño). Sin `commit` devuelve la vista previa; con `commit` inserta
// todas las filas válidas en esta misma transacción: o entran todas o no entra ninguna.
export const POST = route({ auth: 'owner', body: Body }, async ({ db, user, body }) => {
  const { rows, valid, invalid } = await analyzeImport(db, body.csv);
  const preview = rows.map(({ line, ok, errors, data }) => ({ line, ok, errors, data }));
  if (!body.commit) return { rows: preview, valid, invalid };

  if (invalid > 0 && !body.skip_invalid) {
    throw badRequest(`Hay ${invalid} ${invalid === 1 ? 'fila con error' : 'filas con error'}. Corrígelas o elige omitirlas para importar el resto.`);
  }
  if (valid === 0) throw badRequest('No hay filas válidas que importar.');

  let inserted = 0;
  for (const r of rows) {
    if (!r.ok || !r.input || !r.therapist_id) continue;
    const row = await insertPatient(db, r.input, r.therapist_id, user.id);
    if (r.plan_id) await createInitialMembership(db, row.id, r.plan_id, user.id);
    inserted++;
  }
  await logEvent(db, 'import', `Importación de pacientes desde CSV: ${inserted} ${inserted === 1 ? 'alta' : 'altas'}.`, { table: 'patients' });
  return { inserted, skipped: invalid };
});
