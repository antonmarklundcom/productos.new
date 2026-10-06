import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Lee un archivo sin sus comentarios.
 *
 * Los tests que grepean el código buscan lo que el código **hace**; un
 * comentario que documenta la regla ("nunca COUNT(*)") no puede hacerlos
 * fallar, y borrar el comentario para que pasen sería el peor incentivo.
 */
export async function readCode(relativePath: string): Promise<string> {
  const content = await readFile(path.join(process.cwd(), relativePath), 'utf8');
  return stripComments(content);
}

/**
 * Los caracteres después de los cuales una `/` abre una expresión regular y no
 * es una división.
 *
 * `x / 2` divide; `(/x/)`, `= /x/`, `[/x/]`, `, /x/` abren un literal. La regla
 * de JavaScript de verdad es más larga, pero el error de este lado es barato:
 * confundir una división con una regex sólo puede pasar en `a / b / c`, que
 * este repo no tiene, y aun así el peor caso es dejar de más un pedazo de
 * código, no borrarlo.
 */
const ANTES_DE_REGEX = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>',
]);

/** `return /x/`, `typeof /x/`: acá la `/` tampoco divide. */
const PALABRAS_ANTES_DE_REGEX = /\b(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/;

/**
 * Saca los comentarios **sin** tocar lo que hay adentro de un string ni de una
 * expresión regular.
 *
 * Escanea de a un carácter en vez de usar dos regex, y no es prolijidad: en
 * `src/proxy.ts` hay una URL de medidores que dice
 * `https://*.google-analytics.com`. Para una regex, ese `/*` abre un comentario
 * — y el primer `*​/` que aparezca más abajo lo cierra, borrando de un saque
 * todas las directivas del CSP que hay en el medio.
 *
 * Las expresiones regulares del código hay que saltearlas por la misma razón,
 * al revés: `scripts/nueva-tienda.ts` tiene una regex que contiene comillas
 * (`/"((?:[^"\\]|\\.)*)"|'…'/g`). Un escáner que sólo entienda strings toma
 * esa comilla como apertura y **se desincroniza de ahí hasta el final del
 * archivo**: los comentarios que vengan después dejan de reconocerse como
 * comentarios y el código que sí importa deja de verse como código.
 *
 * Lo grave, en los dos casos, es para qué lado falla. Un test que exige que
 * algo **esté** se cae ruidosamente y alguien lo mira. Pero
 * `expect(csp).not.toContain('unsafe-inline')` pasa feliz cuando el CSP entero
 * desapareció: el test queda en verde justamente porque ya no está mirando
 * nada.
 */
export function stripComments(source: string): string {
  let salida = '';
  let i = 0;
  /** El último carácter de código que se emitió, para distinguir `/` de `/`. */
  let anterior = '';

  const emitir = (texto: string): void => {
    salida += texto;
    const limpio = texto.trimEnd();
    if (limpio !== '') anterior = limpio[limpio.length - 1] as string;
  };

  while (i < source.length) {
    const dos = source.slice(i, i + 2);

    if (dos === '//') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }

    if (dos === '/*') {
      i += 2;
      while (i < source.length && source.slice(i, i + 2) !== '*/') i += 1;
      i += 2;
      continue;
    }

    const char = source[i]!;

    // Un string se copia entero, comillas incluidas: adentro no hay comentarios.
    if (char === '"' || char === "'" || char === '`') {
      let literal = char;
      i += 1;
      while (i < source.length && source[i] !== char) {
        // Una barra invertida se lleva puesto al carácter que sigue, así que
        // `"\""` no termina el string.
        if (source[i] === '\\') {
          literal += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        literal += source[i];
        i += 1;
      }
      literal += source[i] ?? '';
      i += 1;
      emitir(literal);
      continue;
    }

    // Una expresión regular: se copia entera igual que un string, para que ni
    // sus comillas ni sus barras confundan al escáner.
    if (char === '/' && empiezaRegex(anterior, salida)) {
      let literal = '/';
      i += 1;
      let enClase = false;
      while (i < source.length) {
        const actual = source[i]!;
        if (actual === '\\') {
          literal += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        // Adentro de `[...]` una `/` no cierra nada.
        if (actual === '[') enClase = true;
        else if (actual === ']') enClase = false;
        else if (actual === '/' && !enClase) break;
        // Una regex no cruza el salto de línea: si llegamos acá era división.
        else if (actual === '\n') break;
        literal += actual;
        i += 1;
      }
      if (source[i] === '/') {
        literal += '/';
        i += 1;
        while (i < source.length && /[a-z]/.test(source[i]!)) {
          literal += source[i];
          i += 1;
        }
      }
      emitir(literal);
      continue;
    }

    emitir(char);
    i += 1;
  }

  return salida;
}

function empiezaRegex(anterior: string, emitido: string): boolean {
  if (anterior === '') return true;
  if (PALABRAS_ANTES_DE_REGEX.test(emitido.trimEnd())) return true;
  return ANTES_DE_REGEX.has(anterior);
}

export async function listSourceFiles(roots: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  for (const root of roots) {
    for await (const file of walk(path.join(process.cwd(), root))) {
      files.push(path.relative(process.cwd(), file));
    }
  }
  return files.sort();
}

/**
 * Encuentra la llave que abre el cuerpo de una función, saltándose los
 * parámetros y el tipo de retorno.
 *
 * Tomar la primera `{` que aparece no sirve: en
 * `): Promise<AdminActionResult<{ productId: number }>> {` esa llave es la del
 * tipo genérico, y el cuerpo extraído queda vacío — o sea, una función sin lo
 * que el test busca "pasa" con el cuerpo de otro. Los tres tests que extraen
 * cuerpos (`admin-guards`, `atribucion`, `flags-apagados`) usan esta única
 * implementación a propósito: la versión ingenua ya dejó pasar tres acciones
 * sin revisar una vez.
 *
 * @param from índice justo después del `(` que abre los parámetros.
 */
export function findBodyStart(code: string, from: number): number {
  let parens = 1;
  let index = from;
  while (index < code.length && parens > 0) {
    if (code[index] === '(') parens += 1;
    else if (code[index] === ')') parens -= 1;
    index += 1;
  }

  // Ya pasamos los parámetros: ahora el tipo de retorno. La `{` del cuerpo es
  // la primera que aparece fuera de todo `<...>`.
  let angles = 0;
  for (; index < code.length; index += 1) {
    const char = code[index];
    if (char === '<') angles += 1;
    else if (char === '>') angles = Math.max(0, angles - 1);
    else if (char === '{' && angles === 0) return index;
  }
  return -1;
}

/**
 * Extrae nombre y cuerpo de cada `export async function` del módulo.
 *
 * Cuenta llaves para encontrar el cierre en vez de usar una regex sobre todo
 * el archivo: si no, una función sin guard "pasa" porque la de al lado sí lo
 * tiene.
 */
export function exportedAsyncFunctions(code: string): Array<{ name: string; body: string }> {
  const functions: Array<{ name: string; body: string }> = [];
  const signature = /export\s+async\s+function\s+(\w+)\s*\(/g;

  let match: RegExpExecArray | null;
  while ((match = signature.exec(code)) !== null) {
    const name = match[1];
    if (!name) continue;

    const bodyStart = findBodyStart(code, signature.lastIndex);
    if (bodyStart === -1) continue;

    let depth = 0;
    let end = bodyStart;
    for (let i = bodyStart; i < code.length; i += 1) {
      if (code[i] === '{') depth += 1;
      else if (code[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    functions.push({ name, body: code.slice(bodyStart, end + 1) });
  }
  return functions;
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      yield full;
    }
  }
}
