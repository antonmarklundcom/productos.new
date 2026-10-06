import { gzipSync } from "node:zlib";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { orders, stockReservations } from "@/db/schema";
import { transitionOrder } from "@/domain/orders";
import { dumpDatabase, dumpRows } from "@/domain/backup";
import { getPool } from "@/db";
import { inspectBackup, restoreBackup } from "@/domain/restore-backup";
import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createOrder, createVariant } from "../helpers/factories";

describe.skipIf(!hasTestDb)("consistent and recoverable backups", () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);
  it("a canceled gzip pipeline rejects promptly and leaves the pool usable", async () => {
    const { stream, stats } = dumpDatabase();
    stream.on("error", () => {});
    stream.destroy(new Error("Injected sink failure"));
    await expect(stats).rejects.toThrow();
    await expect(getPool().query("SELECT 1")).resolves.toBeDefined();
  });
  it("holds one snapshot while an order is paid and its reservation consumed", async () => {
    const variantId = await createVariant({ onHand: 5 });
    const orderId = await createOrder();
    await getTestDb()
      .insert(stockReservations)
      .values({
        orderId,
        variantId,
        qty: 2,
        state: "held",
        expiresAt: new Date(Date.now() + 60_000),
      });
    const rows: Array<{ table: string; row: Record<string, unknown> }> = [];
    for await (const row of dumpRows()) {
      rows.push(row);
      if (row.table === "variants" && row.row.id === variantId) {
        await transitionOrder(orderId, "pagado", "test");
      }
    }
    expect(rows.find((r) => r.table === "orders")!.row.status).toBe(
      "pendiente_pago"
    );
    expect(rows.find((r) => r.table === "variants")!.row.on_hand).toBe(5);
    expect(rows.find((r) => r.table === "stock_reservations")!.row.state).toBe(
      "held"
    );
    expect(rows.filter((r) => r.table === "payments")).toHaveLength(0);
  });
  it("writes and validates a manifest, counts, checksum and closing record", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "ecom-backup-test-"));
    try {
      const file = path.join(folder, "backup.gz");
      const { stream, stats } = dumpDatabase();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      await writeFile(file, Buffer.concat(chunks));
      const info = await inspectBackup(file);
      expect(info.manifest!.format).toBe(2);
      expect(info.rows).toBe((await stats).rows);
      expect(info.keyMatches).toBe(true);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
  it("rejects missing, truncated and malformed files before changing a sentinel row", async () => {
    const id = await createOrder();
    const folder = await mkdtemp(path.join(tmpdir(), "ecom-restore-test-"));
    try {
      await expect(
        restoreBackup({ archivo: path.join(folder, "missing.gz") })
      ).rejects.toThrow();
      const file = path.join(folder, "broken.gz");
      await writeFile(file, gzipSync("invalid-json\n").subarray(0, 12));
      await expect(restoreBackup({ archivo: file })).rejects.toThrow();
      await writeFile(file, gzipSync('{"table":"unknown","row":{}}\n'));
      await expect(restoreBackup({ archivo: file })).rejects.toThrow();
      expect(
        await getTestDb().select().from(orders).where(eq(orders.id, id))
      ).toHaveLength(1);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
  it("refuses a valid backup when the recovery target already contains data", async () => {
    const id = await createOrder();
    const folder = await mkdtemp(path.join(tmpdir(), "ecom-restore-test-"));
    try {
      const file = path.join(folder, "backup.gz");
      const { stream, stats } = dumpDatabase();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      await stats;
      await writeFile(file, Buffer.concat(chunks));
      await expect(restoreBackup({ archivo: file })).rejects.toThrow(
        "base vacía"
      );
      expect(
        await getTestDb().select().from(orders).where(eq(orders.id, id))
      ).toHaveLength(1);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
