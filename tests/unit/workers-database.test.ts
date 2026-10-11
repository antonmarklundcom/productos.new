import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type mysql from "mysql2/promise";
import { getDb, getPool } from "@/db";
import { variants } from "@/db/schema";
import { currentRequestDatabase } from "@/db/request-context";
import {
  hyperdriveOptions, openPreviewDatabase, requireUtcOrigin, UTC_CHECK_SQL,
  withPreviewDatabase, type HyperdriveBinding,
} from "../../workers/hyperdrive-database";

const binding: HyperdriveBinding = { host: "fixture.invalid", port: 3306, user: "fixture", password: "fixture", database: "fixture" };
function fixture(globalZone = "+00:00", offset = 0) {
  const query = vi.fn(async (input: string | { sql: string }) => {
    const text = typeof input === "string" ? input : input.sql;
    if (text === UTC_CHECK_SQL) return [[{ global_zone: globalZone, offset_seconds: offset }], []];
    return [[{ value: 1 }], []];
  });
  const end = vi.fn(async () => undefined), destroy = vi.fn();
  const connection = { query, end, destroy } as unknown as mysql.Connection;
  const factory = vi.fn(async () => connection);
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } };
  return { query, end, destroy, factory, pending, ctx };
}

describe("request-scoped read-only Workers database", () => {
  it("requires a binding and cannot silently fall back to DATABASE_URL", async () => {
    const f = fixture();
    await expect(openPreviewDatabase({}, f.factory)).rejects.toThrow("PREVIEW_DB_MISSING");
    expect(f.factory).not.toHaveBeenCalled();
  });
  it("uses the binding, disableEval and text-query options without an origin ssl override", () => {
    expect(hyperdriveOptions(binding)).toMatchObject({ ...binding, disableEval: true, timezone: "Z", multipleStatements: false });
    // The Worker connects to Hyperdrive's local endpoint. Origin TLS is
    // configured and validated by Hyperdrive, not disabled in this client.
    expect(hyperdriveOptions(binding)).not.toHaveProperty("ssl");
  });
  it.each([["SYSTEM", 0], ["-03:00", -10800], ["+00:00", 10800]])("rejects unsafe origin defaults/session offsets (%s)", async (zone, offset) => {
    const f = fixture(String(zone), Number(offset));
    await expect(openPreviewDatabase({ HYPERDRIVE: binding }, f.factory)).rejects.toThrow("PREVIEW_DB_UTC_REQUIRED");
    expect(f.end).toHaveBeenCalledTimes(1);
    expect(f.query.mock.calls.map(([q]) => q)).toEqual([UTC_CHECK_SQL]);
  });
  it("accepts explicit UTC without issuing a SET statement", async () => {
    const f = fixture();
    const session = await openPreviewDatabase({ HYPERDRIVE: binding }, f.factory);
    await session.database.execute(sql`SELECT 1`);
    await session.close();
    expect(f.query.mock.calls).toHaveLength(2);
    expect(f.query.mock.calls.some(([q]) => /^SET\b/i.test(typeof q === "string" ? q : q.sql))).toBe(false);
    expect(() => requireUtcOrigin([])).toThrow("PREVIEW_DB_UTC_REQUIRED");
  });
  it("Drizzle selections use query and reject writes/transactions", async () => {
    const f = fixture();
    const session = await openPreviewDatabase({ HYPERDRIVE: binding }, f.factory);
    await session.database.select({ id: variants.id }).from(variants).limit(1);
    expect(f.query.mock.calls[1]?.[0]).toMatchObject({ sql: expect.stringMatching(/^select/i), rowsAsArray: true });
    await expect(session.database.execute(sql`UPDATE variants SET on_hand = 0`)).rejects.toThrow();
    await expect(session.database.transaction(async () => undefined)).rejects.toThrow();
    expect(f.query).toHaveBeenCalledTimes(2);
    await session.close();
    await expect(session.database.execute(sql`SELECT 1`)).rejects.toThrow();
  });
  it("concurrent requests get different databases, one client each, and never a Hostinger pool", async () => {
    const first = fixture(), second = fixture();
    const databases: unknown[] = [];
    const run = (f: ReturnType<typeof fixture>) => withPreviewDatabase(new Request("https://fixture.invalid/"), { HYPERDRIVE: binding }, f.ctx, async () => {
      databases.push(getDb());
      expect(getDb()).toBe(currentRequestDatabase());
      expect(() => getPool()).toThrow("Workers preview cannot access");
      await getDb().execute(sql`SELECT 1`);
      return new Response("public");
    }, f.factory);
    const responses = await Promise.all([run(first), run(second)]);
    expect(databases[0]).not.toBe(databases[1]);
    await Promise.all(responses.map((r) => r.text()));
    await Promise.all([...first.pending, ...second.pending]);
    for (const f of [first, second]) { expect(f.factory).toHaveBeenCalledTimes(1); expect(f.end).toHaveBeenCalledTimes(1); }
    expect(currentRequestDatabase()).toBeUndefined();
  });
  it("keeps database scope available in streamed reads and closes after completion", async () => {
    const f = fixture();
    const response = await withPreviewDatabase(new Request("https://fixture.invalid/"), { HYPERDRIVE: binding }, f.ctx, async () => new Response(new ReadableStream({
      async pull(controller) {
        await getDb().execute(sql`SELECT 1`);
        controller.enqueue(new TextEncoder().encode("stream")); controller.close();
      },
    }), { headers: { "content-security-policy": "default-src 'self'" } }), f.factory);
    expect(f.end).not.toHaveBeenCalled();
    expect(await response.text()).toBe("stream");
    await Promise.all(f.pending);
    expect(response.headers.get("content-security-policy")).toBe("default-src 'self'");
    expect(f.end).toHaveBeenCalledTimes(1);
  });
  it("closes on cancellation", async () => {
    const f = fixture();
    const response = await withPreviewDatabase(new Request("https://fixture.invalid/"), { HYPERDRIVE: binding }, f.ctx, async () => new Response(new ReadableStream()), f.factory);
    await response.body!.cancel(); await Promise.all(f.pending);
    expect(f.end).toHaveBeenCalledTimes(1);
  });
  it("closes on handler errors", async () => {
    const f = fixture();
    await expect(withPreviewDatabase(new Request("https://fixture.invalid/"), { HYPERDRIVE: binding }, f.ctx, async () => { throw new Error("fixture failure"); }, f.factory)).rejects.toThrow("fixture failure");
    await Promise.all(f.pending); expect(f.end).toHaveBeenCalledTimes(1);
  });
  it("closes on streaming errors", async () => {
    const f = fixture();
    const response = await withPreviewDatabase(new Request("https://fixture.invalid/"), { HYPERDRIVE: binding }, f.ctx, async () => new Response(new ReadableStream({
      pull(controller) { controller.error(new Error("fixture stream error")); },
    })), f.factory);
    await expect(response.text()).rejects.toThrow("fixture stream error");
    await Promise.all(f.pending); expect(f.end).toHaveBeenCalledTimes(1);
  });
  it("closes when the request is aborted", async () => {
    const f = fixture(), controller = new AbortController();
    await withPreviewDatabase(new Request("https://fixture.invalid/", { signal: controller.signal }), { HYPERDRIVE: binding }, f.ctx, async () => new Response(new ReadableStream()), f.factory);
    controller.abort(); await Promise.all(f.pending);
    expect(f.end).toHaveBeenCalledTimes(1);
  });
  it("closes on HEAD without streaming a body", async () => {
    const f = fixture();
    const response = await withPreviewDatabase(new Request("https://fixture.invalid/", { method: "HEAD" }), { HYPERDRIVE: binding }, f.ctx, async () => new Response("page"), f.factory);
    expect(await response.text()).toBe(""); await Promise.all(f.pending);
    expect(f.end).toHaveBeenCalledTimes(1);
  });
  it("destroys a client if graceful close fails", async () => {
    const f = fixture(); f.end.mockRejectedValue(new Error("fixture close error"));
    const session = await openPreviewDatabase({ HYPERDRIVE: binding }, f.factory);
    await Promise.all([session.close(), session.close()]);
    expect(f.end).toHaveBeenCalledTimes(1); expect(f.destroy).toHaveBeenCalledTimes(1);
  });
});
