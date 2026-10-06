import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { spreadsheetToCsvText, UnsupportedSpreadsheetError } from '@/lib/spreadsheet';

/**
 * El puente entre el `.xlsx` que sube el comercio y `parseCatalogo`, que sólo
 * entiende CSV.
 *
 * Hasta acá ningún test le pasaba bytes de verdad: se probaba `parseCatalogo`
 * con texto ya armado a mano. Un cambio de versión de `exceljs` podía romper
 * el separador o el orden de las hojas sin que nada se pusiera rojo.
 */

async function libroDePrueba(filas: unknown[][], nombreHoja = 'Catálogo'): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(nombreHoja);
  sheet.addRows(filas);
  return Buffer.from(await book.xlsx.writeBuffer());
}

describe('spreadsheetToCsvText', () => {
  it('convierte un .xlsx real a CSV con `;` como separador', async () => {
    const bytes = await libroDePrueba([
      ['sku', 'nombre', 'precio'],
      ['REM-001', 'Remera negra', 120000],
      ['REM-002', 'Remera blanca', 135000],
    ]);

    const csv = await spreadsheetToCsvText('catalogo.xlsx', bytes);

    expect(csv.split('\n')[0]).toBe('sku;nombre;precio');
    expect(csv).toContain('REM-001;Remera negra;120000');
    // Los guaraníes salen enteros: ni miles con punto ni decimales.
    expect(csv).not.toMatch(/120\.000|120000\.0/);
  });

  it('toma la primera hoja y no las demás', async () => {
    const book = new ExcelJS.Workbook();
    book.addWorksheet('Uno').addRows([['sku'], ['PRIMERA']]);
    book.addWorksheet('Dos').addRows([['sku'], ['SEGUNDA']]);
    const bytes = Buffer.from(await book.xlsx.writeBuffer());

    const csv = await spreadsheetToCsvText('catalogo.xlsx', bytes);

    expect(csv).toContain('PRIMERA');
    expect(csv).not.toContain('SEGUNDA');
  });

  it('respeta el texto con acentos y con `;` adentro', async () => {
    const bytes = await libroDePrueba([
      ['nombre', 'descripcion'],
      ['Ñandutí', 'blanco; hecho a mano'],
    ]);

    const csv = await spreadsheetToCsvText('catalogo.xlsx', bytes);

    expect(csv).toContain('Ñandutí');
    // El `;` del texto va entre comillas o el CSV se parte en una columna de más.
    expect(csv).toContain('"blanco; hecho a mano"');
  });

  it('devuelve el texto tal cual para .csv y .txt', async () => {
    const texto = 'sku;nombre\nREM-001;Remera negra';

    expect(await spreadsheetToCsvText('catalogo.csv', Buffer.from(texto, 'utf8'))).toBe(texto);
    expect(await spreadsheetToCsvText('catalogo.TXT', Buffer.from(texto, 'utf8'))).toBe(texto);
  });

  it('rechaza una extensión que no sabe leer', async () => {
    await expect(spreadsheetToCsvText('catalogo.pdf', Buffer.from('%PDF-1.7'))).rejects.toThrow(
      UnsupportedSpreadsheetError,
    );
  });

  // Un `.xls` (Excel 97-2003, formato binario) ya no se soporta: `exceljs`
  // sólo lee el formato `.xlsx` (zip + XML). Cae en el mismo mensaje que
  // cualquier extensión desconocida — está documentado en KNOWN-ISSUES.md.
  it('rechaza un .xls (formato binario viejo)', async () => {
    await expect(spreadsheetToCsvText('catalogo.xls', Buffer.from('cualquier cosa'))).rejects.toThrow(
      UnsupportedSpreadsheetError,
    );
  });

  // Un `.xlsx` con el ZIP dañado es el caso aburrido y frecuente: la planilla
  // se bajó a medias, o la exportó un programa viejo. Tiene que salir como
  // `UnsupportedSpreadsheetError` con un mensaje en castellano —el panel lo
  // muestra tal cual— y nunca como un CSV inventado ni como el
  // `Corrupted zip: ...` crudo de la librería (O14).
  it('el .xlsx corrupto sale como error en castellano, no como CSV', async () => {
    const zipRoto = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);

    await expect(spreadsheetToCsvText('catalogo.xlsx', zipRoto)).rejects.toThrow(
      UnsupportedSpreadsheetError,
    );
    await expect(spreadsheetToCsvText('catalogo.xlsx', zipRoto)).rejects.toThrow(/dañado/);
  });
});
