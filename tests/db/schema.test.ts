import { describe, expect, it } from 'vitest';
import { sqlSystem } from '../helpers';

describe('esquema', () => {
  it('AUTH-05 · ninguna tabla queda sin RLS', async () => {
    const rows = await sqlSystem((tx) => tx<{ relname: string }[]>`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it('HUE-16 · no existe ninguna columna que guarde huellas o plantillas biométricas', async () => {
    const rows = await sqlSystem((tx) => tx<{ c: string }[]>`
      select table_name || '.' || column_name as c from information_schema.columns
      where table_schema = 'public' and column_name ~* '(finger_?data|finger_?print_?(data|image|template)|biometric_?(data|template)|huella_?(data|imagen|plantilla))'`);
    expect(rows.map((r) => r.c)).toEqual([]);
  });

  it('las tablas internas de autenticación no son accesibles para el rol de aplicación', async () => {
    const rows = await sqlSystem((tx) => tx<{ t: string }[]>`
      select table_name as t from information_schema.role_table_grants
      where grantee = 'nce_app' and table_name in ('sessions','auth_tokens','passkeys','webauthn_challenges','folio_counters','device_commands','email_outbox')`);
    expect(rows).toEqual([]);
  });
});
