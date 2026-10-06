import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  realpathSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

import {
  BASELINE_FILE,
  contenidoBaseline,
  esSoloTemplate,
} from "./template-shared";

/**
 * `pnpm bootstrap:repo --destino ../lenceria` — meter el template dentro de un
 * repo que **ya existe y ya tiene algo adentro**.
 *
 * NEW-STORE.md §1 supone el camino feliz: "Use this template" en GitHub sobre
 * un repo vacío. En la práctica, las tres tiendas de la primera tanda
 * (productos, lenceria, mascota) ya tenían repo propio, con historia, remoto y
 * contenido, antes de que existiera este template. Para ésas el camino de
 * GitHub no aplica y la copia se hace a mano.
 *
 * Hacerla a mano es peligroso, y no en teoría: un `cp -a ecom/. destino/`
 * —que es lo que sale natural— **copia también el `.git` del template encima
 * del `.git` del destino**. Eso no rompe el build ni falla ruidosamente: deja
 * un repo que apunta al remoto equivocado y con la historia de otro proyecto.
 * Se descubre al hacer `git push`. Por eso este script existe y por eso lo
 * primero que hace la lista de exclusiones es `.git`.
 *
 * Lo que hace, y nada más que esto:
 *
 *   - copia el árbol del template al destino, salteando `.git`, `node_modules`,
 *     `.env*`, builds y otras cosas que no viajan;
 *   - no borra nada en el destino: lo que sobra queda, y se lista al final para
 *     que decidas vos;
 *   - se puede correr de nuevo — no reescribe un archivo cuyo contenido ya es
 *     idéntico, así que la segunda pasada sólo trae lo que cambió;
 *   - no depende de `rsync`, que no está instalado en todos lados (entre otros,
 *     los contenedores de Claude Code en la nube, que es justo donde
 *     terminaron bootstrapeándose las tres tiendas).
 *
 * No toca git en el destino: no commitea, no hace push, no cambia de rama. Deja
 * todo en el working tree para que lo mires con `git diff` antes de commitear.
 */

/** Nombres que nunca se copian, estén donde estén en el árbol. */
export const EXCLUIR_NOMBRE = [
  // El de siempre y el que motiva el script: pisar el .git del destino le
  // cambia la historia y el remoto al repo que estás bootstrapeando.
  ".git",
  "node_modules",
  ".next",
  "out",
  "coverage",
  ".turbo",
  ".vercel",
  ".pnpm-store",
  // Copias de la base: datos reales de clientes y de plata (ver .gitignore).
  "backups",
  ".claude",
  ".DS_Store",
  "Thumbs.db",
] as const;

/**
 * Rutas relativas exactas que no se copian aunque existan en el template.
 *
 * `.template-baseline` es el caso interesante: guarda hasta qué commit del
 * template está al día **esa tienda** (ver `template-diff.ts`). Copiarlo desde
 * acá sería escribirle al destino un "ya estás al día" que no es suyo, y en la
 * segunda corrida le pisaría el que ya se ganó. Lo escribe `pnpm nueva-tienda`
 * en el destino, y ahí tiene sentido.
 */
export const EXCLUIR_RUTA = [".template-baseline"] as const;

/** Todo lo que huele a secreto o a build local se queda en la máquina. */
export function esArchivoDeEntorno(nombre: string): boolean {
  // `.env.example` sí viaja: es la documentación de qué variables existen.
  if (nombre === ".env.example") return false;
  return nombre === ".env" || nombre.startsWith(".env.");
}

/**
 * ¿Esta entrada del árbol del template se saltea?
 *
 * `rutaRelativa` va siempre con `/`, también en Windows: la normaliza quien
 * llama, así los tests no dependen del separador del sistema.
 */
