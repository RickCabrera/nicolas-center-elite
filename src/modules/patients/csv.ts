/**
 * PAC-09 · Lector y escritor de CSV sin dependencias. Sirve igual en servidor y navegador.
 * Soporta: BOM, separador `,` o `;` (se detecta solo), comillas dobles, comillas escapadas (""),
 * separadores y saltos de línea dentro de comillas, y finales de línea \n, \r\n o \r.
 */
export type CsvRecord = { line: number; cells: string[] };

/** Cuenta separadores fuera de comillas en el primer registro para elegir entre `,` y `;`. */
export function detectDelimiter(text: string): ',' | ';' {
  let commas = 0, semis = 0, quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted) {
      if (c === ',') commas++;
      else if (c === ';') semis++;
      else if (c === '\n' || c === '\r') { if (commas || semis) break; }
    }
  }
  return semis > commas ? ';' : ',';
}

/**
 * Convierte el texto en registros. `line` es la línea del archivo (desde 1) donde empieza el registro.
 * Los registros completamente vacíos se omiten. Las celdas se devuelven sin espacios alrededor.
 */
export function parseCsv(input: string, delimiter?: ',' | ';'): CsvRecord[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const sep = delimiter ?? detectDelimiter(text);
  const out: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;      // dentro de comillas
  let wasQuoted = false;   // la celda actual venía entre comillas (no se recorta)
  let line = 1, startLine = 1;

  const endCell = () => { cells.push(wasQuoted ? cell : cell.trim()); cell = ''; wasQuoted = false; };
  const endRecord = () => {
    endCell();
    if (cells.some((c) => c !== '')) out.push({ line: startLine, cells });
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else {
        if (c === '\n') line++;
        else if (c === '\r') { if (text[i + 1] !== '\n') line++; }
        cell += c === '\r' ? (text[i + 1] === '\n' ? '' : '\n') : c;
      }
    } else if (c === '"' && cell.trim() === '') {
      quoted = true; wasQuoted = true; cell = '';
    } else if (c === sep) {
      endCell();
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++; startLine = line;
    } else if (!wasQuoted || c.trim() !== '') {
      cell += c;   // tras cerrar comillas se ignoran los espacios sobrantes
    }
  }
  if (cell !== '' || cells.length || wasQuoted) endRecord();
  return out;
}

/** Arma un CSV: entrecomilla lo que lleve separador, comillas o saltos de línea. */
export function toCsv(rows: string[][], delimiter: ',' | ';' = ','): string {
  const esc = (v: string) => (/["\r\n]/.test(v) || v.includes(delimiter) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(esc).join(delimiter)).join('\r\n') + '\r\n';
}

/** Encabezado normalizado: sin acentos, minúsculas, espacios y guiones como `_`. */
export function normHeader(h: string): string {
  return h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[\s\-./]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Columnas del importador de pacientes, en el orden de la plantilla. */
export const IMPORT_COLUMNS = [
  'nombre', 'fecha_nacimiento', 'sexo', 'telefono', 'correo', 'domicilio', 'curp', 'emergencia_nombre', 'emergencia_telefono',
  'tutor_nombre', 'tutor_parentesco', 'tutor_telefono', 'sede', 'fisioterapeuta', 'membresia', 'motivo', 'etiquetas',
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

/** Otros nombres con los que suele venir cada columna en las hojas de cálculo. */
const ALIASES: Record<string, ImportColumn> = {
  nombre_completo: 'nombre', paciente: 'nombre',
  fecha_de_nacimiento: 'fecha_nacimiento', nacimiento: 'fecha_nacimiento', fecha_nac: 'fecha_nacimiento',
  genero: 'sexo', tel: 'telefono', celular: 'telefono', email: 'correo', correo_electronico: 'correo', direccion: 'domicilio',
  contacto_emergencia: 'emergencia_nombre', contacto_de_emergencia: 'emergencia_nombre', telefono_emergencia: 'emergencia_telefono',
  tutor: 'tutor_nombre', parentesco: 'tutor_parentesco', sucursal: 'sede', fisio: 'fisioterapeuta', terapeuta: 'fisioterapeuta',
  plan: 'membresia', motivo_de_consulta: 'motivo', lesion: 'motivo', etiqueta: 'etiquetas',
};

export function columnFor(header: string): ImportColumn | null {
  const h = normHeader(header);
  if ((IMPORT_COLUMNS as readonly string[]).includes(h)) return h as ImportColumn;
  return ALIASES[h] ?? null;
}
