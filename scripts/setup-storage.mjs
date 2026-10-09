#!/usr/bin/env node
// DEP-01 · Crea el bucket PRIVADO de estudios en Supabase si no existe (idempotente). Corre en cada build.
// Con STORAGE_DRIVER=local no hace nada.
import { createClient } from '@supabase/supabase-js';

if ((process.env.STORAGE_DRIVER ?? 'local') !== 'supabase') {
  console.log('Almacenamiento local: no hay bucket que preparar.');
  process.exit(0);
}
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const bucket = process.env.SUPABASE_BUCKET || 'estudios';
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await sb.storage.getBucket(bucket);
if (data) {
  if (data.public) {
    await sb.storage.updateBucket(bucket, { public: false });
    console.log(`El bucket "${bucket}" era público: se cambió a privado.`);
  } else console.log(`Bucket privado "${bucket}" listo.`);
} else {
  // 200 MB por archivo (estudios DICOM). El plan gratuito de Supabase limita a 50 MB por archivo y rechaza
  // un límite mayor: en ese caso se crea sin límite propio y aplica el del plan.
  let r = await sb.storage.createBucket(bucket, { public: false, fileSizeLimit: '200MB' });
  if (r.error) {
    console.warn(`Aviso: no se aceptó el límite de 200 MB (${r.error.message}); se crea con el límite del plan.`);
    r = await sb.storage.createBucket(bucket, { public: false });
  }
  if (r.error) {
    // No se detiene la publicación: la app funciona y solo fallarán las subidas de archivos hasta resolverlo.
    console.warn(`AVISO: no se pudo crear el bucket "${bucket}": ${r.error.message} ${error?.message ?? ''}`);
    console.warn('Revisa SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (llave "service_role" de la pestaña Legacy).');
  } else console.log(`Bucket privado "${bucket}" creado.`);
}
