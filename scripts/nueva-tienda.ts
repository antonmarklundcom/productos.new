import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

// El nombre del template se escribe en un solo lugar y se lee de ahí
// (`marca-centralizada.test.ts` lo verifica en CI). Los **valores** de los
// campos, en cambio, se leen del archivo como texto y no importando el módulo:
// importarlo daría `nombre` ya resuelto, y este script necesita distinguir
// "sigue siendo la constante del template" de "la tienda se llama así".
import { MARCA_PLACEHOLDER } from '../src/config/tienda';
import { BASELINE_FILE, SOLO_TEMPLATE } from './template-shared';

/**
 * `pnpm nueva-tienda` — de "Use this template" a una tienda que corre.
 *
 * El template ya tenía todo automatizado salvo la parte más aburrida y más
 * fácil de arruinar: abrir `tienda.ts` y cambiar seis campos a mano, generar
 * tres secretos con `openssl` (que en Windows no está), copiar `.env.example`,
 * y después acordarse de `template:diff --marcar`. Cuatro archivos y ninguna
 * regla que verifique que quedaron coherentes. Esto lo pregunta una vez y lo
 * escribe.
 *
 * **Idempotente a propósito.** Correrlo dos veces no rompe nada y no regenera
 * ningún secreto que ya exista: `SESSION_SECRET` nuevo = todas las sesiones
 * del panel cerradas, y `CRON_SECRET` nuevo = el cron de Hostinger llamando
 * con la llave vieja hasta que alguien mire. Los valores de hoy se ofrecen
 * como default de cada pregunta, así que la segunda corrida es "Enter, Enter,
 * Enter" salvo lo que quieras cambiar.
 *
 * Con `--dry-run` no escribe nada: imprime lo que haría. Útil para ver el
 * bloque del hPanel sin tocar el repo.
 *
 * Las seis respuestas también se pueden pasar por bandera
 * (`--nombre`, `--titulo`, `--descripcion`, `--tagline`, `--whatsapp`,
 * `--dominio`). Sin terminal interactiva —un pipe, un script, CI— las
 * banderas son el único camino y el script **falla diciéndolo** en vez de
 * salir en silencio: `readline` sobre un stdin cerrado deja la pregunta
 * colgada y Node se va con código 0, que es la peor forma de no hacer nada.
 *
 * Lo que este script **no** hace, a propósito: no toca la base (eso es
 * `db:push` / `db:seed`), no sube nada a ningún lado, y no inventa los datos
 * de terceros (Hostinger, dominio, Pagopar, banco, fotos). Ver NEW-STORE.md.
 */

// ---------------------------------------------------------------------------
// Lo puro: todo lo que se puede probar sin una terminal ni un filesystem
// ---------------------------------------------------------------------------

export type DatosTienda = {
  nombre: string;
  titulo: string;
  descripcion: string;
  tagline: string;
  whatsapp: string;
  dominio: string;
};

/**
 * Los temas del kit de piel (plan-crecimiento §6.2), en el mismo orden que
 * la pregunta interactiva los ofrece. `src/styles/temas/<nombre>.css` tiene
 * que existir para cada uno — `temas.test.ts` es quien lo verifica, no este
 * script.
 */
export const TEMAS = ['neutro', 'calido', 'oscuro-vivo'] as const;
export type Tema = (typeof TEMAS)[number];

/** ¿`valor` es uno de los temas conocidos? Sirve de type guard para `--tema`. */
export function esTema(valor: string): valor is Tema {
  return (TEMAS as readonly string[]).includes(valor);
}

/**
 * El título que se propone cuando el que hay sigue siendo el del template.
 *
 * Es el único de los cuatro campos que lleva la marca adentro
 * (`titulo` arranca como `"<MARCA> — Comprá online en Paraguay"`), así que es
 * el único donde
 * apretar Enter sin mirar deja el nombre del template en el `<title>` de
 * todas las pantallas y en cada link compartido por WhatsApp. Los otros tres
 * son texto genérico y no mienten sobre quién es la tienda.
 */
export function sugerirTitulo(actual: string, nombre: string): string {
  if (nombre.trim() === '') return actual;
  if (actual.trim() === '' || actual.includes(MARCA_PLACEHOLDER)) {
    return `${nombre} — Comprá online en Paraguay`;
  }
  return actual;
}

/** Los campos de `TIENDA` que el wizard escribe. El resto no se toca. */
const CAMPOS_TIENDA = ['nombre', 'titulo', 'descripcion', 'tagline'] as const;
type CampoTienda = (typeof CAMPOS_TIENDA)[number];

