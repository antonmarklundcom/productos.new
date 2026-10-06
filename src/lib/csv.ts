/**
 * CSV para abrir en Excel o Google Sheets.
 *
 * Dos decisiones que parecen detalles y no lo son:
 *
 * - **Separador `;`.** El Excel en español usa el punto y coma como separador
 *   de lista. Con comas, el dueño abre el archivo y ve todo apelmazado en una
 *   sola columna, que en la práctica es un export roto. Google Sheets detecta
 *   el separador solo.
 * - **BOM al principio.** Sin él, Excel lee el archivo como Latin-1 y
 *   "Corpiño" sale "CorpiÃ±o".
 *
 * Los montos van como enteros pelados, sin `₲` ni separador de miles: así la
 * planilla los suma. Formatearlos es tarea de quien mira, no del archivo.
 */

/**
 * Techo de filas de cualquier export.
 *
 * El CSV se arma entero en memoria del servidor antes de bajar, y el slot de
 * Hostinger no tiene margen para juntar 80.000 pedidos ahí adentro. Con este
 * techo, quien necesite más filtra por fecha y baja dos archivos — y la
 * pantalla avisa cuando el corte pasó, en vez de entregar un archivo
 * incompleto que parece completo.
 */
export const EXPORT_MAX_ROWS = 5000;

export const CSV_SEPARATOR = ";";
export const CSV_BOM = "﻿";

export type CsvValue = string | number | null | undefined;

/**
 * Escapa una celda.
 *
 * Se entrecomilla cuando hay separador, comillas o saltos de línea, y las
 * comillas de adentro se duplican, que es lo que dice el RFC 4180. Un `=` o un
 * `+` al principio también fuerzan comillas: sin eso, un nombre de cliente que
 * arranque con `=` lo interpreta Excel como fórmula.
 */
function escapeCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  const needsQuotes =
    text.includes(CSV_SEPARATOR) ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r") ||
    /^[=+\-@]/.test(text);
  if (!needsQuotes) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Filas + encabezado a un CSV completo, listo para descargar. */
export function toCsv(headers: readonly string[], rows: ReadonlyArray<readonly CsvValue[]>): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCell).join(CSV_SEPARATOR));
  // CRLF: es lo que pide el RFC y lo que espera Excel en Windows.
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}

/**
 * La otra mitad: leer un CSV que alguien editó en Excel o Google Sheets.
 *
 * Lo usa `pnpm importar:productos` (scripts/importar-productos.ts). Acepta lo
 * que esas planillas realmente exportan, que no siempre es lo que exportamos
 * nosotros:
 *
 * - **Separador `;` o `,`.** El nuestro sale con `;`, pero Google Sheets
 *   descarga con `,` según la configuración regional de la cuenta. Se decide
 *   mirando la primera fila (fuera de comillas): gana el que más aparece.
 * - **BOM, CRLF y saltos dentro de comillas** — RFC 4180, igual que `toCsv`.
 * - Las comillas dobladas (`""`) vuelven a ser una comilla.
 *
 * Devuelve filas de celdas crudas, sin interpretar: los tipos y los errores
 * con número de línea son problema de quien llama (src/domain/catalog-import).
 * Las filas completamente vacías se descartan — Excel deja varias al final.
 */
export function parseCsv(text: string): string[][] {
  const input = text.startsWith(CSV_BOM) ? text.slice(CSV_BOM.length) : text;
  const separator = detectSeparator(input);

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"' && cell === "") {
      inQuotes = true;
    } else if (ch === separator) {
      pushCell();
    } else if (ch === "\n") {
      pushRow();
    } else if (ch === "\r") {
      // CRLF: el \n que sigue cierra la fila; un \r suelto no dice nada.
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) pushRow();

  return rows;
}

/** `;` o `,`: el que más veces aparezca fuera de comillas en la primera fila. */
function detectSeparator(input: string): ";" | "," {
  let semicolons = 0;
  let commas = 0;
  let inQuotes = false;

  for (const ch of input) {
    if (ch === '"') inQuotes = !inQuotes;
    if (inQuotes) continue;
    if (ch === "\n") break;
    if (ch === ";") semicolons += 1;
    if (ch === ",") commas += 1;
  }

  return commas > semicolons ? "," : ";";
}

/**
 * `csvFilename("pedidos", new Date())` → `"pedidos-2026-08-07.csv"`.
 *
 * La fecha va en el nombre porque estos archivos terminan todos juntos en la
 * carpeta de descargas, y "pedidos (3).csv" no le dice nada a nadie.
 */
export function csvFilename(prefix: string, day: string): string {
  return `${prefix}-${day}.csv`;
}
