import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  commitDeOrigen,
  gitEn,
  parseBaseline,
} from "../../scripts/template-shared";
import { ejecutarSync } from "../../scripts/template-sync";

/**
 * `pnpm template:sync` contra git de verdad.
 *
 * Arma dos repos temporales sin historia compartida —igual que un template y
 * una tienda hecha con "Use this template"— y cubre las decisiones archivo
 * por archivo: lo que la tienda no tocó llega, la maquinaria que las dos
 * partes cambiaron se fusiona, la piel de la tienda queda, `fable/` nunca
 * viaja, y un conflicto de verdad deja marcadores sin commitear.
 */

const temporales: string[] = [];

function repoTemporal(prefijo: string): string {
  const ruta = mkdtempSync(join(tmpdir(), `${prefijo}-`));
  temporales.push(ruta);
  return ruta;
}

afterEach(() => {
  while (temporales.length > 0) {
    rmSync(temporales.pop() as string, { recursive: true, force: true });
  }
});

function escribir(repo: string, ruta: string, contenido: string): void {
  const completa = join(repo, ...ruta.split("/"));
  mkdirSync(dirname(completa), { recursive: true });
  writeFileSync(completa, contenido);
}

function commit(repo: string, mensaje: string): string {
  gitEn(repo, ["add", "-A"]);
  gitEn(repo, ["-c", "core.editor=true", "commit", "-m", mensaje]);
  return gitEn(repo, ["rev-parse", "HEAD"]).trim();
}

function identidadGit(repo: string): void {
  gitEn(repo, ["init"]);
  gitEn(repo, ["config", "core.autocrlf", "false"]);
  gitEn(repo, ["config", "user.email", "test@example.com"]);
  gitEn(repo, ["config", "user.name", "Test"]);
  gitEn(repo, ["config", "commit.gpgsign", "false"]);
}

const OPCIONES = {
  remoto: "template",
  rama: "main",
  dryRun: false,
  hasta: null,
  sinTests: true,
} as const;

function leer(repo: string, ruta: string): string {
  return readFileSync(join(repo, ...ruta.split("/")), "utf8");
}

function existe(repo: string, ruta: string): boolean {
  return gitEn(repo, ["ls-files", "--", ruta]).trim() !== "";
}

/**
 * Template con historia (C0 → C1…) y una tienda creada desde C0 con
 * customizaciones propias, parada en una rama de feature con el baseline en C0.
 */
