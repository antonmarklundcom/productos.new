import app from "vinext/server/fetch-handler";
import { sql } from "drizzle-orm";
import { getDb } from "../src/db/index";
import { handlePreviewRequest } from "./preview-policy.mjs";
import { PreviewDatabaseError, withPreviewDatabase } from "./hyperdrive-database";
import { serveCatalogDemo } from "./catalog-demo.mjs";
export * from "vinext/server/fetch-handler";

const previewWorker = {
  fetch(request, env, ctx) {
    return handlePreviewRequest(request, async (anonymous) => {
      if (!env.HYPERDRIVE && env.PREVIEW_CATALOG_SNAPSHOT === "true")
        return serveCatalogDemo(anonymous, env);
      const health = ["/api/health", "/health"].includes(new URL(anonymous.url).pathname);
      try {
        return await withPreviewDatabase(anonymous, env, ctx, async () => {
          if (health) {
            await getDb().execute(sql`SELECT 1`);
            return Response.json({ ok: true, db: true, cron: false });
          }
          return app.fetch(anonymous, env, ctx);
        });
      } catch (error) {
        const code = error instanceof PreviewDatabaseError ? error.code : "PREVIEW_DB_UNAVAILABLE";
        // Never forward SQL, parameters, origin credentials or driver error text.
        if (health) return Response.json({ ok: true, db: false, cron: false, previewStatus: code });
        return new Response("Catalog preview is waiting for its staging database.", {
          status: 503, headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }
    });
  },
};
export default previewWorker;
