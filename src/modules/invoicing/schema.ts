import { z } from 'zod';
import { RFC_RE } from './catalogs';

// FAC-01 · Datos fiscales, tal como aparecen en la Constancia de Situación Fiscal.
export const TaxProfileSchema = z.object({
  legal_name: z.string('Escribe el nombre o razón social.').trim().min(2, 'Escribe el nombre o razón social como aparece en la constancia.').max(300, 'Máximo 300 caracteres.'),
  tax_id: z.string('Escribe el RFC.').trim().toUpperCase().regex(RFC_RE, 'RFC inválido: 12 caracteres (persona moral) o 13 (persona física), sin guiones.'),
  tax_system: z.string('Elige el régimen fiscal.').regex(/^\d{3}$/, 'Elige el régimen fiscal.'),
  zip: z.string('Escribe el código postal.').trim().regex(/^\d{5}$/, 'El código postal del domicilio fiscal tiene 5 dígitos.'),
  cfdi_use: z.string().regex(/^[A-Z]{1,2}\d{2}$/, 'Elige el uso de CFDI.').default('D01'),
  email: z.union([z.literal(''), z.email('Escribe un correo válido.')]).default(''),
});
export type TaxProfileInput = z.infer<typeof TaxProfileSchema>;
