/**
 * @file The built artifact's suite: the bytes the manifest names, the graph it
 * was made of, and the contract the bundle itself keeps.
 * @license AGPL-3.0-only
 *
 * The manifest is the consumer's interface — the site reads the asset name from
 * it and serves that file — so the suite checks the file against it: same
 * name, same size, same SHA-256. It then imports the bundle rather than the
 * source and mounts two editors, which is the only way to see the failure two
 * copies of `@codemirror/state` produce.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import { figure, install, page, press, settle } from './support/dom.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
const asset = join(dist, manifest.asset);
const bytes = readFileSync(asset);
const text = bytes.toString('utf8');

install(figure('installed before the bundle loads'));
const { mountEditor } = await import(pathToFileURL(asset).href);

const SOURCE = 'const value = 1;\n';
const MOD = { ctrlKey: true };

test('the manifest names the bytes: one hashed asset, its size and its SHA-256', () => {
  assert.equal(existsSync(asset), true, `${manifest.asset} is beside the manifest`);
  assert.match(manifest.asset, /^editor\.[0-9a-f]{10}\.js$/, 'a content-hashed name');
  assert.equal(bytes.length, manifest.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
  assert.equal(manifest.format, 'esm');
  assert.equal(manifest.entry, 'src/editor.js');
});

test('one graph: one JS file in dist, no sibling import, an ES module', () => {
  const scripts = readdirSync(dist).filter((name) => name.endsWith('.js'));
  assert.deepEqual(scripts, [manifest.asset], 'dist holds the asset and no other module to import');
  // esbuild puts a chunk's imports first; a single-file bundle starts with code.
  assert.equal(/^import[\s{*]/.test(text.trimStart()), false, 'no chunk import at the top of the file');
  assert.equal(/export\s*\{/.test(text), true, 'an ES module, not a UMD blob');
  assert.equal(manifest.toolchain.bundled, Object.keys(manifest.packages).length);
  assert.equal(Object.keys(manifest.packages).includes('@codemirror/state'), true);
});

test('the manifest records the versions and the notices of what it bundles', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const [name, version] of Object.entries(pkg.devDependencies)) {
    if (!name.startsWith('@codemirror/') && !name.startsWith('@lezer/')) continue;
    assert.equal(manifest.packages[name], version, `${name} is pinned to ${version}`);
  }
  for (const item of manifest.licenses) {
    assert.equal(manifest.packages[item.package], item.version);
    assert.equal(item.license, 'MIT');
    assert.match(item.notice, /Permission is hereby granted, free of charge/, `${item.package}'s notice text`);
  }
  assert.equal(manifest.licenses.length, Object.keys(manifest.packages).length);
  assert.match(manifest.toolchain.esbuild, /^\d+\.\d+\.\d+$/);
});

test('the bundle keeps the adapter contract in a page', async () => {
  const { window, document } = page(figure(SOURCE));
  const textarea = document.querySelector('textarea.source');
  let runs = 0;
  const adapter = mountEditor(textarea, { onRun: () => { runs += 1; } });

  assert.equal(adapter.getValue(), SOURCE);
  assert.equal(textarea.hidden, true);
  assert.ok(textarea.parentElement.querySelector('.cm-editor'));

  const content = textarea.parentElement.querySelector('.cm-content');
  adapter.focus();
  assert.equal(press(window, content, { key: 'Enter', ...MOD }).defaultPrevented, true);
  assert.equal(runs, 1, 'Mod-Enter runs the sketch');
  assert.equal(adapter.getValue(), SOURCE, 'and does not touch the source');

  press(window, content, { key: 'Enter' });
  await settle();
  assert.notEqual(adapter.getValue(), SOURCE);
  adapter.reset();
  assert.equal(adapter.getValue(), SOURCE, 'Reset is byte-exact through the bundle too');
  adapter.destroy();
});

test('two editors from one bundle: no duplicate state, no second graph', () => {
  const { document } = page(figure(SOURCE));
  const second = document.createElement('textarea');
  second.value = 'let other = 2;\n';
  document.body.append(second);
  const first = document.querySelector('textarea.source');

  const a = mountEditor(first, {});
  const b = mountEditor(second, {});
  assert.equal(document.querySelectorAll('.cm-editor').length, 2);
  assert.equal(a.getValue(), SOURCE);
  assert.equal(b.getValue(), 'let other = 2;\n');
  a.reset();
  b.reset();
  a.destroy();
  b.destroy();
});
