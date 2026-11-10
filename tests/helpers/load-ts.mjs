// Test helper: loads TypeScript/TSX project modules (and everything they import
// from the project) into a vm context so pure logic and server components can be
// exercised without Next.js, Firestore or network access.
//
//   const facts = loadModule('src/lib/seo/facts.ts', { env: { BILLING_ENABLED: 'true' } });
//
// - `@/…` and relative imports resolve to project files (extensions optional).
// - Packages must be stubbed or allow-listed; anything else throws so a test can
//   never silently reach firebase-admin, the network or the file system.
// - react, react/jsx-runtime and react-dom/server are real, so components can be
//   rendered with renderToStaticMarkup.
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const nodeRequire = createRequire(import.meta.url);
const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.json'];
const REAL_PACKAGES = ['react', 'react/jsx-runtime', 'react-dom/server'];

function isFile(file) {
  try { return statSync(file).isFile(); } catch { return false; }
}
function resolveProjectFile(specifier, fromFile) {
  const base = specifier.startsWith('@/') ? path.join(root, 'src', specifier.slice(2)) : path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, ...EXTENSIONS.map((ext) => base + ext), ...EXTENSIONS.map((ext) => path.join(base, `index${ext}`))];
  return candidates.find((file) => existsSync(file) && isFile(file));
}

function defaultStubs() {
  const React = nodeRequire('react');
  return {
    'server-only': {},
    // React's `cache` only exists in the server build; a pass-through is enough for tests.
    react: { ...React, cache: (fn) => fn },
    'next/link': { default: ({ href, children, prefetch, ...rest }) => React.createElement('a', { href: typeof href === 'string' ? href : String(href), ...rest }, children) },
    'next/image': { default: ({ src, alt, width, height, priority, ...rest }) => React.createElement('img', { src, alt, width, height, ...rest }) },
    'next/navigation': { notFound() { throw Object.assign(new Error('NEXT_NOT_FOUND'), { digest: 'NEXT_NOT_FOUND' }); } },
  };
}

export function loadModule(entry, { stubs = {}, env = { SITE_INDEXABLE: 'true' } } = {}) {
  const allStubs = { ...defaultStubs(), ...stubs };
  const context = vm.createContext({
    process: { env: { ...env } }, console, URL, URLSearchParams, TextEncoder, TextDecoder, Buffer,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, structuredClone,
    fetch: globalThis.fetch, Response, Request, Headers, AbortController, AbortSignal,
  });
  const cache = new Map();

  function requireFrom(specifier, from) {
    if (Object.hasOwn(allStubs, specifier)) return allStubs[specifier];
    if (specifier.endsWith('.css')) return {};
    if (specifier.startsWith('.') || specifier.startsWith('@/')) {
      const file = resolveProjectFile(specifier, from);
      if (!file) throw new Error(`Cannot resolve ${specifier} from ${path.relative(root, from)}`);
      return load(file);
    }
    if (REAL_PACKAGES.includes(specifier)) return nodeRequire(specifier);
    throw new Error(`Unexpected dependency: ${specifier} (imported by ${path.relative(root, from)}). Stub it in the test.`);
  }

  function load(file) {
    const cached = cache.get(file);
    if (cached) return cached.exports;
    const module = { exports: {} };
    cache.set(file, module);
    if (file.endsWith('.json')) { module.exports = JSON.parse(readFileSync(file, 'utf8')); return module.exports; }
    const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    });
    const wrapper = vm.runInContext(`(function (exports, require, module, __filename, __dirname) {${outputText}\n})`, context, { filename: file });
    wrapper(module.exports, (specifier) => requireFrom(specifier, file), module, file, path.dirname(file));
    return module.exports;
  }

  const file = path.resolve(root, entry);
  if (!isFile(file)) throw new Error(`Entry module not found: ${entry}`);
  return load(file);
}

export { root as projectRoot };
