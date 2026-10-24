import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, realpath, stat, open, writeFile } from 'node:fs/promises';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORMAT = 'workers-private-recovery-v1';
const fail = () => { throw new Error('RECOVERY_BUNDLE_REJECTED'); };
const inside = (root, p) => { const r = path.relative(root, p); return r !== '' && !r.startsWith('..') && !path.isAbsolute(r); };
function absolute(p) { if (typeof p !== 'string' || !path.isAbsolute(p)) fail(); return path.resolve(p); }
async function canonical(p) { p = absolute(p); if ((await realpath(p)).toLowerCase() !== p.toLowerCase()) fail(); return p; }
function privateLocation(p) {
  if (p === ROOT || inside(ROOT, p) || /(^|[\\/])(?:onedrive(?:[ -][^\\/]*)?|reports?)([\\/]|$)/i.test(p)) fail();
  for (let ancestor = p; ; ancestor = path.dirname(ancestor)) { if (existsSync(path.join(ancestor, '.git'))) fail(); if (ancestor === path.dirname(ancestor)) break; }
}
async function privateRoot(p) { p = await canonical(p); privateLocation(p); if (!(await stat(p)).isDirectory()) fail(); return p; }
async function newTarget(root, p) { p = absolute(p); privateLocation(p); if (!inside(root, p) || await canonical(path.dirname(p)) !== path.dirname(p)) fail(); await mkdir(p, { mode: 0o700 }); return p; }
function keyFor(config, env) {
  if (!!config.keyFile === !!env.WORKERS_RECOVERY_KEY) fail();
  return config.keyFile ? null : decodeKey(env.WORKERS_RECOVERY_KEY);
}
function decodeKey(s) { if (typeof s !== 'string' || !/^[0-9a-f]{64}$/i.test(s)) fail(); return Buffer.from(s, 'hex'); }
async function loadKey(config, env) {
  const key = keyFor(config, env); if (key) return key;
  const p = await canonical(config.keyFile); privateLocation(p); if ((await stat(p)).size > 128) fail(); return decodeKey((await readFile(p, 'utf8')).trim());
}
function policy(p) {
  if (!p || p.ownerApproved !== true || p.automaticDeletion !== false || p.independentCopy !== true) fail();
  for (const k of ['destinationIdentity', 'independenceEvidence', 'retentionPolicy', 'approvalReference']) if (typeof p[k] !== 'string' || !p[k].trim()) fail();
  for (const k of ['rpoSeconds', 'rtoSeconds']) if (!Number.isSafeInteger(p[k]) || p[k] <= 0) fail();
}
function artifact(a) {
  if (!a || !['d1-schema', 'd1-data', 'r2-object', 'private-config', 'capture-certificate'].includes(a.kind) || !Number.isSafeInteger(a.size) || a.size < 0 || !/^[a-f0-9]{64}$/.test(a.sha256)) fail();
  if (typeof a.path !== 'string' || !a.path || a.path.includes('\\') || path.posix.isAbsolute(a.path) || a.path.split('/').some(s => !s || s === '.' || s === '..' || /[:\x00-\x1f]/.test(s) || /[. ]$/.test(s) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))) fail();
}
function manifestCheck(m) {
  if (m?.format !== FORMAT || !/^[a-f0-9]{32}$/.test(m.bundleId)) fail(); policy(m.policy);
  if (!m.capture || m.capture.immutable !== true || m.capture.consistencyAccepted !== true || !Number.isFinite(Date.parse(m.capture.capturedAt)) || typeof m.capture.procedureReference !== 'string' || !m.capture.procedureReference.trim()) fail();
  if (!Array.isArray(m.artifacts) || !m.artifacts.length || m.artifacts.length > 100000) fail();
  const ids = new Set(), paths = new Set(), kinds = new Set();
  for (const a of m.artifacts) { artifact(a); if (!/^[a-f0-9]{32}$/.test(a.id) || ids.has(a.id) || paths.has(a.path.toLowerCase())) fail(); ids.add(a.id); paths.add(a.path.toLowerCase()); kinds.add(a.kind); }
  for (const k of ['d1-schema', 'd1-data', 'private-config', 'capture-certificate']) if (!kinds.has(k)) fail();
  if (!/^[a-f0-9]{64}$/.test(m.capture.certificateSha256) || !m.artifacts.some(a => a.kind === 'capture-certificate' && a.sha256 === m.capture.certificateSha256)) fail();
}
const aad = (id, item) => Buffer.from(JSON.stringify([FORMAT, id, item]));
function meter() { const h = createHash('sha256'); let size = 0; return { stream: new Transform({ transform(b, _, cb) { size += b.length; h.update(b); cb(null, b); } }), result: () => ({ size, sha256: h.digest('hex') }) }; }
async function sourceFile(root, rel) { const p = path.resolve(root, ...rel.split('/')); if (!inside(root, p)) fail(); await canonical(p); if (!(await stat(p)).isFile()) fail(); return p; }
async function encryptFile(source, output, key, additional, iv) {
  const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(additional);
  const handle = await open(output, 'wx', 0o600); await handle.write(iv); await handle.close();
  const measured = meter(); await pipeline(createReadStream(source), measured.stream, cipher, createWriteStream(output, { flags: 'a', mode: 0o600 }));
  const tail = await open(output, 'a'); try { await tail.write(cipher.getAuthTag()); } finally { await tail.close(); } return measured.result();
}
async function decryptFile(source, key, additional, destination) {
  const h = await open(source, 'r'); let size, iv = Buffer.alloc(12), tag = Buffer.alloc(16);
  try { size = (await h.stat()).size; if (size < 28) fail(); await h.read(iv, 0, 12, 0); await h.read(tag, 0, 16, size - 16); } finally { await h.close(); }
  const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAAD(additional); decipher.setAuthTag(tag);
  const measured = meter(); const sink = destination ? createWriteStream(destination, { flags: 'wx', mode: 0o600 }) : new Writable({ write(_b, _e, cb) { cb(); } });
  // Empty payloads have no ciphertext; an empty Readable is needed instead of an invalid range.
  const { Readable } = await import('node:stream');
  await pipeline(size === 28 ? Readable.from([]) : createReadStream(source, { start: 12, end: size - 17 }), decipher, measured.stream, sink);
  return measured.result();
}
function same(actual, expected) { if (actual.size !== expected.size || actual.sha256 !== expected.sha256) fail(); }
export async function packBundle(config, env = process.env) {
  const key = await loadKey(config, env); policy(config.policy);
  const source = await privateRoot(config.sourceRoot), parent = await privateRoot(config.privateRoot);
  const bundleId = randomBytes(16).toString('hex');
  const m = { format: FORMAT, bundleId, policy: config.policy, capture: config.capture, artifacts: (config.artifacts ?? []).map(a => ({ ...a, id: randomBytes(16).toString('hex') })) };
  manifestCheck(m);
  // Validate every source before creating output. Exporter-provided hashes are checked during streaming.
  const files = await Promise.all(m.artifacts.map(a => sourceFile(source, a.path)));
  const candidate = absolute(config.bundlePath); if (candidate === source || inside(source, candidate) || inside(candidate, source)) fail();
  const out = await newTarget(parent, candidate), ivs = new Set();
  function iv() { let b; do { b = randomBytes(12); } while (ivs.has(b.toString('hex'))); ivs.add(b.toString('hex')); return b; }
  for (let i = 0; i < files.length; i++) same(await encryptFile(files[i], path.join(out, m.artifacts[i].id + '.enc'), key, aad(bundleId, m.artifacts[i].id), iv()), m.artifacts[i]);
  const nonce = iv(), cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(aad(bundleId, 'manifest'));
  const sealed = Buffer.concat([nonce, cipher.update(JSON.stringify(m)), cipher.final(), cipher.getAuthTag()]);
  await writeFile(path.join(out, 'manifest.enc'), sealed, { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(out, 'bundle.json'), JSON.stringify({ format: FORMAT, bundleId }), { flag: 'wx', mode: 0o600 });
  return { status: 'PASS', artifacts: m.artifacts.length, scope: 'offline encrypted bundle; consistency attested by exporter, not independently proven' };
}
async function readBundle(config, key) {
  const folder = await privateRoot(config.bundlePath);
  const headerPath = await sourceFile(folder, 'bundle.json'); if ((await stat(headerPath)).size > 4096) fail();
  const h = JSON.parse(await readFile(headerPath, 'utf8')); if (h.format !== FORMAT || !/^[a-f0-9]{32}$/.test(h.bundleId)) fail();
  const mp = await sourceFile(folder, 'manifest.enc'); if ((await stat(mp)).size > 16 * 1024 * 1024) fail();
  const b = await readFile(mp); if (b.length < 28) fail();
  const decipher = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)); decipher.setAAD(aad(h.bundleId, 'manifest')); decipher.setAuthTag(b.subarray(-16));
  const m = JSON.parse(Buffer.concat([decipher.update(b.subarray(12, -16)), decipher.final()]).toString('utf8')); manifestCheck(m); if (m.bundleId !== h.bundleId) fail();
  const seenIV = new Set([b.subarray(0,12).toString('hex')]);
  for (const a of m.artifacts) {
    const p = await sourceFile(folder, a.id + '.enc'), f = await open(p, 'r'), iv = Buffer.alloc(12);
    try { await f.read(iv, 0, 12, 0); } finally { await f.close(); }
    if (seenIV.has(iv.toString('hex'))) fail(); seenIV.add(iv.toString('hex'));
    same(await decryptFile(p, key, aad(m.bundleId, a.id)), a);
  }
  return { folder, m };
}
export async function verifyBundle(config, env = process.env) { const { m } = await readBundle(config, await loadKey(config, env)); return { status: 'PASS', artifacts: m.artifacts.length, scope: 'authenticated offline bytes only' }; }
export async function prepareRestore(config, env = process.env) {
  if (config.restore?.newPrivateIsolatedTarget !== true || config.restore?.outgoingIntegrationsDisabled !== true || config.restore?.productionTraffic !== false) fail();
  const key = await loadKey(config, env), { folder, m } = await readBundle(config, key);
  const parent = await privateRoot(config.privateRoot), target = absolute(config.restorePath);
  // No overlap with the encrypted input or original exports, including their parents.
  if (target === folder || inside(target, folder) || inside(folder, target)) fail();
  await newTarget(parent, target);
  for (const a of m.artifacts) {
    const output = path.resolve(target, ...a.path.split('/')); if (!inside(target, output)) fail();
    await mkdir(path.dirname(output), { recursive: true, mode: 0o700 }); await canonical(path.dirname(output));
    same(await decryptFile(await sourceFile(folder, a.id + '.enc'), key, aad(m.bundleId, a.id), output), a);
  }
  // No SQL is executed and no provider is contacted. Operator must accept actual application restore separately.
  return { status: 'PASS', artifacts: m.artifacts.length, scope: 'new private plaintext preparation only; database/login/R2 restore acceptance pending' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, flag, configFile, ...extra] = process.argv.slice(2);
    if (flag !== '--config' || !configFile || extra.length || !['pack', 'verify', 'prepare-restore'].includes(command)) fail();
    const configPath = await canonical(path.resolve(configFile)); privateLocation(configPath);
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    console.log(JSON.stringify(await ({ pack: packBundle, verify: verifyBundle, 'prepare-restore': prepareRestore })[command](config)));
  } catch { console.error('RECOVERY_BUNDLE_REJECTED: validate private configuration, paths, policy, key and artifact integrity privately. No sensitive diagnostics emitted.'); process.exitCode = 1; }
}
