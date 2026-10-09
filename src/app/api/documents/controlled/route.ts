import { route } from '@/lib/api';

// REC-06 · Catálogo de sustancias controladas (normalizado: minúsculas, sin acentos) para avisar
// en vivo en la hoja de emisión. Con ?name= responde si ese nombre coincide. La base es la autoridad.
export const GET = route({ auth: 'user' }, async ({ db, query }) => {
  if (query.name !== undefined) {
    const [hit] = await db<{ name: string }[]>`
      select cs.name from controlled_substances cs where norm(${query.name}) like '%' || cs.name || '%' order by length(cs.name) desc limit 1`;
    return { controlled: !!hit, match: hit?.name ?? null };
  }
  const rows = await db<{ name: string }[]>`select name from controlled_substances order by name`;
  return { names: rows.map((r) => r.name) };
});
