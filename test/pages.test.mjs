/**
 * @file The page carrier's suite: the Markdown page tree, the symbol strip its
 * front matter binds, the example a fence carries, the one shortcode, the
 * blocks a plugin supplies, the index in its kinds, the redirect stubs and the
 * addresses a nested page writes.
 * @license AGPL-3.0-only
 *
 * The fixture is a site whose pages are files — a source file with two
 * documented names, a page tree under `docs/`, one plugin that supplies a block
 * and supplies it nowhere else — because every rule here reads the files it
 * names.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { build, BuildError } from '../src/generator/build.js';
import { DeclarationError, normalize } from '../src/generator/declaration.js';
import { loadPages, snake, slug, symbolOfTitle } from '../src/generator/pages.js';
import { shortcodeErrors, canonicalPages } from '../src/generator/pagerender.js';
import { readSurface } from '../src/generator/surface.js';

/** Write `{ 'path': text }` into a fresh directory; returns its root. */
function site(tree) {
  const root = mkdtempSync(join(tmpdir(), 'scholion-pages-'));
  for (const [path, text] of Object.entries(tree)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}

const cleanup = (root) => rmSync(root, { recursive: true, force: true });

const block = (lines) => `/**\n${lines.map((line) => ` * ${line}`).join('\n')}\n */\n`;

/** The quiet log a build writes through. */
function recorder() {
  const seen = { warnings: [], errors: [], notes: [] };
  return {
    seen,
    warn: (line) => seen.warnings.push(line),
    error: (line) => seen.errors.push(line),
    log: (line) => seen.notes.push(line),
  };
}

const front = (fields) => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n`;

// ── The fixture site ────────────────────────────────────────────────────────

const FIXTURE = {
  'package.json': JSON.stringify({ name: 'fixture.book', version: '2.0.0', license: 'MIT' }),
  'README.md': '# fixture.book\n\nThe book of the fixture.\n',
  'src/thing.js': [
    block([
      '@file The fixture module',
      '@module fixture/thing',
      '@license MIT',
    ]),
    block([
      'Alpha adds two numbers.',
      '@function alpha',
      '@memberof fixture/thing',
      '@param {number} a The first operand.',
      '@param {number} b The second operand.',
      '@returns {number} The sum.',
      '@group areas',
      '@page areas/alpha',
    ]),
    'export function alpha(a, b) { return a + b; }\n',
    block([
      'Beta multiplies.',
      '@function beta',
      '@memberof fixture/thing',
      '@param {number} a The first operand.',
      '@returns {number} The product.',
      '@group areas',
      '@page areas/beta',
    ]),
    'export function beta(a) { return a; }\n',
  ].join('\n'),
  'docs/reference/_index.md': `${front({ title: '"Reference"', weight: 9 })}\nThe reference area.\n`,
  'docs/reference/host.md': [
    front({ title: '"The host"', weight: 1 }),
    '',
    'The names the snippets call.',
    '',
    '<!-- uses: host -->',
    '',
  ].join('\n'),
  'docs/areas/_index.md': `${front({ title: '"Areas"', weight: 1 })}\nThe teaching area.\n`,
  'docs/areas/alpha.md': [
    front({ title: '"alpha(a, b)"', weight: 1, symbol: 'alpha' }),
    '',
    'Alpha adds.',
    '',
    '```js',
    'function setup() {',
    '  createCanvas(10, 10)',
    '}',
    '```',
    '',
    '```js',
    'const n = alpha(1, 2)',
    '```',
    '',
    'A note.[^1]',
    '',
    '[^1]: The footnote.',
    '',
  ].join('\n'),
  'docs/areas/alpha_more.md': [
    front({ title: '"alpha, again"', weight: 2, symbol: 'alpha' }),
    '',
    'The same name, taught again.',
    '',
  ].join('\n'),
  'docs/areas/beta.md': [
    front({ title: '"beta(x)"', weight: 3, symbol: 'none' }),
    '',
    'A page that deliberately claims no symbol.',
    '',
    '{{< youtube v7hc715hvVg "A caption" >}}',
    '',
  ].join('\n'),
  'docs/areas/notes.md': [
    front({ title: '"notes"', weight: 4 }),
    '',
    'A supplement page.',
    '',
  ].join('\n'),
  'docs/inventory.json': JSON.stringify({ pages: ['areas/alpha', 'areas/retired'], anchors: ['areas/alpha#alphaab'] }),
  'docs/redirects.json': JSON.stringify({ pages: { 'areas/retired': 'areas/notes', 'areas/gone': null } }),
  'dist/fixture.book.js': 'var fixtureBook = (function () {\n' +
    '  var thing = { alpha: function alpha(a, b) { return a + b; },\n' +
    '                beta: function beta(a) { return a; } };\n' +
    '  return { thing: thing };\n' +
    '})();\n',
  'tools/docs/static/assets/style.css': ':root { color-scheme: light dark; }\n',
  'tools/docs/static/assets/runner.js': '// the fixture runner\n',
  'tools/docs/static/assets/search.js': '// the fixture search\n',
  'tools/docs/static/assets/chrome.js': '// the fixture chrome\n',
  'tools/docs/static/assets/video.js': '// the fixture video\n',
  'tools/docs/plugins/slots.mjs': [
    'export default {',
    "  name: 'slots',",
    '  data(parsed, ctx) {',
    '    const host = ctx.pages.find((p) => p.path === \'reference/host\');',
    '    return {',
    "      slots: { [host.path]: { host: '\\n      <table class=\"terms\"><tbody><tr id=\"alpha\"><td>alpha</td></tr></tbody></table>' } },",
    "      index: [{ t: 'alpha', h: 'docs/reference/host/#alpha', k: 'ext', s: 'a host name' }],",
    "      notes: ['one note from the plugin'],",
    '    };',
    '  },',
    '};',
    '',
  ].join('\n'),
};

