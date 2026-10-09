import { z } from 'zod';

/** HUE-01 / CFG-04 · Datos editables de un lector. La contraseña solo viaja hacia el servidor. */
const host = z.string().trim().max(120).regex(/^[A-Za-z0-9.\-:]*$/, 'Escribe solo la IP o el nombre del lector, sin http://.');

export const DeviceCreate = z.object({
  name: z.string().trim().min(1, 'Escribe un nombre para el lector.').max(80),
  location_id: z.uuid('Selecciona la sede.'),
  model: z.string().trim().max(80).default(''),
  serial: z.string().trim().max(80).default(''),
  host: host.default(''),
  port: z.coerce.number().int().min(1, 'Puerto inválido.').max(65535, 'Puerto inválido.').optional(),
  use_https: z.boolean().default(false),
  username: z.string().trim().min(1, 'Escribe el usuario del lector.').max(60).default('admin'),
  password: z.string().max(120).optional(),
});

export const DeviceUpdate = z.object({
  name: z.string().trim().min(1, 'Escribe un nombre para el lector.').max(80).optional(),
  location_id: z.uuid('Selecciona la sede.').optional(),
  model: z.string().trim().max(80).optional(),
  serial: z.string().trim().max(80).optional(),
  host: host.optional(),
  port: z.coerce.number().int().min(1, 'Puerto inválido.').max(65535, 'Puerto inválido.').optional(),
  use_https: z.boolean().optional(),
  username: z.string().trim().min(1, 'Escribe el usuario del lector.').max(60).optional(),
  password: z.string().max(120).optional(),
  active: z.boolean().optional(),
});