export function debeExcluir(rutaRelativa: string): boolean {
  if (rutaRelativa === "" || rutaRelativa === ".") return false;

  const partes = rutaRelativa.split("/");
  if (
    partes.some((parte) =>
      (EXCLUIR_NOMBRE as readonly string[]).includes(parte)
    )
  )
    return true;
  if ((EXCLUIR_RUTA as readonly string[]).includes(rutaRelativa)) return true;
  // `fable/`, Dependabot: del template, no de la tienda (SOLO_TEMPLATE).
  if (esSoloTemplate(rutaRelativa) || esSoloTemplate(`${rutaRelativa}/`))
    return true;

  const nombre = partes[partes.length - 1] ?? "";
  if (esArchivoDeEntorno(nombre)) return true;
  if (nombre.endsWith(".log") || nombre.endsWith(".tsbuildinfo")) return true;

  return false;
}

export type Opciones = { destino: string; dryRun: boolean; forzar: boolean };

export function parseArgs(argv: string[]): Opciones {
  const opciones: Opciones = { destino: "", dryRun: false, forzar: false };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i] ?? "";

    if (flag === "--dry-run") {
      opciones.dryRun = true;
      continue;
    }
    if (flag === "--forzar") {
      opciones.forzar = true;
      continue;
    }
    if (flag === "--destino") {
      const valor = argv[i + 1];
      if (!valor || valor.startsWith("--"))
        throw new Error(`${flag} espera un valor`);
      opciones.destino = valor;
      i += 1;
      continue;
    }
    // Un path suelto también vale: `pnpm bootstrap:repo ../lenceria`.
    if (!flag.startsWith("--") && opciones.destino === "") {
      opciones.destino = flag;
      continue;
    }

    throw new Error(`no conozco la opción "${flag}"`);
  }

  if (opciones.destino === "")
    throw new Error("falta --destino <carpeta del repo destino>");
  return opciones;
}

/**
 * Los dos caminos que terminarían copiando el template adentro de sí mismo.
 *
 * Es chequeo de paths y nada más —sin tocar disco— para poder testearlo.
 */
export function validarRutas(origen: string, destino: string): string | null {
  const a = resolve(origen);
  const b = resolve(destino);

  if (a === b)
    return "el destino es el propio template: no hay nada que copiar.";
  if ((b + sep).startsWith(a + sep)) {
    return `el destino (${b}) está adentro del template (${a}): copiar ahí se muerde la cola.`;
  }
  if ((a + sep).startsWith(b + sep)) {
    return `el template (${a}) está adentro del destino (${b}): no sé separar uno del otro.`;
  }
  return null;
}

export type Accion = { ruta: string; tipo: "nuevo" | "actualiza" | "igual" };

/** Recorre el template y decide, archivo por archivo, qué le falta al destino. */
export function planificar(origen: string, destino: string): Accion[] {
  const sourcePhysical = realpathSync(origen);
  const targetPhysical = physicalPath(destino);
  const overlap = validarRutas(sourcePhysical, targetPhysical);
  if (overlap) throw new Error(overlap);
  const acciones: Accion[] = [];

  const recorrer = (subruta: string): void => {
    const entradas = readdirSync(join(origen, subruta || "."), {
      withFileTypes: true,
    });

    for (const entrada of entradas.sort((x, y) =>
      x.name.localeCompare(y.name)
    )) {
      const rel = subruta === "" ? entrada.name : `${subruta}/${entrada.name}`;
      if (debeExcluir(rel)) continue;
      // Un symlink copiado con copyFileSync se convierte en su destino, que casi
      // nunca es lo que alguien quiso. El template no tiene ninguno; si algún
      // día aparece, mejor avisar que adivinar.
      if (entrada.isSymbolicLink()) {
        console.warn(`  ! ${rel} es un symlink — no se copia, miralo a mano.`);
        continue;
      }
      if (entrada.isDirectory()) {
        recorrer(rel);
        continue;
      }
      if (!entrada.isFile()) continue;

      const destinoRuta = join(destino, ...rel.split("/"));
      assertSafeDestination(destino, destinoRuta);
      if (!existsSync(destinoRuta)) {
        acciones.push({ ruta: rel, tipo: "nuevo" });
        continue;
      }
      const igual = readFileSync(join(origen, ...rel.split("/"))).equals(
        readFileSync(destinoRuta)
      );
      acciones.push({ ruta: rel, tipo: igual ? "igual" : "actualiza" });
    }
  };

  recorrer("");
  return acciones;
}

