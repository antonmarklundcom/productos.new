import {adaptHttpLoopbackCsp} from "./loopback-csp.mjs";
import app from "../../dist/server/index.js";
// Test-only adapter: never imported by a deployment entry point.
const fixtureWorker = {
  async fetch(request, env, ctx) {
    const external = new URL(request.url);
    if (
      external.pathname.startsWith("/assets/") ||
      external.pathname.startsWith("/_next/") ||
      external.pathname.startsWith("/placeholders/")
    )
      return env.ASSETS.fetch(request);
    const internal = new URL(
      external.pathname + external.search,
      env.NEXT_PUBLIC_SITE_URL
    );
    const headers = new Headers(request.headers);
    headers.set("host", internal.host);
    if (headers.has("origin")) headers.set("origin", internal.origin);
    const input = new Request(internal, {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    });
    const bindings = {
      ...env,
      EMAIL: {
        send: async (message) => {
          const r = await env.MAIL_STUB.fetch("http://mail.local/send", {
            method: "POST",
            body: JSON.stringify(message),
          });
          if (!r.ok) throw Error("Synthetic delivery failure");
        },
      },
    };
    if (headers.get("x-fixture-outage") === "true") bindings.DB = undefined;
    if (headers.get("x-fixture-query-outage") === "true")
      bindings.DB = new Proxy(env.DB, {
        get(target, key) {
          if (key === "prepare")
            return () => {
              throw Error("SYNTHETIC_DB_UNAVAILABLE");
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    if (headers.get("x-fixture-product-query-outage") === "true")
      bindings.DB = new Proxy(env.DB, {
        get(target,key) {
          if (key === "prepare") return sql => {
            if (sql.includes("WITH candidates AS")) throw Error("SYNTHETIC_DEFERRED_PRODUCT_QUERY_FAILURE");
            return target.prepare(sql);
          };
          const value = Reflect.get(target,key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    if (headers.get("x-fixture-cache") === "true")
      bindings.WORKERS_PUBLIC_CACHE_SECONDS = "30";
    // Only the isolated fixture accepts a controlled clock. Buffer streamed
    // readers before restoring it so DTO and HTML expiry see the same instant.
    const requestedClock = Number(headers.get("x-fixture-clock-ms"));
    const clocked = headers.has("x-fixture-clock-ms") && Number.isSafeInteger(requestedClock) && requestedClock > 0;
    const realNow = Date.now;
    let response;
    try {
      if (clocked) Date.now = () => requestedClock;
      response = await app.fetch(input, bindings, ctx);
      if (clocked) response = new Response(await response.arrayBuffer(), {status:response.status,headers:response.headers});
    } finally { Date.now = realNow; }
    const
      output = new Headers(response.headers),
      location = output.get("location");
    if (location?.startsWith(internal.origin))
      output.set(
        "location",
        external.origin + location.slice(internal.origin.length)
      );
    adaptHttpLoopbackCsp(output, external);
    return new Response(response.body, {
      status: response.status,
      headers: output,
    });
  },
};

export default fixtureWorker;
