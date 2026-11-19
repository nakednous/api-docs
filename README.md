# @nakednous/scholion

[![npm](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.npmjs.org%2F%40nakednous%2Fscholion&query=$.dist-tags.latest&label=npm&color=1c1e22)](https://www.npmjs.com/package/@nakednous/scholion)

One scaffold for the API reference sites of four libraries — [p5.quadrille.js](https://objetos.github.io/p5.quadrille.js/),
[p5.tree](https://visualcomputing.github.io/p5.tree/), [webgl.tree](https://jpcharalambosh.co/webgl.tree/)
and [webgpu.tree](https://jpcharalambosh.co/webgpu.tree/): one editor, one generator, one page contract.

A *scholion* (pl. *scholia*) is the note a commentator writes in the margin beside a line of someone
else's text; these are the notes beside the libraries' source.

ESM only: no CommonJS, no UMD. Node 22 or later.

## What is whose

| the site writes | this package |
|---|---|
| `docs.config.js` (a declaration), its content (`src/`, `docs/`, `README.md`), its runner and stylesheet, a plugin where the declaration cannot say it | parse, validate, render, the static output, the search index, the stamp, the editor bundle |

A library carries no pipeline, and a site's `tools/docs` is four imports:

```js
// tools/docs/index.js, in full
import { build } from '@nakednous/scholion/generator';
import config from './docs.config.js';

const summary = await build(config, { root });
```

```
docs.config.js                    the declaration — no steps in it
static/                           the stylesheet, the scripts, the models
plugins/<name>.mjs                only if the declaration cannot say it
```

## The declaration

A field is a statement about the site, never a step.

| field | what it states |
|---|---|
| `paths` | `pkg`, `readme`, `src`, `bundle`, `module`, `deps`, `static`, `plugins`, `site` — repo-relative; `readmeAssets` — files the README names relatively, copied to the same site-relative path; `inventory`, `redirects` — the two files a page carrier answers its old addresses with |
| `outputs` | `bundle`, `module`, `deps`, `index`, `editor`, `notices` — what the build writes, as the page names it |
| `brand` | `name`, `version`, `license`; each defaults to the package manifest |
| `carrier` | `docs` — documentation-only sources; `landing` — a Markdown file rendered as a landing-page section, its one `js` fence a live module demo (`{ file, section, id }`); `pages` — the page tree: `kind` (`'modules'`, one page per documented module, the default; `'markdown'`, one page per file), `dir` (the directory, which is also each URL's first segment), `source` (the address the strip's source line links into) |
| `parse` | `surface` (gate on what `src/index.js` re-exports or declares), `members` (the class whose indented members are public), `ignore` (`'skip'` drops an `@ignore` block, `'keep'` keeps it for a coverage check), `private` (`'skip'` keeps a leading `_` off the site, `'keep'` documents it), `vocabulary` (the site's own closed tag set) |
| `examples` | `syntax` (`'global'`, `'module'`, `'any'`), `global` (the global an example must read), `required` (a function with no `@example` is a warning), `setup` (every example defines `setup()`) |
| `surface` | `global` — the name the IIFE leaves behind, or the host global it installs onto, or a list of names when a build leaves one thing behind and installs another (the api is then keyed by them); `module: true` — the ES build at `paths.module`, imported; `globals` — what that build reads at load; `check` — `'reexports'` or `'all'` |
| `owners` | where each owner lives in the build: a path from the surface, a list of paths when its names sit in several places, `''` for the surface's own top-level exports, `path()` for the object a factory returns, `null` for an owner only a sketch can reach |
| `ownerOrder` | the owners a page puts first; a bare name several owners share resolves to the first of them |
| `namespaces` | owners written as a prefix in signatures (`tree.mat4Mul`) |
| `pins` | `{ 'twgl.js': { version, script, module } }` — a CDN artifact a page loads, one version, the paths it names |
| `references` | `packages` (name → address), `externals` (a documentation grammar), `aliases`, `readme` (`'linked'` or `'plain'`) |
| `home` | the address the site is served from; a README link into it names a page and a name the build writes |
| `mode` | `'esm'` or `'global'` — how the page loads its own scripts; the JSON block is its config either way |
| `shell` | `base` (the site path the package's base stylesheet is written to), `stylesheet` (the site's own, which states the colour), `favicon`, `search` |
| `runner` | `script`, `search`, `chrome`, `extra`, `video` (loaded only by a page that carries a video shortcode), `config` (the page's config block) |
| `groups`, `areas` | the teaching structure; a site that states none has `@group`/`@page` ignored |
| `plugins` | the names this site's code is known by, resolved as `paths.plugins/<name>.mjs` |
| `strict` | the finding codes that fail the build rather than print |
| `stamp` | `true` when every site-local asset URL carries `?v=<hash>` of what ships |

### Reference data

A name in prose or in a signature resolves in one order: a documented name, a package, an external
library's grammar, plain code.

```js
references: {
  packages: { '@nakednous/tree': 'https://github.com/nakednous/tree', 'twgl.js': 'https://twgljs.org/' },
  externals: [{
    prefix: 'twgl',                       // twgl.<member> and twgl.<ns>.<member>
    base: 'https://twgljs.org/docs/',
    url: {
      qualified: 'module-twgl_{ns}.html#.{member}',
      one:       'module-twgl.html#.{member}',
      namespace: 'module-twgl_{member}.html',       // a one-segment name that is a namespace
      namespaces: ['m4', 'v3', 'primitives'],
      classes: '^[A-Z][a-z]',                       // a one-segment name that is a class
      class: 'class-{member}.html',
      pages: { setTextureFromElement: 'module-twgl_textures.html#.{member}' },
    },
    exclude: ['Own'],                    // a segment the grammar does not claim
    text: '{rest}',                      // how the link reads; `{name}` is the name as written
  }],
}
```

`{member}`, `{ns}`, `{name}` and `{rest}` are the substitutions — the last segment, the first, the name
as written, and the name without the prefix. A name is the prefix plus one segment (taking `pages` →
`namespaces` → `classes` → `one`) or two (`qualified`); a segment an `exclude` lists is not its own. A
`resolve(name)` hook does not exist: a scheme this table cannot express is a defect to report.

## Plugins

The only place a site's code runs inside the package: three optional methods, named by `plugins`.

| method | what it may do |
|---|---|
| `data(parsed, ctx)` | supply `slots` (page path → the HTML its `<!-- uses: NAME -->` directives and its `foot` render), `index` (entries its names earn, between the carrier's symbols and its pages), `notes` (lines the build prints) |
| `validate(parsed, ctx)` | add errors and warnings |
| `render(ctx)` | add pages and anchors |

```js
// tools/docs/plugins/host.mjs
export default {
  name: 'host',
  data(parsed, ctx) {
    return {
      slots: { 'reference/host': { host: '<table class="terms">…' }, 'areas/alpha': { foot: '…' } },
      index: [{ t: 'createCanvas', h: 'docs/reference/host/#createcanvas', k: 'p5', s: '…' }],
      notes: ['3 name(s) belong to no tier: …'],
    };
  },
};
```

`ctx` is the build's state: `declaration`, `parsed`, `pages` (a page carrier's records), `tree`, `order`,
`link`, `readme`, `api`, `inventory`, `data`; `render` adds `urls`, `config`, `landing`, `stamp`,
`rendered`, `emit(file, html)`, `shell(page)`, `output(name)`. A directive no plugin's `slots` claims
fails the build: a page cannot ask for a block and ship an empty section.

## The generator

`@nakednous/scholion/generator` exports `parseSources`, `validate`, `render`, `build`, `BuildError` and
`DeclarationError`.

| step | what it reads and writes |
|---|---|
| `parseSources` | sources plus documentation-only carriers in; a module table and a doclet table out — each rule an option (`surface`, `members`, `ignore`, `private`, `carriers`). An `@example` is its caption and its code; a fenced line inside it is the comment's markup, not the code |
| `validate` | the doclet table against the built IIFE or the module's exports (a rest parameter opens the list), the examples against the site's rule, every `{@link}`, the README's own links, the carrier's pages. Errors stop a build, warnings print, a code in `strict` fails it |
| `render` | one page per module, or one per Markdown file; the README as landing; the index; the pager; the shell |
| `build` | the four in one pass, then the static output: the same commit's builds, the static chrome, the pinned deps, the editor's content-hashed asset and notices, every earlier editor asset, and every reference resolved on disk |

**The API is unstable.** It is exported for the sibling repositories, all four of which run on it, and it
is published — `0.0.1`, the four sites' only pinned version — before either half is promised. A version a
site pins is a version it reads this file against, so a breaking change is a release, not a patch.

### The page

One head for every page: the theme boot, the title, the favicons, the stylesheets, one
`<script type="application/json" id="docs-config">` block, then the site's scripts — modules when `mode`
is `'esm'`, classic `defer` scripts when it is `'global'`, reading the block by that id either way, so
`mode` decides nothing but how they load.

`shell.base` is where the package's base stylesheet is written, and the page loads it before the site's
own: the base is this markup's structure (the grid, the rail, the picker, the search box, the doclet
tables, the example figure, the editor's surface) and states no colour; the site's file states the
colour tokens (`--bg`, `--bg-2`, `--fg`, `--muted`, `--border`, `--accent`, `--accent-ink`, `--accent-2`,
`--stage`, the `--cm-*` roles).

A site whose pages are files states `carrier.pages: { kind: 'markdown', dir }`:

| | |
|---|---|
| pages | one per Markdown file, at `<dir>/<path>/index.html` — the directory's name is each URL's first segment; `_index.md` is its directory's page |
| front matter | `title`, `weight`, `symbol` — the documented name the page carries (`none`: deliberately none; absent: a supplement) |
| the strip | the symbol's signatures (one per surface), its return type, a parameter table only where the page states none, and the source line — on one page per name: its `@page`, else `<group>/<snake(name)>` |
| fences | a fence that defines `setup()` is a sketch and runs in the editor; any other stays a plain `<pre><code>` |
| the shortcode | `{{< youtube ID "caption" >}}` — a 16:9 poster a click upgrades; any other shortcode-shaped run fails the build |
| the index | `{ t, h, k, s }`: a symbol, a plugin's entries, then a page (`'section'` or `'page'`) — a module site keeps `{ n, o, h, s }` |
| addresses | every URL page-relative; `{root}` is the page's prefix to the site root; `paths.inventory`/`paths.redirects` answer old addresses with a stub and its `rel=canonical` |

## The editor

`mountEditor(textarea, { value, onRun, wrap })` returns `{ getValue, reset, focus, destroy }`; no
CodeMirror type crosses that boundary, and the caller keeps the textarea, the buttons and the frame.

```js
// a site's runner, on a page that has an example; the URL is the page's config
const { mountEditor } = await import(config.editor);
const editor = mountEditor(textarea, {
  value: textarea.value,       // what Reset restores, byte for byte
  onRun: () => run(),          // Mod-Enter, bound before the default keymap
  wrap: false,                 // EditorView.lineWrapping only where a page wants it
});
```

- The document is the textarea's current text, so an edit made while the module loads survives; the
  textarea is hidden only once the view is in the page.
- `reset()` installs a fresh `EditorState` from `value` — the text comes back byte for byte, history
  cleared.
- A mount that throws leaves the textarea in place, marks it `data-editor="fallback"` and returns the
  same four methods over it; `destroy()` gives the text back.
- The extension set is fixed: JavaScript highlighting, line numbers, history, `historyKeymap`,
  `defaultKeymap` with Mod-Enter ahead of it, a two-space indent and tab size, `indentOnInput`,
  `drawSelection`, `indentWithTab`, the highlight style and the theme. No `basicSetup`; wrapping opt-in.
- Colours are CSS variables (`--cm-*`, `--bg-2`, `--border`, `--fg`), so a theme switch is CSS only —
  no `Compartment`, no view rebuild. A focused editor draws its ring from `:has(.cm-content:focus-visible)`.

## The bundle

`npm run build` writes `dist/editor.<hash>.js` — one ES module, `bundle: true`, `format: esm`,
`platform: browser`, no splitting, one CodeMirror graph — and `dist/manifest.json` beside it: the asset's
name, size and SHA-256, every package's exact version, the esbuild version and the license notices. A
site copies the asset under its hashed name and keeps the earlier ones; a rebuild of the same inputs
produces the same bytes. The export map carries `./manifest.json` and `./generator`, and no root export:
a site imports the served bundle, never the adapter's source, which would pull `@codemirror/*` into a
page.

## Commands

```
npm ci                   # install (esbuild's install script is the only one, allowed by .npmrc)
npm test                 # build, the conformance and generator suites, then the consumer gate
npm run build            # src/editor.js → dist/editor.<hash>.js + dist/manifest.json
npm pack --dry-run       # the files a consumer installs
```

`node:test` + jsdom assert the editor's contract, its state and the injected CSS as text — never layout
or paint; a fixture site asserts the generator's every step on disk. The consumer gate packs the
tarball, installs it production-only, resolves both exports and checks the installed asset against the
manifest.

## Licence

AGPL-3.0-only. The bundle ships @codemirror/* and @lezer/* under MIT, with their notices in the manifest.
