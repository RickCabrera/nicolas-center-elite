import type { Tx } from '@/lib/db';
import { fmtDate } from '@/lib/dates';
import { badRequest } from '@/lib/errors';
import { columnFor, parseCsv, type ImportColumn } from './csv';
import { loadCatalogs, normText, PatientFields, patientRuleErrors, type PatientInput } from './server';
import type { ImportRow } from './types';

/** PAC-09 · Importador de pacientes desde CSV: valida cada fila con las mismas reglas del alta. */
export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_MAX_CHARS = 3_000_000;

export type AnalyzedRow = ImportRow & { input?: PatientInput; therapist_id?: string; plan_id?: string | null };

const SEX: Record<string, 'F' | 'M' | 'X'> = {
  f: 'F', femenino: 'F', mujer: 'F', m: 'M', masculino: 'M', hombre: 'M', h: 'M', x: 'X', otro: 'X', 'no binario': 'X',
};
const FIELD_LABEL: Record<string, string> = {
  full_name: 'nombre', birth_date: 'fecha_nacimiento', sex: 'sexo', phone: 'telefono', email: 'correo', address: 'domicilio',
  curp: 'curp', emergency_name: 'emergencia_nombre', emergency_phone: 'emergencia_telefono', guardian_name: 'tutor_nombre',
  guardian_relationship: 'tutor_parentesco', guardian_phone: 'tutor_telefono', reason: 'motivo',
};

