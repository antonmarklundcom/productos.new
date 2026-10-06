import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/**
 * `pnpm setup:doctor` — ¿esta máquina puede correr `pnpm nueva-tienda` ahora mismo?
 *
 * `preflight` revisa si una tienda ya armada puede cobrar plata; esto revisa
 * lo anterior a eso, la laptop de quien va a crear la tienda. Nace de una
 * sesión real: Docker Desktop cerrado, la SSH key de GitHub sin cargar y el
 * Node del sistema por debajo del mínimo, los tres descubiertos uno por uno
 * a mitad del wizard en vez de todos juntos antes de empezar.
 *
 * No toca nada — sólo lee versiones y prueba conexiones. Sale con código 1
 * si algo bloquea, 0 si sólo hay advertencias o todo está bien.
 *
 *   pnpm setup:doctor
 *   pnpm setup:doctor --skip-docker   # sé que acá no hay Docker, no me bloquees
 */

type Severidad = "bloquea" | "advierte" | "ok";
type Check = { title: string; detail: string; severity: Severidad };

function run(cmd: string, args: string[]): string | null {
  try {
    // Windows cannot execFile a .cmd shim. pnpm exposes its actual JS entry.
    const entry = cmd === "pnpm" ? process.env.npm_execpath : undefined;
    const useEntry =
      entry && /pnpm.*\.[cm]?js$/i.test(entry) && existsSync(entry);
    return execFileSync(
      useEntry ? process.execPath : cmd,
      useEntry ? [entry, ...args] : args,
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 10_000,
      }
    ).trim();
  } catch {
    return null;
  }
}

export type Opciones = { skipDocker: boolean };

export function parseArgs(argv: string[]): Opciones {
  const opciones: Opciones = { skipDocker: false };

  for (const flag of argv) {
    if (flag === "--skip-docker") {
      opciones.skipDocker = true;
      continue;
    }
    throw new Error(`no conozco la opción "${flag}"`);
  }

  return opciones;
}

export function checkNode(nodeVersion: string, nvmrc: string | null): Check {
  const major = Number(nodeVersion.replace(/^v/, "").split(".")[0]);
  const esperado = nvmrc?.trim() ?? null;

  if (Number.isNaN(major) || major < 20 || major >= 25) {
    return {
      title: "Node",
      detail: `tenés ${nodeVersion}, el template pide >=20 <25${esperado ? ` (.nvmrc pide ${esperado})` : ""}.`,
      severity: "bloquea",
    };
  }
  return { title: "Node", detail: `${nodeVersion} — ok.`, severity: "ok" };
}

export function checkPnpm(
  pnpmVersion: string | null,
  esperado: string | null
): Check {
  if (!pnpmVersion) {
    return {
      title: "pnpm",
      detail:
        "no encontrado. `corepack enable && corepack prepare pnpm@11 --activate`.",
      severity: "bloquea",
    };
  }
  const major = Number(pnpmVersion.split(".")[0]);
  const esperadoMajor = esperado
    ? Number(esperado.split("@")[1]?.split(".")[0])
    : null;
  if (esperadoMajor && major !== esperadoMajor) {
    return {
      title: "pnpm",
      detail: `tenés ${pnpmVersion}, el repo pinea ${esperado}. \`corepack prepare pnpm@${esperadoMajor} --activate\`.`,
      severity: "advierte",
    };
  }
  return { title: "pnpm", detail: `${pnpmVersion} — ok.`, severity: "ok" };
}

/**
 * ¿Estamos adentro de un contenedor / sesión en la nube?
 *
 * NEW-STORE.md dice, con razón, que el bootstrap se corre en tu máquina: los
 * pasos de base de datos necesitan un daemon de Docker de verdad. Pero en la
 * práctica las tres primeras tiendas se bootstrapearon desde una sesión de
 * Claude Code en la nube, donde no hay daemon y nunca lo va a haber, y ahí el
 * doctor bloqueaba por algo que no tenía arreglo posible en ese entorno.
 *
 * Así que se separan dos cosas que antes eran una: "te falta prender Docker"
 * (bloquea, tiene arreglo) y "acá no hay Docker y no lo va a haber" (advierte,
 * y te dice qué pasos vas a tener que hacer en otro lado).
 */
