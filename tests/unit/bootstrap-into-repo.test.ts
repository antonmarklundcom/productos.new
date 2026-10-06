import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  debeExcluir,
  assertSafeDestination,
  esArchivoDeEntorno,
  parseArgs,
  planificar,
  sobrasDelDestino,
  validarRutas,
} from "../../scripts/bootstrap-into-repo";

/**
 * `pnpm bootstrap:repo` (NEW-STORE.md §1b) — meter el template en un repo que
 * ya existe.
 *
 * Lo que se fija acá es lo que hace daño de verdad si falla en silencio:
 * copiar el `.git` del template encima del `.git` del destino (le cambia la
 * historia y el remoto al repo ajeno), o copiar el template adentro de sí
 * mismo. Lo demás —el orden en que se imprime, los textos— se lee a ojo.
 */

const temporales: string[] = [];

function carpetaTemporal(): string {
  const ruta = mkdtempSync(join(tmpdir(), "bootstrap-test-"));
  temporales.push(ruta);
  return ruta;
}

function escribir(base: string, ruta: string, contenido: string): void {
  const completa = join(base, ...ruta.split("/"));
  mkdirSync(join(completa, ".."), { recursive: true });
  writeFileSync(completa, contenido);
}

afterEach(() => {
  while (temporales.length > 0) {
    rmSync(temporales.pop() as string, { recursive: true, force: true });
  }
});

describe("parseArgs", () => {
  it("acepta el destino con bandera o suelto", () => {
    expect(parseArgs(["--destino", "../lenceria"])).toEqual({
      destino: "../lenceria",
      dryRun: false,
      forzar: false,
    });
    expect(parseArgs(["../lenceria"]).destino).toBe("../lenceria");
  });

  it("--dry-run y --forzar son flags sueltos", () => {
    expect(parseArgs(["../x", "--dry-run", "--forzar"])).toEqual({
      destino: "../x",
      dryRun: true,
      forzar: true,
    });
  });

  it("sin destino no arranca", () => {
    // El default silencioso acá sería copiar a algún lado que nadie pidió.
    expect(() => parseArgs([])).toThrow(/falta --destino/);
    expect(() => parseArgs(["--dry-run"])).toThrow(/falta --destino/);
  });

  it("una opción desconocida o sin valor no se ignora", () => {
    expect(() => parseArgs(["--destino"])).toThrow(/espera un valor/);
    expect(() => parseArgs(["--destino", "--dry-run"])).toThrow(
      /espera un valor/
    );
    expect(() => parseArgs(["--dstino", "x"])).toThrow(/no conozco/);
  });
});

describe("destination boundaries", () => {
  it("rejects an existing junction before planning writes and preserves the external sentinel", () => {
    const source = carpetaTemporal();
    const target = carpetaTemporal();
    const external = carpetaTemporal();
    escribir(source, "src/sentinel.txt", "replacement");
    escribir(external, "sentinel.txt", "external original");
    symlinkSync(
      external,
      join(target, "src"),
      process.platform === "win32" ? "junction" : "dir"
    );
    expect(() => planificar(source, target)).toThrow(/symlink|junction/);
    expect(readFileSync(join(external, "sentinel.txt"), "utf8")).toBe(
      "external original"
    );
    expect(() =>
      assertSafeDestination(target, join(external, "sentinel.txt"))
    ).toThrow(/escapes/);
  });
});

describe("debeExcluir", () => {
  it("nunca copia .git — ni el de arriba ni uno anidado", () => {
    // El accidente que motiva todo el script: pisar el .git del destino le
    // cambia el remoto y la historia al repo que estás bootstrapeando.
    expect(debeExcluir(".git")).toBe(true);
    expect(debeExcluir(".git/config")).toBe(true);
    expect(debeExcluir(".git/refs/heads/main")).toBe(true);
    expect(debeExcluir("sub/.git/config")).toBe(true);
  });

  it("saltea builds, dependencias y copias de la base", () => {
    for (const ruta of [
      "node_modules/react/index.js",
      ".next/BUILD_ID",
      "coverage/lcov.info",
      "backups/2026-08-01.sql",
      ".claude/settings.json",
      "algo.log",
      "tsconfig.tsbuildinfo",
    ]) {
      expect(debeExcluir(ruta), ruta).toBe(true);
    }
  });

  it("saltea secretos pero copia .env.example", () => {
    expect(debeExcluir(".env")).toBe(true);
    expect(debeExcluir(".env.local")).toBe(true);
    expect(debeExcluir(".env.production")).toBe(true);
    expect(debeExcluir(".env.example")).toBe(false);
    expect(esArchivoDeEntorno(".env.example")).toBe(false);
  });

  it("no copia .template-baseline: el del destino es suyo", () => {
    // Es el "hasta acá estoy al día" de esa tienda (template-diff.ts). Traerlo
    // desde el template sería mentirle, y en la segunda corrida pisarle el que
    // ya se ganó.
    expect(debeExcluir(".template-baseline")).toBe(true);
  });

  it("no copia lo que sólo es del template: fable/ y Dependabot", () => {
    // SOLO_TEMPLATE (template-shared.ts): los planes del template y los PRs de
    // dependencias no son de la tienda.
    for (const ruta of [
      "fable",
      "fable/plan.md",
      "fable/prompts/o1.md",
      ".github/dependabot.yml",
    ]) {
      expect(debeExcluir(ruta), ruta).toBe(true);
    }
    expect(debeExcluir("src/fable.ts")).toBe(false);
  });

  it("copia lo que sí es el template", () => {
    for (const ruta of [
      "package.json",
      "src/domain/orders.ts",
      "src/app/globals.css",
      ".github/workflows/ci.yml",
      "drizzle/0000_init.sql",
      "public/placeholders/ropa.svg",
    ]) {
      expect(debeExcluir(ruta), ruta).toBe(false);
    }
  });
});

