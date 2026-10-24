import {readFile} from "node:fs/promises";
import {expect,it} from "vitest";
import {publicCatalogs} from "../../src/i18n/public-catalogs";
it("every literal catalogue filter message is shipped in the storefront-only catalog",async()=>{
 const source=await readFile("src/components/catalog-filters.tsx","utf8");
 const keys=[...source.matchAll(/\bt\(\s*["']([\w.]+)["']/g)].map(match=>match[1]!);
 expect(keys).toContain("filtros.todasCategorias");
 for(const key of keys)expect(publicCatalogs["es-PY"]?.[key],`missing public filter message ${key}`).toBeDefined();
 expect(source).not.toContain('t("panel.');
});
