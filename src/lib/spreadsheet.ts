import ExcelJS from "exceljs";

/**
 * El puente entre "el comercio manda un `.xlsx`" y `parseCatalogo`, que sólo
 * entiende texto CSV.
 *
 * No se reimplementa el parseo de la planilla: se convierte la primera hoja
 * del Excel a CSV (mismo separador `;` que ya entiende `parseCsv`) y de ahí en
 * más es exactamente el mismo camino que un `.csv` subido a mano.
 */
export class UnsupportedSpreadsheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedSpreadsheetError";
  }
}

const EXTENSIONES_TEXTO = new Set(["csv", "txt"]);
const EXTENSIONES_EXCEL = new Set(["xlsx"]);

function celdaATexto(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";

  if (value instanceof Date) return value.toISOString();

  if (typeof value === "object") {
    // Fórmula: usamos el resultado ya calculado, no la fórmula en sí.
    if ("result" in value) return celdaATexto(value.result as ExcelJS.CellValue);
    // Texto enriquecido (`richText`): se concatena el texto plano.
    if ("richText" in value) {
      return (value.richText as { text: string }[]).map((parte) => parte.text).join("");
    }
    // Hipervínculo: el texto visible, no la URL.
    if ("text" in value) return String((value as { text: unknown }).text);
    return String(value);
  }

  return String(value);
}

function campoCsv(texto: string): string {
  if (texto.includes(";") || texto.includes("\n") || texto.includes("\r") || texto.includes('"')) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

function sheetToCsv(sheet: ExcelJS.Worksheet): string {
  const columnas = sheet.actualColumnCount || sheet.columnCount;
  const filas: string[] = [];

  sheet.eachRow({ includeEmpty: true }, (row) => {
    const celdas: string[] = [];
    for (let col = 1; col <= columnas; col += 1) {
      celdas.push(campoCsv(celdaATexto(row.getCell(col).value)));
    }
    filas.push(celdas.join(";"));
  });

  return filas.join("\n");
}

export async function spreadsheetToCsvText(filename: string, bytes: Buffer): Promise<string> {
  const extension = filename.toLowerCase().split(".").pop() ?? "";

  if (EXTENSIONES_TEXTO.has(extension)) {
    return bytes.toString("utf8");
  }

  if (EXTENSIONES_EXCEL.has(extension)) {
    const workbook = new ExcelJS.Workbook();
    // `exceljs` tipa `load()` con un `Buffer` local a su propio `.d.ts` (no el
    // `Buffer` global de Node), incompatible con la definición de ArrayBuffer
    // de TS moderno: en runtime acepta un `Buffer` de Node sin problema
    // (termina en `JSZip.loadAsync`), sólo el tipado está mal.
    try {
      await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    } catch {
      // Un `.xlsx` es un ZIP, y un ZIP dañado hace tirar a la librería un
      // `Corrupted zip: ...` en inglés que subía tal cual hasta la pantalla
      // del panel como "error inesperado". El caso real es aburrido y
      // frecuente: la planilla se bajó a medias de Drive, o la exportó un
      // programa viejo. Lo único que el staff necesita saber es que el
      // archivo está roto y que hay que exportarlo de nuevo.
      throw new UnsupportedSpreadsheetError(
        "No pude abrir el archivo Excel: parece estar dañado. Abrilo y exportalo de nuevo como .xlsx, o guardalo como .csv.",
      );
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new UnsupportedSpreadsheetError("El archivo Excel no tiene ninguna hoja con datos.");
    }
    return sheetToCsv(sheet);
  }

  throw new UnsupportedSpreadsheetError(
    `Formato ".${extension || filename}" no soportado. Subí un archivo .csv o .xlsx.`,
  );
}
