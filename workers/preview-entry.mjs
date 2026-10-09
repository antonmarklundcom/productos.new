import app from "vinext/server/fetch-handler";
import { sql } from "drizzle-orm";
import { getDb } from "../src/db/index";
import { handlePreviewRequest } from "./preview-policy.mjs";
import { PreviewDatabaseError, withPreviewDatabase } from "./hyperdrive-database";
import { serveCatalogDemo } from "./catalog-demo.mjs";
import { getNativeDb, withD1Database } from "./d1/database";
import { d1StagingRoute, protectStagingResponse } from "./d1/policy.mjs";
export * from "vinext/server/fetch-handler";

const previewWorker = {
  async fetch(request, env, ctx) {
    if (env.WORKERS_D1_STAGING === "true") {
      const blocked = d1StagingRoute(request);
      if (blocked) return protectStagingResponse(blocked);
      if (new URL(request.url).pathname === "/robots.txt") return protectStagingResponse(new Response("User-agent: *\nDisallow: /\n"));
      if (!env.DB) return protectStagingResponse(Response.json({ok:false,db:false,mode:"d1-staging"},{status:503}));
      return withD1Database(env.DB, async () => {
        if (["/api/health","/health"].includes(new URL(request.url).pathname)) {
          const [row] = await getNativeDb().all(sql`SELECT (SELECT COUNT(*) FROM products) products, (SELECT COUNT(*) FROM product_images) images, (SELECT COUNT(*) FROM categories) categories`);
          return protectStagingResponse(Response.json({ok:true,db:true,mode:"d1-staging",counts:row,cron:false}));
        }
        return protectStagingResponse(await app.fetch(request,env,ctx));
      }, env.SESSION_SECRET);
    }
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
