import {test} from "node:test";
import assert from "node:assert/strict";
import {catalogResponse, catalogFingerprint, HOME_TRUST_SECONDS, HOME_MAX_SECONDS} from "../../workers/d1/public-response.mjs";
import {robotsResponse, ROBOTS_TXT} from "../../workers/d1/robots-response.mjs";

const home = (headers = {}, path = "https://productos.com.py/") => new Request(path, {headers: {accept: "text/html", ...headers}});
const base = {WORKERS_PUBLIC_CACHE_SECONDS: "60", CF_VERSION_METADATA: {id: "v1"}, WORKERS_PRODUCTION_READY: "true", NEXT_PUBLIC_SITE_URL: "https://productos.com.py"};
// In-memory stand-in for the Cache API (expiry is enforced by the code under test via x-catalog-expires-at).
function memoryStorage() {
  const spaces = new Map();
  return {spaces, open: async name => {
    if (!spaces.has(name)) spaces.set(name, new Map());
    const values = spaces.get(name);
    return {match: async r => values.get(r.url)?.clone(), put: async (r, s) => {values.set(r.url, s.clone());}};
  }};
}
function fakeDb(state) {
  return {prepare: () => ({first: async () => {
    state.queries++;
    if (state.fail) throw new Error("d1 down");
    return {p: state.p, c: "1/a/A/0/1//", s: "t"};
  }})};
}
function setup(overrides = {}) {
  const state = {queries: 0, p: "262:10:2026-11-01", fail: false};
  const pending = [], ctx = {waitUntil: p => pending.push(p)};
  const storage = memoryStorage(), env = {...base, DB: fakeDb(state), ...overrides};
  let renders = 0, lastDataContext;
  const dataContext = {enabled: true, expiresAt: Infinity};
  const html = {"content-type": "text/html", vary: "RSC", "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'"};
  const render = async () => {renders++; lastDataContext = {...dataContext}; return new Response("home " + renders, {headers: html});};
  const call = async (request = home()) => {
    const r = await catalogResponse(request, env, ctx, render, storage, dataContext);
    await Promise.all(pending.splice(0));
    return r;
  };
  return {state, env, ctx, call, storage, renders: () => renders, rendered: () => lastDataContext};
}
const realNow = Date.now;
const clock = start => { let t = start; Date.now = () => t; return s => { t += s * 1000; }; };
const T0 = 1_800_000_000_000;

test("home: MISS then HIT, no extra D1 inside the trust window, data cache off for the render", async () => {
  const s = setup(), advance = clock(T0);
  try {
    const first = await s.call();
    assert.equal(first.headers.get("x-home-cache"), "MISS");
    assert.equal(first.headers.get("x-catalog-cache"), "MISS");
    assert.equal(s.rendered().enabled, false, "stored render must use fresh data");
    assert.equal(first.headers.has("x-home-fingerprint"), false);
    assert.equal(s.state.queries, 1);
    advance(HOME_TRUST_SECONDS - 5);
    const second = await s.call();
    assert.equal(second.headers.get("x-home-cache"), "HIT");
    assert.equal(await second.text(), "home 1");
    assert.equal(s.renders(), 1);
    assert.equal(s.state.queries, 1, "trusted HIT does no D1 work");
    assert.equal(second.headers.has("x-home-fingerprint"), false);
    assert.match(second.headers.get("cache-control"), /s-maxage=(\d|[12]\d|30)$/);
  } finally { Date.now = realNow; }
});

test("home: after the trust window a matching fingerprint still HITs (one D1 read)", async () => {
  const s = setup(), advance = clock(T0);
  try {
    await s.call();
    advance(HOME_TRUST_SECONDS + 60);
    const hit = await s.call();
    assert.equal(hit.headers.get("x-home-cache"), "HIT");
    assert.equal(s.renders(), 1);
    assert.equal(s.state.queries, 2);
  } finally { Date.now = realNow; }
});

test("home freshness: a catalogue change re-renders after the trust window, not before", async () => {
  const s = setup(), advance = clock(T0);
  try {
    await s.call();
    s.state.p = "262:11:2026-11-02"; // a price/stock edit bumps products.revision
    advance(HOME_TRUST_SECONDS - 1);
    assert.equal((await s.call()).headers.get("x-home-cache"), "HIT"); // inside the documented 30 s
    advance(5);
    const fresh = await s.call();
    assert.equal(fresh.headers.get("x-home-cache"), "MISS");
    assert.equal(await fresh.text(), "home 2");
    assert.equal((await s.call()).headers.get("x-home-cache"), "HIT");
    assert.equal(s.renders(), 2);
  } finally { Date.now = realNow; }
});