/**
 * El valor actual de un campo de `TIENDA` en `src/config/tienda.ts`.
 *
 * Se lee del archivo y no se importa el módulo: importarlo traería el resto
 * del grafo (i18n, dominio) para leer cuatro strings, y sobre todo daría el
 * valor **ya resuelto** — `nombre: MARCA_PLACEHOLDER` volvería como
 * `"TiendaPY"` y el script no podría distinguir "todavía es el template" de
 * "esta tienda se llama TiendaPY".
 */
export function leerCampoTienda(source: string, campo: CampoTienda): string | null {
  const literal = literalTienda(source);
  if (literal === null) return null;

  // El valor puede venir en una línea o partido en varias (prettier corta las
  // descripciones largas), y puede ser una constante en vez de un string.
  const match = new RegExp(`\\n\\s*${campo}:\\s*([\\s\\S]*?),\\n`).exec(literal);
  const crudo = match?.[1]?.trim();
  if (crudo === undefined) return null;
  if (!crudo.startsWith('"') && !crudo.startsWith("'")) return null;

  // Un string partido en varias líneas son varios literales pegados.
  const partes = [...crudo.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)].map(
    (parte) => parte[1] ?? parte[2] ?? '',
  );
  return partes.join('').replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

/** El cuerpo de `export const TIENDA: Tienda = { … }`, o `null`. */
function literalTienda(source: string): string | null {
  const inicio = source.indexOf('export const TIENDA: Tienda = {');
  if (inicio === -1) return null;
  const abre = source.indexOf('{', inicio);

  let nivel = 0;
  for (let i = abre; i < source.length; i += 1) {
    if (source[i] === '{') nivel += 1;
    else if (source[i] === '}') {
      nivel -= 1;
      if (nivel === 0) return source.slice(abre, i + 1);
    }
  }
  return null;
}

