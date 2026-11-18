# @nakednous/scholion

The shared API reference scaffold for the nakednous libraries — the editor, the site kit and the
generator behind p5.quadrille.js, p5.tree, webgl.tree and webgpu.tree.

A *scholion* (pl. *scholia*) is the note a commentator writes in the margin beside a line of someone
else's text; these are the notes beside the libraries' source.

ESM only: no CommonJS, no UMD. Node 22 or later. The first release carries the CodeMirror 6 editor
adapter and its prebuilt ES module bundle; the generator follows.

## The editor

`mountEditor(textarea, { value, onRun, wrap })` puts an editor in place of a textarea and returns
`{ getValue, reset, focus, destroy }`. No CodeMirror type crosses that boundary: the caller keeps the
textarea, the buttons and the frame.

```js
import { mountEditor } from '@nakednous/scholion';

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

The package's own `exports` map: `.` is the adapter's source (for tests and tooling that install the
CodeMirror packages themselves), `./manifest.json` is the build's interface. `prepack` rebuilds, so a
tarball always carries a fresh bundle.

## Commands

```
npm ci                   # install (esbuild's install script is the only one, allowed by .npmrc)
npm test                 # build, then the adapter and bundle conformance suites (node:test, jsdom)
npm run build            # src/editor.js → dist/editor.<hash>.js + dist/manifest.json
npm pack --dry-run       # the files a consumer installs
```

## Licence

AGPL-3.0-only. The bundle ships @codemirror/* and @lezer/* under MIT, with their notices in the
manifest.
