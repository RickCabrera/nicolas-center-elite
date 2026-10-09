import { describe, expect, it } from 'vitest';
import { columnFor, detectDelimiter, normHeader, parseCsv, toCsv } from '@/modules/patients/csv';

// PAC-09 · Lector de CSV del importador de pacientes.
describe('parseCsv', () => {
  it('lee celdas simples y numera las líneas', () => {
    const r = parseCsv('nombre,sede\nAna,Córdoba\nBeto,Orizaba\n');
    expect(r).toEqual([
      { line: 1, cells: ['nombre', 'sede'] },
      { line: 2, cells: ['Ana', 'Córdoba'] },
      { line: 3, cells: ['Beto', 'Orizaba'] },
    ]);
  });

  it('quita el BOM y acepta \\r\\n y \\r', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r3,4').map((r) => r.cells)).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });

  it('detecta el separador punto y coma', () => {
    expect(detectDelimiter('nombre;sede;motivo\nAna;Córdoba;Dolor, rodilla')).toBe(';');
    expect(parseCsv('nombre;motivo\nAna;Dolor, rodilla')[1].cells).toEqual(['Ana', 'Dolor, rodilla']);
  });

  it('no confunde separadores dentro de comillas al detectar', () => {
    expect(detectDelimiter('"a;b;c;d",x,y\n')).toBe(',');
  });

  it('respeta comas, comillas escapadas y saltos de línea dentro de comillas', () => {
    const r = parseCsv('nombre,motivo,sede\n"López, Ana","Dice ""me duele""\nal apoyar",Córdoba\nBeto,x,Orizaba');
    expect(r[1]).toEqual({ line: 2, cells: ['López, Ana', 'Dice "me duele"\nal apoyar', 'Córdoba'] });
    expect(r[2]).toEqual({ line: 4, cells: ['Beto', 'x', 'Orizaba'] });   // la línea cuenta el salto interno
  });

  it('normaliza \\r\\n dentro de comillas a \\n', () => {
    expect(parseCsv('a\r\n"uno\r\ndos"\r\n')[1].cells).toEqual(['uno\ndos']);
  });

  it('recorta espacios fuera de comillas y los conserva dentro', () => {
    expect(parseCsv('a,b\n  Ana  , "  x " ')[1].cells).toEqual(['Ana', '  x ']);
  });

  it('omite líneas vacías y conserva celdas vacías', () => {
    const r = parseCsv('a,b,c\n\n,,\n1,,3\n\n');
    expect(r).toEqual([{ line: 1, cells: ['a', 'b', 'c'] }, { line: 4, cells: ['1', '', '3'] }]);
  });

  it('acepta una celda vacía entre comillas y un último registro sin salto final', () => {
    expect(parseCsv('a,b\n"",2')[1].cells).toEqual(['', '2']);
    expect(parseCsv('a\n""')).toHaveLength(1);
  });

  it('trata como texto una comilla a media celda', () => {
    expect(parseCsv('a\nBalón 5" de hule')[1].cells).toEqual(['Balón 5" de hule']);
  });

  it('texto vacío no produce registros', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('﻿\n\n')).toEqual([]);
  });
});

describe('toCsv', () => {
  it('entrecomilla lo necesario y se puede volver a leer', () => {
    const rows = [['nombre', 'motivo'], ['López, Ana', 'Dice "ay"\nal apoyar'], ['Beto', '']];
    const csv = toCsv(rows);
    expect(csv).toContain('"López, Ana"');
    expect(parseCsv(csv).map((r) => r.cells)).toEqual(rows);
    expect(parseCsv(toCsv(rows, ';')).map((r) => r.cells)).toEqual(rows);
  });
});

describe('encabezados', () => {
  it('tolera acentos, mayúsculas y espacios', () => {
    expect(normHeader('  Fecha de Nacimiento ')).toBe('fecha_de_nacimiento');
    expect(columnFor('TELÉFONO')).toBe('telefono');
    expect(columnFor('Membresía')).toBe('membresia');
    expect(columnFor('Fecha de nacimiento')).toBe('fecha_nacimiento');
    expect(columnFor('Emergencia Nombre')).toBe('emergencia_nombre');
    expect(columnFor('color favorito')).toBeNull();
  });
});
