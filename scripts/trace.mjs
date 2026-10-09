#!/usr/bin/env node
// Genera docs/trazabilidad.md: por cada ID del backlog, los archivos de código y de pruebas que lo citan.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const EPICS = ['INF', 'UI', 'DB', 'AUTH', 'PAC', 'EXP', 'EST', 'AGE', 'REC', 'PAG', 'HUE', 'DASH', 'CFG', 'EQ', 'LEG', 'QA', 'DEP', 'FAC'];
const COUNTS = { INF: 8, UI: 7, DB: 12, AUTH: 9, PAC: 9, EXP: 10, EST: 6, AGE: 9, REC: 10, PAG: 12, HUE: 16, DASH: 4, CFG: 10, EQ: 7, LEG: 5, QA: 6, DEP: 6, FAC: 6 };
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  if (['node_modules', '.next', '.git', '.data', 'test-results', 'respaldos'].includes(f)) return [];
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk(root).filter((f) => /\.(ts|tsx|mjs|sql|ps1|md|yml|json|css)$/.test(f) && !f.endsWith('trazabilidad.md'));
const hits = {};
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const rel = relative(root, f);
  for (const m of text.matchAll(/\b(INF|UI|DB|AUTH|PAC|EXP|EST|AGE|REC|PAG|HUE|DASH|CFG|EQ|LEG|QA|DEP|FAC)-(\d{2})\b/g)) {
    const id = `${m[1]}-${m[2]}`;
    (hits[id] ??= new Set()).add(rel);
  }
}
let out = `# Trazabilidad del backlog\n\nGenerado con \`node scripts/trace.mjs\`. Para cada tarea: dónde se implementa y qué prueba la cubre.\n`;
out += `Una tarea sin pruebas listadas se verificó por revisión visual o es documentación.\n\n`;
let missing = [];
for (const e of EPICS) {
  out += `## ${e}\n\n| Tarea | Código | Pruebas |\n| --- | --- | --- |\n`;
  for (let i = 1; i <= COUNTS[e]; i++) {
    const id = `${e}-${String(i).padStart(2, '0')}`;
    const all = [...(hits[id] ?? [])].sort();
    const tests = all.filter((f) => f.startsWith('tests/'));
    const code = all.filter((f) => !f.startsWith('tests/') && !f.startsWith('docs/'));
    if (!all.length) missing.push(id);
    const cell = (a) => (a.length ? a.slice(0, 6).map((f) => `\`${f}\``).join('<br>') + (a.length > 6 ? `<br>(+${a.length - 6})` : '') : '—');
    out += `| ${id} | ${cell(code)} | ${cell(tests)} |\n`;
  }
  out += '\n';
}
writeFileSync(join(root, 'docs', 'trazabilidad.md'), out);
console.log(`docs/trazabilidad.md generado. Tareas sin ninguna referencia: ${missing.length ? missing.join(', ') : 'ninguna'}`);