describe("validarRutas", () => {
  it("se niega a copiarse encima de sí mismo", () => {
    expect(validarRutas("/repos/ecom", "/repos/ecom")).toMatch(
      /propio template/
    );
  });

  it("se niega si uno está adentro del otro, en cualquier dirección", () => {
    expect(validarRutas("/repos/ecom", "/repos/ecom/tiendas/lenceria")).toMatch(
      /adentro del template/
    );
    expect(validarRutas("/repos/ecom/plantilla", "/repos/ecom")).toMatch(
      /adentro del destino/
    );
  });

  it("deja pasar dos carpetas hermanas", () => {
    expect(validarRutas("/repos/ecom", "/repos/lenceria")).toBeNull();
    // Prefijo compartido pero no anidado: `ecom` vs `ecom-viejo`.
    expect(validarRutas("/repos/ecom", "/repos/ecom-viejo")).toBeNull();
  });
});

describe("planificar", () => {
  it("separa nuevo, distinto e idéntico, y saltea lo excluido", () => {
    const origen = carpetaTemporal();
    const destino = carpetaTemporal();

    escribir(origen, "package.json", '{"name":"ecom"}');
    escribir(origen, "src/domain/orders.ts", "export const a = 1;");
    escribir(origen, "README.md", "template");
    escribir(origen, ".git/config", '[remote "origin"] url = template');
    escribir(origen, ".env.local", "SESSION_SECRET=del-template");
    escribir(origen, "node_modules/x/index.js", "nope");

    escribir(destino, "README.md", "template"); // idéntico
    escribir(destino, "package.json", '{"name":"lenceria"}'); // distinto
    escribir(destino, ".git/config", '[remote "origin"] url = lenceria');
    escribir(destino, ".env.local", "SESSION_SECRET=de-la-tienda");

    const acciones = planificar(origen, destino);
    const porRuta = Object.fromEntries(acciones.map((a) => [a.ruta, a.tipo]));

    expect(porRuta).toEqual({
      "README.md": "igual",
      "package.json": "actualiza",
      "src/domain/orders.ts": "nuevo",
    });
    // Lo importante en negativo: el .git y el .env del destino ni se miran.
    expect(acciones.some((a) => a.ruta.startsWith(".git/"))).toBe(false);
    expect(acciones.some((a) => a.ruta.startsWith(".env"))).toBe(false);
  });

  it("correrlo de nuevo sobre un destino ya copiado no propone nada", () => {
    const origen = carpetaTemporal();
    const destino = carpetaTemporal();
    escribir(origen, "a.txt", "uno");
    escribir(origen, "sub/b.txt", "dos");
    escribir(destino, "a.txt", "uno");
    escribir(destino, "sub/b.txt", "dos");

    expect(planificar(origen, destino).every((a) => a.tipo === "igual")).toBe(
      true
    );
  });

  it("un symlink se avisa y no se copia", () => {
    const origen = carpetaTemporal();
    const destino = carpetaTemporal();
    escribir(origen, "real/contenido.txt", "contenido");
    symlinkSync(
      join(origen, "real"),
      join(origen, "alias"),
      process.platform === "win32" ? "junction" : "dir"
    );

    expect(planificar(origen, destino).map((a) => a.ruta)).toEqual([
      "real/contenido.txt",
    ]);
  });
});

describe("sobrasDelDestino", () => {
  it("lista lo del proyecto viejo sin contar .git ni lo excluido", () => {
    const origen = carpetaTemporal();
    const destino = carpetaTemporal();
    escribir(origen, "package.json", "{}");
    escribir(destino, "package.json", "{}");
    escribir(destino, "wp-config.php", "<?php");
    mkdirSync(join(destino, "wp-content"));
    escribir(destino, ".git/config", "x");
    escribir(destino, ".env.local", "x");
    mkdirSync(join(destino, "node_modules"));

    expect(sobrasDelDestino(origen, destino)).toEqual([
      "wp-config.php",
      "wp-content",
    ]);
  });
});
