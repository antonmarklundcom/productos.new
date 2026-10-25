import { describe, expect, it } from 'vitest';

import { CSV_BOM, csvFilename, neutralizeFormula, toCsv } from '../../src/lib/csv';

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

  it('antepone una comilla simple al texto que Excel ejecutaría como fórmula', () => {
    // Un nombre que arranca con "=" es una fórmula para Excel, y ahí el
    // archivo pasa de ser data a ser algo que se ejecuta.
    for (const value of ['=1+1', '+A1', '-x', '@algo', '-2+3', '@SUM(1)', '\tx', '\rx']) {
      expect(neutralizeFormula(value)).toBe(`'${value}`);
    }
    expect(toCsv(['x'], [['=1+1']])).toContain("\r\n'=1+1\r\n");
    expect(toCsv(['x'], [['@SUM(1)']])).toContain("\r\n'@SUM(1)\r\n");
    // Con comillas adentro sigue el escape RFC 4180 sobre el texto ya prefijado.
    expect(toCsv(['x'], [['=HYPERLINK("http://x","y")']])).toContain(
      `"'=HYPERLINK(""http://x"",""y"")"`,
    );
  });

  it('no toca el texto normal ni los números que la app escribe como número', () => {
    expect(neutralizeFormula('Ana Pérez')).toBe('Ana Pérez');
    // Teléfonos y números sueltos no se tocan.
    for (const v of ['+595 981 123456', '+595981123456', '-12.5', '(021) 123-456']) {
      expect(neutralizeFormula(v)).toBe(v);
    }
    // Lo que no es solo número sigue con prefijo.
    for (const v of ["+cmd|' /C calc'!A0", '=1+1', '-2+3*SUM(A1)', '@SUM(1)', '+A1']) {
      expect(neutralizeFormula(v)).toBe(`'${v}`);
    }
    expect(neutralizeFormula('')).toBe('');
    expect(neutralizeFormula(-5)).toBe(-5);
    expect(toCsv(['n'], [[-5]])).toContain('\r\n-5\r\n');
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
