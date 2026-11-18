# @nakednous/scholion

The shared API reference scaffold for the nakednous libraries — the editor, the site kit and the
generator behind p5.quadrille.js, p5.tree, webgl.tree and webgpu.tree.

A *scholion* (pl. *scholia*) is the note a commentator writes in the margin beside a line of someone
else's text; these are the notes beside the libraries' source.

ESM only: no CommonJS, no UMD. Node 22 or later.

## What a site owns, and what it does not

A library carries no pipeline. Its API site is a **declaration** — `tools/docs/docs.config.js`, a plain
object with no steps in it — plus what is genuinely local: its content, its example runner, its static
chrome and, where its reference scheme cannot be expressed as data, a plugin. Everything else is this
package: parse, validate, render and write.

```
src/ · docs/ · README.md · dist/          the site's sources and builds
tools/docs/docs.config.js                 the declaration
tools/docs/static/                        its stylesheet, its scripts, its models
tools/docs/index.js                       `npm run docs`: ~8 lines, calls build()
tools/docs/plugins/<name>.mjs             only if the declaration cannot say it
```

```js
// tools/docs/index.js, in full
import { build } from '@nakednous/scholion/generator';
import config from './docs.config.js';

const summary = await build(config, { root });
```

## The declaration

Every field is a statement about the site, never a step. The ones this package reads:

