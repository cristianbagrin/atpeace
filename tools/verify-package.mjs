#!/usr/bin/env node
// verify-package — checks the built add-on package before it is signed or installed.
//
//   node tools/verify-package.mjs [path/to/at-peace-<version>.zip]
//   npm run verify:package            builds first (web-ext build), then checks the fresh zip
//
// It unzips the package into a temporary folder (own tiny zip reader: no extra dependency) and checks
//   - the zip is named after the manifest version, which matches package.json;
//   - only manifest.json, icons/ and src/ are in it: no tests, tools, docs, node_modules, markdown,
//     the Chrome-only service worker, dotfiles;
//   - every file the manifest names exists inside the package (icons, background scripts, content
//     scripts, popup, options page, web_accessible_resources patterns match something);
//   - every extension page's <script src>, <link href>, <img src>, and every CSS url() and static ES
//     `import` resolves to a file inside the package, and nothing loads from the network;
//   - every string literal in the code that looks like a path into the package ('src/…', 'icons/…')
//     exists (runtime.getURL, registerContentScripts, …).
// Files nothing refers to are listed as a warning (a reference by a computed name is invisible here).
// Exit code 1 when a check fails.
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------------------------
// A small zip reader (central directory, stored + deflate), enough for what web-ext writes.
// ---------------------------------------------------------------------------------------------

/**
 * @param {Buffer} buf
 * @returns {{ name: string, data: Buffer, isDir: boolean }[]}
 */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error('corrupt central directory');
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    const isDir = name.endsWith('/');
    if (isDir) {
      entries.push({ name, data: Buffer.alloc(0), isDir });
      continue;
    }
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`corrupt local header for ${name}`);
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(start, start + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`${name}: unsupported compression method ${method}`);
    entries.push({ name, data, isDir });
  }
  return entries;
}

// ---------------------------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------------------------

/** What the package may contain at the top level. */
const ALLOWED_TOP = new Set(['manifest.json', 'icons', 'src']);
/** Files that must stay out even inside the allowed folders. */
const FORBIDDEN_NAMES = [/(^|\/)sw-chrome\.js$/, /\.md$/i, /\.map$/, /(^|\/)\.[^/]+/, /\.(test|spec)\.m?js$/, /(^|\/)package(-lock)?\.json$/];
const REMOTE = /^(?:https?:)?\/\//i;

/** A glob from web_accessible_resources ('src/pages/pause/*', '**' allowed) as a RegExp. */
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '@@ANY@@').replace(/\*/g, '[^/]*').replace(/@@ANY@@/g, '.*').replace(/\?/g, '[^/]');
  return new RegExp(`^${escaped}$`);
}

/** Collects `src`/`href` style references out of an HTML page (no HTML parser: the pages are ours and simple). */
function htmlRefs(html) {
  const refs = [];
  for (const m of html.matchAll(/<script\b[^>]*?\bsrc\s*=\s*"([^"]+)"/gi)) refs.push({ kind: 'script', ref: m[1] });
  for (const m of html.matchAll(/<link\b[^>]*?\bhref\s*=\s*"([^"]+)"/gi)) refs.push({ kind: 'link', ref: m[1] });
  for (const m of html.matchAll(/<(?:img|source|video|audio)\b[^>]*?\bsrc\s*=\s*"([^"]+)"/gi)) refs.push({ kind: 'media', ref: m[1] });
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*"([^"#][^"]*)"/gi)) if (!REMOTE.test(m[1]) && !/^(?:mailto|about|moz-extension|javascript):/i.test(m[1])) refs.push({ kind: 'anchor', ref: m[1] });
  return refs;
}