export async function analyzeImport(db: Tx, csv: string): Promise<{ rows: AnalyzedRow[]; valid: number; invalid: number }> {
  if (csv.length > IMPORT_MAX_CHARS) throw badRequest('El archivo es demasiado grande. Divídelo en partes de hasta 2,000 pacientes.', { csv: 'Archivo demasiado grande.' });
  const records = parseCsv(csv);
  if (!records.length) throw badRequest('El archivo está vacío.', { csv: 'El archivo está vacío.' });

  const [head, ...body] = records;
  const cols = head.cells.map(columnFor);
  const has = (c: ImportColumn) => cols.includes(c);
  const missing = (['nombre', 'fecha_nacimiento', 'sede', 'fisioterapeuta'] as const).filter((c) => !has(c));
  if (missing.length) {
    const msg = `Faltan columnas obligatorias en el encabezado: ${missing.join(', ')}. Descarga la plantilla para ver el formato.`;
    throw badRequest(msg, { csv: msg });
  }
  if (!body.length) throw badRequest('El archivo solo tiene el encabezado: no hay pacientes que importar.', { csv: 'Sin filas.' });
  if (body.length > IMPORT_MAX_ROWS) {
    const msg = `El archivo tiene ${body.length.toLocaleString('es-MX')} filas; el máximo por importación es 2,000.`;
    throw badRequest(msg, { csv: msg });
  }

  const cats = await loadCatalogs(db);
  const existing = await db<{ key: string; record_number: string }[]>`
    select norm(full_name) || '|' || birth_date::text as key, record_number from patients`;
  const known = new Map(existing.map((e) => [e.key.replace(/\s+/g, ' '), e.record_number]));
  const seen = new Map<string, number>();

  const rows: AnalyzedRow[] = body.map((rec) => {
    const v = {} as Record<ImportColumn, string>;
    cols.forEach((c, i) => { if (c && v[c] === undefined) v[c] = rec.cells[i] ?? ''; });
    const get = (c: ImportColumn) => v[c] ?? '';
    const errors: string[] = [];

    // Sede: por nombre o por clave.
    const sede = normText(get('sede'));
    const loc = cats.locations.find((l) => normText(l.name) === sede || l.code.toLowerCase() === sede);
    if (!get('sede')) errors.push('sede: falta la sede.');
    else if (!loc) errors.push(`sede: no existe la sede "${get('sede')}".`);
    else if (!loc.active) errors.push(`sede: "${loc.name}" está inactiva.`);

    // Fisioterapeuta: por usuario o por nombre (con o sin título).
    const fis = normText(get('fisioterapeuta'));
    const matches = cats.therapists.filter((t) => t.username.toLowerCase() === fis || normText(t.full_name) === fis || normText(t.display_name) === fis);
    if (!get('fisioterapeuta')) errors.push('fisioterapeuta: falta el fisioterapeuta.');
    else if (!matches.length) errors.push(`fisioterapeuta: no hay un fisioterapeuta activo "${get('fisioterapeuta')}".`);
    else if (matches.length > 1) errors.push(`fisioterapeuta: "${get('fisioterapeuta')}" coincide con más de uno; usa su nombre de usuario.`);
    const ther = matches.length === 1 ? matches[0] : undefined;

    // Membresía: nombre del plan (opcional).
    const plan = get('membresia') ? cats.plans.find((p) => normText(p.name) === normText(get('membresia'))) : undefined;
    if (get('membresia') && !plan) errors.push(`membresia: no hay un plan activo "${get('membresia')}".`);

    // Etiquetas separadas por |
    const tags: string[] = [];
    for (const raw of get('etiquetas').split('|').map((t) => t.trim()).filter(Boolean)) {
      const tag = cats.tags.find((t) => normText(t) === normText(raw));
      if (!tag) errors.push(`etiquetas: no existe la etiqueta "${raw}".`);
      else if (!tags.includes(tag)) tags.push(tag);
    }

    const sexRaw = normText(get('sexo'));
    const parsed = PatientFields.safeParse({
      full_name: get('nombre'), birth_date: get('fecha_nacimiento'), sex: SEX[sexRaw] ?? (sexRaw === '' ? null : sexRaw),
      phone: get('telefono'), email: get('correo'), address: get('domicilio'), curp: get('curp'),
      emergency_name: get('emergencia_nombre'), emergency_phone: get('emergencia_telefono'),
      guardian_name: get('tutor_nombre'), guardian_relationship: get('tutor_parentesco'), guardian_phone: get('tutor_telefono'),
      location_id: loc?.id ?? '00000000-0000-4000-8000-000000000000', tags, reason: get('motivo'),
    });

    let input: PatientInput | undefined;
    if (!parsed.success) {
      const done = new Set<string>();
      for (const i of parsed.error.issues) {
        const k = String(i.path[0] ?? '');
        if (k === 'location_id' || k === 'tags' || done.has(k)) continue;
        done.add(k);
        errors.push(`${FIELD_LABEL[k] ?? k}: ${k === 'sex' ? 'usa F, M o X.' : i.message}`);
      }
    } else {
      input = parsed.data;
      for (const [k, m] of Object.entries(patientRuleErrors(input))) errors.push(`${FIELD_LABEL[k] ?? k}: ${m}`);
      // Evita duplicar expedientes: mismo nombre y fecha de nacimiento.
      const key = `${normText(input.full_name)}|${input.birth_date}`;
      const dup = known.get(key);
      const prev = seen.get(key);
      if (dup) errors.push(`Ya existe un paciente con ese nombre y fecha de nacimiento (${dup}).`);
      else if (prev) errors.push(`Repite al paciente de la línea ${prev}.`);
      else seen.set(key, rec.line);
    }

    const ok = errors.length === 0;
    return {
      line: rec.line, ok, errors,
      data: {
        full_name: input?.full_name ?? get('nombre'),
        birth_date: input ? fmtDate(input.birth_date) : get('fecha_nacimiento'),
        sex: input ? (input.sex ?? '') : get('sexo'),
        phone: input?.phone ?? get('telefono'),
        location_name: loc?.name ?? get('sede'),
        therapist_name: ther?.display_name ?? get('fisioterapeuta'),
        plan_name: plan?.name ?? get('membresia'),
        reason: input?.reason ?? get('motivo'),
        tags,
      },
      ...(ok ? { input, therapist_id: ther!.id, plan_id: plan?.id ?? null } : {}),
    };
  });

  const valid = rows.filter((r) => r.ok).length;
  return { rows, valid, invalid: rows.length - valid };
}