export function esEntornoSinDocker(
  env: Record<string, string | undefined>,
  hayDockerenv: boolean
): boolean {
  if (hayDockerenv) return true;
  return Boolean(
    env.CODESPACES ||
    env.GITPOD_WORKSPACE_ID ||
    env.REMOTE_CONTAINERS ||
    env.DEVCONTAINER ||
    env.CLAUDE_CODE_REMOTE ||
    env.CI
  );
}

export type ContextoDocker = {
  /** `--skip-docker`: quien corre el comando ya sabe que acá no hay daemon. */
  omitido?: boolean;
  /** Detectado: contenedor, Codespace, CI, sesión en la nube. */
  entornoSinDocker?: boolean;
};

export function checkDocker(
  dockerInfoOk: boolean,
  dockerFound: boolean,
  contexto: ContextoDocker = {}
): Check {
  const NOTA =
    "Los pasos de base local (`docker compose up -d`, `db:push`, `db:seed`) hay que " +
    "correrlos en una máquina con Docker; el resto del bootstrap anda igual acá.";

  if (contexto.omitido) {
    return {
      title: "Docker",
      detail: `salteado con --skip-docker. ${NOTA}`,
      severity: "advierte",
    };
  }
  if (!dockerFound) {
    return contexto.entornoSinDocker
      ? {
          title: "Docker",
          detail: `no hay daemon en este entorno (contenedor / sesión en la nube). ${NOTA}`,
          severity: "advierte",
        }
      : {
          title: "Docker",
          detail:
            "no encontrado. Instalá Docker Desktop — hace falta para la base local.",
          severity: "bloquea",
        };
  }
  if (!dockerInfoOk) {
    return contexto.entornoSinDocker
      ? {
          title: "Docker",
          detail: `el binario está pero el daemon no responde, y en este entorno no va a responder. ${NOTA}`,
          severity: "advierte",
        }
      : {
          title: "Docker",
          detail:
            "instalado pero el daemon no responde. Abrí Docker Desktop y esperá a que arranque.",
          severity: "bloquea",
        };
  }
  return { title: "Docker", detail: "daemon corriendo — ok.", severity: "ok" };
}

export function checkGitRemote(
  nombre: string,
  url: string | null,
  alcanzable: boolean | null
): Check {
  if (!url) {
    return {
      title: `Remoto "${nombre}"`,
      detail:
        nombre === "template"
          ? "no configurado. `git remote add template https://github.com/antonmarklundcom/ecom.git` (NEW-STORE.md §1)."
          : "no configurado.",
      severity: nombre === "template" ? "advierte" : "bloquea",
    };
  }
  if (alcanzable === false) {
    const esSsh = url.startsWith("git@") || url.startsWith("ssh://");
    return {
      title: `Remoto "${nombre}"`,
      detail: esSsh
        ? `${url} configurado pero no responde. ¿Tenés una SSH key cargada en GitHub? Probá con la URL https:// si no.`
        : `${url} configurado pero no responde.`,
      severity: "bloquea",
    };
  }
  return {
    title: `Remoto "${nombre}"`,
    detail: `${url} — alcanzable.`,
    severity: "ok",
  };
}

/* ---------------------------------------------------------------------------
 * ¿Se quedó `main` atrás?
 * ------------------------------------------------------------------------- */

/**
 * Una rama del repo, tal como la ve `git for-each-ref`.
 *
 * `adelante` son los commits que tiene y `main` no (`git rev-list --count
 * main..rama`). Cero = ya está mergeada, no interesa.
 */
export type RamaInfo = {
  nombre: string;
  /** Fecha del commit de la punta, en milisegundos. */
  fechaTip: number;
  adelante: number;
};

/**
 * Un solo feature branch en vuelo es lo normal; el aviso tiene que quedarse
 * callado ahí o nadie lo va a volver a mirar. Estos dos números son el punto
 * medio: dos ramas sin mergear con trabajo más nuevo que `main` ya es un
 * patrón, y una sola con mes y medio encima es trabajo olvidado.
 */
export const DIAS_DERIVA = 14;
export const DIAS_DERIVA_UNA_SOLA = 45;

export type Deriva = {
  ramas: Array<{ nombre: string; dias: number; adelante: number }>;
  /** Días entre la punta de `main` y la punta más nueva sin mergear. */
  diasMax: number;
};

