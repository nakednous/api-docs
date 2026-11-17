#!/usr/bin/env node
/**
 * @file The editor bundle build: one ES module graph, one content-hashed file,
 * and the release manifest that names its bytes.
 * @license AGPL-3.0-only
 *
 * `npm run build` bundles `src/editor.js` with esbuild — `bundle: true`,
 * `format: esm`, `platform: browser`, no splitting, no downlevelling — then
 * hashes the bytes and writes them as `dist/editor.<hash>.js`. The manifest
 * beside it records the asset name, its size, its SHA-256, the exact versions
 * of every package that ended up in the graph, the esbuild version and the
 * license notice of each of those packages.
 *
 * Two invariants fail the build rather than shipping silently: every bundled
 * `@codemirror/*` and `@lezer/*` package must resolve to exactly one directory
 * (two copies of `@codemirror/state` in one page is the documented
 * `Unrecognized extension value` failure), and the asset must carry no import
 * of its own — a second module would be a graph the site has to serve too.
 *
 * The output is deterministic: the same inputs produce the same bytes and the
 * same name.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const at = (p) => join(root, p);

const PKG_RE = /node_modules\/((?:@[^/]+\/)?[^/]+)\//;

/** The packages the graph is made of, read off esbuild's own input list. */
function bundled(metafile) {
  const found = new Map();          // package → Set of installed directories
  for (const file of Object.keys(metafile.inputs)) {
    const m = PKG_RE.exec(file);
    if (!m) continue;
    const dir = file.slice(0, m.index + m[0].length);
    if (!found.has(m[1])) found.set(m[1], new Set());
    found.get(m[1]).add(dir);
  }
  for (const [name, dirs] of found) {
    if (dirs.size > 1) {
      throw new Error(`[editor] ${name} appears ${dirs.size} times in the graph: ${[...dirs].join(', ')}`);
    }
  }
  return new Map([...found].map(([name, dirs]) => [name, [...dirs][0]]).sort(([a], [b]) => a.localeCompare(b)));
}

/** The notice a package ships, and the licence it declares. */
function notices(name, dir) {
  const pkg = JSON.parse(readFileSync(at(join(dir, 'package.json')), 'utf8'));
  const file = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license']
    .map((f) => at(join(dir, f))).find(existsSync);
  const text = file ? readFileSync(file, 'utf8').trim() : '';
  return { package: name, version: pkg.version, license: pkg.license ?? null, notice: text };
}

/** The asset's bytes, hashed, and the manifest that names them. */
function publish(bytes, meta) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const asset = `editor.${sha256.slice(0, 10)}.js`;
  const manifest = {
    name: meta.name,
    version: meta.version,
    format: 'esm',
    entry: 'src/editor.js',
    asset,
    bytes: bytes.length,
    sha256,
    packages: Object.fromEntries(meta.packages.map((p) => [p.package, p.version])),
    toolchain: { esbuild: esbuild.version, bundled: meta.bundled },
    licenses: meta.packages,
  };
  return { asset, manifest, sha256 };
}

async function main() {
  const pkg = JSON.parse(readFileSync(at('package.json'), 'utf8'));
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  const temporary = join(dist, 'editor.build.js');
  const result = await esbuild.build({
    entryPoints: [at('src/editor.js')],
    outfile: temporary,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'esnext',
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    metafile: true,
    absWorkingDir: root,
    logLevel: 'silent',
  });

  const graph = bundled(result.metafile);
  const names = [...graph.keys()];
  const bytes = readFileSync(temporary);
  const text = bytes.toString('utf8');
  const imports = [...text.matchAll(/^\s*import\s[^;]*?from\s*["']([^"']+)["']/gm)].map((m) => m[1]);
  if (imports.length) {
    throw new Error(`[editor] the asset imports ${imports.join(', ')}; a single-file bundle may not`);
  }

  const packages = names.map((name) => notices(name, graph.get(name)));
  const { asset, manifest, sha256 } = publish(bytes, { ...pkg, packages, bundled: names.length });

  rmSync(temporary, { force: true });
  writeFileSync(join(dist, asset), bytes);
  writeFileSync(join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const gzip = await import('node:zlib').then(({ gzipSync }) => gzipSync(bytes, { level: 9 }).length);
  const k = (n) => `${(n / 1024).toFixed(1)} kB`;
  console.log(`[editor] dist/${asset} ${k(bytes.length)} (${k(gzip)} gzip) sha256 ${sha256.slice(0, 16)}…`);
  console.log(`[editor] ${names.length} package(s) in one graph: ${names.join(' ')}`);
  const files = readdirSync(dist).sort();
  if (files.length !== 2) throw new Error(`[editor] dist/ should hold the asset and the manifest, not ${files.join(' ')}`);
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
