/**
 * @file The parser's suite: the union of rules the two sites state, on fixtures
 * written to a temporary directory.
 * @license AGPL-3.0-only
 *
 * The fixtures are sources on disk because a parser reads files: what a doc
 * block sits above is half of what makes it public. Each case names the rule it
 * pins, and the parity with the two live sites is measured where those sites
 * are (their own `parseSources` against this one), not here.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { parseSources } from '../src/generator/parse.js';

/** Write `{ 'name.js': text }` into a fresh directory; returns the root. */
function site(tree) {
  const root = mkdtempSync(join(tmpdir(), 'scholion-parse-'));
  for (const [path, text] of Object.entries(tree)) {
    const file = join(root, path);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}

const cleanup = (root) => rmSync(root, { recursive: true, force: true });

const block = (lines) => `/**\n${lines.map((line) => ` * ${line}`).join('\n')}\n */\n`;

test('an export names its symbol; a doc block over nothing public is ignored', () => {
  const root = site({
    'src/one.js': [
      block(['@file One', '@module one']),
      block(['A documented export.']),
      'export function alpha() {}',
      block(['An internal helper.']),
      'function beta() {}',
      block(['@function gamma', '@memberof one', 'Named by its tag.']),
      'export { gamma };',
    ].join('\n'),
  });
  const { modules, doclets } = parseSources({ src: join(root, 'src') });
  assert.equal(modules.length, 1);
  assert.equal(modules[0].name, 'one');
  assert.deepEqual(doclets.map((d) => d.name), ['alpha', 'gamma']);
  assert.equal(doclets[0].kind, 'function');
  assert.equal(doclets[1].owner, 'one');
  assert.equal(doclets[0].owner, 'one', 'an owner defaults to the module');
  cleanup(root);
});

test('a surface gate keeps only the names src/index.js re-exports', () => {
  const root = site({
    'src/one.js': [
      block(['@module one']),
      block(['Kept.']), 'export function kept() {}',
      block(['Dropped.']), 'export function dropped() {}',
    ].join('\n'),
    'src/index.js': "export { kept } from './one.js';\n",
  });
  const gated = parseSources({ src: join(root, 'src'), surface: true });
  assert.deepEqual(gated.doclets.map((d) => d.name), ['kept']);
  const open = parseSources({ src: join(root, 'src') });
  assert.deepEqual(open.doclets.map((d) => d.name), ['kept', 'dropped']);
  cleanup(root);
});

test('a surface gate also keeps a verb src/index.js declares itself', () => {
  const root = site({
    'src/one.js': [block(['@module one']), block(['Carried.']), 'export function alpha() {}'].join('\n'),
    'src/index.js': [
      block(['@file The root module', '@module root', '@license MIT']),
      "export { alpha } from './one.js';",
      '',
      block(['A verb of the root module.']),
      'export function program() {}',
    ].join('\n'),
  });
  const { doclets } = parseSources({ src: join(root, 'src'), surface: true });
  assert.deepEqual(doclets.map((d) => `${d.name}:${d.module}`), ['program:root', 'alpha:one']);
  cleanup(root);
});

test('members of the nominated class are public, and a getter joins its setter', () => {
  const root = site({
    'src/one.js': [
      block(['@module one']),
      'class Grid {',
      '  ' + block(['The width.', '@returns {number} The width.']).split('\n').join('\n  '),
      '  get width() { return 1; }',
      '  ' + block(['Set the width.', '@param {number} value The width.']).split('\n').join('\n  '),
      '  set width(value) {}',
      '  ' + block(['Private.']).split('\n').join('\n  '),
      '  _hidden() {}',
      '}',
      'export { Grid };',
    ].join('\n'),
  });
  const { doclets } = parseSources({ src: join(root, 'src'), members: 'Grid' });
  assert.equal(doclets.length, 1, 'the getter and the setter are one surface; the private one is gone');
  assert.equal(doclets[0].name, 'width');
  assert.equal(doclets[0].kind, 'accessor');
  assert.equal(doclets[0].owner, 'Grid');
  assert.match(doclets[0].description, /The width\.[\s\S]*Set the width\./);
  assert.equal(doclets[0].params[0].name, 'value');
  cleanup(root);
});

test('a static helper and the instance method that delegates to it are one surface', () => {
  const root = site({
    'src/one.js': [
      block(['@module one']),
      'class Grid {',
      '  ' + block(['Static test.', '@param {*} value', '@returns {boolean}']).split('\n').join('\n  '),
      '  static isFilled(value) { return true; }',
      '  ' + block(['Instance test.', '@param {number} row', '@param {number} col']).split('\n').join('\n  '),
      '  isFilled(row, col) { return Grid.isFilled(1); }',
      '}',
    ].join('\n'),
  });
  const { doclets } = parseSources({ src: join(root, 'src'), members: 'Grid' });
  assert.equal(doclets.length, 1);
  assert.equal(doclets[0].kind, 'surface');
  assert.deepEqual(doclets[0].surfaces, ['static', 'instance']);
  assert.equal(doclets[0].surfaceParams.static[0].name, 'value');
  assert.equal(doclets[0].surfaceParams.instance[0].name, 'row');
  assert.equal(doclets[0].params[0].name, 'value', 'the heading surface keeps its own list');
  cleanup(root);
});

test('@ignore is kept for a coverage check, or dropped', () => {
  const source = [block(['@module one']), block(['@ignore', 'A seam.']), 'export function seam() {}'].join('\n');
  const root = site({ 'src/one.js': source });
  const kept = parseSources({ src: join(root, 'src'), ignore: 'keep' });
  assert.deepEqual(kept.doclets.map((d) => `${d.name}:${d.ignore}`), ['seam:true']);
  const skipped = parseSources({ src: join(root, 'src'), ignore: 'skip' });
  assert.deepEqual(skipped.doclets, []);
  cleanup(root);
});

test('a leading _ is private, unless the site documents its underscored names', () => {
  const source = [
    block(['@module one']),
    block(['@constant {number[]} _i', '@memberof one', 'A basis vector.']),
    'export const _i = CONST(1)',
    block(['@constant {number[]} j', '@memberof one', 'A basis vector.']),
    'export const j = CONST(2)',
  ].join('\n');
  const root = site({ 'src/one.js': source });
  const skipped = parseSources({ src: join(root, 'src') });
  assert.deepEqual(skipped.doclets.map((d) => d.name), ['j'], 'an underscored name is not public surface');
  const kept = parseSources({ src: join(root, 'src'), private: 'keep' });
  assert.deepEqual(kept.doclets.map((d) => d.name), ['_i', 'j'], 'a site may document its underscored names');
  cleanup(root);
});

test('carrier files are public by declaration and marked reexport', () => {
  const root = site({
    'src/one.js': [block(['@module one']), block(['An export.']), 'export function alpha() {}'].join('\n'),
    'src/index.js': "export { alpha } from './one.js';\n",
    'docs/one.js': [
      block(['@file Carried surface', '@module docs/one']),
      block(['@function beta', '@memberof one', 'Carried.']),
    ].join('\n'),
  });
  const { doclets } = parseSources({
    src: join(root, 'src'), carriers: [join(root, 'docs')], surface: true,
  });
  assert.deepEqual(doclets.map((d) => `${d.name}:${d.reexport}`), ['alpha:false', 'beta:true']);
  cleanup(root);
});

test('dotted names nest under their parent, and an undeclared parent is an orphan', () => {
  const root = site({
    'src/one.js': [
      block(['@module one']),
      block(['Takes options.', '@param {Object} opts The options.', '@param {boolean} opts.on Whether.',
        '@param {number} opts.size How big.', '@param {string} ghost.a Parentless.']),
      'export function alpha(opts) {}',
    ].join('\n'),
  });
  const [doclet] = parseSources({ src: join(root, 'src') }).doclets;
  assert.equal(doclet.params.length, 2, 'opts and the orphaned ghost.a stay roots');
  assert.equal(doclet.params[0].children.length, 2, 'on and size nest under opts');
  assert.deepEqual(doclet.orphans, ['ghost.a']);
  cleanup(root);
});

test('an example carries an optional caption, and its code is trimmed', () => {
  const root = site({
    'src/one.js': [
      block(['@module one']),
      block(['Sketch.', '@example', '<caption>A red grid</caption>', '',
        'const q = createQuadrille(2);', 'q.fill(255, 0, 0);', '']),
      'export function alpha() {}',
    ].join('\n'),
  });
  const [doclet] = parseSources({ src: join(root, 'src') }).doclets;
  assert.equal(doclet.examples.length, 1);
  assert.equal(doclet.examples[0].caption, 'A red grid');
  assert.equal(doclet.examples[0].code, 'const q = createQuadrille(2);\nq.fill(255, 0, 0);');
  cleanup(root);
});

test('a fenced shader line inside an example is the comment\'s markup, not its code', () => {
  const root = site({
    'src/one.js': [
      block(['@module one']),
      block(['A shader.', '@example', 'const p = program(ctx, `',
        '```wgsl', '@fragment', 'fn fs() -> @location(0) vec4f {', '  return vec4f(1);', '}', '```',
        '`)']),
      'export function program() {}',
    ].join('\n'),
  });
  const [doclet] = parseSources({ src: join(root, 'src') }).doclets;
  assert.deepEqual(doclet.examples[0].code.split('\n'), [
    'const p = program(ctx, `',
    '@fragment',
    'fn fs() -> @location(0) vec4f {',
    '  return vec4f(1);',
    '}',
    '`)',
  ]);
  cleanup(root);
});

test('a module header reads its prose around the tags, and @details stays out of it', () => {
  const root = site({
    'src/one.js': [
      '/**',
      ' * @file One — the first module.',
      ' * @module one',
      ' * @license AGPL-3.0-only',
      ' *',
      ' * What a caller gets.',
      ' * @details How it is arranged, for whoever maintains it.',
      ' */',
      block(['An export.']),
      'export function alpha() {}',
    ].join('\n'),
  });
  const [module] = parseSources({ src: join(root, 'src') }).modules;
  assert.equal(module.name, 'one');
  assert.equal(module.title, 'One — the first module.');
  assert.equal(module.license, 'AGPL-3.0-only');
  assert.equal(module.description, 'What a caller gets.');
  assert.equal(module.detail, 'How it is arranged, for whoever maintains it.');
  cleanup(root);
});

test('@group and @page are read as the teaching area and its address', () => {
  const root = site({
    'src/one.js': [
      block(['@module one']),
      // A tag owns its continuation lines, so the prose comes before them.
      block(['A ring.', '@group accessors', '@page accessors/instance_creators/ring']),
      'export function ring() {}',
    ].join('\n'),
  });
  const [doclet] = parseSources({ src: join(root, 'src') }).doclets;
  assert.equal(doclet.group, 'accessors');
  assert.equal(doclet.page, 'accessors/instance_creators/ring');
  cleanup(root);
});