/**
 * ¿`main` se quedó atrás de trabajo real que vive en otras ramas?
 *
 * De una tienda de verdad: `main` tenía un ajuste de CI y nada más, mientras
 * meses de trabajo mergeado en PRs (marca, catálogo, rediseño de la home,
 * preparación del deploy) vivían en ramas que nunca bajaron. Nada lo avisó; se
 * descubrió a mano con `git log` y `merge-base` cuando ya molestaba.
 *
 * El heurístico, a propósito conservador —un falso positivo en un repo sano
 * entrena a ignorar el aviso—:
 *
 *   - sólo cuentan ramas con commits que `main` no tiene (`adelante > 0`);
 *   - y cuya punta es **más nueva** que la de `main` por más de `DIAS_DERIVA`.
 *     Una rama vieja y abandonada no es deriva de `main`, es basura para
 *     borrar; lo que duele es lo nuevo que `main` no vio;
 *   - avisa con dos o más ramas así, o con una sola si pasó de
 *     `DIAS_DERIVA_UNA_SOLA`.
 *
 * Nunca bloquea: es un aviso para mirar, no un problema de la máquina.
 */
export function evaluarDeriva(
  fechaMain: number,
  ramas: RamaInfo[]
): Deriva | null {
  const MS_DIA = 24 * 60 * 60 * 1000;

  const candidatas = ramas
    .filter((rama) => rama.adelante > 0)
    .map((rama) => ({
      nombre: rama.nombre,
      dias: Math.floor((rama.fechaTip - fechaMain) / MS_DIA),
      adelante: rama.adelante,
    }))
    .filter((rama) => rama.dias >= DIAS_DERIVA)
    .sort((x, y) => y.dias - x.dias);

  const peor = candidatas[0];
  if (!peor) return null;
  if (candidatas.length === 1 && peor.dias < DIAS_DERIVA_UNA_SOLA) return null;

  return { ramas: candidatas, diasMax: peor.dias };
}

export function checkMainAlDia(deriva: Deriva | null, hayDatos = true): Check {
  if (!hayDatos) {
    return {
      title: "main al día",
      detail:
        "no pude mirarlo (¿clone shallow, o sin rama main/master?) — saltado.",
      severity: "ok",
    };
  }
  if (!deriva) {
    return {
      title: "main al día",
      detail: "sin ramas con trabajo más nuevo sin mergear — ok.",
      severity: "ok",
    };
  }

  const lista = deriva.ramas
    .slice(0, 5)
    .map(
      (rama) =>
        `${rama.nombre} (+${rama.adelante} commit(s), ${rama.dias} día(s) más nueva)`
    )
    .join(", ");
  const resto =
    deriva.ramas.length > 5 ? `, y ${deriva.ramas.length - 5} más` : "";

  return {
    title: "main al día",
    detail:
      `main parece haberse quedado atrás: ${lista}${resto}. ` +
      "Revisá con `git log --oneline main..<rama>` y mergeá lo que corresponda antes de " +
      "seguir — bootstrapear encima de un main viejo te hace repetir trabajo ya hecho.",
    severity: "advierte",
  };
}

/**
 * Lee las ramas del repo actual.
 *
 * `hayDatos: false` cuando no se pudo mirar —no es un repo git, no hay
 * `main` ni `master`, el clone es shallow—, que no es lo mismo que "está todo
 * al día" y no tiene que reportarse como si lo fuera.
 */