function armarEscenario() {
  const template = repoTemporal("template-sync-template");
  identidadGit(template);

  // Tres líneas con un "medio" que nunca cambia: le da al merge de 3 vías el
  // contexto para separar la línea 1 (de la tienda) de la 3 (del template).
  escribir(template, "src/domain/stock.ts", "inicio\nmedio\nfin\n");
  escribir(template, "src/lib/spreadsheet.ts", "export const v = 1;\n");
  escribir(template, "fable/plan.md", "plan v1\n");
  escribir(template, "README.md", "template readme v1\n");
  escribir(template, "src/components/hero.tsx", "hero v1\n");
  escribir(template, "KNOWN-ISSUES.md", "# Known\nuno\n");
  escribir(template, "tests/e2e/helpers.ts", "selector v1\n");
  escribir(
    template,
    "package.json",
    `${JSON.stringify({ name: "ecom", scripts: { dev: "next dev" }, dependencies: { zod: "1" } }, null, 2)}\n`
  );
  const c0 = commit(template, "C0 inicial");
  gitEn(template, ["branch", "-M", "main"]);

  // La tienda: copia de C0 (sin historia compartida, sin fable/) + sus cambios.
  const tienda = repoTemporal("template-sync-tienda");
  identidadGit(tienda);
  escribir(tienda, "src/domain/stock.ts", "inicio-tienda\nmedio\nfin\n");
  escribir(tienda, "README.md", "tienda readme\n");
  escribir(tienda, "src/components/hero.tsx", "hero v1\n");
  escribir(tienda, "KNOWN-ISSUES.md", "# Known\nuno\n");
  escribir(tienda, "tests/e2e/helpers.ts", "selector de la tienda\n");
  escribir(
    tienda,
    "package.json",
    `${JSON.stringify({ name: "mascota", scripts: { dev: "next dev", fotos: "tsx fotos.ts" }, dependencies: { zod: "1" } }, null, 2)}\n`
  );
  // src/lib/spreadsheet.ts no está: la tienda nunca lo trajo.
  writeFileSync(
    join(tienda, ".template-baseline"),
    `# baseline de prueba\n${c0}\n`
  );
  commit(tienda, "C0 tienda");
  gitEn(tienda, ["checkout", "-b", "sync"]);
  gitEn(tienda, ["remote", "add", "template", template]);

  // Lo que cambia el template después de C0.
  escribir(template, "src/domain/stock.ts", "inicio\nmedio\nfin-template\n");
  escribir(template, "src/lib/spreadsheet.ts", "export const v = 2;\n");
  escribir(template, "fable/plan.md", "plan v2\n");
  escribir(template, "README.md", "template readme v2\n");
  escribir(template, "src/components/hero.tsx", "hero v2\n");
  escribir(template, "KNOWN-ISSUES.md", "# Known\nuno, resuelto\n");
  escribir(template, "tests/e2e/helpers.ts", "selector por testid\n");
  escribir(template, "scripts/helper.ts", "export const helper = 1;\n");
  escribir(template, "tiendas.json", "[]\n");
  escribir(
    template,
    "package.json",
    `${JSON.stringify({ name: "ecom", scripts: { dev: "next dev", restore: "tsx restore.ts" }, dependencies: { zod: "1" } }, null, 2)}\n`
  );
  const c1 = commit(template, "C1 maquinaria, piel y docs");

  return { template, tienda, c0, c1 };
}

