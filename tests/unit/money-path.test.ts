import path from "node:path";

import { describe, expect, it } from "vitest";

import { ivaBreakdown, ivaIncluded } from "../../src/lib/money";
import { listSourceFiles, readCode } from "../helpers/source";

/**
 * Auditoría del dinero (PLAN.md 4.10).
 *
 * Tres cosas que tienen que seguir siendo ciertas cuando el código crezca:
 * ninguna columna de plata es float o decimal, el IVA se redondea por línea, y
 * nadie mete un `toFixed`/`parseFloat` en el camino del dinero.
 */

describe("cero float / decimal en las columnas de dinero", () => {
  it("el schema declara todo `*_pyg` como BIGINT UNSIGNED", async () => {
    const schema = await readCode(path.join("src", "db", "schema.ts"));

    // El helper `pyg()` es el único constructor de columnas de plata.
    expect(schema).toMatch(
      /bigint\(name,\s*\{\s*mode:\s*['"]number['"],\s*unsigned:\s*true\s*,?\s*\}\)/
    );

    // Cualquier `algo_pyg: <lo que sea>` que no salga de pyg() es sospechoso.
    const declarations = [...schema.matchAll(/(\w*[Pp]yg)\s*:\s*(\w+)\s*\(/g)];
    expect(declarations.length).toBeGreaterThan(0);

    const offenders = declarations
      .filter(([, , builder]) => builder !== "pyg")
      .map(([full]) => full);
    expect(offenders).toEqual([]);
  });

  it("las migraciones no crean ninguna columna de plata como FLOAT/DOUBLE/DECIMAL", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const dir = path.join(process.cwd(), "drizzle");
    const files = (await readdir(dir)).filter((file) => file.endsWith(".sql"));
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const sql = await readFile(path.join(dir, file), "utf8");
      for (const line of sql.split("\n")) {
        if (!/_pyg`?\s/i.test(line)) continue;
        if (/\b(float|double|decimal|numeric|real)\b/i.test(line)) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("ningún módulo del camino del dinero usa float, toFixed o parseFloat", async () => {
    // `src/domain` es todo el camino del dinero; de `src/lib` interesan los
    // módulos que lo tocan. Se listan por directorio porque `listSourceFiles`
    // camina carpetas, no archivos sueltos.
    const MONEY_FILES = (
      await listSourceFiles([path.join("src", "domain")])
    ).concat(
      path.join("src", "lib", "money.ts"),
      path.join("src", "lib", "schemas.ts")
    );

    const offenders: string[] = [];
    for (const file of MONEY_FILES) {
      const code = await readCode(file);
      // `toFixed(2)` es el reflejo automático de cualquiera que venga de
      // trabajar con centavos, y en guaraníes produce totales que no cierran
      // (ARCH.md §4: Pagopar además rechaza el hash de "150000.00").
      if (/\.toFixed\s*\(/.test(code)) offenders.push(`${file}: toFixed`);
      if (/parseFloat\s*\(/.test(code)) offenders.push(`${file}: parseFloat`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("el IVA se redondea por línea, nunca sobre el total", () => {
  /**
   * El caso que separa las dos implementaciones. Tres líneas de ₲ 33.333 al
   * 10%:
   *   - por línea: round(33333 × 10/110) = 3030 cada una → 9090
   *   - sobre el total: round(99999 × 10/110) = 9091
   * Un guaraní de diferencia, todos los días, contra la factura.
   */
  it("sumar el IVA de cada línea no da lo mismo que calcularlo sobre el total", () => {
    const lines = [
      { lineTotalPyg: 33333, ivaRate: 10 },
      { lineTotalPyg: 33333, ivaRate: 10 },
      { lineTotalPyg: 33333, ivaRate: 10 },
    ];

    const perLine = ivaBreakdown(lines).iva10Pyg;
    const onTotal = ivaIncluded(
      lines.reduce((sum, line) => sum + line.lineTotalPyg, 0),
      10
    );

    expect(perLine).toBe(9090);
    expect(onTotal).toBe(9091);
    // Si algún día esto empieza a fallar, alguien movió el redondeo al total.
    expect(perLine).not.toBe(onTotal);
  });

  it("mezcla de tasas: cada línea va a su balde", () => {
    const breakdown = ivaBreakdown([
      { lineTotalPyg: 110000, ivaRate: 10 },
      { lineTotalPyg: 105000, ivaRate: 5 },
      { lineTotalPyg: 50000, ivaRate: 0 },
    ]);

    expect(breakdown).toEqual({ iva10Pyg: 10000, iva5Pyg: 5000 });
  });

  it("todos los resultados son enteros", () => {
    for (const total of [1, 7, 99, 33333, 1234567, 999999999]) {
      for (const rate of [10, 5, 0]) {
        expect(Number.isInteger(ivaIncluded(total, rate))).toBe(true);
      }
    }
  });

  it("`createOrder` calcula el IVA con ivaIncluded/ivaBreakdown y no a mano", async () => {
    const createOrder = await readCode(
      path.join("src", "domain", "create-order.ts")
    );
    const cart = await readCode(path.join("src", "domain", "cart.ts"));

    expect(`${createOrder}${cart}`).toMatch(/iva(Included|Breakdown)\s*\(/);
    // Nada de `* 0.1` ni `/ 1.1`: la tasa entra como entero y la división la
    // hace ivaIncluded.
    expect(createOrder).not.toMatch(/[*/]\s*1?\.\d/);
    expect(cart).not.toMatch(/[*/]\s*1?\.\d/);
  });
});