| field | what it states |
|---|---|
| `paths` | `pkg`, `readme`, `src`, `bundle`, `module`, `deps`, `static`, `plugins`, `site` — repo-relative; `readmeAssets` — files the README names relatively, copied to the same site-relative path |
| `outputs` | `bundle`, `module`, `deps`, `index`, `editor`, `notices` — what the build writes, as the page names it |
| `brand` | `name`, `version`, `license`; each defaults to the package manifest, and a stated version that disagrees with it is the site's problem, not a build fact |
| `carrier` | `docs`: documentation-only sources the parser reads; `landing`: a Markdown file rendered as a section of the landing page, its one `js` fence a live module demo (`{ file, section, id }`) |
| `parse` | `surface` (gate on what `src/index.js` re-exports or declares), `members` (the class whose indented members are public), `ignore` (`'skip'` drops an `@ignore` block, `'keep'` keeps it for a coverage check), `private` (`'skip'` keeps a leading `_` off the site, `'keep'` documents it), `vocabulary` (the site's own closed tag set, where it states one) |
| `examples` | `syntax` (`'global'` — classic scripts, `'module'`, `'any'`), `global` (the global an example must read), `required` (a function with no `@example` is a warning), `setup` (every example defines `setup()`) |
| `surface` | `global` (the name the IIFE leaves behind, or the host global it installs onto) or `module: true` (the ES build at `paths.module`, imported), `globals` (what that build reads at load), `check` (`'reexports'` — the documentation-only carriers only — or `'all'`) |
| `owners` | where each owner lives in the build: a path from the surface, a list of paths when one owner's names sit in several places, an empty path for an owner whose names are the surface's own top-level exports, `path()` for the object a factory returns (its methods defined in the factory's body or attached to the result), or `null` for an owner that is documented and not statically reachable |
| `ownerOrder` | the owners a page puts first, in order; a bare name several owners share resolves to the first of them |
| `namespaces` | owners written as a prefix in signatures (`tree.mat4Mul`) |
| `pins` | `{ 'twgl.js': { version, script, module } }` — a CDN artifact a page loads, one version, the paths it names |
| `references` | `packages` (name → address), `externals` (a documentation grammar: `prefix`, `base`, `url`, `text`, `exclude`), `aliases`, and `readme` (`'linked'` — the landing page's prose through the same table — or `'plain'`, as written) |
| `home` | the address the site is served from: a README link into it must name a page and a name the build writes |
| `mode` | `'esm'` or `'global'` — how the page loads its own scripts; the JSON block is the page's config either way |
| `shell` | `base` — the site path the package's base stylesheet is written to, when the site takes it; `stylesheet` — the site's own file, which states its colours; `favicon`; `search` (the box's placeholder and label) |
| `runner` | `script`, `search`, `chrome`, `extra`, and `config` — the page's config block |
| `groups`, `areas` | the teaching structure, where a site has one; a site that states none has `@group`/`@page` ignored |
| `plugins` | the names this site's code is known by, resolved as `paths.plugins/<name>.mjs` |
| `strict` | the finding codes that fail the build rather than print |
| `stamp` | `true` when every site-local asset URL carries `?v=<hash>` of what ships |

### Reference data

A name in prose or in a signature resolves in one order: a documented name, then a package, then an
external library's grammar, and plain code when nothing claims it.

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
      pages: { setTextureFromElement: 'module-twgl_textures.html#.{member}' },   // its own page
    },
    exclude: ['Own'],                    // a segment the grammar does not claim: an addon's namespace
    text: '{rest}',                      // how the link reads; `{name}` is the name as written
  }],
}
```

`{member}`, `{ns}`, `{name}` and `{rest}` are the substitutions: the last segment, the first one, the
whole name as written, and the name without the prefix. A name is the prefix alone (not a name), the
prefix plus one segment (takes `pages` → `namespaces` → `classes` → `one`), or two (takes `qualified`).
A name any of whose segments an `exclude` lists is not that grammar's.

A `resolve(name)` hook does not exist: a scheme this table cannot express is a defect to report, not a
hook to add quietly.

## Plugins

A plugin is a named object with two optional methods, and it is the only place a site's code runs inside
this package.

```js
// tools/docs/plugins/host.mjs
export default {
  name: 'host',
  validate(parsed, ctx) {                 // may add errors and warnings
    return { errors: [], warnings: ['…'] };
  },
  render(ctx) {                           // may add pages and anchors
    return { pages: [['reference/host.html', ctx.shell({ … })]], anchors: [['p5.createCanvas', '…']] };
  },
};
```

`ctx` for both is the build's state: `declaration`, `parsed`, `link` (the name table and its markdown
renderers), `urls`, `config`, `readme`, `landing`, `stamp`, `api`; `render` also gets `pages` (what is
rendered so far), `emit(file, html)`, `shell(page)` and `output(name)`.

## The generator's API

`@nakednous/scholion/generator` exports `parseSources`, `validate`, `render`, `build`, `BuildError` and
`DeclarationError`.

**The API is unstable.** It is exported for the sibling repositories of this suite, nothing has been
published, and it is read by every site of the suite before either half is promised: until then the shape
moves, and the declaration — the half a site writes — is where it has moved. A CLI would change what the
package's entry is, which is a separate question from this one. Pin the package and read this file; do not
build on a signature that is not written here.

`build` is the whole pipeline: parse → validate → render → write. The three steps are exported beside it
because a site's own tool may want the tables without a site — a parity run does.

### parseSources

Source files plus any documentation-only carrier files in, one module table and one doclet table out.
The union of the rules the sites state today, each chosen by an option: `surface` gates publicity on
what `src/index.js` puts on the surface — the names it re-exports and the ones it declares itself —
`members` names the class whose indented members are public, `ignore` says whether an `@ignore` block is
kept for a coverage check or dropped, `private` says what a leading `_` means, `carriers` lists the
documentation-only directories. A `@example` is its caption and its code; a fenced line inside it
(` ```wgsl ` … ` ``` `) is dropped from the code, because a doc block reads a line that begins with `@`
as a tag and the fence is the comment's markup.

### validate

The documented surface against the built IIFE or the module's exports (a rest parameter opens the list,
so only the parameters the source declares before `...` are compared), the examples against the site's
own rule, every `{@link}` against the name table, and the README's own links against the pages and names
the build writes. Errors stop a build; warnings print; a code in `strict` fails it. A plugin's
`validate` runs last.

### render and the static output

One page per module with public doclets, the README as the landing page, the search index, the pager, and
the shell every page is wrapped in — the theme boot, the picker, the rail, the search box, the footer.
`build` writes the site beside the builds of the same commit, copies the static chrome and any pinned
dependency build, copies the editor's content-hashed asset and its notices, keeps every earlier editor
asset an older page may still ask for, and resolves every reference it wrote against the files on disk.

**The page's head is one contract.** The theme boot, the title, the favicons, the stylesheets, then one
`<script type="application/json" id="docs-config">` block, then the site's own scripts — `type="module"`
when `mode` is `'esm'`, classic `defer` scripts when it is `'global'`. The block is the page's config
either way, and its contents are `runner.config` with the `{tokens}` resolved; a classic page reads it by
that id instead of writing a global of its own, so `mode` decides how the scripts load and nothing else.
A site whose `examples.syntax` is `'module'` has its example figures carry `data-mode="module"`, so the
site's runner reads the shape off the markup rather than inferring it from the source.

**The stylesheets.** `shell.base` is where the package's base stylesheet is written, and a page that
states one loads it before the site's own file. The base is the structure of this markup — the grid, the
rail, the picker, the search box, the doclet tables, the example figure, the editor's surface — and it
states no colour: a site's own stylesheet states the colour tokens (`--bg`, `--bg-2`, `--fg`, `--muted`,
`--border`, `--accent`, `--accent-ink`, `--accent-2`, `--stage`, the `--cm-*` roles) and overrides the
type where its page's code is not the base's. A site that states no `shell.base` keeps the one stylesheet
it wrote.

## The editor

`mountEditor(textarea, { value, onRun, wrap })` puts an editor in place of a textarea and returns
`{ getValue, reset, focus, destroy }`. No CodeMirror type crosses that boundary: the caller keeps the
textarea, the buttons and the frame.

```js
// a site's runner, on a page that has an example: the URL is the page's config
const { mountEditor } = await import(config.editor);
const editor = mountEditor(textarea, {
  value: textarea.value,       // what Reset restores, byte for byte
  onRun: () => run(),          // Mod-Enter, bound before the default keymap
  wrap: false,                 // EditorView.lineWrapping only where a page wants it
});
```

- The document is the textarea's current text, so an edit made while the module was loading survives;
  the textarea is hidden only once the view is in the page.
- `reset()` installs a fresh `EditorState` from `value`, so the text comes back byte for byte and the
  history is cleared.
- A mount that throws leaves the textarea in place, marks it `data-editor="fallback"` and returns the
  same four verbs over the bare textarea.
- `destroy()` gives the text back to the textarea.
- The extension set is fixed: JavaScript highlighting, line numbers, history, `historyKeymap`,
  `defaultKeymap` with Mod-Enter bound ahead of it, a two-space indent unit and tab size,
  `indentOnInput`, `drawSelection`, `indentWithTab`, the highlight style and the theme. No
  `basicSetup`. Wrapping is opt-in.
- The theme is one `EditorView.theme` and one `HighlightStyle` whose colours are CSS variables
  (`--cm-*`, `--bg-2`, `--border`, `--fg`), each with a `light-dark()` fallback: a page switches light
  and dark through `color-scheme` and `data-theme`, with no `Compartment` and no view rebuild. The
  variables and their fallbacks are listed in `src/theme.js`.

## The bundle

A consuming site never imports CodeMirror. It serves the built artifact and imports it with a dynamic
`import()` on a page that has an editor:

- `npm run build` writes `dist/editor.<hash>.js` — one ES module, `bundle: true`, `format: esm`,
  `platform: browser`, no splitting, no downlevelling — and `dist/manifest.json` beside it.
- The manifest records the asset's name, size and SHA-256, the exact version of every package in the
  graph, the esbuild version and each package's license notice. A consuming build copies the asset
  under its hashed name and reads that URL from the manifest; a rebuild of the same inputs produces
  the same bytes and the same name.
- A build that finds two copies of a package, or an asset that imports another file, fails instead of
  shipping.

The package's export map carries two entries, `./manifest.json` and `./generator`. There is no root
export — a site imports the served bundle the manifest names, never the adapter's source, which would
pull `@codemirror/*` into a page that has no business holding two editor graphs.

## Commands

```
npm ci                   # install (esbuild's install script is the only one, allowed by .npmrc)
npm test                 # build, the conformance and generator suites, then the consumer gate
npm run build            # src/editor.js → dist/editor.<hash>.js + dist/manifest.json
npm pack --dry-run       # the files a consumer installs
```

What the suite can see, and what it cannot: `node:test` + jsdom assert the editor's contract, its state
— facets, history, keymaps, transactions — and the injected CSS as text, and a fixture site asserts the
generator's every step on disk. jsdom has no layout engine and the suite never claims layout or computed
paint; tokens, caret, gutters, selection and the theme switch are a consuming site's browser probe's
business. The consumer gate packs the tarball, installs it production-only and checks that the installed
`./manifest.json` and `./generator` both resolve, and that the installed asset's bytes are the manifest's.

## Licence

AGPL-3.0-only. The bundle ships @codemirror/* and @lezer/* under MIT, with their notices in the
manifest.
