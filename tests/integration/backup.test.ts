import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { BACKUP_TABLES } from "@/db/schema";
import { orders, payments, products, variants } from "@/db/schema";
import {
  PAGE_SIZE,
  PRIMARY_KEY,
  backupPublicId,
  dumpRows,
} from "@/domain/backup";

import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import {
  createOrder,
  createProduct,
  createVariant,
} from "../helpers/factories";

/**
 * El dump de la base (O8, plan-operacion §5.4 A).
 *
 * Lo que se fija acá es que el backup **contenga todo**: una tabla que queda
 * afuera no se nota hasta el día que hay que restaurar, y ese día es
 * exactamente el peor para descubrirlo.
 */

async function volcar(): Promise<
  Array<{ table: string; row: Record<string, unknown> }>
> {
  const filas: Array<{ table: string; row: Record<string, unknown> }> = [];
  for await (const fila of dumpRows(getTestDb())) filas.push(fila);
  return filas;
}

describe("la lista de tablas del backup", () => {
  it("cubre todas las tablas declaradas en el schema", async () => {
    // Lista explícita y no `SHOW TABLES`: una tabla nueva que nadie decidió
    // incluir tiene que hacer fallar **este** test, no entrar sola al backup
    // ni —peor— quedar afuera en silencio.
    const codigo = await (
      await import("node:fs/promises")
    ).readFile("src/db/schema.ts", "utf8");
    const declaradas = [
      ...codigo.matchAll(/mysqlTable\(\s*['"]([a-z_]+)['"]/g),
    ].map((m) => m[1]!);

    expect(declaradas.length).toBeGreaterThan(20);
    for (const tabla of declaradas) {
      expect(BACKUP_TABLES, `falta ${tabla} en BACKUP_TABLES`).toContain(tabla);
    }
  });

  it("no tiene tablas que ya no existen", async () => {
    const codigo = await (
      await import("node:fs/promises")
    ).readFile("src/db/schema.ts", "utf8");
    const declaradas = new Set(
      [...codigo.matchAll(/mysqlTable\(\s*['"]([a-z_]+)['"]/g)].map(
        (m) => m[1]!
      )
    );

    for (const tabla of BACKUP_TABLES) {
      expect(declaradas, `${tabla} ya no está en el schema`).toContain(tabla);
    }
  });

  it("cada tabla dice cómo se pagina", () => {
    // `null` = "es chica, se trae entera", y esa decisión tiene que ser
    // explícita para cada tabla.
    for (const tabla of BACKUP_TABLES) {
      expect(Object.keys(PRIMARY_KEY)).toContain(tabla);
    }
  });
});

describe.skipIf(!hasTestDb)("dumpRows", () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it("una base recién reseteada sólo trae el contador", async () => {
    // `resetTables` deja la fila de `counters` en 0 —es la que acuña los
    // números de pedido—, así que "vacía" nunca es literalmente vacía.
    const filas = await volcar();
    expect(filas.map((fila) => fila.table)).toEqual(["counters"]);
  });

  it("vuelca las filas que hay, con todas sus columnas", async () => {
    const productId = await createProduct();
    await createVariant({ onHand: 5, productId });
    await createOrder({ status: "pagado", totalPyg: 150_000 });

    const filas = await volcar();
    const pedidos = filas.filter((fila) => fila.table === "orders");

    expect(pedidos).toHaveLength(1);
    // Columnas completas, no un subconjunto elegido a dedo: un backup al que
    // le falta una columna es un backup que no restaura.
    expect(Object.keys(pedidos[0]!.row)).toContain("access_token");
    expect(Object.keys(pedidos[0]!.row)).toContain("total_pyg");
    expect(Object.keys(pedidos[0]!.row)).toContain("tracking_code");
  });

  it("las tablas salen en orden de dependencia", async () => {
    // Restaurar en este orden nunca choca contra una FK.
    const productId = await createProduct();
    await createVariant({ onHand: 1, productId });

    const orden = [...new Set((await volcar()).map((fila) => fila.table))];
    expect(orden.indexOf("categories")).toBeLessThan(orden.indexOf("products"));
    expect(orden.indexOf("products")).toBeLessThan(orden.indexOf("variants"));
  });

  it("`raw_payload` de payments va entero", async () => {
    // Es el aviso crudo de Pagopar y es parte del rastro de la plata: un
    // backup que lo trunca no sirve para reconstruir un incidente, que es
    // justo cuando se usa un backup.
    const orderId = await createOrder({ status: "pagado" });
    const payload = { evento: "x".repeat(2000), anidado: { a: 1 } };
    await getTestDb().insert(payments).values({
      orderId,
      provider: "pagopar",
      providerRef: "ref-1",
      amountPyg: 100_000,
      status: "paid",
      rawPayload: payload,
    });

    const fila = (await volcar()).find((f) => f.table === "payments");
    const crudo = fila!.row.raw_payload;
    const parsed = typeof crudo === "string" ? JSON.parse(crudo) : crudo;
    expect((parsed as typeof payload).evento).toHaveLength(2000);
  });

  it("pagina sin saltear ni repetir filas", async () => {
    // La paginación va por PK y no por OFFSET: con OFFSET, una fila insertada
    // a mitad del dump corre el resto y una fila se salta o se duplica.
    const productId = await createProduct();
    const total = PAGE_SIZE + 7;
    const db = getTestDb();
    const valores = Array.from({ length: total }, (_, i) => ({
      productId,
      sku: `PAG-${String(i).padStart(5, "0")}`,
      label: "Único",
      pricePyg: 1000,
      onHand: 0,
    }));
    for (let i = 0; i < valores.length; i += 200) {
      await db.insert(variants).values(valores.slice(i, i + 200));
    }

    const volcadas = (await volcar()).filter(
      (fila) => fila.table === "variants"
    );
    expect(volcadas).toHaveLength(total);
    expect(new Set(volcadas.map((fila) => fila.row.id)).size).toBe(total);
  });

  it("las tablas de configuración se traen enteras", async () => {
    // `counters` tiene PK de texto y una sola fila: `resetTables` la deja en 0.
    const filas = await volcar();
    expect(filas.some((fila) => fila.table === "counters")).toBe(true);
  });
});

describe("backupPublicId", () => {
  it("usa la fecha y hora de Asunción", () => {
    // 03:00 de Asunción del 12/08 es 06:00 UTC. Si el nombre saliera en UTC,
    // el backup de las 3 de la mañana aparecería fechado a las 6 y el dueño
    // buscaría el archivo equivocado.
    expect(backupPublicId(new Date("2026-08-12T06:00:00Z"))).toBe(
      "backup-2026-08-12T0300"
    );
  });

  it("ordena alfabéticamente igual que cronológicamente", () => {
    const temprano = backupPublicId(new Date("2026-08-12T06:00:00Z"));
    const tarde = backupPublicId(new Date("2026-08-13T06:00:00Z"));
    expect(temprano < tarde).toBe(true);
  });
});

describe.skipIf(!hasTestDb)("round-trip dump → restore", () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it("las filas vuelven iguales", async () => {
    // El test que de verdad importa: un backup que no restaura es un archivo,
    // no una copia de seguridad.
    const { dumpDatabase } = await import("@/domain/backup");
    const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");

    const productId = await createProduct();
    await createVariant({ onHand: 7, pricePyg: 123_000, productId });
    const orderId = await createOrder({ status: "pagado", totalPyg: 150_000 });

    const antes = await volcar();

    // Se escribe el archivo comprimido, igual que lo haría el cron.
    const dir = await mkdtemp(path.join(tmpdir(), "backup-"));
    const archivo = path.join(dir, "backup.jsonl.gz");
    const { stream: gz, stats } = dumpDatabase();
    const trozos: Buffer[] = [];
    for await (const trozo of gz) trozos.push(trozo as Buffer);
    await writeFile(archivo, Buffer.concat(trozos));
    await stats;

    // Se borra todo y se restaura desde el archivo.
    const { restaurar } = await import("../../scripts/restore-backup");
    await resetTables();
    // Todo borrado salvo el contador que `resetTables` vuelve a sembrar.
    expect((await volcar()).map((fila) => fila.table)).toEqual(["counters"]);

    const reporte = await restaurar({ archivo, vaciar: true });
    expect(reporte.filas).toBe(antes.length);
    expect(await volcar()).toEqual(antes);

    const db = getTestDb();
    const [pedido] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(pedido?.totalPyg).toBe(150_000);

    const [producto] = await db
      .select()
      .from(products)
      .where(eq(products.id, productId));
    expect(producto?.slug).toBeDefined();

    const [variante] = await db
      .select()
      .from(variants)
      .where(eq(variants.productId, productId));
    expect(variante?.onHand).toBe(7);
    expect(variante?.pricePyg).toBe(123_000);

    await rm(dir, { recursive: true, force: true });
  });
});