test("home: hard ceiling re-renders even when nothing changed", async () => {
  const s = setup(), advance = clock(T0);
  try {
    await s.call();
    advance(HOME_MAX_SECONDS + 1);
    assert.equal((await s.call()).headers.get("x-home-cache"), "MISS");
    assert.equal(s.renders(), 2);
  } finally { Date.now = realNow; }
});

test("home: D1 fingerprint failure never stores or serves an unverified entry", async () => {
  const s = setup(), advance = clock(T0);
  try {
    s.state.fail = true;
    assert.equal((await s.call()).headers.get("x-home-cache"), "BYPASS");
    s.state.fail = false;
    await s.call();
    advance(HOME_TRUST_SECONDS + 5);
    s.state.fail = true;
    assert.notEqual((await s.call()).headers.get("x-home-cache"), "HIT");
  } finally { Date.now = realNow; }
});

test("home bypass: cookie, auth, query string, RSC, no-cache; other paths carry no home header", async () => {
  const s = setup();
  await s.call();
  const requests = [home({cookie: "ecom_admin=x"}), home({authorization: "Bearer x"}), home({rsc: "1"}), home({"cache-control": "no-cache"}), home({}, "https://productos.com.py/?utm=1")];
  for (const request of requests) {
    const r = await s.call(request);
    assert.equal(r.headers.get("x-catalog-cache"), "BYPASS");
    assert.equal(r.headers.get("x-home-cache"), "BYPASS");
    assert.equal(r.headers.get("cache-control"), "private, no-store");
  }
  const product = await s.call(home({}, "https://productos.com.py/producto/cepillo"));
  assert.equal(product.headers.has("x-home-cache"), false);
  assert.equal(product.headers.get("x-catalog-cache"), "MISS");
});

test("home: responses that set cookies or carry nonces are never stored", async () => {
  const s = setup();
  for (const extra of [{"set-cookie": "a=b"}, {"x-nonce": "n"}, {"content-security-policy": "script-src 'nonce-abc'"}]) {
    const render = async () => new Response("x", {headers: {"content-type": "text/html", ...extra}});
    const r = await catalogResponse(home(), s.env, s.ctx, render, s.storage, {enabled: true, expiresAt: Infinity});
    assert.equal(r.headers.get("x-home-cache"), "BYPASS");
  }
  await Promise.resolve();
  assert.equal([...s.storage.spaces.values()].reduce((n, m) => n + m.size, 0), 0);
});

test("kill switch WORKERS_HOME_CACHE=0 restores the old short-TTL behaviour", async () => {
  const s = setup({WORKERS_HOME_CACHE: "0"}), advance = clock(T0);
  try {
    assert.equal((await s.call()).headers.get("x-home-cache"), "MISS");
    assert.equal(s.state.queries, 0, "no fingerprint query when off");
    assert.equal(s.rendered().enabled, true);
    assert.ok(s.storage.spaces.has("catalog-html-v1") && !s.storage.spaces.has("catalog-html-home-v1"));
    assert.equal((await s.call()).headers.get("x-home-cache"), "HIT");
    advance(61);
    assert.equal((await s.call()).headers.get("x-home-cache"), "MISS");
  } finally { Date.now = realNow; }
});

test("fingerprint is stable, changes with its input, and is null on failure", async () => {
  const state = {queries: 0, p: "a", fail: false}, db = fakeDb(state);
  const one = await catalogFingerprint(db);
  assert.match(one, /^[0-9a-f]{24}$/);
  assert.equal(await catalogFingerprint(db), one);
  state.p = "b";
  assert.notEqual(await catalogFingerprint(db), one);
  state.fail = true;
  assert.equal(await catalogFingerprint(db), null);
});

test("robots.txt is a constant response (no DB, no render), production origin only", async () => {
  const prod = request => robotsResponse(request, base);
  const get = prod(new Request("https://productos.com.py/robots.txt"));
  assert.equal(get.status, 200);
  assert.equal(await get.text(), ROBOTS_TXT);
  assert.match(get.headers.get("content-type"), /^text\/plain/);
  assert.equal(get.headers.has("set-cookie"), false);
  assert.equal(prod(new Request("https://productos.com.py/robots.txt", {method: "HEAD"})).status, 200);
  assert.equal(prod(new Request("https://productos.com.py/robots.txt", {method: "POST"})), null);
  assert.equal(prod(new Request("https://productos.com.py/other")), null);
  assert.equal(prod(new Request("https://stage.workers.dev/robots.txt")), null, "non-production keeps the Disallow-all path");
  assert.doesNotMatch(ROBOTS_TXT, /Cloudflare Managed/);
  assert.match(ROBOTS_TXT, /Sitemap: https:\/\/productos\.com\.py\/sitemap\.xml\n$/);
});
