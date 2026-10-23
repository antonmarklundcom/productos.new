import app from "vinext/server/fetch-handler";
import { sql } from "drizzle-orm";
import { getDb } from "../src/db/index";
import { handlePreviewRequest } from "./preview-policy.mjs";
import { PreviewDatabaseError, withPreviewDatabase } from "./hyperdrive-database";
import { serveCatalogDemo } from "./catalog-demo.mjs";
import { getNativeDb, withD1Database } from "./d1/database";
import { d1StagingRoute, protectStagingResponse, boundedAdminRequest } from "./d1/policy.mjs";
import { catalogResponse, productionPublicRequest } from "./d1/public-response.mjs";
import { catalogOnly } from "./d1/catalog-capabilities";
import { publicReadContext } from "./d1/public-data-cache.mjs";
import { canonicalDomainResponse } from "./catalog-domain.mjs";
import { handleAdminRecovery } from "./d1/admin-recovery.mjs";
export * from "vinext/server/fetch-handler";

const previewWorker = {
  async fetch(request, env, ctx) {
    const canonical = canonicalDomainResponse(request, env);
    if (canonical) return canonical;
    if (env.WORKERS_D1_STAGING === "true") {
      const blocked = d1StagingRoute(request);
      if (blocked) return protectStagingResponse(blocked);
      const bounded = await boundedAdminRequest(request);
      if (bounded instanceof Response) return protectStagingResponse(bounded);
      request = bounded;
      if (new URL(request.url).pathname === "/robots.txt" && !productionPublicRequest(request, env)) return protectStagingResponse(new Response("User-agent: *\nDisallow: /\n"));
      if (!env.DB) return protectStagingResponse(Response.json({ok:false,db:false,mode:"d1-staging"},{status:503}));
      const recovery = await handleAdminRecovery(request, env, ctx);
      if (recovery) return recovery;
      const publicEnv = catalogOnly ? env : {...env, WORKERS_PUBLIC_CACHE_SECONDS: "0"};
      const publicCatalog = publicReadContext(request, publicEnv, ctx);
      return withD1Database(env.DB, async () => {
        if (["/api/health","/health"].includes(new URL(request.url).pathname)) {
          const [row] = await getNativeDb().all(sql`SELECT (SELECT COUNT(*) FROM products) products, (SELECT COUNT(*) FROM product_images) images, (SELECT COUNT(*) FROM categories) categories`);
          return protectStagingResponse(Response.json({ok:true,db:true,mode:"d1-staging",counts:row,cron:false}));
        }
        const response = await catalogResponse(request, publicEnv, ctx, (renderRequest) => app.fetch(renderRequest,env,ctx), globalThis.caches, publicCatalog);
        if (env.WORKERS_PUBLIC_DIAGNOSTICS !== "true") return response;
        // Preview-only opt-in: finish RSC to observe late readers. Do not enable
        // this for normal shoppers: it deliberately buffers diagnostic responses.
        const body = await response.arrayBuffer();
        const headers = new Headers(response.headers);
        headers.set("x-catalog-public-loads", String(publicCatalog.loads.length));
        const timings = publicCatalog.loads.map((load,index) => `catalog_${load.reader}_${index};dur=${load.durationMs}`).join(", ");
        if (timings) headers.append("server-timing", timings);
        return new Response(body, {status: response.status,statusText:response.statusText,headers});
      }, env.SESSION_SECRET, {...env, PUBLIC_CATALOG: publicCatalog});
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