function physicalPath(file: string): string {
  if (existsSync(file)) return realpathSync(file);
  return join(physicalPath(dirname(file)), basename(file));
}

export function assertSafeDestination(root: string, file: string): void {
  const expectedRoot = resolve(root);
  const expectedFile = resolve(file);
  if (
    expectedFile !== expectedRoot &&
    !(expectedFile + sep).startsWith(expectedRoot + sep)
  )
    throw new Error("Destination escapes the target repository");
  // Reject junctions/symlinks on the target and on every existing ancestor.
  let cursor = expectedFile;
  for (;;) {
    try {
      if (lstatSync(cursor).isSymbolicLink())
        throw new Error(
          `Destination contains a symlink or junction: ${cursor}`
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const physicalRoot = physicalPath(expectedRoot);
  const physicalFile = physicalPath(expectedFile);
  if (
    physicalFile !== physicalRoot &&
    !(physicalFile + sep).startsWith(physicalRoot + sep)
  )
    throw new Error("Physical destination escapes the target repository");
}

/**
 * Lo que ya estaba en el destino y el template no conoce (primer nivel nomás).
 *
 * No se borra nada: el destino puede tener carpetas suyas que quiere conservar.
 * Se listan para que quien corre esto decida — típicamente el `src/` del sitio
 * viejo, que hay que sacar a mano para que no queden dos apps mezcladas.
 */
export function sobrasDelDestino(origen: string, destino: string): string[] {
  const delTemplate = new Set(
    readdirSync(origen, { withFileTypes: true })
      .map((e) => e.name)
      .filter((nombre) => !debeExcluir(nombre))
  );

  return readdirSync(destino, { withFileTypes: true })
    .map((e) => e.name)
    .filter(
      (nombre) =>
        !delTemplate.has(nombre) && !debeExcluir(nombre) && nombre !== ".git"
    )
    .sort();
}

function gitSucio(destino: string): boolean | null {
  try {
    const salida = execFileSync(
      "git",
      ["-C", destino, "status", "--porcelain"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 15_000,
      }
    );
    return salida.trim() !== "";
  } catch {
    // No es un repo git, o no hay git. Quien llama decide qué hacer con el null.
    return null;
  }
}

/**
 * El baseline de un repo que ya existía es el commit del template que se
 * acaba de copiar — no la punta de `template/main` el día que alguien corra
 * el wizard (que daría por traídos arreglos que no llegaron). Sólo si el
 * template está limpio: con cambios sin commitear, lo copiado no es ningún
 * commit, y un baseline inventado es peor que ninguno.
 */
function marcarBaselineDelOrigen(origen: string, destino: string): void {
  const ruta = join(destino, BASELINE_FILE);
  assertSafeDestination(destino, ruta);
  if (existsSync(ruta)) {
    console.log(`\n  ${BASELINE_FILE} ya existía en el destino — no se toca.`);
    return;
  }
  if (gitSucio(origen) !== false) {
    console.log(
      `\n  ! No escribí ${BASELINE_FILE}: el template tiene cambios sin commitear (o no es un\n` +
        "    repo git), así que lo copiado no es ningún commit. Escribí a mano el SHA del\n" +
        "    template del que copiaste, o volvé a correr esto con el template limpio."
    );
    return;
  }
  const sha = execFileSync("git", ["-C", origen, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  writeFileSync(ruta, contenidoBaseline(sha));
  console.log(
    `\n  ${BASELINE_FILE} → ${sha.slice(0, 12)} (el commit del template que se copió).`
  );
}

function main(): void {
  let opciones: Opciones;
  try {
    opciones = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`✗ ${(error as Error).message}`);
    console.error(
      "\n  pnpm bootstrap:repo --destino ../mi-tienda [--dry-run] [--forzar]\n"
    );
    process.exitCode = 1;
    return;
  }

  const origen = process.cwd();
  const destino = resolve(opciones.destino);
  assertSafeDestination(destino, destino);

  const problema = validarRutas(origen, destino);
  if (problema) {
    console.error(`✗ ${problema}`);
    process.exitCode = 1;
    return;
  }

  if (!existsSync(destino)) {
    if (opciones.dryRun) {
      console.log(`(dry-run) ${destino} no existe todavía — se crearía.`);
    } else {
      mkdirSync(destino, { recursive: true });
    }
  } else if (!statSync(destino).isDirectory()) {
    console.error(`✗ ${destino} existe y no es una carpeta.`);
    process.exitCode = 1;
    return;
  }

  const sucio = existsSync(destino) ? gitSucio(destino) : null;
  if (sucio === true && !opciones.forzar && !opciones.dryRun) {
    console.error(`✗ ${destino} tiene cambios sin commitear.`);
    console.error(
      "      Commiteá o guardá eso primero: con el working tree limpio, todo lo que\n" +
        "      escriba este script se deshace con un `git checkout .`. Si igual querés\n" +
        "      seguir, agregá --forzar."
    );
    process.exitCode = 1;
    return;
  }
  if (sucio === null) {
    console.warn(
      `! ${destino} no parece un repo git.\n` +
        "      Se puede copiar igual, pero no vas a tener con qué deshacerlo.\n"
    );
  }

  console.log(
    `\nTemplate → repo existente\n  de:  ${origen}\n  a:   ${destino}\n`
  );

  const acciones = planificar(origen, destino);
  const nuevos = acciones.filter((a) => a.tipo === "nuevo");
  const actualizados = acciones.filter((a) => a.tipo === "actualiza");
  const iguales = acciones.filter((a) => a.tipo === "igual");

  for (const accion of [...nuevos, ...actualizados])
    console.log(`  ${accion.tipo === "nuevo" ? "+" : "~"} ${accion.ruta}`);
  for (const accion of [...nuevos, ...actualizados]) {
    if (opciones.dryRun) continue;

    const rutaDestino = join(destino, ...accion.ruta.split("/"));
    assertSafeDestination(destino, rutaDestino);
    mkdirSync(dirname(rutaDestino), { recursive: true });
    copyFileSync(join(origen, ...accion.ruta.split("/")), rutaDestino);
  }

  console.log(
    `\n  ${nuevos.length} nuevo(s), ${actualizados.length} actualizado(s), ${iguales.length} ya idéntico(s).`
  );

  if (existsSync(destino)) {
    const sobras = sobrasDelDestino(origen, destino);
    if (sobras.length > 0) {
      console.log(
        "\n  Esto ya estaba en el destino y el template no lo conoce. No se tocó nada:\n" +
          "  revisalo y borrá a mano lo que sea del proyecto viejo.\n"
      );
      for (const sobra of sobras) console.log(`      · ${sobra}`);
    }
  }

  if (opciones.dryRun) {
    console.log(
      "\n(dry-run) No se escribió nada. Sacá --dry-run para copiar de verdad."
    );
    return;
  }

  marcarBaselineDelOrigen(origen, destino);

  console.log(
    "\nSeguí desde NEW-STORE.md §1:\n" +
      `  cd ${opciones.destino}\n` +
      "  git status                 # mirá qué entró antes de commitear\n" +
      "  git remote add template https://github.com/antonmarklundcom/ecom.git\n" +
      "  pnpm install && pnpm setup:doctor && pnpm nueva-tienda\n"
  );
}

if (process.argv[1] && basename(process.argv[1]) === "bootstrap-into-repo.ts") {
  main();
}