const DECLARATION = {
  paths: {
    pkg: 'package.json',
    readme: 'README.md',
    src: 'src',
    bundle: 'dist/fixture.book.js',
    static: 'tools/docs/static',
    site: 'site',
    inventory: 'docs/inventory.json',
    redirects: 'docs/redirects.json',
  },
  outputs: { bundle: 'fixture.book.js', index: 'search.json', editor: 'assets', notices: 'assets/editor.LICENSES.txt' },
  carrier: { pages: { kind: 'markdown', dir: 'docs', source: 'https://example.test/blob/main/' } },
  parse: { members: null },
  examples: { syntax: 'global', setup: true },
  surface: { global: 'fixtureBook', check: 'all' },
  owners: { 'fixture/thing': 'thing' },
  groups: [{ slug: 'areas', title: 'Areas' }],
  areas: [{ slug: 'reference', title: 'Reference' }],
  home: 'https://example.test/book/',
  mode: 'esm',
  shell: { stylesheet: 'assets/style.css' },
  runner: {
    script: 'assets/runner.js',
    search: 'assets/search.js',
    chrome: 'assets/chrome.js',
    video: 'assets/video.js',
    config: { lib: '{bundle}', root: '{root}', index: '{index}', editor: '{editor}' },
  },
  strict: [],
  plugins: ['slots'],
};

/** The fixture with one key replaced (a shallow merge of the top level). */
const withDecl = (patch) => ({ ...DECLARATION, ...patch });

// ── The page tree ───────────────────────────────────────────────────────────

test('a page tree reads its front matter, its address and its place in the navigation', () => {
  const root = site(FIXTURE);
  const pages = loadPages(join(root, 'docs'));
  const byPath = new Map(pages.map((p) => [p.path, p]));

  assert.deepEqual([...byPath.keys()].sort(), [
    'areas', 'areas/alpha', 'areas/alpha_more', 'areas/beta', 'areas/notes',
    'reference', 'reference/host',
  ]);
  const alpha = byPath.get('areas/alpha');
  assert.equal(alpha.title, 'alpha(a, b)', 'the title is the front matter\'s');
  assert.equal(alpha.weight, 1, 'and the weight orders its siblings');
  assert.equal(alpha.symbol, 'alpha', 'a page that documents a name states it');
  assert.equal(alpha.group, 'areas', 'its first segment is its area');
  assert.equal(alpha.parent, 'areas', 'and its directory is its parent');
  const index = byPath.get('areas');
  assert.equal(index.isIndex, true, '`_index.md` is its directory\'s page');
  assert.equal(index.path, 'areas', 'written at the directory\'s own address');
  assert.equal(byPath.get('areas/notes').symbol, null, 'a supplement claims nothing');
  assert.equal(byPath.get('areas/beta').symbol, 'none', 'and `symbol: none` says so deliberately');
  assert.deepEqual(
    ['toFEN', 'visitCollection', 'VERSION'].map(snake),
    ['to_fen', 'visit_collection', 'version'],
    'a name\'s page address is snake_case',
  );
  assert.equal(slug('createQuadrille(width, height)'), 'createquadrillewidth-height', 'and a heading\'s id is Hugo\'s');
  assert.equal(symbolOfTitle('Quadrille.fill(value)'), 'fill');
  assert.equal(symbolOfTitle('row & col'), null, 'a title that is not a bare name claims nothing');
  cleanup(root);
});

