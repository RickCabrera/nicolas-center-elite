import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import { TEST_DATABASE_URL } from './env';

// Crea (si falta) la base de pruebas y la deja recién migrada antes de correr la suite.
export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const name = url.pathname.slice(1);
  const admin = new URL(TEST_DATABASE_URL);
  admin.pathname = '/postgres';
  const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    const [exists] = await sql`select 1 from pg_database where datname = ${name}`;
    if (!exists) await sql.unsafe(`create database "${name}"`);
  } finally {
    await sql.end();
  }
  execFileSync('node', ['scripts/migrate.mjs', '--reset'], { env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, APP_ENV: 'development' }, stdio: 'pipe' });
}
