/**
 * @file The generator's suite: the declaration, the reference grammars, the
 * link table, validation, the renderer and a whole build, on a fixture site.
 * @license AGPL-3.0-only
 *
 * The fixture is a site on disk — a package manifest, a source file, a
 * documentation-only carrier, an IIFE, a static directory and a declaration —
 * because every step of this pipeline reads files. The pilot's parity with
 * webgl.tree's own pipeline is measured at that site, not here.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { build, BuildError } from '../src/generator/build.js';
import { DeclarationError, normalize } from '../src/generator/declaration.js';
import { linker } from '../src/generator/links.js';
import { parseSources } from '../src/generator/parse.js';
import { externalRef, packageUrl } from '../src/generator/references.js';
import { render } from '../src/generator/render.js';
import { validate } from '../src/generator/validate.js';

/** Write `{ 'path': text }` into a fresh directory; returns its root. */
function site(tree) {
  const root = mkdtempSync(join(tmpdir(), 'scholion-build-'));
  for (const [path, text] of Object.entries(tree)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}

const cleanup = (root) => rmSync(root, { recursive: true, force: true });

const block = (lines) => `/**\n${lines.map((line) => ` * ${line}`).join('\n')}\n */\n`;

/** The quiet log a build writes through, so a test reads the findings instead of stderr. */
function recorder() {
  const seen = { warnings: [], errors: [] };
  return { seen, warn: (line) => seen.warnings.push(line), error: (line) => seen.errors.push(line) };
}

// ── The fixture site ────────────────────────────────────────────────────────

const FIXTURE = {
  'package.json': JSON.stringify({ name: 'fixture.tree', version: '1.2.3', license: 'MIT' }),
  'README.md': [
    '# fixture.tree',
    '',
    'The [alpha surface](https://example.test/docs/mod.html#fixture/mod.alpha) is what this page documents.',
    '',
    '```js',
    'const n = fixtureTree.mod.alpha(1, 2)',
    '```',
    '',
  ].join('\n'),
  'src/index.js': "export { alpha } from './mod.js';\n",
  'src/mod.js': [
    block([
      '@file The fixture module',
      '@module fixture/mod',
      '@license MIT',
      '',
      'Prose for the module.',
    ]),
    block([
      'Alpha adds, and {@link beta} multiplies.',
      '@param {number} a The first operand.',
      '@param {number} b The second operand.',
      '@returns {number} The sum.',
      '@example',
      'const n = fixtureTree.mod.alpha(1, 2)',
    ]),
    'export function alpha(a, b) {}',
    '',
  ].join('\n'),
  'docs/carrier.js': [
    block([
      '@file A documentation-only carrier',
      '@module fixture/carrier',
      '@license MIT',
    ]),
    block([
      'Beta multiplies.',
      '@function beta',
      '@memberof fixture/mod',
      '@param {number} a The first operand.',
      '@returns {number} The product.',
      '@example',
      'const n = fixtureTree.mod.beta(2, 3)',
    ]),
    block(['An internal helper.', '@ignore']),
    'export function helper() {}',
    '',
  ].join('\n'),
  'dist/fixture.js': 'var fixtureTree = (function () {\n' +
    '  var mod = { alpha: function alpha(a, b) { return a + b; },\n' +
    '              beta: function beta(a) { return a; } };\n' +
    '  return { mod: mod };\n' +
    '})();\n',
  'tools/docs/static/assets/style.css': ':root { color-scheme: light dark; }\n',
  'tools/docs/static/assets/runner.js': '// the fixture runner\n',
  'tools/docs/static/assets/search.js': '// the fixture search\n',
  'tools/docs/static/assets/chrome.js': '// the fixture chrome\n',
  'tools/docs/static/favicon.png': '',
  'tools/docs/esm.md': [
    '## ES modules',
    '',
    'The module build is `dist/index.js`.',
    '',
    '<!-- caption: A demo. -->',
    '```js',
    "import { alpha } from 'fixture.tree'",
    '',
    'alpha(1, 2)',
    '```',
    '',
  ].join('\n'),
};

const DECLARATION = {
  paths: {
    pkg: 'package.json',
    readme: 'README.md',
    src: 'src',
    bundle: 'dist/fixture.js',
    static: 'tools/docs/static',
    site: 'site',
  },
  outputs: { bundle: 'fixture.tree.js', index: 'search.json', editor: 'assets', notices: 'assets/editor.LICENSES.txt' },
  carrier: { docs: 'docs', landing: { file: 'tools/docs/esm.md', section: 'esm', id: 'es-modules' } },
  parse: { surface: true, ignore: 'skip' },
  examples: { syntax: 'global', global: 'fixtureTree', required: true },
  surface: { global: 'fixtureTree', check: 'all' },
  owners: { 'fixture/mod': 'mod', 'fixture/carrier': 'mod' },
  namespaces: ['mod'],
  pins: { 'tool.js': { version: '9.9.9', script: 'dist/tool.js', module: 'dist/tool.module.js' } },
  references: {
    packages: { 'fixture.tree': 'https://example.test/repo', '@scope/lib': 'https://example.test/lib' },
    externals: [{
      prefix: 'ext',
      base: 'https://ext.test/docs/',
      url: {
        qualified: 'ns-{ns}.html#.{member}',
        one: 'flat-{member}.html',
        namespace: 'module-{member}.html',
        namespaces: ['m4'],
        classes: '^[A-Z]',
        class: 'class-{member}.html',
        pages: { own: 'own.html#.{member}' },
      },
      text: '{member}',
    }],
  },
  home: 'https://example.test/docs/',
  mode: 'esm',
  shell: { stylesheet: 'assets/style.css', favicon: [{ sizes: '32x32', href: 'favicon.png' }] },
  runner: {
    script: 'assets/runner.js',
    search: 'assets/search.js',
    chrome: 'assets/chrome.js',
    config: {
      tool: '{pin:tool.js:script}',
      lib: './{bundle}',
      imports: { 'tool.js': '{pin:tool.js:module}', 'fixture.tree': './{module}' },
      index: '{index}',
      editor: '{editor}',
    },
  },
  plugins: [],
};

/** The fixture with one key replaced (a shallow merge of the top level). */
const withDecl = (patch) => ({ ...DECLARATION, ...patch });

// ── The declaration ─────────────────────────────────────────────────────────

test('a declaration defaults to the package manifest, and refuses one it cannot build', () => {
  const pkg = { name: 'x.tree', version: '0.0.1', license: 'MIT' };
  const decl = normalize({ paths: { src: 'src', pkg: 'package.json', site: 'site' }, outputs: { index: 'search.json' }, runner: { script: 'r.js' } }, pkg);
  assert.deepEqual(decl.brand, { name: 'x.tree', version: '0.0.1', license: 'MIT' });
  assert.equal(decl.mode, 'esm');
  assert.equal(decl.examples.syntax, 'any');
  assert.equal(decl.parse.ignore, 'keep');
  assert.throws(() => normalize({ paths: { pkg: 'package.json', site: 'site' }, outputs: { index: 'i' }, runner: { script: 'r.js' } }, pkg), DeclarationError);
  assert.throws(() => normalize({ ...DECLARATION, mode: 'umd' }, pkg), DeclarationError);
  assert.throws(() => normalize({ ...DECLARATION, surface: {} }, pkg), DeclarationError);
});

test('a brand a declaration states wins over the manifest', () => {
  const decl = normalize({ ...DECLARATION, brand: { name: 'Fixture' } },
    { name: 'fixture.tree', version: '1.2.3', license: 'MIT' });
  assert.equal(decl.brand.name, 'Fixture');
  assert.equal(decl.brand.version, '1.2.3');
});

test('a declaration states no palette: the colour is the site\'s stylesheet', () => {
  const decl = normalize({ ...DECLARATION, palette: ['#000000', '#ffffff'] },
    { name: 'fixture.tree', version: '1.2.3', license: 'MIT' });
  assert.equal('palette' in decl, false, 'a palette pair is not a declaration field');
  assert.equal(decl.shell.base, null, 'and a site that states no base keeps the one stylesheet it wrote');
});

// ── References ──────────────────────────────────────────────────────────────

test('an external grammar resolves every shape it declares, and its text', () => {
  const refs = DECLARATION.references;
  const of = (name) => externalRef(refs, name);
  assert.equal(of('ext.one').url, 'https://ext.test/docs/flat-one.html');
  assert.equal(of('ext.one').text, 'one');
  assert.equal(of('ext.m4').url, 'https://ext.test/docs/module-m4.html', 'a declared namespace is its own module page');
  assert.equal(of('ext.own').url, 'https://ext.test/docs/own.html#.own', 'a member with a page of its own');
  assert.equal(of('ext.Thing').url, 'https://ext.test/docs/class-Thing.html', 'a one-segment name matching the class pattern');
  assert.equal(of('ext.ns.member').url, 'https://ext.test/docs/ns-ns.html#.member');
  assert.equal(of('ext'), null, 'the prefix alone is not a name');
  assert.equal(of('ext.a.b.c'), null, 'three segments after the prefix is not a shape');
  assert.equal(of('other.one'), null, 'another library is not this grammar\'s');
});

test('an external grammar leaves an excluded name alone, and {rest} drops the prefix from a link\'s text', () => {
  const refs = { externals: [{
    prefix: 'lib',
    base: 'https://lib.test/',
    url: { qualified: 'ns/{ns}/{member}', one: 'one/{member}' },
    exclude: ['Own'],
    text: '{rest}',
  }] };
  assert.equal(externalRef(refs, 'lib.Own'), null, 'a name the grammar excludes');
  assert.equal(externalRef(refs, 'lib.Own.member'), null, 'and one under an excluded namespace');
  assert.deepEqual(externalRef(refs, 'lib.one'), { url: 'https://lib.test/one/one', text: 'one' });
  assert.deepEqual(externalRef(refs, 'lib.Ns.member'), { url: 'https://lib.test/ns/Ns/member', text: 'Ns.member' });
});

test('a package resolves to the address the declaration states, or not at all', () => {
  assert.equal(packageUrl(DECLARATION.references, 'fixture.tree'), 'https://example.test/repo');
  assert.equal(packageUrl(DECLARATION.references, 'nope'), null);
});

// ── Links ───────────────────────────────────────────────────────────────────

test('prose links resolve a documented name, a package and an external one; fences are untouched', () => {
  const root = site(FIXTURE);
  const parsed = parseSources({ src: join(root, 'src'), carriers: [join(root, 'docs')], surface: true, ignore: 'skip' });
  const link = linker({ parsed, references: DECLARATION.references, namespaces: ['mod'], brand: 'fixture.tree' });

  assert.match(link.mdInline('See `alpha(1)`.'), /<a href="mod.html#fixture\/mod.alpha"><code>alpha\(1\)<\/code><\/a>/);
  assert.match(link.mdInline('The `@scope/lib` package.'), /<a href="https:\/\/example.test\/lib"><code>@scope\/lib<\/code><\/a>/);
  assert.match(link.mdInline('The `ext.m4` module.'), /module-m4\.html/);
  assert.match(link.mdInline('{@link beta}.'), /<a href="carrier.html#fixture\/mod.beta">/);
  assert.match(link.md('```\n`alpha`\n```'), /`alpha`/, 'a fence keeps its code plain');
  assert.match(link.mdInline('`unknownName`'), /^<code>unknownName<\/code>$/, 'an unknown name stays code');
  cleanup(root);
});

test('a name several owners share stays plain unless the landing page prefers one', () => {
  const root = site({
    ...FIXTURE,
    'src/two.js': [
      block(['@file Two', '@module fixture/two', '@license MIT']),
      block(['Alpha again, on another owner.', '@function alpha', '@memberof Other']),
      'export function alpha() {}',
      '',
    ].join('\n'),
  });
  const parsed = parseSources({ src: join(root, 'src'), surface: false, ignore: 'skip' });
  const link = linker({ parsed, references: {}, brand: 'fixture' });
  assert.match(link.mdInline('`alpha`'), /^<code>alpha<\/code>$/, 'ambiguous on a page');
  assert.match(link.mdInline('`alpha`', { prefer: true }), /href="mod.html#fixture\/mod.alpha"/, 'the landing page prefers the site\'s own module');
  cleanup(root);
});

test('an owner the declaration puts first wins a bare name on every page', () => {
  const root = site({
    ...FIXTURE,
    'src/two.js': [
      block(['@file Two', '@module fixture/two', '@license MIT']),
      block(['Alpha again, on the sketch owner.', '@function alpha', '@memberof Other']),
      'export function alpha() {}',
      '',
    ].join('\n'),
  });
  const parsed = parseSources({ src: join(root, 'src'), carriers: [join(root, 'docs')], ignore: 'keep' });
  const plain = linker({ parsed, references: {}, brand: 'fixture.tree' });
  assert.match(plain.mdInline('`alpha`'), /^<code>alpha<\/code>$/, 'ambiguous name, plain code');
  assert.equal(plain.table.get('alpha').doclet.owner, 'fixture/mod', 'first doclet wins');
  const ordered = linker({ parsed, references: {}, ownerOrder: ['Other'], brand: 'fixture.tree' });
  assert.equal(ordered.table.get('alpha').doclet.owner, 'Other', 'the declared owner wins the bare name');
  assert.match(ordered.mdInline('`alpha`'), /two\.html#Other\.alpha/, 'and the name earns its link');
  cleanup(root);
});

test('a plugin anchor joins the table, and prose links to it', () => {
  const root = site(FIXTURE);
  const parsed = parseSources({ src: join(root, 'src'), carriers: [join(root, 'docs')], surface: true, ignore: 'skip' });
  const link = linker({ parsed, references: {}, brand: 'fixture.tree' });
  link.addAnchor('gloss', 'terms.html#gloss');
  assert.match(link.mdInline('`gloss`'), /<a href="terms.html#gloss">/);
  cleanup(root);
});

// ── Validation ──────────────────────────────────────────────────────────────

/** The fixture parsed and linked, as `build` would hand it to `validate`. */
function fixtureParsed(tree = FIXTURE, options = {}) {
  const root = site(tree);
  const parsed = parseSources({
    src: join(root, 'src'),
    carriers: [join(root, 'docs')],
    surface: true,
    ignore: 'skip',
    ...options,
  });
  const link = linker({ parsed, references: DECLARATION.references, namespaces: ['mod'], brand: 'fixture.tree' });
  return { root, parsed, link };
}

const readmeOf = (root) => readFileSync(join(root, 'README.md'), 'utf8');

test('the fixture passes every check, and its documentation-only carrier is in the surface', () => {
  const { root, parsed, link } = fixtureParsed();
  const { errors, warnings } = validate(parsed, {
    declaration: normalize(DECLARATION, { name: 'fixture.tree', version: '1.2.3', license: 'MIT' }),
    readme: readmeOf(root),
    link,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  cleanup(root);
});

test('the surface check reads the built IIFE: a name it does not export, and its parameters', () => {
  const tree = {
    ...FIXTURE,
    'dist/fixture.js': 'var fixtureTree = { mod: { alpha: function (a, b, c) {} } };\n',
  };
  const { root, parsed, link } = fixtureParsed(tree);
  const decl = normalize(DECLARATION, { name: 'fixture.tree', version: '1.2.3', license: 'MIT' });
  return import('../src/generator/surface.js').then(({ readSurface }) => readSurface(decl.surface, join(root, 'dist/fixture.js')))
    .then(({ api, errors }) => {
      const out = validate(parsed, { declaration: decl, api, surfaceErrors: errors, readme: readmeOf(root), link });
      assert.equal(out.errors.length, 2, out.errors.join('\n'));
      assert.match(out.errors.join('\n'), /fixture\/mod\.beta is not in the build/);
      assert.match(out.errors.join('\n'), /alpha\(a, b\) does not match the build's \(a, b, c\)/);
      cleanup(root);
    });
});

test('a rest parameter opens the parameter list: the documented ones after it are not compared', () => {
  const read = (body) => {
    const root = site({
      ...FIXTURE,
      'dist/fixture.js': `var fixtureTree = { mod: { ${body} } };\n`,
    });
    const parsed = parseSources({ src: join(root, 'src'), carriers: [join(root, 'docs')], surface: true, ignore: 'skip' });
    const link = linker({ parsed, references: {}, brand: 'fixture.tree' });
    return import('../src/generator/surface.js')
      .then(({ readSurface }) => readSurface({ global: 'fixtureTree' }, join(root, 'dist/fixture.js')))
      .then(({ api, errors }) => {
        const out = validate(parsed, {
          declaration: normalize(DECLARATION, { name: 'fixture.tree', version: '1.2.3', license: 'MIT' }),
          api, surfaceErrors: errors, readme: readmeOf(root), link,
        });
        cleanup(root);
        return out.errors;
      });
  };
  return Promise.all([
    read('alpha: function (a, ...rest) {}, beta: function (...args) {}'),
    read('alpha: function (x, ...rest) {}, beta: function (...args) {}'),
  ]).then(([open, mismatched]) => {
    assert.deepEqual(open, [], 'the fixed prefix matches, and the open list covers the rest');
    assert.match(mismatched.join('\n'), /alpha\(a, b\) does not match the build's \(x, \.\.\.rest\)/);
  });
});

test('an example that uses module syntax, or misses the global, fails the build', () => {
  const tree = {
    ...FIXTURE,
    'docs/carrier.js': FIXTURE['docs/carrier.js'].replace('const n = fixtureTree.mod.beta(2, 3)', 'import x from "y"'),
  };
  const { root, parsed, link } = fixtureParsed(tree);
  const out = validate(parsed, {
    declaration: normalize(DECLARATION, { name: 'fixture.tree', version: '1.2.3', license: 'MIT' }),
    readme: readmeOf(root),
    link,
  });
  assert.match(out.errors.join('\n'), /uses module syntax — examples are classic scripts/);
  cleanup(root);
});

test('a site may require every example to define setup()', () => {
  const { root, parsed, link } = fixtureParsed();
  const decl = normalize({ ...DECLARATION, examples: { ...DECLARATION.examples, setup: true } },
    { name: 'fixture.tree', version: '1.2.3', license: 'MIT' });
  const out = validate(parsed, { declaration: decl, readme: readmeOf(root), link });
  assert.equal(out.errors.length, 2, out.errors.join('\n'));
  assert.match(out.errors.join('\n'), /@example #1 of alpha does not define setup\(\)/);
  cleanup(root);

  const sketching = {
    ...FIXTURE,
    'src/mod.js': FIXTURE['src/mod.js'].replace('const n = fixtureTree.mod.alpha(1, 2)', 'function setup() {\n  const n = fixtureTree.mod.alpha(1, 2)\n}'),
    'docs/carrier.js': FIXTURE['docs/carrier.js'].replace('const n = fixtureTree.mod.beta(2, 3)', 'function setup() {\n  const n = fixtureTree.mod.beta(2, 3)\n}'),
  };
  const good = fixtureParsed(sketching);
  const ok = validate(good.parsed, { declaration: decl, readme: readmeOf(good.root), link: good.link });
  assert.deepEqual(ok.errors, []);
  cleanup(good.root);
});

test('a strict code turns a warning into a failed build', () => {
  const tree = {
    ...FIXTURE,
    'src/mod.js': FIXTURE['src/mod.js'].replace(' * @example\n * const n = fixtureTree.mod.alpha(1, 2)', ' * No example here.'),
  };
  const { root, parsed, link } = fixtureParsed(tree);
  const base = normalize(DECLARATION, { name: 'fixture.tree', version: '1.2.3', license: 'MIT' });
  const lenient = validate(parsed, { declaration: base, readme: readmeOf(root), link });
  assert.deepEqual(lenient.errors, []);
  assert.match(lenient.warnings.join('\n'), /fixture\/mod\.alpha has no @example/);
  const strict = validate(parsed, { declaration: { ...base, strict: ['example'] }, readme: readmeOf(root), link });
  assert.match(strict.errors.join('\n'), /has no @example/);
  cleanup(root);
});

test('the README\'s own links must name a page this build writes and a name it documents', () => {
  const tree = {
    ...FIXTURE,
    'README.md': `${FIXTURE['README.md']}\n[gone](https://example.test/docs/gone.html)\n` +
      '[bad anchor](https://example.test/docs/mod.html#fixture/mod.nope)\n',
  };
  const { root, parsed, link } = fixtureParsed(tree);
  const out = validate(parsed, {
    declaration: normalize(DECLARATION, { name: 'fixture.tree', version: '1.2.3', license: 'MIT' }),
    readme: readmeOf(root),
    link,
  });
  assert.match(out.errors.join('\n'), /docs\/gone\.html is no page in this build/);
  assert.match(out.errors.join('\n'), /mod\.html#fixture\/mod\.nope is no documented name/);
  cleanup(root);
});

test('a site\'s own closed vocabulary is what its blocks are held to', () => {
  const tree = {
    ...FIXTURE,
    'src/mod.js': FIXTURE['src/mod.js'].replace(' * @returns {number} The sum.',
      ' * @returns {number} The sum.\n * @group fixture'),
  };
  const { root, parsed, link } = fixtureParsed(tree);
  const pkg = { name: 'fixture.tree', version: '1.2.3', license: 'MIT' };
  const union = validate(parsed, { declaration: normalize(DECLARATION, pkg), readme: readmeOf(root), link });
  assert.deepEqual(union.errors, [], 'the package reads @group where a site states no set');
  const closed = normalize({
    ...DECLARATION,
    parse: { ...DECLARATION.parse, vocabulary: ['file', 'module', 'license', 'function', 'param', 'returns', 'example'] },
  }, pkg);
  const out = validate(parsed, { declaration: closed, readme: readmeOf(root), link });
  assert.match(out.errors.join('\n'), /tag @group is outside the vocabulary/);
  assert.throws(() => normalize({ ...DECLARATION, parse: { vocabulary: ['nonsense'] } }, pkg), DeclarationError);
  cleanup(root);
});

test('the vocabulary is checked on public blocks only, and @ignore is not public', () => {
  const tree = {
    ...FIXTURE,
    'src/mod.js': `${FIXTURE['src/mod.js']}\n${block(['Not a tag the vocabulary knows.', '@nonsense'])}\nexport function gamma() {}\n`,
    'src/index.js': "export { alpha, gamma } from './mod.js';\n",
  };
  const { root, parsed, link } = fixtureParsed(tree);
  const out = validate(parsed, {
    declaration: normalize(DECLARATION, { name: 'fixture.tree', version: '1.2.3', license: 'MIT' }),
    readme: readmeOf(root),
    link,
  });
  assert.match(out.errors.join('\n'), /tag @nonsense is outside the vocabulary/);
  cleanup(root);
});

test('an @ignore block is deliberately internal: its own tags are not reported', () => {
  const root = site({
    'src/one.js': [
      block(['@module one', '@license MIT']),
      block(['An internal illustration.', '@ignore', '@example', 'const n = 1']),
      'export function alpha() {}',
    ].join('\n'),
  });
  const parsed = parseSources({ src: join(root, 'src'), ignore: 'skip' });
  const decl = normalize({ ...DECLARATION, examples: { syntax: 'any' } },
    { name: 'fixture.tree', version: '1.2.3', license: 'MIT' });
  const link = linker({ parsed, references: {}, brand: 'fixture.tree' });
  const { errors, warnings } = validate(parsed, { declaration: decl, readme: '', link });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, [], 'a block the site ignores is not a block that went missing');
  cleanup(root);
});

// ── Render ──────────────────────────────────────────────────────────────────

test('the renderer writes a page per module, the landing page, and the search index', () => {
  const { root, parsed, link } = fixtureParsed();
  const decl = normalize(DECLARATION, { name: 'fixture.tree', version: '1.2.3', license: 'MIT' });
  const files = render(parsed, {
    declaration: decl,
    brand: decl.brand,
    link,
    urls: { bundle: 'fixture.tree.js', index: 'search.json', editor: 'assets/editor.abc.js', notices: 'assets/editor.LICENSES.txt' },
    config: { lib: './fixture.tree.js' },
    readme: readmeOf(root),
    landing: FIXTURE['tools/docs/esm.md'],
    stamp: '',
  });
  assert.deepEqual([...files.keys()].sort(), ['carrier.html', 'index.html', 'mod.html', 'search.json']);
  const page = files.get('mod.html');
  assert.match(page, /<article class="doclet function" id="fixture\/mod.alpha">/);
  assert.match(files.get('carrier.html'), /<a class="anchor" href="#fixture\/mod.beta">/);
  assert.match(page, /<figure class="example" id="fixture\/mod.alpha-example-1">/);
  assert.match(page, /aria-label="sketch source"/);
  assert.match(page, /<nav class="pager"/);
  assert.match(page, /third-party notices/);
  const index = files.get('index.html');
  assert.match(index, /<section class="esm">/);
  assert.match(index, /data-mode="module"/, 'the landing carrier\'s fence is a module demo');
  const search = JSON.parse(files.get('search.json'));
  assert.deepEqual(search.map((e) => e.n).sort(), ['alpha', 'beta']);
  assert.equal(search.find((e) => e.n === 'alpha').h, 'mod.html#fixture/mod.alpha');
  cleanup(root);
});

test('a site whose examples are module scripts says so on every figure', () => {
  const { root, parsed, link } = fixtureParsed();
  const decl = normalize({ ...DECLARATION, examples: { ...DECLARATION.examples, syntax: 'module' } },
    { name: 'fixture.tree', version: '1.2.3', license: 'MIT' });
  const files = render(parsed, {
    declaration: decl, brand: decl.brand, link,
    urls: { index: 'search.json' }, config: {}, readme: '', landing: null, stamp: '',
  });
  assert.match(files.get('mod.html'),
    /<figure class="example" id="fixture\/mod\.alpha-example-1" data-mode="module">/);
  cleanup(root);
});

test('a page opens with the owners the declaration puts first, then first appearance; no favicon, no blank line', () => {
  const root = site({
    ...FIXTURE,
    'src/two.js': [
      block(['@file Two', '@module fixture/two', '@license MIT']),
      block(['@function slow', '@memberof Later', 'Second.']),
      block(['@function quick', '@memberof First', 'First.']),
      'export function slow() {}',
      'export function quick() {}',
      '',
    ].join('\n'),
  });
  const parsed = parseSources({ src: join(root, 'src'), carriers: [join(root, 'docs')], ignore: 'keep' });
  const link = linker({ parsed, references: {}, brand: 'fixture.tree' });
  const decl = normalize({ ...DECLARATION, ownerOrder: ['First'], shell: { stylesheet: 'assets/style.css', favicon: [] } },
    { name: 'fixture.tree', version: '1.2.3', license: 'MIT' });
  const files = render(parsed, {
    declaration: decl, brand: decl.brand, link,
    urls: { index: 'search.json' }, config: {}, readme: '', landing: null, stamp: '',
  });
  const page = files.get('two.html');
  assert.deepEqual([...page.matchAll(/<section class="owner" id="([^"]+)">/g)].map((m) => m[1]), ['First', 'Later']);
  assert.match(page, /\n  <link rel="stylesheet"/, 'no favicon leaves no empty line in the head');
  cleanup(root);
});

test('a stamp reaches the page\'s asset URLs, and only where the declaration asks for one', () => {
  const { root, parsed, link } = fixtureParsed();
  const decl = normalize({ ...DECLARATION, stamp: true }, { name: 'fixture.tree', version: '1.2.3', license: 'MIT' });
  const files = render(parsed, {
    declaration: decl, brand: decl.brand, link,
    urls: { bundle: 'fixture.tree.js', index: 'search.json' }, config: {}, readme: '', landing: null, stamp: 'abc12345',
  });
  const page = files.get('mod.html');
  assert.match(page, /href="assets\/style\.css\?v=abc12345"/);
  assert.match(page, /<script type="module" src="assets\/runner\.js\?v=abc12345"><\/script>/, 'esm pages load modules');
  cleanup(root);
});

test('a page whose mode is global loads classic scripts, and the block is still its config', () => {
  const { root, parsed, link } = fixtureParsed();
  const decl = normalize({ ...DECLARATION, mode: 'global' },
    { name: 'fixture.tree', version: '1.2.3', license: 'MIT' });
  const files = render(parsed, {
    declaration: decl, brand: decl.brand, link,
    urls: { index: 'search.json' }, config: { lib: './fixture.tree.js' }, readme: '', landing: null, stamp: '',
  });
  const page = files.get('mod.html');
  assert.match(page, /<script type="application\/json" id="docs-config">/, 'the block is the page\'s config in both modes');
  assert.match(page, /<script defer src="assets\/runner\.js"><\/script>/, 'a classic page defers classic scripts');
  assert.doesNotMatch(page, /type="module"/);
  assert.ok(page.indexOf('id="docs-config"') < page.indexOf('src="assets/runner.js"'),
    'and the block comes before the scripts that read it');
  cleanup(root);
});

test('a site that states a base stylesheet gets the package\'s, and its page loads it first', async () => {
  const root = site(FIXTURE);
  const decl = {
    ...DECLARATION,
    stamp: true,
    shell: { base: 'assets/base.css', stylesheet: 'assets/style.css', favicon: [] },
  };
  await build(decl, { root, log: recorder() });

  // The package's own bytes, not a copy a site could drift from.
  assert.equal(readFileSync(join(root, 'site', 'assets/base.css'), 'utf8'),
    readFileSync(new URL('../src/base.css', import.meta.url), 'utf8'));

  const page = readFileSync(join(root, 'site', 'mod.html'), 'utf8');
  const base = page.indexOf('href="assets/base.css');
  const own = page.indexOf('href="assets/style.css');
  assert.ok(base > 0 && own > base, 'the base is linked before the site\'s own file');
  assert.match(page, /href="assets\/base\.css\?v=[0-9a-f]{8}"/, 'and it is stamped like the site\'s file');
  cleanup(root);
});

test('the base stylesheet states the markup\'s structure and no colour', () => {
  const css = readFileSync(new URL('../src/base.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'no hex colour');
  assert.doesNotMatch(css, /\b(?:rgba?|hsla?)\(/, 'no colour function');
  for (const hook of ['.sidebar', '.theme-menu', '.pager', 'textarea.source', '.cm-editor']) {
    assert.ok(css.includes(hook), `${hook} is the shell markup's own`);
  }
});

// ── Build ───────────────────────────────────────────────────────────────────

test('a build writes the site, copies the builds and the static chrome, and keeps an older editor asset', async () => {
  const root = site(FIXTURE);
  const log = recorder();
  const out = join(root, 'site');

  // An earlier build's editor asset, which the next build must not prune.
  mkdirSync(join(out, 'assets'), { recursive: true });
  writeFileSync(join(out, 'assets', 'editor.deadbeef01.js'), '// older\n');

  const summary = await build(DECLARATION, { root, log });
  assert.deepEqual(log.seen.errors, []);
  assert.deepEqual(log.seen.warnings, []);
  assert.equal(summary.files.size, 4);
  assert.equal(summary.doclets.length, 2);
  assert.equal(summary.examples, 2);

  for (const file of ['index.html', 'mod.html', 'carrier.html', 'search.json', 'fixture.tree.js',
    'favicon.png', 'assets/style.css', 'assets/runner.js', 'assets/search.js', 'assets/chrome.js',
    'assets/editor.LICENSES.txt']) {
    assert.ok(existsSync(join(out, file)), `${file} is written`);
  }
  assert.ok(existsSync(join(out, 'assets', 'editor.deadbeef01.js')), 'an older editor asset is kept');

  // The editor asset is the package's own, byte for byte, and its notice names it.
  const manifest = JSON.parse(readFileSync(new URL('../dist/manifest.json', import.meta.url), 'utf8'));
  const copied = readFileSync(join(out, 'assets', manifest.asset));
  assert.equal(createHash('sha256').update(copied).digest('hex'), manifest.sha256);
  assert.match(readFileSync(join(out, 'assets/editor.LICENSES.txt'), 'utf8'), new RegExp(manifest.asset));

  // The page's config block is the declaration's, its tokens resolved.
  const config = JSON.parse(/<script type="application\/json" id="docs-config">(.*?)<\/script>/.exec(readFileSync(join(out, 'mod.html'), 'utf8'))[1]);
  assert.equal(config.tool, 'https://cdn.jsdelivr.net/npm/tool.js@9.9.9/dist/tool.js');
  assert.equal(config.lib, './fixture.tree.js');
  assert.equal(config.index, 'search.json');
  assert.equal(config.imports['tool.js'], 'https://cdn.jsdelivr.net/npm/tool.js@9.9.9/dist/tool.module.js');
  assert.match(config.editor, /^assets\/editor\.[0-9a-f]+\.js$/);
  cleanup(root);
});

test('a build refuses a renderer artifact the site does not have, and a link with nothing behind it', async () => {
  const root = site({ ...FIXTURE, 'README.md': `${FIXTURE['README.md']}\n[gone](gone.html)\n` });
  await assert.rejects(build(DECLARATION, { root, log: recorder() }), BuildError);
  cleanup(root);

  const noBuild = site({ ...FIXTURE });
  rmSync(join(noBuild, 'dist'), { recursive: true, force: true });
  await assert.rejects(build(DECLARATION, { root: noBuild, log: recorder() }), /not found — run `npm run build` first/);
  cleanup(noBuild);
});

test('a plugin validates and renders inside the package: a warning, a page and an anchor', async () => {
  const plugin = `export default {
  name: 'probe',
  validate(parsed, ctx) {
    return { warnings: [\`\${parsed.doclets.length} doclet(s) seen\`], errors: [] };
  },
  render(ctx) {
    ctx.emit('probe.html', ctx.shell({ title: 'probe', active: 'probe.html', nav: [], body: '<p>probe</p>' }));
    return { anchors: [['probe.marker', 'probe.html#marker']] };
  },
};
`;
  const root = site({ ...FIXTURE, 'tools/docs/plugins/probe.mjs': plugin });
  const log = recorder();
  const summary = await build(withDecl({ plugins: ['probe'] }), { root, log });
  assert.match(log.seen.warnings.join('\n'), /probe  2 doclet\(s\) seen/);
  assert.ok(existsSync(join(root, 'site', 'probe.html')), 'the plugin\'s page is written');
  assert.match(readFileSync(join(root, 'site', 'probe.html'), 'utf8'), /<footer>fixture\.tree v1\.2\.3/, 'with the package\'s shell');
  assert.equal(summary.files.get('probe.html') !== undefined, true);
  cleanup(root);
});

test('a declared plugin that is not there stops the build', async () => {
  const root = site(FIXTURE);
  await assert.rejects(build(withDecl({ plugins: ['absent'] }), { root, log: recorder() }), /plugin absent is declared/);
  cleanup(root);
});

test('a README\'s own files are copied to the site root, and a declared one that is absent stops the build', async () => {
  const README = `${FIXTURE['README.md']}\n![hero](hero.png)\n`;
  const decl = { ...DECLARATION, paths: { ...DECLARATION.paths, readmeAssets: ['hero.png'] } };
  const root = site({ ...FIXTURE, 'README.md': README, 'hero.png': 'PNG' });
  await build(decl, { root, log: recorder() });
  assert.equal(readFileSync(join(root, 'site', 'hero.png'), 'utf8'), 'PNG');
  cleanup(root);

  const absent = site({ ...FIXTURE, 'README.md': README });
  await assert.rejects(build(decl, { root: absent, log: recorder() }), /hero\.png is declared as a README asset/);
  cleanup(absent);
});

test('the search index is checked against the files the build wrote', async () => {
  const root = site(FIXTURE);
  await build(DECLARATION, { root, log: recorder() });
  const index = JSON.parse(readFileSync(join(root, 'site', 'search.json'), 'utf8'));
  for (const entry of index) assert.ok(existsSync(join(root, 'site', entry.h.split('#')[0])));
  assert.deepEqual(readdirSync(join(root, 'site')).sort(),
    ['assets', 'carrier.html', 'favicon.png', 'fixture.tree.js', 'index.html', 'mod.html', 'search.json']);
  cleanup(root);
});

test('an owner may live in several places in the build, or nowhere static', async () => {
  const tree = {
    ...FIXTURE,
    'dist/fixture.js': 'var fixtureTree = { mod: { alpha: function (a, b) {} },' +
      ' other: { beta: function (a) {} } };\n',
  };
  const root = site(tree);
  const parsed = parseSources({ src: join(root, 'src'), carriers: [join(root, 'docs')], surface: true, ignore: 'skip' });
  const link = linker({ parsed, references: {}, brand: 'fixture.tree' });
  const pkg = { name: 'fixture.tree', version: '1.2.3', license: 'MIT' };
  const read = (owners) => import('../src/generator/surface.js')
    .then(({ readSurface }) => readSurface({ global: 'fixtureTree' }, join(root, 'dist/fixture.js')))
    .then(({ api, errors }) => validate(parsed, {
      declaration: normalize({ ...DECLARATION, owners }, pkg),
      api, surfaceErrors: errors, readme: readmeOf(root), link,
    }));

  const onePath = await read({ 'fixture/mod': 'mod', 'fixture/carrier': 'mod' });
  assert.match(onePath.errors.join('\n'), /fixture\/mod\.beta is not in the build/, 'one path reaches one object');
  const split = await read({ 'fixture/mod': ['mod', 'other'], 'fixture/carrier': ['mod', 'other'] });
  assert.deepEqual(split.errors, [], 'a list of paths reaches both objects');
  const waived = await read({ 'fixture/mod': null, 'fixture/carrier': null });
  assert.deepEqual(waived.errors, [], 'an owner declared null is documented and not checked');
  cleanup(root);
});

test('an owner whose names are the surface\'s own top-level exports states an empty path', async () => {
  const tree = {
    ...FIXTURE,
    'dist/index.js': 'export function alpha(a, b) { return a + b; }\n' +
      'export function beta(a) { return a; }\n',
  };
  const root = site(tree);
  const decl = {
    ...DECLARATION,
    paths: { ...DECLARATION.paths, module: 'dist/index.js' },
    surface: { module: true, check: 'all' },
    owners: { 'fixture/mod': '', 'fixture/carrier': '' },
  };
  const parsed = parseSources({ src: join(root, 'src'), carriers: [join(root, 'docs')], surface: true, ignore: 'skip' });
  const link = linker({ parsed, references: DECLARATION.references, brand: 'fixture.tree' });
  const normalized = normalize(decl, { name: 'fixture.tree', version: '1.2.3', license: 'MIT' });
  const { readSurface } = await import('../src/generator/surface.js');
  const read = await readSurface(normalized.surface, join(root, 'dist/index.js'));
  const { errors } = validate(parsed, {
    declaration: normalized, api: read.api, surfaceErrors: read.errors, readme: readmeOf(root), link,
  });
  assert.deepEqual(errors, []);
  cleanup(root);
});

test('the surface can be an ES build\'s exports rather than an IIFE\'s global', async () => {
  const tree = {
    ...FIXTURE,
    'dist/index.js': 'export const mod = { alpha(a, b) { return a + b; }, beta(a) { return a; } };\n',
  };
  const root = site(tree);
  const decl = { ...DECLARATION, paths: { ...DECLARATION.paths, module: 'dist/index.js' }, surface: { module: true, check: 'all' } };
  const parsed = parseSources({ src: join(root, 'src'), carriers: [join(root, 'docs')], surface: true, ignore: 'skip' });
  const link = linker({ parsed, references: DECLARATION.references, namespaces: ['mod'], brand: 'fixture.tree' });
  const normalized = normalize(decl, { name: 'fixture.tree', version: '1.2.3', license: 'MIT' });
  const { readSurface } = await import('../src/generator/surface.js');
  const read = await readSurface(normalized.surface, join(root, 'dist/index.js'));
  assert.deepEqual(read.errors, []);
  assert.deepEqual(
    validate(parsed, { declaration: normalized, api: read.api, surfaceErrors: read.errors, readme: readmeOf(root), link }).errors,
    [],
  );
  cleanup(root);
});

test('an ES build\'s namespace exports its members as getters, and their parameters still read', async () => {
  const tree = {
    ...FIXTURE,
    'dist/tree.js': 'export function alpha(a, b) { return a + b; }\n' +
      'export function beta(a) { return a; }\n',
    'dist/index.js': "export * as tree from './tree.js';\n",
  };
  const root = site(tree);
  const decl = {
    ...DECLARATION,
    paths: { ...DECLARATION.paths, module: 'dist/index.js' },
    surface: { module: true, check: 'all' },
    owners: { 'fixture/mod': 'tree', 'fixture/carrier': 'tree' },
  };
  const parsed = parseSources({ src: join(root, 'src'), carriers: [join(root, 'docs')], surface: true, ignore: 'skip' });
  const link = linker({ parsed, references: DECLARATION.references, brand: 'fixture.tree' });
  const normalized = normalize(decl, { name: 'fixture.tree', version: '1.2.3', license: 'MIT' });
  const { readSurface } = await import('../src/generator/surface.js');
  const read = await readSurface(normalized.surface, join(root, 'dist/index.js'));
  const { errors } = validate(parsed, {
    declaration: normalized, api: read.api, surfaceErrors: read.errors, readme: readmeOf(root), link,
  });
  assert.deepEqual(errors, [], 'a namespace owner reads its members and their parameters');
  cleanup(root);
});