/** Escapa un valor para meterlo entre comillas dobles en el .ts. */
function comillas(valor: string): string {
  return `"${valor.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Reescribe los cuatro campos de marca de `src/config/tienda.ts`.
 *
 * Reemplazo quirúrgico sobre el archivo existente y **no** un archivo
 * regenerado desde una plantilla: `tienda.ts` tiene ~120 líneas de comentarios
 * que explican por qué cada flag existe, y una tienda nueva los necesita más
 * que nadie. Regenerarlo sería cambiar seis strings a cambio de perder toda la
 * documentación.
 *
 * `nombre` es el caso especial: en el template dice `MARCA_PLACEHOLDER`, que
 * es una constante y no un string, y `marca-centralizada.test.ts` sólo le
 * permite a este archivo escribir el nombre a mano.
 */
export function reescribirTienda(source: string, datos: DatosTienda): string {
  const literal = literalTienda(source);
  if (literal === null) {
    throw new Error(
      'No encontré `export const TIENDA: Tienda = {` en src/config/tienda.ts. ' +
        '¿Lo reescribiste a mano? Editalo vos y salteá este paso.',
    );
  }

  const valores: Record<CampoTienda, string> = {
    nombre: datos.nombre,
    titulo: datos.titulo,
    descripcion: datos.descripcion,
    tagline: datos.tagline,
  };

  let nuevo = literal;
  for (const campo of CAMPOS_TIENDA) {
    // La sangría se conserva y el valor sale **en una línea**: el original
    // puede tener la descripción partida por prettier, y dejar el `campo:`
    // solo arriba de un string corto sería un archivo que el próximo
    // `prettier --write` vuelve a tocar. Una línea larga tampoco es el
    // formato final —una descripción de 150 caracteres pasa el printWidth—,
    // así que después de escribir se corre prettier sobre el archivo
    // (`formatearTienda`): sin eso, el primer commit de la tienda nueva
    // arranca con lint-staged reformateando un archivo que nadie tocó.
    const regex = new RegExp(`(\\n)([ \\t]*)${campo}:\\s*[\\s\\S]*?,(\\n)`);
    if (!regex.test(nuevo)) {
      throw new Error(`No encontré el campo "${campo}" en TIENDA. Editalo a mano.`);
    }
    nuevo = nuevo.replace(regex, (_todo, nl: string, sangria: string, fin: string) =>
      `${nl}${sangria}${campo}: ${comillas(valores[campo])},${fin}`,
    );
  }

  return source.replace(literal, nuevo);
}

/**
 * Deja `src/config/tienda.ts` como lo dejaría `prettier --write`.
 *
 * El reemplazo de arriba escribe cada campo en una línea, y una descripción
 * de 150 caracteres se pasa del `printWidth`. Sin esta pasada el archivo
 * queda formateado distinto de todo el repo y el primer `git commit` de la
 * tienda nueva lo reformatea solo (husky + lint-staged), que es ruido en el
 * peor momento: el diff inicial deja de ser "cambié la marca".
 *
 * Si prettier no se puede cargar —alguien corre el wizard sin instalar las
 * devDependencies— no es un error: el archivo queda escrito igual y sólo se
 * pierde el formato. Un wizard que se cae después de escribir es peor que uno
 * que deja una línea larga.
 */
async function formatearTienda(archivo: string): Promise<void> {
  try {
    const prettier = await import('prettier');
    const source = readFileSync(archivo, 'utf8');
    const config = await prettier.resolveConfig(archivo);
    const formateado = await prettier.format(source, {
      ...config,
      filepath: archivo,
    });
    if (formateado !== source) writeFileSync(archivo, formateado);
  } catch {
    // Ver el comentario de arriba: formatear es prolijidad, no el trabajo.
  }
}

/** El `@import` de un tema, tal como lo escribe `escribirTema`. */
const IMPORT_TEMA_REGEX = /@import\s+"\.\.\/styles\/temas\/([a-z0-9-]+)\.css";/;

/**
 * El tema que `globals.css` importa hoy, o `'neutro'` si no se puede leer.
 *
 * `'neutro'` como default y no un error a propósito: es el único de los
 * tres que puede faltar sin que nada se rompa (es el que trae el template
 * antes de que esta fase exista), y una tienda que corre el wizard por
 * primera vez sobre un `globals.css` viejo no tiene por qué fallar acá.
 */
export function leerTemaActual(globalsSource: string): Tema {
  const match = IMPORT_TEMA_REGEX.exec(globalsSource);
  const encontrado = match?.[1];
  return encontrado !== undefined && esTema(encontrado) ? encontrado : 'neutro';
}

/**
 * Reescribe la línea `@import ".../temas/<tema>.css";` de `globals.css`.
 *
 * Idempotente: si ya importa `tema`, devuelve `globalsSource` sin tocar
 * (mismo string, para que quien llama pueda comparar por referencia y no
 * escribir un archivo idéntico). Si el archivo no tiene el `@import`
 * esperado —alguien reescribió `globals.css` a mano—, avisa en vez de
 * escribir cualquier cosa, igual que `reescribirTienda`.
 */
export function escribirTema(globalsSource: string, tema: Tema): string {
  if (!esTema(tema)) {
    throw new Error(`"${tema}" no es un tema conocido. Elegí uno de: ${TEMAS.join(', ')}.`);
  }
  if (!IMPORT_TEMA_REGEX.test(globalsSource)) {
    throw new Error(
      'No encontré el `@import ".../styles/temas/<tema>.css";` en src/app/globals.css. ' +
        '¿Lo reescribiste a mano? Cambiá la línea vos y salteá este paso.',
    );
  }
  return globalsSource.replace(IMPORT_TEMA_REGEX, `@import "../styles/temas/${tema}.css";`);
}

/**
 * Un secreto nuevo, con `crypto.randomBytes` y no con `openssl` por
 * `execSync`.
 *
 * `openssl rand -base64 32` es lo que dice NEW-STORE.md desde siempre y
 * funciona… en la máquina de quien lo escribió. En Windows no existe salvo que
 * haya Git Bash en el PATH, y un `execSync` que falla dejaría el `.env.local`
 * escrito con un secreto vacío — que es peor que no escribir nada, porque
 * parece hecho. `randomBytes` viene con Node y es el mismo CSPRNG.
 *
 * 32 bytes en base64 son 44 caracteres, arriba de los 32 que exige
 * iron-session y de los 16 del cron.
 */
export function generarSecreto(bytes = 32): string {
  return randomBytes(bytes).toString('base64');
}

/** Las seis respuestas de marca, más el tema — tal como pueden venir por bandera. */
export type Respuestas = Partial<DatosTienda> & { tema?: string };

/**
 * `--nombre "Lencería Guaraní" --dominio lenceria.com.py --tema calido` → `{ … }`.
 *
 * Sirve para dos cosas distintas: correrlo sin terminal (un script, CI) y
 * repetir exactamente la misma corrida sin volver a tipear los campos.
 * Una bandera desconocida es un error y no algo que se ignora: `--nombr` mal
 * tipeado tiene que doler ahora y no cuando el header diga "TiendaPY".
 *
 * `--tema` no se valida acá contra `TEMAS`: el valor crudo se guarda igual
 * (así el mensaje de error, si el nombre está mal, sale de `escribirTema`,
 * que es quien conoce la lista completa y no la duplica).
 */
export function parseFlags(argv: readonly string[]): Respuestas {
  const conocidas: Record<string, keyof DatosTienda | 'tema'> = {
    '--nombre': 'nombre',
    '--titulo': 'titulo',
    '--descripcion': 'descripcion',
    '--tagline': 'tagline',
    '--whatsapp': 'whatsapp',
    '--dominio': 'dominio',
    '--tema': 'tema',
  };
  const sinValor = new Set(['--dry-run']);

  const salida: Respuestas = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === undefined || sinValor.has(flag)) continue;

    const campo = conocidas[flag];
    if (campo === undefined) throw new Error(`no conozco la opción "${flag}"`);

    const valor = argv[i + 1];
    if (valor === undefined || valor.startsWith('--')) {
      throw new Error(`${flag} espera un valor`);
    }
    salida[campo] = valor;
    i += 1;
  }
  return salida;
}

export type ValoresEnv = Record<string, string>;

/**
 * ¿Este valor cuenta como "todavía no configurado"?
 *
 * La misma regla que `pnpm preflight` usa para rechazar un secreto
 * (`/changeme|generate/i`), y por el mismo motivo: `.env.example` trae
 * `SESSION_SECRET="changeme-generate-with-openssl-rand-base64-32"`, y un
 * wizard que lo tomara por un valor cargado dejaría la tienda con el secreto
 * del ejemplo — que es público, está en el repo, y firma las cookies del
 * panel.
 */
export function esPlaceholder(valor: string): boolean {
  const limpio = valor.trim();
  return limpio === '' || /changeme|generate/i.test(limpio);
}

/**
 * Mete `valores` en el contenido de un `.env`, **sin pisar lo que ya está**.
 *
 * Ésta es la regla que hace idempotente al script: una clave que ya tiene un
 * valor no vacío se deja como está, y sólo se completan las vacías y se
 * agregan las que faltan. Sin eso, la segunda corrida cambiaría los secretos y
 * cerraría todas las sesiones del panel.
 *
 * Devuelve el contenido nuevo y qué claves cambió, para poder decirlo en
 * pantalla en vez de escribir en silencio.
 */
export function completarEnv(
  contenido: string,
  valores: ValoresEnv,
): { contenido: string; escritas: string[]; conservadas: string[] } {
  const escritas: string[] = [];
  const conservadas: string[] = [];
  let salida = contenido;

  for (const [clave, valor] of Object.entries(valores)) {
    if (valor === '') continue;

    // Sólo líneas activas: una `# CLAVE=` comentada es documentación, no un
    // valor, y pisarla dejaría el comentario convertido en configuración.
    const regex = new RegExp(`^(${clave}=)(.*)$`, 'm');
    const match = regex.exec(salida);

    if (match) {
      const actual = (match[2] ?? '').trim().replace(/^["']|["']$/g, '');
      if (!esPlaceholder(actual)) {
        conservadas.push(clave);
        continue;
      }
      salida = salida.replace(regex, `$1${JSON.stringify(valor)}`);
      escritas.push(clave);
      continue;
    }

    if (!salida.endsWith('\n')) salida += '\n';
    salida += `${clave}=${JSON.stringify(valor)}\n`;
    escritas.push(clave);
  }

  return { contenido: salida, escritas, conservadas };
}

/**
 * Escribe `valores` **pisando** lo que haya.
 *
 * Es la otra mitad de `completarEnv`, y la diferencia importa: un secreto no
 * se pisa nunca (regenerarlo cierra las sesiones del panel y deja al cron
 * llamando con la llave vieja), pero el WhatsApp y el dominio son la respuesta
 * que la persona **acaba de dar**. Conservar el valor viejo ahí sería ignorar
 * en silencio lo que acaba de tipear.
 */
export function fijarEnv(
  contenido: string,
  valores: ValoresEnv,
): { contenido: string; escritas: string[] } {
  const escritas: string[] = [];
  let salida = contenido;

  for (const [clave, valor] of Object.entries(valores)) {
    if (valor === '') continue;

    const regex = new RegExp(`^(${clave}=)(.*)$`, 'm');
    const match = regex.exec(salida);
    const actual = (match?.[2] ?? '').trim().replace(/^["']|["']$/g, '');
    if (actual === valor) continue;

    if (match) salida = salida.replace(regex, `$1${JSON.stringify(valor)}`);
    else {
      if (!salida.endsWith('\n')) salida += '\n';
      salida += `${clave}=${JSON.stringify(valor)}\n`;
    }
    escritas.push(clave);
  }

  return { contenido: salida, escritas };
}

/**
 * Lista las variables del hPanel. Los secretos se copian del archivo local.
 *
 * Hostinger las carga de a una, a mano, así que lo que sirve es la lista
 * exacta. Los valores públicos van sin comillas; los secretos se consultan en
 * `.env.local` para que no terminen en logs o artifacts. Se listan sólo las
 * que este script conoce; el resto —Cloudinary, Pagopar, la base— las trae
 * quien tiene esas cuentas, y el script no las va a inventar.
 */
export function bloqueHPanel(valores: ValoresEnv): string {
  return Object.entries(valores)
    .filter(([, valor]) => valor !== '')
    .map(([clave, valor]) => `${clave}=${/(?:SECRET|TOKEN|PASSWORD|(?:API|PUBLIC|PRIVATE)_KEY|DATABASE_URL)/i.test(clave) ? '<copiá el valor de .env.local>' : valor}`)
    .join('\n');
}

/**
 * Las cinco de `.env.example` —las que una tienda necesita en el hosting para
 * arrancar— y el resto. Hostinger precarga un campo por cada variable de
 * `.env.example`, así que el bloque principal tiene que coincidir con esa
 * lista: lo que no está ahí es opcional (docs/ENV-OPCIONAL.md) y se imprime
 * aparte, para que nadie lo tome por obligatorio.
 */
export const IMPRESCINDIBLES_HPANEL = [
  'DATABASE_URL',
  'SESSION_SECRET',
  'NEXT_PUBLIC_SITE_URL',
  'CRON_SECRET',
  'SETUP_SECRET',
] as const;

export function separarHPanel(valores: ValoresEnv): {
  imprescindibles: string[];
  opcionales: string[];
} {
  const esImprescindible = (clave: string): boolean =>
    (IMPRESCINDIBLES_HPANEL as readonly string[]).includes(clave);
  const claves = Object.keys(valores);
  return {
    imprescindibles: claves.filter(esImprescindible),
    opcionales: claves.filter((clave) => !esImprescindible(clave)),
  };
}

/** `tienda.com.py` / `https://tienda.com.py/` → `https://tienda.com.py`. */
export function normalizarDominio(entrada: string): string {
  const limpio = entrada.trim().replace(/\/+$/, '');
  if (limpio === '') return '';
  if (/^https?:\/\//i.test(limpio)) return limpio.replace(/^http:\/\//i, 'https://');
  return `https://${limpio}`;
}

/** `0981123456` / `981123456` → `+595981123456`. Vacío si no se entiende. */
export function normalizarWhatsApp(entrada: string): string {
  const digitos = entrada.trim().replace(/[^\d+]/g, '');
  if (digitos === '') return '';
  if (digitos.startsWith('+595')) return digitos;
  if (digitos.startsWith('595')) return `+${digitos}`;
  if (digitos.startsWith('0')) return `+595${digitos.slice(1)}`;
  return `+595${digitos}`;
}

// ---------------------------------------------------------------------------
// De acá para abajo: preguntas, archivos y git
// ---------------------------------------------------------------------------

const TIENDA_FILE = 'src/config/tienda.ts';
const ENV_FILE = '.env.local';
const ENV_EXAMPLE = '.env.example';
const GLOBALS_FILE = 'src/app/globals.css';

/** Las claves que este script sabe completar. El resto las trae otra persona. */
const CLAVES_GENERADAS = ['SESSION_SECRET', 'CRON_SECRET', 'SETUP_SECRET'] as const;

/**
 * Las seis preguntas de marca más la del tema, con lo que ya está como
 * sugerencia. Enter deja el default; una bandera pisa el default y se
 * muestra como tal.
 */
async function preguntarTodo(
  inicial: DatosTienda,
  temaInicial: Tema,
  flags: Respuestas,
  dryRun: boolean,
): Promise<{ datos: DatosTienda; tema: Tema }> {
  let actuales = inicial;
  console.log('\n  Tienda nueva — siete preguntas y listo.');
  console.log('  Entre paréntesis va lo que hay hoy: Enter lo deja como está.');
  if (dryRun) console.log('  (--dry-run: no se escribe nada)');
  console.log('');

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const preguntar = async (etiqueta: string, campo: keyof DatosTienda): Promise<string> => {
      const actual = flags[campo] ?? actuales[campo];
      const sufijo = actual === '' ? '' : ` (${actual})`;
      const respuesta = (await rl.question(`  ${etiqueta}${sufijo}: `)).trim();
      return respuesta === '' ? actual : respuesta;
    };

    const nombre = await preguntar('Nombre del comercio', 'nombre');
    // El título se sugiere a partir del nombre recién dado si el que hay
    // sigue siendo el del template: si no, Enter deja "TiendaPY" en el
    // `<title>` de todas las pantallas.
    actuales = { ...actuales, titulo: sugerirTitulo(actuales.titulo, nombre) };

    const datos: DatosTienda = {
      nombre,
      titulo: await preguntar('Título del navegador', 'titulo'),
      descripcion: await preguntar('Meta description (150-160)', 'descripcion'),
      tagline: await preguntar('Tagline del pie', 'tagline'),
      whatsapp: await preguntar('WhatsApp del comercio', 'whatsapp'),
      dominio: await preguntar('Dominio final', 'dominio'),
    };

    const temaDefault = flags.tema ?? temaInicial;
    let tema: Tema = esTema(temaDefault) ? temaDefault : temaInicial;
    const respuestaTema = (
      await rl.question(`  Tema (${TEMAS.join(' / ')}) (${tema}): `)
    ).trim();
    if (respuestaTema !== '') {
      if (!esTema(respuestaTema)) {
        console.log(`  "${respuestaTema}" no es un tema conocido — se deja "${tema}".`);
      } else {
        tema = respuestaTema;
      }
    }

    return { datos, tema };
  } finally {
    rl.close();
  }
}

/**
 * Sin terminal interactiva: mandan las banderas, con lo ya escrito de default.
 *
 * Falla si después de eso el nombre sigue vacío. Podría seguir de largo y
 * dejar la marca del template, pero eso es exactamente el error que
 * `pnpm preflight` bloquea después — mejor decirlo acá, con la bandera que
 * falta escrita en el mensaje.
 *
 * El tema **no** hace fallar nada: sin bandera queda el que ya estaba
 * (`neutro` si `globals.css` no importaba ninguno todavía), y una bandera
 * con un nombre que no existe es un error explícito de `escribirTema`.
 */
function sinTerminal(
  actuales: DatosTienda,
  temaActual: Tema,
  flags: Respuestas,
): { datos: DatosTienda; tema: string } {
  const datos: DatosTienda = { ...actuales, ...limpiar(flags) };
  datos.titulo = flags.titulo ?? sugerirTitulo(datos.titulo, datos.nombre);

  if (datos.nombre.trim() === '') {
    throw new Error(
      'No hay terminal interactiva (stdin no es un TTY) y falta el nombre.\n' +
        '  Pasá las respuestas por bandera:\n\n' +
        '    pnpm nueva-tienda --nombre "Lencería Guaraní" \\\n' +
        '      --titulo "Lencería Guaraní — Comprá online en Paraguay" \\\n' +
        '      --descripcion "…" --tagline "…" \\\n' +
        '      --whatsapp 0981123456 --dominio lenceria.com.py --tema neutro',
    );
  }

  return { datos, tema: flags.tema?.trim() || temaActual };
}

/** Una bandera vacía no pisa lo que ya está escrito. */
function limpiar(flags: Respuestas): Respuestas {
  return Object.fromEntries(
    Object.entries(flags).filter(([, valor]) => (valor ?? '').trim() !== ''),
  );
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  if (!existsSync(TIENDA_FILE)) {
    throw new Error(`No encuentro ${TIENDA_FILE}. ¿Estás parado en la raíz del repo?`);
  }

  const tiendaSource = readFileSync(TIENDA_FILE, 'utf8');
  const envActual = existsSync(ENV_FILE)
    ? readFileSync(ENV_FILE, 'utf8')
    : existsSync(ENV_EXAMPLE)
      ? readFileSync(ENV_EXAMPLE, 'utf8')
      : '';

  if (!existsSync(GLOBALS_FILE)) {
    throw new Error(`No encuentro ${GLOBALS_FILE}. ¿Estás parado en la raíz del repo?`);
  }
  const globalsSource = readFileSync(GLOBALS_FILE, 'utf8');

  const flags = parseFlags(process.argv.slice(2));

  // Los defaults salen de lo que ya está escrito: en la primera corrida son
  // los del template, y en la segunda son los de esta tienda — que es lo que
  // hace que repetir el wizard sea "Enter, Enter, Enter". El tema sigue la
  // misma regla: el default es el que `globals.css` ya importa.
  const actuales: DatosTienda = {
    nombre: leerCampoTienda(tiendaSource, 'nombre') ?? '',
    titulo: leerCampoTienda(tiendaSource, 'titulo') ?? '',
    descripcion: leerCampoTienda(tiendaSource, 'descripcion') ?? '',
    tagline: leerCampoTienda(tiendaSource, 'tagline') ?? '',
    whatsapp: leerValorEnv(envActual, 'WHATSAPP_NUMBER'),
    dominio: leerValorEnv(envActual, 'NEXT_PUBLIC_SITE_URL'),
  };
  const temaActual = leerTemaActual(globalsSource);

  const crudos = stdin.isTTY
    ? await preguntarTodo(actuales, temaActual, flags, dryRun)
    : sinTerminal(actuales, temaActual, flags);

  const datos: DatosTienda = {
    ...crudos.datos,
    whatsapp: normalizarWhatsApp(crudos.datos.whatsapp),
    dominio: normalizarDominio(crudos.datos.dominio),
  };

  // --- tienda.ts ----------------------------------------------------------
  const tiendaNueva = reescribirTienda(tiendaSource, datos);
  const tiendaCambia = tiendaNueva !== tiendaSource;

  // --- globals.css (tema) ---------------------------------------------------
  if (!esTema(crudos.tema)) {
    throw new Error(`"${crudos.tema}" no es un tema conocido. Elegí uno de: ${TEMAS.join(', ')}.`);
  }
  const globalsNuevo = escribirTema(globalsSource, crudos.tema);
  const temaCambia = globalsNuevo !== globalsSource;

  // --- .env.local ---------------------------------------------------------
  const generados: ValoresEnv = {};
  for (const clave of CLAVES_GENERADAS) {
    // Sólo se genera lo que falta: ver `completarEnv`. El valor se calcula
    // igual porque `completarEnv` decide, pero uno ya cargado gana.
    generados[clave] = generarSecreto(clave === 'CRON_SECRET' ? 24 : 32);
  }

  const respuestas: ValoresEnv = {
    WHATSAPP_NUMBER: datos.whatsapp,
    NEXT_PUBLIC_SITE_URL: datos.dominio,
  };

  // Primero lo que la persona acaba de contestar (pisa), después los secretos
  // (sólo si faltan). Ver `fijarEnv` y `completarEnv`.
  const fijado = fijarEnv(envActual, respuestas);
  const env = completarEnv(fijado.contenido, generados);
  const aEscribir: ValoresEnv = { ...generados, ...respuestas };
  const escritas = [...fijado.escritas, ...env.escritas];

  // --- Contarlo antes de hacerlo -----------------------------------------
  console.log('');
  console.log(`  ${TIENDA_FILE}: ${tiendaCambia ? 'marca actualizada' : 'sin cambios'}`);
  console.log(
    `  ${ENV_FILE}: ${escritas.length === 0 ? 'sin cambios' : `escribe ${escritas.join(', ')}`}`,
  );
  if (env.conservadas.length > 0) {
    console.log(`     (se conservan los valores ya cargados de ${env.conservadas.join(', ')})`);
  }
  console.log(
    `  ${GLOBALS_FILE}: ${temaCambia ? `tema → ${crudos.tema}` : `sin cambios (tema ${crudos.tema})`}`,
  );
  const aBorrar = soloTemplateABorrar(datos.nombre, existsSync);
  if (aBorrar.length > 0) {
    console.log(`  ${aBorrar.join(', ')}: se borra (es del template, no de la tienda)`);
  }

  if (dryRun) {
    console.log('\n  --dry-run: no se escribió nada.\n');
    imprimirHPanel(env.contenido, aEscribir);
    return;
  }

  if (tiendaCambia) {
    writeFileSync(TIENDA_FILE, tiendaNueva);
    await formatearTienda(TIENDA_FILE);
  }
  writeFileSync(ENV_FILE, env.contenido);
  if (temaCambia) writeFileSync(GLOBALS_FILE, globalsNuevo);
  for (const ruta of aBorrar) rmSync(ruta, { recursive: true, force: true });

  imprimirHPanel(env.contenido, aEscribir);
  marcarBaseline();

  console.log(
    '\n  Falta lo que no depende de este repo (NEW-STORE.md):\n' +
      '    · el favicon (src/app/favicon.ico) — ningún control lo verifica\n' +
      '    · Cloudinary, la base de Hostinger y, si va con tarjeta, Pagopar\n' +
      '      (variables opcionales, documentadas en docs/ENV-OPCIONAL.md)\n' +
      '    · los datos bancarios, que se cargan desde /admin/banco\n\n' +
      '  Y después, la base:\n\n' +
      '    docker compose up -d && pnpm db:push && pnpm db:seed && pnpm create-owner\n' +
      '    pnpm preflight\n',
  );
}

/**
 * Lo de `SOLO_TEMPLATE` (`fable/`, Dependabot) que hay que borrar al volver
 * esto una tienda: los planes del template leídos por una IA en la tienda
 * parecen tareas pendientes, y Dependabot abriría PRs (y minutos de CI) que
 * ya llegan por template:sync. Sólo cuando la tienda tiene nombre propio: con
 * el nombre del template sigue siendo el template, y ahí no se borra nada.
 */
export function soloTemplateABorrar(nombre: string, existe: (ruta: string) => boolean): string[] {
  const limpio = nombre.trim();
  if (limpio === '' || limpio === MARCA_PLACEHOLDER) return [];
  return SOLO_TEMPLATE.map((entrada) => entrada.replace(/\/$/, '')).filter(existe);
}

/** El valor de una clave en un `.env`, o `''`. */
export function leerValorEnv(contenido: string, clave: string): string {
  const match = new RegExp(`^${clave}=(.*)$`, 'm').exec(contenido);
  const crudo = (match?.[1] ?? '').trim();
  const limpio = crudo.replace(/^["']|["']$/g, '');
  return esPlaceholder(limpio) ? '' : limpio;
}

/**
 * El bloque del hPanel se arma con lo que quedó **en el archivo**, no con lo
 * que este script generó: si `SESSION_SECRET` ya estaba, lo que hay que pegar
 * en Hostinger es ése y no uno nuevo que nadie va a usar.
 */
function imprimirHPanel(contenidoEnv: string, claves: ValoresEnv): void {
  const { imprescindibles, opcionales } = separarHPanel(claves);
  const leer = (lista: string[]): ValoresEnv =>
    Object.fromEntries(lista.map((clave) => [clave, leerValorEnv(contenidoEnv, clave)]));

  console.log('\n  Variables para el hPanel de Hostinger. Copiá los secretos de .env.local; no se imprimen en la consola:\n');
  for (const linea of bloqueHPanel(leer(imprescindibles)).split('\n')) console.log(`    ${linea}`);
  console.log('    DATABASE_URL=<la de la base MySQL de Hostinger, DEPLOY.md §2>');
  console.log('    NODE_ENV=production');

  const extra = bloqueHPanel(leer(opcionales));
  if (extra !== '') {
    console.log('\n  Opcionales (docs/ENV-OPCIONAL.md) — sólo si no las cargás desde el panel:\n');
    for (const linea of extra.split('\n')) console.log(`    ${linea}`);
  }
  console.log(
    '\n  Con eso deployado, abrí https://TU-DOMINIO/setup para crear la base\n' +
      '  y la cuenta del dueño (sin terminal). SETUP_SECRET va sólo durante el\n' +
      '  primer deploy y después se borra del hPanel (DEPLOY.md §4). Cambiar una\n' +
      '  variable en Hostinger no rebuildea: hay que apretar Redeploy a mano.\n' +
      '  Nombre, logo, colores, pagos y WhatsApp se cargan después en /admin.\n',
  );
}

/**
 * `pnpm template:diff --marcar`, que es el paso que todo el mundo se saltea.
 *
 * Sin baseline, el primer `template:diff` de esa tienda lista los commits del
 * template enteros y para siempre (NEW-STORE.md). Es la clase de cosa que sólo
 * duele meses después, así que la hace el wizard.
 *
 * No es un error que falle: en el repo del template no hay remoto `template`,
 * y ahí no hay nada que marcar.
 */
function marcarBaseline(): void {
  // Idempotente de verdad: volver a correr el wizard no puede mover un
  // baseline que ya existe. Adelantarlo a la punta del template da por
  // traídos arreglos que la tienda nunca recibió, y ninguno llega después.
  if (existsSync(BASELINE_FILE)) {
    console.log(`  ${BASELINE_FILE} ya existe — no se toca.`);
    return;
  }
  try {
    // `--origen`: el commit del template del que salió la tienda (mismo árbol
    // que su primer commit), no la punta de hoy.
    execFileSync('pnpm', ['template:diff', '--marcar', '--origen'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    console.log(`  ${BASELINE_FILE} escrito — commitealo junto con el resto.`);
  } catch {
    console.log(
      '  (no pude marcar el baseline del template: falta el remoto `template`, o\n' +
        '   el primer commit de este repo no salió del template. Agregá el remoto y\n' +
        '   corré `pnpm template:diff --marcar --origen`; si no encuentra el commit,\n' +
        `   escribí a mano en ${BASELINE_FILE} el SHA del template del que salió.)`,
    );
  }
}

// Igual que el resto de los scripts: los tests importan las funciones puras de
// arriba sin abrir una terminal interactiva.
if (process.argv[1] && /nueva-tienda\.ts$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