test('a declaration states a page tree or does not, and a tree states its directory', () => {
  const pkg = { name: 'x.book', version: '0.0.1', license: 'MIT' };
  const base = { paths: { src: 'src', pkg: 'package.json', site: 'site' }, outputs: { index: 'search.json' }, runner: { script: 'r.js' } };
  assert.equal(normalize(base, pkg).carrier.pages.kind, 'modules', 'no page tree: one page per module');
  assert.throws(() => normalize({ ...base, carrier: { pages: { kind: 'markdown' } } }, pkg), DeclarationError);
  assert.throws(() => normalize({ ...base, carrier: { pages: { kind: 'tree' } } }, pkg), DeclarationError);
  assert.equal(normalize({ ...base, carrier: { pages: { kind: 'markdown', dir: 'docs/' } } }, pkg).carrier.pages.dir, 'docs');
  assert.equal(normalize({ ...base, carrier: { pages: { kind: 'markdown', dir: 'docs' } } }, pkg).carrier.pages.source, null);
});

// ── The surface ─────────────────────────────────────────────────────────────

test('a build that leaves one name behind and installs another exposes both', async () => {
  const root = site({
    'bundle.js': 'var Thing = (function (host) {\n' +
      '  host.register(function (fn) { fn.installed = function (a) { return a; }; });\n' +
      '  return { name: function () { return 1; } };\n' +
      '})(host);\n',
  });
  const host = { register(install) { install((this.fn = {})); } };
  const one = await readSurface({ global: 'Thing', globals: { host } }, join(root, 'bundle.js'));
  assert.equal(typeof one.api.name, 'function', 'the name the build leaves behind');
  const both = await readSurface({ global: ['Thing', 'host'], globals: { host } }, join(root, 'bundle.js'));
  assert.equal(typeof both.api.Thing.name, 'function', 'a list is an api keyed by the names');
  assert.equal(typeof both.api.host.fn.installed, 'function', 'so an owner may live on either of them');
  const missing = await readSurface({ global: ['Thing', 'absent'], globals: { host } }, join(root, 'bundle.js'));
  assert.match(missing.errors[0], /leaves no absent behind/);
  cleanup(root);
});

// ── The build ───────────────────────────────────────────────────────────────

test('a page carrier writes one page per file at its published address, and a page tree in the chrome', async () => {
  const root = site(FIXTURE);
  const log = recorder();
  const summary = await build(DECLARATION, { root, log });

  assert.ok(summary.files.has('docs/areas/alpha/index.html'), 'a page is written at its own address');
  assert.ok(summary.files.has('docs/areas/index.html'), 'and a directory page at its directory\'s');
  assert.equal(summary.pages, 7);

  const alpha = readFileSync(join(root, 'site/docs/areas/alpha/index.html'), 'utf8');
  assert.match(alpha, /<article class="page">/, 'the page carrier\'s article');
  assert.match(alpha, /<aside class="api">/, 'the strip of the name it claims');
  assert.match(alpha, /<code class="sig">fixture\/thing\.alpha\(a, b\)<\/code>/, 'the signature the source declares');
  assert.match(alpha, /<span class="arrow">→<\/span> <code class="type">number<\/code>/, 'the return type');
  assert.match(alpha, /<a class="source" href="https:\/\/example\.test\/blob\/main\/#L\d+"/, 'the line that implements it');
  assert.match(alpha, /<tr class="depth-0">/, 'a parameter table, because the page states none of its own');
  assert.match(alpha, /<section class="footnotes">/, 'the page\'s footnotes at its foot');

  const more = readFileSync(join(root, 'site/docs/areas/alpha_more/index.html'), 'utf8');
  assert.doesNotMatch(more, /<aside class="api">/, 'a second page claiming the name carries no strip: the doclet has one page');

  const children = readFileSync(join(root, 'site/docs/areas/index.html'), 'utf8');
  assert.match(children, /<h3 id="alphaa-b"><a href="\.\.\/\.\.\/docs\/areas\/alpha\/">alpha\(a, b\)<\/a><\/h3>/, 'a child as a heading whose id is the anchor a link lands on');

  const nav = readFileSync(join(root, 'site/docs/areas/notes/index.html'), 'utf8');
  assert.match(nav, /<li><details open><summary><a href="\.\.\/\.\.\/\.\.\/docs\/areas\/">Areas<\/a><\/summary>/, 'the tree in the rail, its area open');
  assert.match(nav, /<li><a href="\.\.\/\.\.\/\.\.\/docs\/areas\/notes\/" aria-current="page">notes<\/a><\/li>/, 'and the page marked as the one being read');
  assert.match(nav, /<nav class="pager">/, 'and the reading order around the page');
  cleanup(root);
});

