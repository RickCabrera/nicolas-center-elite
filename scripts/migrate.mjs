#!/usr/bin/env node
// Aplica las migraciones SQL pendientes de db/migrations en orden.
// Uso: node scripts/migrate.mjs [--reset]   (--reset borra todo; prohibido en producción)
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['.env.local', '.env']) {
  const p = join(root, f);
  if (!process.env.DATABASE_URL && !process.env.DIRECT_DATABASE_URL && existsSync(p)) {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

// Las migraciones prefieren la conexión DIRECTA (Supabase: puerto 5432); la app usa el pooler.
const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL (o DIRECT_DATABASE_URL) con la cadena de conexión a Postgres.');
  process.exit(1);
}
const reset = process.argv.includes('--reset');
if (reset && (process.env.VERCEL_ENV === 'production' || process.env.APP_ENV === 'production')) {
  console.error('--reset no está permitido en producción.');
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const dir = join(root, 'db', 'migrations');

try {
  if (reset) {
    await sql.unsafe('drop schema public cascade; create schema public; grant usage on schema public to public;');
    console.log('Esquema reiniciado.');
  }
  await sql`create table if not exists schema_migrations (
    name text primary key, checksum text not null, applied_at timestamptz not null default now())`;
  const done = new Map((await sql`select name, checksum from schema_migrations`).map((r) => [r.name, r.checksum]));
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  let applied = 0;
  for (const f of files) {
    const body = readFileSync(join(dir, f), 'utf8');
    const checksum = createHash('sha256').update(body).digest('hex');
    if (done.has(f)) {
      if (done.get(f) !== checksum) console.warn(`Aviso: ${f} cambió después de aplicarse; no se vuelve a ejecutar.`);
      continue;
    }
    process.stdout.write(`Aplicando ${f} ... `);
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(727274)`;
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name, checksum) values (${f}, ${checksum})`;
    });
    console.log('ok');
    applied++;
  }
  await sql`alter table schema_migrations enable row level security`;
  console.log(applied ? `${applied} migración(es) aplicadas.` : 'Base de datos al día.');
} catch (e) {
  console.error('\nError de migración:', e.message, e.where ? `\n${e.where}` : '');
  process.exitCode = 1;
} finally {
  await sql.end();
}
