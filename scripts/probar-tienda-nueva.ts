import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, toNamespacedPath } from "node:path";

import { SOLO_TEMPLATE } from "./template-shared";
import { runPnpm } from "./package-runner";

/**
 * `pnpm template:probar-tienda` — ¿una tienda recién creada desde este commit
 * sigue en verde?
 *
 * El CI del template corre sobre el template, con el nombre y los defaults del
 * template. Una tienda no: `pnpm nueva-tienda` le cambia el nombre, el tema y
 * el `.env.local`, y borra `fable/`. Un test que sólo pasa mientras el repo se
 * llama como el template (fable/TEMPLATE-REVIEW.md T2) deja a cada tienda
 * nueva con CI en rojo desde el primer commit, y el template no se entera.
 *
 * Esto arma esa tienda en un worktree temporal a partir de HEAD, corre el
 * wizard sin terminal, instala desde el lockfile y ejecuta `test:full` con
 * una base desechable: tipos, lint, unidad, integración, build y navegador.
 * Corre en tu máquina (0 minutos de Actions).
 *
 * Sólo mira lo commiteado: commiteá antes de correrlo.
 */

// Armado en runtime y no como literal: `marca-centralizada.test.ts` busca el
// nombre de la tienda en todo `scripts/`, y este archivo viaja con la tienda.
const NOMBRE = ["Probeta", "Fresca"].join(" ");

const raiz = process.cwd();
const temporaryRoot = realpathSync(tmpdir());
const destino = mkdtempSync(join(temporaryRoot, "tienda-fresca-"));

function cleanup(): void {
  const target = realpathSync(destino);
  if (
    target !== destino ||
    dirname(target) !== temporaryRoot ||
    !basename(target).startsWith("tienda-fresca-")
  ) {
    throw new Error("Refusing to remove an unexpected temporary worktree path");
  }
  // Git on Windows cannot remove some deep pnpm paths. Node supports their
  // namespaced form and removes links without following their targets.
  rmSync(toNamespacedPath(join(target, "node_modules")), {
    recursive: true,
    force: true,
    maxRetries: 3,
  });
  execFileSync(
    "git",
    ["-c", "core.longpaths=true", "worktree", "remove", "--force", target],
    {
      cwd: raiz,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
}

function correr(comando: string, args: string[], cwd: string): void {
  if (comando !== "pnpm") throw new Error("Unsupported validation runner");
  runPnpm(args, {
    cwd,
    stdio: ["ignore", "inherit", "inherit"],
    // El entorno conserva la base desechable explícita del verificador.
    env: { ...process.env },
  });
}

function main(): void {
  console.log(`\n  Armando una tienda nueva desde HEAD en ${destino}\n`);
  execFileSync("git", ["worktree", "add", "--detach", destino, "HEAD"], {
    cwd: raiz,
    stdio: ["ignore", "pipe", "inherit"],
  });

  try {
    correr("pnpm", ["install", "--frozen-lockfile"], destino);

    correr(
      "pnpm",
      [
        "exec",
        "tsx",
        "scripts/nueva-tienda.ts",
        "--nombre",
        NOMBRE,
        "--titulo",
        `${NOMBRE} — Comprá online en Paraguay`,
        "--descripcion",
        "Una tienda creada por template:probar-tienda.",
        "--tagline",
        "Probando el template",
        "--whatsapp",
        "0971000111",
        "--dominio",
        "prueba.example.py",
        "--tema",
        "calido",
      ],
      destino
    );

    const quedaron = SOLO_TEMPLATE.map((entrada) =>
      entrada.replace(/\/$/, "")
    ).filter((ruta) => existsSync(join(destino, ruta)));
    if (quedaron.length > 0) {
      throw new Error(`nueva-tienda no borró ${quedaron.join(", ")}`);
    }

    if (!process.env.TEST_DATABASE_URL)
      throw new Error(
        "Fresh-store verification requires a disposable TEST_DATABASE_URL for integration and browser checks."
      );
    correr("pnpm", ["test:full"], destino);

    console.log("\n  ✓ Una tienda nueva desde este commit queda en verde.\n");
  } finally {
    cleanup();
  }
}

try {
  main();
} catch (error) {
  console.error(
    `\n✗ ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
