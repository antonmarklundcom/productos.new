import { describe, expect, it } from 'vitest';

import { CSV_BOM, csvFilename, toCsv } from '../../src/lib/csv';

/**
 * El CSV que baja el panel. Lo que se verifica es que el archivo se abra bien
 * y no se pueda romper con el contenido de una celda.
 */
describe('toCsv', () => {
  it('arranca con el BOM: sin él, Excel lee "Corpiño" como "CorpiÃ±o"', () => {
    expect(toCsv(['a'], [['Corpiño']]).startsWith(CSV_BOM)).toBe(true);
  });

  it('separa con punto y coma, que es lo que espera el Excel en español', () => {
    const csv = toCsv(['a', 'b'], [['1', '2']]);

    expect(csv).toContain('a;b');
    expect(csv).toContain('1;2');
  });

  it('entrecomilla la celda que trae el separador', () => {
    // Sin comillas, "Asunción; Barrio Jara" se parte en dos columnas y corre
    // todas las que siguen.
    const csv = toCsv(['dir'], [['Asunción; Barrio Jara']]);

    expect(csv).toContain('"Asunción; Barrio Jara"');
  });

  it('duplica las comillas de adentro (RFC 4180)', () => {
    const csv = toCsv(['nombre'], [['Ana "la vecina"']]);

    expect(csv).toContain('"Ana ""la vecina"""');
  });

  it('entrecomilla los saltos de línea en vez de cortar la fila', () => {
    const csv = toCsv(['nota'], [['linea 1\nlinea 2']]);

    expect(csv).toContain('"linea 1\nlinea 2"');
    // Header + una sola fila de datos.
    expect(csv.split('\r\n').filter((line) => line !== '')).toHaveLength(2);
  });

  it('entrecomilla lo que Excel interpretaría como fórmula', () => {
    // Un nombre que arranca con "=" es una fórmula para Excel, y ahí el
    // archivo pasa de ser data a ser algo que se ejecuta.
    for (const value of ['=1+1', '+595981', '-x', '@algo']) {
      expect(toCsv(['x'], [[value]])).toContain(`"${value}"`);
    }
  });

  it('un null o un undefined salen como celda vacía y no como "null"', () => {
    expect(toCsv(['a', 'b'], [[null, undefined]])).toContain('\r\n;\r\n');
  });

  it('los montos van como enteros pelados, para que la planilla los sume', () => {
    // Nada de "₲ 145.000": eso es texto y no se suma.
    expect(toCsv(['total'], [[145000]])).toContain('145000');
  });

  it('termina cada línea en CRLF', () => {
    expect(toCsv(['a'], [['1']])).toBe(`${CSV_BOM}a\r\n1\r\n`);
  });

  it('sin filas baja igual, con el encabezado solo', () => {
    expect(toCsv(['a', 'b'], [])).toBe(`${CSV_BOM}a;b\r\n`);
  });
});

describe('csvFilename', () => {
  it('lleva la fecha, porque estos archivos terminan todos juntos en Descargas', () => {
    expect(csvFilename('pedidos', '2026-08-07')).toBe('pedidos-2026-08-07.csv');
  });
});