test('a fence that defines setup() is a sketch and runs; any other fence stays a plain listing', async () => {
  const root = site(FIXTURE);
  await build(DECLARATION, { root, log: recorder() });
  const alpha = readFileSync(join(root, 'site/docs/areas/alpha/index.html'), 'utf8');

  assert.match(alpha, /<figure class="example" id="sketch-0">/, 'the sketch lifted where its fence stood');
  assert.match(alpha, /<textarea class="source" spellcheck="false" aria-label="sketch source">function setup\(\)/, 'with its source in the textarea the runner mounts');
  assert.match(alpha, /<div class="stage" data-stage><\/div>/, 'the stage it draws on');
  assert.match(alpha, /<span class="hint">edit, then run<\/span>/, 'and the toolbar the page carrier states');
  assert.match(alpha, /<pre><code class="lang-js">const n = alpha\(1, 2\)<\/code><\/pre>/, 'a fence that is not a sketch stays a listing');
  cleanup(root);
});

test('the shortcode renders a figure a click upgrades, and any other shortcode-shaped run fails the build', async () => {
  const root = site(FIXTURE);
  await build(DECLARATION, { root, log: recorder() });
  const beta = readFileSync(join(root, 'site/docs/areas/beta/index.html'), 'utf8');
  assert.match(beta, /<figure class="video" data-video="v7hc715hvVg">/, 'a 16:9 figure for the video');
  assert.match(beta, /<a class="play" href="https:\/\/www\.youtube\.com\/watch\?v=v7hc715hvVg">/, 'whose poster links to the watch page');
  assert.match(beta, /<figcaption>A caption<\/figcaption>/, 'and the caption is the figure\'s line');
  assert.match(beta, /<script type="module" src="[^"]*assets\/video\.js"><\/script>/, 'the video script is loaded on a page that carries one');

  const notes = readFileSync(join(root, 'site/docs/areas/notes/index.html'), 'utf8');
  assert.doesNotMatch(notes, /assets\/video\.js/, 'and not on a page that does not');

  assert.deepEqual(shortcodeErrors('{{< youtube short >}}').length, 1, 'a mistyped id is shortcode-shaped and wrong');
  assert.deepEqual(shortcodeErrors('{{< ref "x" >}}').length, 1, 'an unknown name too');
  assert.deepEqual(shortcodeErrors('{{% youtube v7hc715hvVg %}}').length, 1, 'and the shortcode syntax an older site left behind');
  assert.deepEqual(shortcodeErrors('```\n{{< youtube x >}}\n```').length, 0, 'a listing is not prose');

  const bad = site({ ...FIXTURE, 'docs/areas/notes.md': `${front({ title: '"notes"', weight: 4 })}\n\n{{< youtube short >}}\n` });
  await assert.rejects(build(DECLARATION, { root: bad, log: recorder() }), (e) => {
    assert.ok(e instanceof BuildError);
    assert.match(e.errors.join('\n'), /is not `\{\{< youtube ID "caption" >\}\}`/);
    cleanup(bad);
    return true;
  });
  cleanup(root);
});

test('the blocks a page asks for are the site\'s data, and a directive nothing supplies fails the build', async () => {
  const root = site(FIXTURE);
  const log = recorder();
  await build(DECLARATION, { root, log });
  const host = readFileSync(join(root, 'site/docs/reference/host/index.html'), 'utf8');
  assert.match(host, /<table class="terms">/, 'the block the plugin supplied');
  assert.ok(log.seen.notes.some((n) => n.includes('one note from the plugin')), 'and the note it printed');

  const unclaimed = site({ ...FIXTURE, 'tools/docs/plugins/slots.mjs': 'export default { name: \'slots\', data() { return { slots: {} }; } };\n' });
  await assert.rejects(build(DECLARATION, { root: unclaimed, log: recorder() }), (e) => {
    assert.match(e.errors.join('\n'), /<!-- uses: host --> is supplied by no plugin/);
    cleanup(unclaimed);
    return true;
  });
  cleanup(root);
});