describe("template:sync contra git de verdad", () => {
  it("trae lo que corresponde archivo por archivo, en un solo commit, y avanza el baseline", () => {
    const { tienda, c1 } = armarEscenario();
    const antes = gitEn(tienda, ["rev-parse", "HEAD"]).trim();

    const resultado = ejecutarSync(tienda, OPCIONES);

    expect(resultado.estado).toBe("completado");
    if (resultado.estado !== "completado") throw new Error("no debería pasar");

    // Maquinaria cambiada de los dos lados: se fusiona (línea 1 de la tienda, línea 3 del template).
    expect(leer(tienda, "src/domain/stock.ts")).toBe(
      "inicio-tienda\nmedio\nfin-template\n"
    );
    // Maquinaria que la tienda no tenía y el template cambió: vuelve.
    expect(leer(tienda, "src/lib/spreadsheet.ts")).toBe(
      "export const v = 2;\n"
    );
    // Nueva en el template: llega.
    expect(leer(tienda, "scripts/helper.ts")).toBe(
      "export const helper = 1;\n"
    );
    // Piel que la tienda no tocó: la del template.
    expect(leer(tienda, "src/components/hero.tsx")).toBe("hero v2\n");
    // Piel que la tienda cambió: la suya.
    expect(leer(tienda, "README.md")).toBe("tienda readme\n");
    // Doc del template: el del template.
    expect(leer(tienda, "KNOWN-ISSUES.md")).toBe("# Known\nuno, resuelto\n");
    // Test adaptado por la tienda y cambiado en el template: gana el del template.
    expect(leer(tienda, "tests/e2e/helpers.ts")).toBe("selector por testid\n");
    // package.json por clave: el script de la tienda y el del template, los dos.
    expect(JSON.parse(leer(tienda, "package.json"))).toEqual({
      name: "mascota",
      scripts: {
        dev: "next dev",
        restore: "tsx restore.ts",
        fotos: "tsx fotos.ts",
      },
      dependencies: { zod: "1" },
    });
    // Sólo del template: nunca viajan.
    expect(existe(tienda, "fable/plan.md")).toBe(false);
    expect(existe(tienda, "tiendas.json")).toBe(false);

    expect(resultado.resumen).toMatchObject({
      restaurados: ["src/lib/spreadsheet.ts"],
      fusionados: ["package.json", "src/domain/stock.ts"],
      reemplazados: ["tests/e2e/helpers.ts"],
      conservados: ["README.md"],
      conflictos: [],
    });

    // Un solo commit, con el baseline adentro y el tree limpio.
    expect(
      gitEn(tienda, ["rev-list", "--count", `${antes}..HEAD`]).trim()
    ).toBe("1");
    expect(gitEn(tienda, ["log", "-1", "--format=%s"])).toContain(
      "Sincronizar maquinaria del template"
    );
    expect(parseBaseline(leer(tienda, ".template-baseline"))).toBe(c1);
    expect(gitEn(tienda, ["status", "--porcelain"]).trim()).toBe("");

    // Y la segunda corrida no tiene nada que hacer.
    expect(ejecutarSync(tienda, OPCIONES).estado).toBe("sin-cambios");
  });

  it("maquinaria que le falta a la tienda vuelve aunque el template no la haya tocado desde el baseline", () => {
    // El agujero por el que productos perdió 15 archivos: un baseline marcado
    // "al día" con maquinaria de menos. Como el template no volvía a cambiar
    // esos archivos, el diff baseline..objetivo nunca los mostraba.
    const { template, tienda } = armarEscenario();
    expect(ejecutarSync(tienda, OPCIONES).estado).toBe("completado");

    gitEn(tienda, ["rm", "-q", "src/lib/spreadsheet.ts"]);
    commit(tienda, "Se perdió en un sync viejo");

    // Sin nada nuevo en el template: igual hay algo que hacer.
    const sinNovedades = ejecutarSync(tienda, OPCIONES);
    expect(sinNovedades.estado).toBe("completado");
    if (sinNovedades.estado !== "completado")
      throw new Error("no debería pasar");
    expect(sinNovedades.resumen.restaurados).toEqual([
      "src/lib/spreadsheet.ts",
    ]);
    expect(leer(tienda, "src/lib/spreadsheet.ts")).toBe(
      "export const v = 2;\n"
    );

    // Con novedades que no lo tocan: también vuelve, junto con lo nuevo.
    gitEn(tienda, ["rm", "-q", "src/lib/spreadsheet.ts"]);
    commit(tienda, "Se perdió otra vez");
    escribir(template, "src/domain/otro.ts", "export const otro = 1;\n");
    commit(template, "C2 maquinaria que no toca spreadsheet");

    const conNovedades = ejecutarSync(tienda, OPCIONES);
    if (conNovedades.estado !== "completado")
      throw new Error(`estado ${conNovedades.estado}`);
    expect(conNovedades.resumen.restaurados).toEqual([
      "src/lib/spreadsheet.ts",
    ]);
    expect(existe(tienda, "src/domain/otro.ts")).toBe(true);

    // La piel que la tienda no tiene no se toca: eso sí puede ser una decisión.
    gitEn(tienda, ["rm", "-q", "src/components/hero.tsx"]);
    commit(tienda, "Sin hero");
    expect(ejecutarSync(tienda, OPCIONES).estado).toBe("sin-cambios");
    expect(existe(tienda, "src/components/hero.tsx")).toBe(false);
  });

  it("trae los commits de un PR mergeado y el baseline queda en el merge", () => {
    const { template, tienda } = armarEscenario();
    gitEn(template, ["checkout", "-b", "arreglo"]);
    escribir(template, "src/domain/otro.ts", "export const otro = 1;\n");
    commit(template, "Arreglo de maquinaria del PR");
    gitEn(template, ["checkout", "main"]);
    gitEn(template, [
      "merge",
      "--no-ff",
      "arreglo",
      "-m",
      "Merge pull request de maquinaria",
    ]);
    const merge = gitEn(template, ["rev-parse", "HEAD"]).trim();

    const resultado = ejecutarSync(tienda, OPCIONES);

    expect(resultado.estado).toBe("completado");
    expect(leer(tienda, "src/domain/otro.ts")).toBe("export const otro = 1;\n");
    expect(parseBaseline(leer(tienda, ".template-baseline"))).toBe(merge);
    expect(gitEn(tienda, ["log", "--merges", "--format=%H"]).trim()).toBe("");
    expect(gitEn(tienda, ["log", "-1", "--format=%B"])).toContain(
      "Arreglo de maquinaria del PR"
    );
  });

  it("un choque de verdad en la maquinaria deja marcadores sin commitear, con el resto aplicado", () => {
    const { template, tienda, c1 } = armarEscenario();
    // El template ahora también cambia la línea 1, la misma que la tienda.
    escribir(
      template,
      "src/domain/stock.ts",
      "inicio-template\nmedio\nfin-template\n"
    );
    commit(template, "C2 maquinaria: stock cambia línea 1");
    const antes = gitEn(tienda, ["rev-parse", "HEAD"]).trim();

    const resultado = ejecutarSync(tienda, OPCIONES);

    expect(resultado.estado).toBe("conflicto");
    if (resultado.estado !== "conflicto") throw new Error("no debería pasar");
    expect(resultado.commiteado).toBe(false);
    expect(resultado.resumen.conflictos.map((c) => c.ruta)).toEqual([
      "src/domain/stock.ts",
    ]);
    expect(leer(tienda, "src/domain/stock.ts")).toContain("<<<<<<<");
    expect(leer(tienda, "scripts/helper.ts")).toBe(
      "export const helper = 1;\n"
    );

    // Nada commiteado, pero el baseline nuevo ya está escrito para el commit a mano.
    expect(gitEn(tienda, ["rev-parse", "HEAD"]).trim()).toBe(antes);
    expect(parseBaseline(leer(tienda, ".template-baseline"))).not.toBe(c1);

    // Una segunda corrida con el conflicto a medio resolver no pisa nada.
    const segunda = ejecutarSync(tienda, OPCIONES);
    expect(segunda.estado).toBe("precondicion");
    if (segunda.estado !== "precondicion") throw new Error("no debería pasar");
    expect(segunda.mensaje).toContain("git commit");

    // Resuelto y commiteado a mano, ya no queda nada pendiente.
    escribir(
      tienda,
      "src/domain/stock.ts",
      "inicio-resuelto\nmedio\nfin-template\n"
    );
    commit(tienda, "Sincronizar maquinaria del template");
    expect(ejecutarSync(tienda, OPCIONES).estado).toBe("sin-cambios");
  });

  it("con --commitear-conflictos, el choque queda commiteado (para el PR en draft de distribuir.yml)", () => {
    const { template, tienda } = armarEscenario();
    escribir(
      template,
      "src/domain/stock.ts",
      "inicio-template\nmedio\nfin-template\n"
    );
    commit(template, "C2 maquinaria: stock cambia línea 1");

    const resultado = ejecutarSync(tienda, {
      ...OPCIONES,
      commitearConflictos: true,
    });

    expect(resultado.estado).toBe("conflicto");
    if (resultado.estado !== "conflicto") throw new Error("no debería pasar");
    expect(resultado.commiteado).toBe(true);
    expect(gitEn(tienda, ["status", "--porcelain"]).trim()).toBe("");
    expect(gitEn(tienda, ["log", "-1", "--format=%B"])).toContain(
      "src/domain/stock.ts"
    );
    expect(gitEn(tienda, ["show", "HEAD:src/domain/stock.ts"])).toContain(
      "<<<<<<<"
    );
  });

  it("--dry-run no toca nada y lista la decisión de cada archivo", () => {
    const { tienda } = armarEscenario();
    const antes = gitEn(tienda, ["rev-parse", "HEAD"]).trim();

    const resultado = ejecutarSync(tienda, { ...OPCIONES, dryRun: true });

    expect(resultado.estado).toBe("dry-run");
    if (resultado.estado !== "dry-run") throw new Error("no debería pasar");
    expect(resultado.plan).toContainEqual({
      ruta: "src/lib/spreadsheet.ts",
      accion: "restaurar",
    });
    expect(resultado.plan).toContainEqual({
      ruta: "fable/plan.md",
      accion: "ignorar",
    });
    expect(gitEn(tienda, ["rev-parse", "HEAD"]).trim()).toBe(antes);
    expect(gitEn(tienda, ["status", "--porcelain"]).trim()).toBe("");
  });

  it("una tienda vieja que heredó fable/ lo pierde en el commit de la sincronización", () => {
    const { tienda } = armarEscenario();
    escribir(tienda, "fable/viejo.md", "plan heredado\n");
    commit(tienda, "Tienda vieja con fable/");

    expect(ejecutarSync(tienda, OPCIONES).estado).toBe("completado");
    expect(existe(tienda, "fable/viejo.md")).toBe(false);
  });

  it("una ruta con tildes llega igual (git las cita si no se le pide -z)", () => {
    const { template, tienda } = armarEscenario();
    escribir(template, "src/app/categoría/page.tsx", "categoria v1\n");
    commit(template, "C2 ruta con tilde");

    expect(ejecutarSync(tienda, OPCIONES).estado).toBe("completado");
    expect(leer(tienda, "src/app/categoría/page.tsx")).toBe("categoria v1\n");
  });

  it("la piel que la tienda rediseñó y el template renombró se avisa aparte", () => {
    const { template, tienda } = armarEscenario();
    escribir(tienda, "src/components/site-header.tsx", "header de la tienda\n");
    commit(tienda, "Header propio");
    // El template lo suma y la tienda se pone al día hasta ahí.
    escribir(template, "src/components/site-header.tsx", "header v1\n");
    const conHeader = commit(template, "C2 header");
    writeFileSync(
      join(tienda, ".template-baseline"),
      `# baseline\n${conHeader}\n`
    );
    commit(tienda, "Baseline con header");

    rmSync(join(template, "src", "components", "site-header.tsx"));
    escribir(template, "src/components/header/site-header.tsx", "header v1\n");
    commit(template, "C3 header movido");

    const resultado = ejecutarSync(tienda, OPCIONES);
    expect(resultado.estado).toBe("completado");
    if (resultado.estado !== "completado") throw new Error("no debería pasar");

    // El rediseño se queda donde estaba, y el PR lo dice: nada lo importa ya.
    expect(leer(tienda, "src/components/site-header.tsx")).toBe(
      "header de la tienda\n"
    );
    expect(resultado.resumen.huerfanos).toEqual([
      "src/components/site-header.tsx",
    ]);
    expect(resultado.resumen.conservados).not.toContain(
      "src/components/site-header.tsx"
    );
  });

  it("el baseline de origen es el commit del template con el árbol del primer commit de la tienda", () => {
    const template = repoTemporal("origen-template");
    identidadGit(template);
    escribir(template, "a.txt", "uno\n");
    commit(template, "T0");
    gitEn(template, ["branch", "-M", "main"]);
    escribir(template, "b.txt", "dos\n");
    const t1 = commit(template, "T1");
    escribir(template, "c.txt", "tres\n");
    commit(template, "T2 (después de crear la tienda)");

    // "Use this template" en T1: un commit inicial propio con el árbol de T1.
    const tienda = repoTemporal("origen-tienda");
    identidadGit(tienda);
    escribir(tienda, "a.txt", "uno\n");
    escribir(tienda, "b.txt", "dos\n");
    commit(tienda, "Initial commit");
    escribir(tienda, "a.txt", "uno, de la tienda\n");
    commit(tienda, "Piel propia");
    gitEn(tienda, ["remote", "add", "template", template]);
    gitEn(tienda, ["fetch", "-q", "template", "main"]);

    // No la punta (T2): T2 todavía no llegó a esta tienda.
    expect(commitDeOrigen(tienda, "template/main")).toBe(t1);
  });

  it("parada en main, no hace nada", () => {
    const { tienda } = armarEscenario();
    gitEn(tienda, ["checkout", "-B", "main"]);

    const resultado = ejecutarSync(tienda, OPCIONES);
    expect(resultado.estado).toBe("precondicion");
  });
});
