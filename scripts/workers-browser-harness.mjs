import { createRequire } from "node:module";
import { readFile, readdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { Miniflare, Log, LogLevel, convertV4MiniflareOptions } = require(
  createRequire(require.resolve("wrangler/package.json")).resolve("miniflare")
);
// Public build constants name the canonical origin; transport remains loopback only.
export const origin =
  process.env.WORKERS_BROWSER_PUBLIC_ORIGIN ||
  JSON.parse(await readFile(path.join(root, "wrangler.jsonc"), "utf8")).vars
    .NEXT_PUBLIC_SITE_URL;
// These are generated synthetic account values, never production credentials.
export const fixturePassword = "Synthetic-fixture-password-2026";
export async function createHarness({
  diagnostics = false,
  sessionSecret = "synthetic-browser-session-key-" + randomUUID(),
} = {}) {
  await access(path.join(root, "dist/server/index.js"));
  const mail = [];
  let failMail = false,
    mailAttempts = 0;
  const files = (
    await readdir(path.join(root, "dist/server"), { recursive: true })
  ).filter((n) => /\.m?js$/.test(n));
  const modules = [
    {
      type: "ESModule",
      path: path.join(root, "scripts/fixtures/workers-browser-entry.mjs"),
    },
    ...files.map((n) => ({
      type: "ESModule",
      path: path.join(root, "dist/server", n),
    })),
  ];
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      host: "127.0.0.1",
      port: 0,
      workers: [
        {
          name: "productos-browser-" + randomUUID(),
          compatibilityDate: "2026-10-09",
          compatibilityFlags: ["nodejs_compat"],
          modules,
          modulesRoot: root,
          d1Databases: { DB: randomUUID() },
          r2Buckets: { IMAGES: "synthetic-" + randomUUID() },
          bindings: {
            CF_VERSION_METADATA: { id: randomUUID() },
            SESSION_SECRET: sessionSecret,
            WORKERS_D1_STAGING: "true",
            WORKERS_PRODUCTION_READY: "true",
            WORKERS_PUBLIC_CACHE_SECONDS: "0",
            WORKERS_PUBLIC_DIAGNOSTICS: String(diagnostics),
            NEXT_PUBLIC_SITE_URL: origin,
            ADMIN_PASSWORD_RESET_ENABLED: "true",
            ADMIN_PASSWORD_RESET_FROM: "recovery@fixture.invalid",
          },
          serviceBindings: {
            ASSETS: async (request) => {
              const pathname = new URL(request.url).pathname;
              const target = path.resolve(root, "dist/client", "." + pathname);
              if (!target.startsWith(path.join(root, "dist/client") + path.sep))
                return new Response("", { status: 404 });
              try {
                const body = await readFile(target);
                return new Response(body, {
                  headers: {
                    "content-type": target.endsWith(".js")
                      ? "text/javascript"
                      : target.endsWith(".css")
                        ? "text/css"
                        : "application/octet-stream",
                  },
                });
              } catch {
                return new Response("", { status: 404 });
              }
            },
            MAIL_STUB: async (request) => {
              const message = await request.json();
              mailAttempts++;
              if (failMail) return new Response("", { status: 503 });
              mail.push(message);
              return new Response("ok");
            },
          },
          outboundService: async () => {
            throw Error(
              "Worker outbound access forbidden in synthetic acceptance"
            );
          },
        },
      ],
      log: new Log(LogLevel.ERROR),
    })
  );
  try {
    const baseURL = (await mf.ready).origin,
      db = await mf.getD1Database("DB");
    const names = (await readdir(path.join(root, "workers/d1/migrations")))
      .filter((n) => /^\d.*\.sql$/.test(n))
      .sort();
    for (const name of names) {
      const sql = await readFile(
        path.join(root, "workers/d1/migrations", name),
        "utf8"
      );
      for (const statement of sql.split("--> statement-breakpoint"))
        if (statement.trim()) await db.exec(statement.replace(/\r?\n/g, " "));
    }
    const hash = await bcrypt.hash(fixturePassword, 4);
    for (const [id, role] of [
      [1, "owner"],
      [2, "staff"],
      [3, "vendedor"],
    ])
      await db
        .prepare(
          "INSERT INTO users(id,email,password_hash,name,role) VALUES(?,?,?,?,?)"
        )
        .bind(id, role + "@fixture.invalid", hash, "Synthetic " + role, role)
        .run();
    await db.exec(
      "INSERT INTO categories(id,slug,name,is_active) VALUES(1,'synthetic','Synthetic',1); INSERT INTO products(id,slug,name,category_id,is_active,published_at,sale_mode,show_price) VALUES(1,'synthetic-visible','Synthetic visible',1,1,CURRENT_TIMESTAMP,'enquiry',1),(2,'synthetic-hidden','Synthetic hidden private marker',1,0,NULL,'enquiry',1),(3,'synthetic-no-price','Synthetic no price',1,1,CURRENT_TIMESTAMP,'enquiry',0); INSERT INTO variants(id,product_id,sku,label,price_pyg,on_hand,is_active) VALUES(1,1,'SYNTH-1','Synthetic',50000,2,1),(2,2,'SYNTH-2','Synthetic',77777,2,1),(3,3,'SYNTH-3','Synthetic',98765,2,1);"
    );
    return {
      baseURL,
      db,
      bucket: await mf.getR2Bucket("IMAGES"),
      mail,
      get mailAttempts() {
        return mailAttempts;
      },
      migrations: names,
      failMail(value) {
        failMail = value;
      },
      close: () => mf.dispose(),
    };
  } catch (error) {
    await mf.dispose();
    throw error;
  }
}
export async function restrictBrowser(context, baseURL) {
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === baseURL
      ? route.continue()
      : route.abort("blockedbyclient")
  );
}