export function leerDeriva(): { hayDatos: boolean; deriva: Deriva | null } {
  const sinDatos = { hayDatos: false, deriva: null };

  const cabeza = ["main", "master"].find(
    (nombre) =>
      run("git", ["rev-parse", "--verify", "--quiet", nombre]) !== null
  );
  if (!cabeza) return sinDatos;

  const fechaMainRaw = run("git", ["log", "-1", "--format=%ct", cabeza]);
  if (!fechaMainRaw) return sinDatos;
  const fechaMain = Number(fechaMainRaw) * 1000;

  // Locales y remotas: la deriva de lenceria vivía en ramas de PR que ni
  // siquiera estaban bajadas localmente.
  const salida = run("git", [
    "for-each-ref",
    "--format=%(refname:short)%09%(committerdate:unix)",
    "refs/heads",
    "refs/remotes/origin",
  ]);
  if (salida === null) return sinDatos;

  // Un `rev-list` por rama, en un repo con cien ramas remotas viejas, son cien
  // procesos para nada: la fecha ya descarta a casi todas y es gratis. Sólo se
  // cuentan commits de las que podrían llegar a avisar.
  const MS_DIA = 24 * 60 * 60 * 1000;
  const corte = fechaMain + DIAS_DERIVA * MS_DIA;

  const ramas: RamaInfo[] = [];
  for (const linea of salida.split("\n")) {
    const [nombre, fecha] = linea.split("\t");
    if (!nombre || !fecha) continue;
    if (
      nombre === cabeza ||
      nombre === `origin/${cabeza}` ||
      nombre === "origin/HEAD"
    )
      continue;

    const fechaTip = Number(fecha) * 1000;
    if (!Number.isFinite(fechaTip) || fechaTip < corte) continue;

    const adelante = run("git", [
      "rev-list",
      "--count",
      `${cabeza}..${nombre}`,
    ]);
    if (adelante === null) continue;

    ramas.push({ nombre, fechaTip, adelante: Number(adelante) });
  }

  return { hayDatos: true, deriva: evaluarDeriva(fechaMain, ramas) };
}

function main(): void {
  let opciones: Opciones;
  try {
    opciones = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`✗ ${(error as Error).message}`);
    console.error("\n  pnpm setup:doctor [--skip-docker]\n");
    process.exitCode = 1;
    return;
  }

  const nvmrc = existsSync(".nvmrc") ? readFileSync(".nvmrc", "utf8") : null;
  const pkg = existsSync("package.json")
    ? (JSON.parse(readFileSync("package.json", "utf8")) as {
        packageManager?: string;
      })
    : {};

  const entornoSinDocker = esEntornoSinDocker(
    process.env,
    existsSync("/.dockerenv")
  );
  const dockerFound = opciones.skipDocker
    ? false
    : run("docker", ["--version"]) !== null;
  const dockerInfoOk = dockerFound && run("docker", ["info"]) !== null;

  const origenUrl = run("git", ["remote", "get-url", "origin"]);
  const origenOk = origenUrl
    ? run("git", ["ls-remote", "--exit-code", "origin"]) !== null
    : null;

  const templateUrl = run("git", ["remote", "get-url", "template"]);
  const templateOk = templateUrl
    ? run("git", ["ls-remote", "--exit-code", "template"]) !== null
    : null;

  const estadoRamas = leerDeriva();

  const checks: Check[] = [
    checkNode(process.version, nvmrc),
    checkPnpm(run("pnpm", ["--version"]), pkg.packageManager ?? null),
    checkDocker(dockerInfoOk, dockerFound, {
      omitido: opciones.skipDocker,
      entornoSinDocker,
    }),
    checkGitRemote("origin", origenUrl, origenOk),
    checkGitRemote("template", templateUrl, templateOk),
    checkMainAlDia(estadoRamas.deriva, estadoRamas.hayDatos),
  ];

  const ICON: Record<Severidad, string> = {
    bloquea: "✗",
    advierte: "!",
    ok: "✓",
  };
  console.log(
    "\nDoctor — ¿esta máquina puede correr `pnpm nueva-tienda` ahora?\n"
  );

  const order: Severidad[] = ["bloquea", "advierte", "ok"];
  for (const severity of order) {
    for (const check of checks.filter((c) => c.severity === severity)) {
      console.log(`  ${ICON[check.severity]} ${check.title}`);
      console.log(`      ${check.detail}`);
    }
  }

  const bloquea = checks.filter((c) => c.severity === "bloquea").length;
  console.log("");
  if (bloquea === 0) {
    console.log(
      "✓ Nada bloquea. Seguí con `pnpm install` y `pnpm nueva-tienda`."
    );
    return;
  }
  console.error(
    `✗ ${bloquea} cosa(s) bloquean. Arreglalas antes de \`pnpm nueva-tienda\`.`
  );
  process.exitCode = 1;
}

if (process.argv[1] && /doctor\.ts$/.test(process.argv[1])) {
  main();
}
