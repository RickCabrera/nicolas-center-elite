import { z } from 'zod';

/** Campos de un plan de membresía (PAG-01), compartidos por el alta y la edición. */
export const PlanFields = {
  name: z.string('Escribe el nombre.').trim().min(1, 'Escribe el nombre.').max(80, 'Máximo 80 caracteres.'),
  kind: z.enum(['monthly', 'package', 'single'], 'Elige el tipo de plan.'),
  price_cents: z.number('Escribe un precio válido.').int('Escribe un precio válido.').min(0, 'El precio no puede ser negativo.').max(100_000_000, 'El precio es demasiado alto.'),
  period_days: z.number('Escribe la vigencia en días.').int('Escribe la vigencia en días.').min(1, 'La vigencia va de 1 a 366 días.').max(366, 'La vigencia va de 1 a 366 días.'),
  sessions_count: z.number('Escribe el número de sesiones.').int('Escribe el número de sesiones.').min(1, 'Debe ser al menos 1 sesión.').max(500, 'Máximo 500 sesiones.').nullable(),
};