test('the search index is the carrier\'s: a symbol, the plugin\'s entries, then a page, each with its kind', async () => {
  const root = site(FIXTURE);
  await build(DECLARATION, { root, log: recorder() });
  const index = JSON.parse(readFileSync(join(root, 'site/search.json'), 'utf8'));

  assert.deepEqual(index.slice(0, 2).map((e) => [e.t, e.k, e.h]), [
    ['alpha', 'symbol', 'docs/areas/alpha/'],
    ['beta', 'symbol', 'docs/areas/beta/'],
  ], 'a documented name first, at its canonical page');
  assert.deepEqual(index[2], { t: 'alpha', h: 'docs/reference/host/#alpha', k: 'ext', s: 'a host name' },
    'then what the plugin adds, as it wrote it');
  assert.deepEqual(index.slice(3).map((e) => [e.t, e.k]), [
    ['Areas', 'section'], ['alpha(a, b)', 'page'], ['alpha, again', 'page'],
    ['beta(x)', 'page'], ['notes', 'page'], ['Reference', 'section'], ['The host', 'page'],
  ], 'then one entry per page, sections and pages apart, in reading order');
  for (const entry of index) {
    assert.deepEqual(Object.keys(entry).sort(), ['h', 'k', 's', 't'], 'every entry has the carrier\'s four fields');
    assert.ok(existsSyncFrom(root, entry.h), `${entry.h} names a file the build wrote`);
  }
  cleanup(root);
});

const existsSyncFrom = (root, href) => {
  const [path] = href.split('#');
  try { readFileSync(join(root, 'site', path, 'index.html')); return true; } catch (_) { return false; }
};

test('an address an earlier site published answers with a page or a stub, and a stale one is a warning', async () => {
  const root = site(FIXTURE);
  const log = recorder();
  await build(DECLARATION, { root, log });

  const stub = readFileSync(join(root, 'site/docs/areas/retired/index.html'), 'utf8');
  assert.match(stub, /<meta http-equiv="refresh" content="0; url=\.\.\/\.\.\/\.\.\/docs\/areas\/notes\/">/, 'a meta refresh to the page that answers it');
  assert.match(stub, /<link rel="canonical" href="\.\.\/\.\.\/\.\.\/docs\/areas\/notes\/">/, 'and a canonical link to the same');
  const home = readFileSync(join(root, 'site/docs/areas/gone/index.html'), 'utf8');
  assert.match(home, /href="\.\.\/\.\.\/\.\.\/index\.html"/, '`null` sends the reader to the landing page');

  assert.ok(log.seen.warnings.some((w) => w.includes('published path areas/retired has no page')),
    'a published path is answered, so no warning for it');
  cleanup(root);

  const stale = site({ ...FIXTURE, 'docs/inventory.json': JSON.stringify({ pages: ['areas/nowhere'], anchors: [] }) });
  const staleLog = recorder();
  await build(DECLARATION, { root: stale, log: staleLog });
  assert.ok(staleLog.seen.warnings.some((w) => w.includes('published path areas/nowhere has no page — add a redirect')));
  cleanup(stale);
});

