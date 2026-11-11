// Shared by package.mjs: file list, dev transform, checks (plan 9.6) and a deterministic zip writer.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROD_ORIGIN = 'https://freelance-place.com';
export const DEV_ORIGIN = 'http://localhost:3000';
export const XPLACE_MATCHES = ['https://www.xplace.com/*', 'https://xplace.com/*'];
export const BRIDGE_PATHS = ['/profile/import*', '/projects/new*'];

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
}

/** Only what the extension needs at runtime: manifest, src/**, icons/*.png. Sorted for stability. */
export function listFiles(root = ROOT) {
  const out = [];
  for (const d of ['src', 'icons', '_locales']) walk(path.join(root, d), out);
  out.push(path.join(root, 'manifest.json'));
  return out.map((p) => path.relative(root, p).split(path.sep).join('/')).filter((p) => !p.endsWith('.DS_Store')).sort();
}

export function readManifest(root = ROOT) { return JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')); }

export function devTransform(relPath, buffer) {
  if (relPath === 'manifest.json') {
    const m = JSON.parse(buffer.toString('utf8'));
    m.content_scripts[1].matches = BRIDGE_PATHS.map((p) => `${DEV_ORIGIN}${p}`);
    return Buffer.from(`${JSON.stringify(m, null, 2)}\n`);
  }
  if (relPath === 'src/config.js') {
    const text = buffer.toString('utf8');
    const next = text.replace(`const FP_ORIGIN = '${PROD_ORIGIN}';`, `const FP_ORIGIN = '${DEV_ORIGIN}';`);
    if (next === text) throw new Error('build:dev could not rewrite FP_ORIGIN in src/config.js');
    return Buffer.from(next);
  }
  return buffer;
}

const arrEq = (a, b) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

/** Plan 9.6 checks on a folder (the production sources). Returns a list of problems. */
export function runChecks(root = ROOT, files = listFiles(root)) {
  const problems = [];
  const m = readManifest(root);
  if (m.incognito !== 'not_allowed') problems.push('manifest must set incognito: "not_allowed"');
  if (m.default_locale !== 'he') problems.push('default_locale must be he');
  for (const loc of ['he', 'en']) {
    const lp = path.join(root, `_locales/${loc}/messages.json`);
    if (!fs.existsSync(lp)) { problems.push(`missing _locales/${loc}/messages.json`); continue; }
    const msgs = JSON.parse(fs.readFileSync(lp, 'utf8'));
    for (const key of ['extName', 'extDescription']) if (!msgs[key] || !msgs[key].message) problems.push(`_locales/${loc}: ${key} missing`);
  }
  if (m.name !== '__MSG_extName__' || m.description !== '__MSG_extDescription__') problems.push('name/description must use __MSG_extName__/__MSG_extDescription__');
  if (m.manifest_version !== 3) problems.push('manifest_version must be 3');
  if (JSON.stringify(m.permissions) !== JSON.stringify(['storage'])) problems.push(`permissions must be exactly ["storage"], got ${JSON.stringify(m.permissions)}`);
  for (const k of ['host_permissions', 'optional_host_permissions', 'optional_permissions', 'externally_connectable', 'web_accessible_resources', 'content_security_policy']) {
    if (k in m) problems.push(`manifest must not declare ${k}`);
  }
  const cs = m.content_scripts || [];
  if (cs.length !== 2) problems.push('exactly two content script entries expected');
  else {
    if (!arrEq(cs[0].matches, XPLACE_MATCHES)) problems.push(`XPlace content script matches must be exactly ${XPLACE_MATCHES.join(', ')}`);
    if (!arrEq(cs[1].matches, BRIDGE_PATHS.map((p) => `${PROD_ORIGIN}${p}`))) problems.push('bridge matches must be exactly the two Freelance Place hand-off paths');
    if (cs[0].run_at !== 'document_idle' || cs[1].run_at !== 'document_start') problems.push('run_at must be document_idle (XPlace) and document_start (bridge)');
  }
  const referenced = new Set();
  for (const c of cs) for (const f of c.js || []) referenced.add(f);
  if (m.background && m.background.service_worker) referenced.add(m.background.service_worker);
  if (m.options_ui && m.options_ui.page) referenced.add(m.options_ui.page);
  for (const f of Object.values(m.icons || {})) referenced.add(f);
  for (const s of [16, 32, 48, 128]) if (!m.icons || m.icons[String(s)] !== `icons/icon-${s}.png`) problems.push(`icon ${s} missing in manifest`);
  for (const f of referenced) if (!fs.existsSync(path.join(root, f))) problems.push(`manifest references a missing file: ${f}`);
  if (!fs.readFileSync(path.join(root, 'src/config.js'), 'utf8').includes(`const FP_ORIGIN = '${PROD_ORIGIN}';`)) problems.push('src/config.js FP_ORIGIN is not the production origin');

  for (const f of files) {
    if (!/\.(js|html|css|json)$/.test(f)) continue;
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    if (/\beval\s*\(/.test(text)) problems.push(`${f}: eval( found`);
    if (/new\s+Function\s*\(/.test(text)) problems.push(`${f}: new Function( found`);
    if (/\.innerHTML\s*=|insertAdjacentHTML|document\.write\s*\(/.test(text)) problems.push(`${f}: dynamic HTML sink found`);
    for (const m2 of text.matchAll(/importScripts\s*\(([^)]*)\)/g)) {
      if (/https?:|\/\//.test(m2[1]) || !/^\s*(['"])\.{1,2}\/[^'"]+\1(\s*,\s*(['"])\.{1,2}\/[^'"]+\3)*\s*$/.test(m2[1])) problems.push(`${f}: importScripts must only take relative local files`);
    }
    if (/<script\b[^>]*\bsrc=["']?(https?:)?\/\//i.test(text)) problems.push(`${f}: remote script`);
    if (f.endsWith('.html') && /\son[a-z]+\s*=/i.test(text)) problems.push(`${f}: inline event handler`);
    if (/\bfetch\s*\(\s*['"`]https?:/.test(text)) problems.push(`${f}: absolute-URL fetch found`);
  }
  for (const s of [16, 32, 48, 128]) {
    const p = path.join(root, `icons/icon-${s}.png`);
    if (!fs.existsSync(p) || fs.statSync(p).size < 100) problems.push(`icon-${s}.png missing or empty`);
  }
  return problems;
}

// ---- deterministic zip (store/deflate, fixed DOS time 2026-01-01 00:00) ----
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function makeZip(entries) {
  const DOS_TIME = 0; const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const locals = []; const centrals = []; let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(useDeflate ? 8 : 0, 8);
    lh.writeUInt16LE(DOS_TIME, 10); lh.writeUInt16LE(DOS_DATE, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(0x031e, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(useDeflate ? 8 : 0, 10);
    ch.writeUInt16LE(DOS_TIME, 12); ch.writeUInt16LE(DOS_DATE, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(0o100644 << 16 >>> 0, 38); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
