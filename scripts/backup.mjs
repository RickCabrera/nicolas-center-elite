#!/usr/bin/env node
/**
 * DEP-06 · Respaldo completo: base de datos (pg_dump, formato custom) + archivos de estudios.
 *
 *   node scripts/backup.mjs [carpeta_destino]          (por defecto ./respaldos/AAAA-MM-DD_HHMM)
 *   node scripts/backup.mjs --restore-check <carpeta>  restaura en una base temporal y compara conteos
 *
 * Requiere pg_dump / pg_restore (PostgreSQL 16 o superior) en la computadora que lo corre, y las variables
 * DATABASE_URL (usa la conexión DIRECTA de Supabase, puerto 5432, no el pooler) y, si los archivos están
 * en Supabase, SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_BUCKET. Lee .env.local si existe.
 * Complementa (no sustituye) los respaldos automáticos del proveedor. Ver docs/respaldos.md.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['.env.local', '.env']) {
  const p = join(root, f);
  if (existsSync(p)) for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const DB = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!DB) { console.error('Falta DATABASE_URL.'); process.exit(1); }
const TABLES = ['users', 'patients', 'clinical_profiles', 'evolution_notes', 'consents', 'studies', 'appointments',
  'documents', 'document_items', 'memberships', 'payments', 'attendance_events', 'audit_log'];

async function counts(url) {
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const out = {};
    for (const t of TABLES) out[t] = (await sql.unsafe(`select count(*)::int as n from ${t}`))[0].n;
    return out;
  } finally { await sql.end(); }
}

async function backup(dest) {
  mkdirSync(join(dest, 'archivos'), { recursive: true });
  console.log(`Respaldando la base en ${dest}/base.dump ...`);
  execFileSync('pg_dump', ['--format=custom', '--no-owner', '--file', join(dest, 'base.dump'), DB], { stdio: 'inherit' });

  const sql = postgres(DB, { max: 1, prepare: false, onnotice: () => {} });
  const files = await sql`select storage_path as p from studies union select thumb_path from studies where thumb_path is not null
                          union select logo_path from clinic where logo_path is not null`;
  await sql.end();
  console.log(`Copiando ${files.length} archivos ...`);
  const driver = process.env.STORAGE_DRIVER ?? 'local';
  let ok = 0; const missing = [];
  for (const { p } of files) {
    const target = join(dest, 'archivos', p);
    mkdirSync(dirname(target), { recursive: true });
    try {
      if (driver === 'local') {
        copyFileSync(join(root, process.env.LOCAL_STORAGE_DIR ?? '.data/storage', p), target);
      } else {
        const url = `${process.env.SUPABASE_URL}/storage/v1/object/${process.env.SUPABASE_BUCKET ?? 'estudios'}/${p}`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } });
        if (!r.ok) throw new Error(String(r.status));
        writeFileSync(target, Buffer.from(await r.arrayBuffer()));
      }
      ok++;
    } catch { missing.push(p); }
  }
  const manifest = {
    created_at: new Date().toISOString(), counts: await counts(DB), files_copied: ok, files_missing: missing,
    sha256_base: createHash('sha256').update(readFileSync(join(dest, 'base.dump'))).digest('hex'),
  };
  writeFileSync(join(dest, 'manifiesto.json'), JSON.stringify(manifest, null, 2));
  console.log(`Listo: ${ok} archivos copiados${missing.length ? `, ${missing.length} faltantes (ver manifiesto.json)` : ''}.`);
}

async function restoreCheck(src) {
  const manifest = JSON.parse(readFileSync(join(src, 'manifiesto.json'), 'utf8'));
  const tmpName = `nce_restore_${Date.now()}`;
  const admin = new URL(DB); admin.pathname = '/postgres';
  const target = new URL(DB); target.pathname = `/${tmpName}`;
  const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  await sql.unsafe(`create database "${tmpName}"`);
  await sql.end();
  try {
    console.log(`Restaurando en la base temporal ${tmpName} ...`);
    execFileSync('pg_restore', ['--no-owner', '--dbname', target.toString(), join(src, 'base.dump')], { stdio: 'inherit' });
    // La seguridad por fila debe seguir funcionando: un fisioterapeuta solo ve a sus pacientes.
    const t = postgres(target.toString(), { max: 1, prepare: false, onnotice: () => {} });
    try {
      const [ther] = await t`select u.id, count(p.id)::int as own from users u join patients p on p.therapist_id = u.id
                             where u.role = 'therapist' group by u.id order by own desc limit 1`;
      if (ther) {
        const seen = await t.begin(async (tx) => {
          await tx`select set_config('app.user_id', ${ther.id}, true), set_config('app.user_role', 'therapist', true)`;
          await tx`set local role nce_app`;
          return (await tx`select count(*)::int as n from patients`)[0].n;
        });
        const okRls = seen === ther.own;
        console.log(`${okRls ? 'ok ' : 'DIF'}  seguridad por fila    un fisioterapeuta ve ${seen} pacientes (le corresponden ${ther.own})`);
        if (!okRls) process.exitCode = 1;
      }
    } finally { await t.end(); }
    const got = await counts(target.toString());
    let fail = 0;
    for (const t of TABLES) {
      const okRow = got[t] === manifest.counts[t];
      if (!okRow) fail++;
      console.log(`${okRow ? 'ok ' : 'DIF'}  ${t.padEnd(20)} respaldo ${String(manifest.counts[t]).padStart(6)}  restaurado ${String(got[t]).padStart(6)}`);
    }
    const files = readdirSync(join(src, 'archivos'), { recursive: true }).filter((f) => statSync(join(src, 'archivos', f)).isFile());
    console.log(`Archivos en el respaldo: ${files.length} (copiados al respaldar: ${manifest.files_copied}).`);
    if (fail || files.length !== manifest.files_copied) { console.error('La restauración NO coincide.'); process.exitCode = 1; }
    else console.log('Restauración verificada: todos los conteos y archivos coinciden.');
  } finally {
    const s2 = postgres(admin.toString(), { max: 1, onnotice: () => {} });
    await s2.unsafe(`drop database if exists "${tmpName}" with (force)`);
    await s2.end();
  }
}

const args = process.argv.slice(2);
if (args[0] === '--restore-check') await restoreCheck(args[1]);
else {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  await backup(args[0] ?? join(root, 'respaldos', stamp));
}
void relative;