/** url(...) references in CSS, minus data: URIs and in-page fragments. */
function cssRefs(css) {
  const refs = [];
  for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) refs.push(m[2]);
  for (const m of css.matchAll(/@import\s+(?:url\(\s*)?(['"])([^'"]+)\1/gi)) refs.push(m[2]);
  return refs.filter((r) => !r.startsWith('data:') && !r.startsWith('#'));
}

/** Static ES module imports: `import x from './a.js'`, `import './a.js'`, `export … from './a.js'`. */
function importRefs(js) {
  const refs = [];
  for (const m of js.matchAll(/(?:^|[\n;])\s*(?:import|export)\s+(?:[^'";]*?\sfrom\s+)?(['"])([^'"]+)\1/g)) refs.push(m[2]);
  for (const m of js.matchAll(/\bimport\(\s*(['"])([^'"]+)\1\s*\)/g)) refs.push(m[2]);
  return refs.filter((r) => r.startsWith('.') || r.startsWith('/'));
}

/** String literals that name a file inside the package. */
function literalPaths(js) {
  const found = new Set();
  for (const m of js.matchAll(/(['"`])((?:src|icons)\/[A-Za-z0-9_./-]+\.(?:html|js|css|png|svg|json))\1/g)) found.add(m[2]);
  return [...found];
}

/**
 * Runs every check on an unzipped package.
 * @param {{ files: Set<string>, read: (path: string) => Promise<string>, manifest: object }} pkg
 * @returns {Promise<{ errors: string[], warnings: string[], referenced: Set<string> }>}
 */
export async function checkPackage({ files, read, manifest }) {
  const errors = [];
  const warnings = [];
  const referenced = new Set(['manifest.json']);
  const needs = (from, path, why) => {
    if (!files.has(path)) errors.push(`${from}: ${why} "${path}" is not in the package`);
    else referenced.add(path);
  };

  // --- the manifest ---
  for (const path of Object.values(manifest.icons ?? {})) needs('manifest.json', path, 'icon');
  for (const path of Object.values(manifest.action?.default_icon ?? {})) needs('manifest.json', path, 'toolbar icon');
  if (manifest.action?.default_popup) needs('manifest.json', manifest.action.default_popup, 'popup');
  if (manifest.options_ui?.page) needs('manifest.json', manifest.options_ui.page, 'options page');
  for (const path of manifest.background?.scripts ?? []) needs('manifest.json', path, 'background script');
  if (manifest.background?.service_worker) needs('manifest.json', manifest.background.service_worker, 'service worker');
  for (const [i, cs] of (manifest.content_scripts ?? []).entries()) {
    for (const path of cs.js ?? []) needs(`manifest.json content_scripts[${i}]`, path, 'script');
    for (const path of cs.css ?? []) needs(`manifest.json content_scripts[${i}]`, path, 'stylesheet');
  }
  for (const [i, war] of (manifest.web_accessible_resources ?? []).entries()) {
    for (const pattern of war.resources ?? []) {
      const re = globToRegExp(pattern);
      const hits = [...files].filter((f) => re.test(f));
      if (hits.length === 0) errors.push(`manifest.json web_accessible_resources[${i}]: "${pattern}" matches nothing in the package`);
      for (const hit of hits) referenced.add(hit);
    }
  }

  // --- every page and script we ship ---
  for (const file of [...files].sort()) {
    const dir = posix.dirname(file);
    const resolveRef = (ref) => {
      const clean = ref.split('#')[0].split('?')[0];
      return clean.startsWith('/') ? clean.slice(1) : posix.normalize(posix.join(dir, clean));
    };

    if (file.endsWith('.html')) {
      const html = await read(file);
      for (const { kind, ref } of htmlRefs(html)) {
        if (REMOTE.test(ref)) {
          errors.push(`${file}: ${kind} "${ref}" loads from the network`);
          continue;
        }
        if (ref.startsWith('data:') || ref.startsWith('moz-extension:')) continue;
        needs(file, resolveRef(ref), kind);
      }
      if (/<script\b(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html)) errors.push(`${file}: has an inline script`);
      if (/\son[a-z]+\s*=\s*["']/i.test(html)) errors.push(`${file}: has an inline event handler`);
    } else if (file.endsWith('.css')) {
      const css = await read(file);
      for (const ref of cssRefs(css)) {
        if (REMOTE.test(ref)) errors.push(`${file}: url "${ref}" loads from the network`);
        else needs(file, resolveRef(ref), 'url()');
      }
    } else if (file.endsWith('.js')) {
      const js = await read(file);
      if (file.startsWith('src/pages/')) {
        for (const ref of importRefs(js)) needs(file, resolveRef(ref), 'import');
      }
      for (const path of literalPaths(js)) needs(file, path, 'path');
    }
  }

  // --- anything nothing refers to ---
  const unreferenced = [...files].filter((f) => !referenced.has(f) && !f.endsWith('/')).sort();
  for (const f of unreferenced) warnings.push(`${f}: nothing in the package refers to this file (a computed reference would not show up here)`);

  return { errors, warnings, referenced };
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

async function main() {
  const pkgJson = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const sourceManifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
  const zipPath = resolve(process.argv[2] ?? join(ROOT, 'web-ext-artifacts', `at-peace-${sourceManifest.version}.zip`));
  if (!existsSync(zipPath)) {
    console.error(`No package at ${zipPath}. Run \`npm run build\` first (or use \`npm run verify:package\`, which builds).`);
    process.exit(1);
  }

  const failures = [];
  const entries = readZip(await readFile(zipPath));
  const dir = await mkdtemp(join(tmpdir(), 'at-peace-pkg-'));
  try {
    // Unzip for real, so the check sees exactly what an installer would.
    for (const entry of entries) {
      const target = join(dir, entry.name);
      if (relative(dir, target).startsWith('..')) throw new Error(`unsafe path in zip: ${entry.name}`);
      if (entry.isDir) await mkdir(target, { recursive: true });
      else {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, entry.data);
      }
    }

    const files = new Set();
    const walk = async (rel) => {
      for (const item of await readdir(join(dir, rel), { withFileTypes: true })) {
        const path = rel === '' ? item.name : `${rel}/${item.name}`;
        if (item.isDirectory()) await walk(path);
        else files.add(path);
      }
    };
    await walk('');

    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    if (manifest.version !== pkgJson.version) failures.push(`manifest.json version ${manifest.version} differs from package.json ${pkgJson.version}`);
    if (!zipPath.endsWith(`at-peace-${manifest.version}.zip`) && process.argv[2] === undefined) failures.push(`the zip name does not carry version ${manifest.version}`);

    for (const f of files) {
      const top = f.split('/')[0];
      if (!ALLOWED_TOP.has(top)) failures.push(`${f}: "${top}" does not belong in the package`);
      for (const re of FORBIDDEN_NAMES) if (re.test(f)) failures.push(`${f}: must not be shipped (${re})`);
    }
    for (const must of ['manifest.json', 'src/background/background.js']) if (!files.has(must)) failures.push(`${must} is missing`);

    const read = (path) => readFile(join(dir, path.split('/').join(sep)), 'utf8');
    const { errors, warnings } = await checkPackage({ files, read, manifest });
    failures.push(...errors);

    let bytes = 0;
    for (const f of files) bytes += (await stat(join(dir, f))).size;
    const zipBytes = (await stat(zipPath)).size;
    const byFolder = new Map();
    for (const f of files) {
      const key = f.split('/').slice(0, f.startsWith('src/') ? 2 : 1).join('/');
      byFolder.set(key, (byFolder.get(key) ?? 0) + 1);
    }

    console.log(`package   ${relative(ROOT, zipPath)} (${(zipBytes / 1024).toFixed(0)} KiB zipped, ${(bytes / 1024).toFixed(0)} KiB unpacked)`);
    console.log(`manifest  ${manifest.name} ${manifest.version}, ${files.size} files`);
    for (const [folder, n] of [...byFolder].sort()) console.log(`  ${folder.padEnd(14)} ${n}`);
    for (const w of warnings) console.warn(`warning: ${w}`);
    if (failures.length > 0) {
      for (const f of failures) console.error(`FAIL: ${f}`);
      console.error(`\n${failures.length} problem${failures.length === 1 ? '' : 's'} in the package.`);
      process.exitCode = 1;
    } else {
      console.log(`\nOK: every reference resolves inside the package; nothing but manifest.json, icons/ and src/ is in it.`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
