import { z } from 'zod';

// CFG-02 · Validación de los campos de una sede (compartida por el alta y la edición).
const line = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres.`);
export const LocationFields = {
  name: z.string().trim().min(2, 'Escribe el nombre de la sede.').max(60, 'Máximo 60 caracteres.'),
  street: line(160),
  neighborhood: line(120),
  city: line(80),
  state: line(80),
  zip: z.string().trim().regex(/^(\d{5})?$/, 'El código postal tiene 5 dígitos.'),
  phone: z.string().trim().max(40, 'Máximo 40 caracteres.').regex(/^[\d\s()+\-.,/extEXT]*$/, 'Escribe solo el número telefónico.'),
  hours: line(200),
};
export const LocationCode = z.string().trim().toUpperCase().regex(/^[A-Z]{2,5}$/, 'La clave lleva de 2 a 5 letras, sin números ni espacios.');
