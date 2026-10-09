import { z } from 'zod';
import { route } from '@/lib/api';
import { logEvent } from '@/lib/audit';
import { decrypt, encrypt, randomToken, sha256 } from '@/lib/crypto';
import { notFound } from '@/lib/errors';
import type { Tx } from '@/lib/db';
import { connectionData } from '@/modules/attendance/server';

type Row = { id: string; name: string; webhook_token_enc: string; bridge_token_enc: string };

async function load(db: Tx, id: string) {
  const [d] = await db<Row[]>`select id, name, webhook_token_enc, bridge_token_enc from devices where id = ${id}`;
  if (!d) throw notFound('Lector no encontrado.');
  return d;
}

// HUE-01 · Datos de conexión del lector y del puente. Solo el dueño; cada consulta queda en la bitácora.
export const GET = route({ auth: 'owner' }, async ({ db, params }) => {
  const d = await load(db, params.id);
  await logEvent(db, 'security', `Consultó los datos de conexión del lector "${d.name}".`, { table: 'devices', rowId: d.id });
  return connectionData(decrypt(d.webhook_token_enc), decrypt(d.bridge_token_enc));
});

const Body = z.object({ regenerate: z.enum(['webhook', 'bridge']) });

// HUE-01 · Rota un token: el anterior deja de funcionar de inmediato.
export const POST = route({ auth: 'owner', body: Body }, async ({ db, params, body }) => {
  const d = await load(db, params.id);
  const token = randomToken();
  if (body.regenerate === 'webhook') {
    await db`update devices set webhook_token_hash = ${sha256(token)}, webhook_token_enc = ${encrypt(token)}, last_webhook_at = null where id = ${d.id}`;
  } else {
    await db`update devices set bridge_token_hash = ${sha256(token)}, bridge_token_enc = ${encrypt(token)}, bridge_seen_at = null where id = ${d.id}`;
  }
  await logEvent(db, 'security', `Regeneró el token ${body.regenerate === 'webhook' ? 'del webhook' : 'del agente puente'} del lector "${d.name}".`, { table: 'devices', rowId: d.id });
  const fresh = await load(db, params.id);
  return connectionData(decrypt(fresh.webhook_token_enc), decrypt(fresh.bridge_token_enc));
});
