import path from "node:path";
import ts from "typescript";

import { describe, expect, it } from "vitest";

import { TIENDA } from "../../src/config/tienda";
import { listSourceFiles, readCode } from "../helpers/source";

/**
 * Guardarraíl del template (NEW-STORE.md): el nombre de la tienda se escribe
 * **una sola vez**, en `src/config/tienda.ts`.
 *
 * Sin esto, cada tienda nueva vuelve a ser una cacería del nombre viejo por
 * componentes, metadatos y títulos del panel — que es exactamente el trabajo
 * que este repo existe para no repetir. Si el test falla, la solución no es
 * agregar una excepción: es leer el nombre de `TIENDA`.
 */
const ROOTS = ["src", "scripts"];
const CONFIG_MODULE = path.join("src", "config", "tienda.ts");

// A brand can also be a common catalog noun. Detect literal brand copy,
// not identifiers, route names or lower-case Spanish prose. These six
// translation keys mean the generic product collection, not the merchant.
const GENERIC_KEYS = new Set([
  "catalogo.tituloOculto",
  "panel.nav.productos",
  "panel.productos.meta",
  "panel.productos.titulo",
  "panel.producto.volver",
  "panel.productoNuevo.volver",
]);
function writesBrand(code: string, brand: string): boolean {
  const source = ts.createSourceFile(
    "source.tsx",
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let found = false;
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[^\\p{L}])${escaped}($|[^\\p{L}])`, "u");
  function visit(node: ts.Node) {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isJsxText(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const parent = node.parent;
      const generic =
        ts.isPropertyAssignment(parent) &&
        ts.isStringLiteral(parent.name) &&
        GENERIC_KEYS.has(parent.name.text);
      if (!generic && pattern.test(node.text)) found = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

describe("la marca vive sólo en src/config/tienda.ts", () => {
  it("ningún otro módulo escribe el nombre de la tienda a mano", async () => {
    const offenders: string[] = [];

    for (const file of await listSourceFiles(ROOTS)) {
      if (file === CONFIG_MODULE) continue;
      const code = await readCode(file);
      if (writesBrand(code, TIENDA.nombre)) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });
  it("detects hardcoded titles, JSX and template brand copy without confusing routes or generic labels", () => {
    const brand = TIENDA.nombre;
    expect(writesBrand(`const title = "${brand} — Inicio";`, brand)).toBe(true);
    expect(writesBrand(`<h1>${brand}</h1>`, brand)).toBe(true);
    expect(writesBrand("const title = `" + brand + " ${suffix}`;", brand)).toBe(
      true
    );
    expect(
      writesBrand(
        'const route = "/admin/productos"; const importarProductos = 1;',
        brand
      )
    ).toBe(false);
    expect(
      writesBrand(
        `const labels = { "panel.nav.productos": "${brand}" };`,
        brand
      )
    ).toBe(false);
  });
});