test('a nested page writes its own prefix: the assets it names, its configuration, and the index it fetches', async () => {
  const root = site(FIXTURE);
  await build(DECLARATION, { root, log: recorder() });
  const nested = readFileSync(join(root, 'site/docs/areas/alpha/index.html'), 'utf8');
  const landing = readFileSync(join(root, 'site/index.html'), 'utf8');

  assert.match(nested, /<link rel="stylesheet" href="\.\.\/\.\.\/\.\.\/assets\/style\.css">/, 'a nested page\'s stylesheet is three levels up');
  assert.match(nested, /<script type="module" src="\.\.\/\.\.\/\.\.\/assets\/runner\.js"><\/script>/, 'and so are its scripts');
  assert.match(nested, /id="docs-config">\{"lib":"fixture\.book\.js","root":"\.\.\/\.\.\/\.\.\/"/, 'the configuration carries the page\'s own prefix');
  assert.match(nested, /<a class="brand" href="\.\.\/\.\.\/\.\.\/index\.html">/, 'and the brand links home from where the page sits');
  assert.match(landing, /"root":""/, 'the landing page is the site root');
  cleanup(root);
});

test('a page that claims a symbol its doc block does not exist for, or another area\'s, stops the build', async () => {
  const missing = site({ ...FIXTURE, 'docs/areas/notes.md': `${front({ title: '"notes"', weight: 4, symbol: 'gamma' })}\n\nA page.\n` });
  await assert.rejects(build(DECLARATION, { root: missing, log: recorder() }), (e) => {
    assert.match(e.errors.join('\n'), /symbol gamma has no doc block/);
    cleanup(missing);
    return true;
  });

  const elsewhere = site({ ...FIXTURE, 'docs/reference/host.md': `${front({ title: '"The host"', weight: 1, symbol: 'alpha' })}\n\nA page.\n` });
  await assert.rejects(build(DECLARATION, { root: elsewhere, log: recorder() }), (e) => {
    assert.match(e.errors.join('\n'), /symbol alpha is @group areas, page is in reference/);
    cleanup(elsewhere);
    return true;
  });

  const orphan = site({ ...FIXTURE, 'src/thing.js': FIXTURE['src/thing.js'].replace('@page areas/beta', '@page areas/absent') });
  await assert.rejects(build(DECLARATION, { root: orphan, log: recorder() }), (e) => {
    assert.match(e.errors.join('\n'), /fixture\/thing\.beta renders on areas\/absent, which is not a page/);
    cleanup(orphan);
    return true;
  });
});

test('a page that names a documented symbol and claims none is a warning, and its title anchor must be its own', async () => {
  const root = site({
    ...FIXTURE,
    'docs/areas/notes.md': `${front({ title: '"beta"', weight: 4 })}\n\nA supplement whose title names a name.\n`,
  });
  const log = recorder();
  await build(DECLARATION, { root, log });
  assert.ok(log.seen.warnings.some((w) => w.includes('title names beta but the page claims no symbol')));
  cleanup(root);

  const twice = site({
    ...FIXTURE,
    'docs/areas/twin.md': `${front({ title: '"beta(x)"', weight: 5 })}\n\nSame title as its sibling.\n`,
  });
  await assert.rejects(build(DECLARATION, { root: twice, log: recorder() }), (e) => {
    assert.match(e.errors.join('\n'), /title anchor betax already used by areas\/beta\.md/);
    cleanup(twice);
    return true;
  });
});

test('the strip is only where the page states no parameter table of its own', async () => {
  const root = site({
    ...FIXTURE,
    'docs/areas/alpha.md': [
      front({ title: '"alpha(a, b)"', weight: 1, symbol: 'alpha' }),
      '',
      'Alpha adds.',
      '',
      '## Parameters',
      '',
      '| Param | Description |',
      '|---|---|',
      '| a | the first |',
      '',
    ].join('\n'),
  });
  await build(DECLARATION, { root, log: recorder() });
  const page = readFileSync(join(root, 'site/docs/areas/alpha/index.html'), 'utf8');
  assert.match(page, /<aside class="api">/, 'the signatures, the return and the source line stay');
  assert.doesNotMatch(page, /<details class="api-params">/, 'and the table the page wrote is the one a reader gets');
  cleanup(root);
});

test('an example whose fences are markup, and a module-syntax site\'s figures, are the declaration\'s', async () => {
  const root = site({
    ...FIXTURE,
    'src/thing.js': FIXTURE['src/thing.js'].replace(
      '@page areas/alpha',
      '@page areas/alpha\n * @example\n * ```wgsl\n * @vertex fn vs() {}\n * ```\n * const n = alpha(1, 2)',
    ),
  });
  const parsed = (await import('../src/generator/parse.js')).parseSources({ src: join(root, 'src') });
  const alpha = parsed.doclets.find((d) => d.name === 'alpha');
  assert.match(alpha.examples[0].code, /@vertex fn vs\(\)/, 'the example keeps the line the fence would have hidden');
  assert.doesNotMatch(alpha.examples[0].code, /```/, 'and the fence itself is the comment\'s markup, not the code');
  cleanup(root);
});

test('the canonical page of a name is the one its @page states, or its area and its snake_case name', () => {
  const doclets = [
    { name: 'alpha', group: 'areas', page: 'areas/alpha', ignore: false },
    { name: 'beta', group: 'areas', page: null, ignore: false },
    { name: 'gamma', group: 'areas', page: null, ignore: true },
  ];
  assert.deepEqual([...canonicalPages(doclets)], [['alpha', 'areas/alpha'], ['beta', 'areas/beta']]);
});
