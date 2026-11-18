/**
 * @file Build — a declaration in, a site out: parse, validate, render, write.
 * @license AGPL-3.0-only
 *
 * The order is fixed and each step is the same for every site: the doc blocks
 * and their carriers are parsed, the result is checked against the built
 * surface, the examples' rule, the site's links and its README, then the pages
 * are rendered and written beside the builds of the same commit, the static
 * chrome, the editor's bundle and its notices.
 *
 * What a site brings: its sources, its declaration, its plugins and its runner.
 * Nothing a site writes is a pipeline — a step it needs that this file does not
 * take is a plugin (`validate` adds findings, `render` adds pages and anchors)
 * or a declaration field, never a copy of a step.
 */

import {
  copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { DeclarationError, normalize, pinUrls, resolveValue } from './declaration.js';
import { linker } from './links.js';
import { loadPages, readingOrder, buildTree } from './pages.js';
import { parseSources } from './parse.js';
import { render, shell } from './render.js';
import { sketchFences } from './pagerender.js';
import { readSurface } from './surface.js';
import { validate } from './validate.js';

/** A build the declaration's own rules stopped. */
export class BuildError extends Error {
  constructor(errors) {
    super(`${errors.length} error(s) — site not written.\n${errors.join('\n')}`);
    this.name = 'BuildError';
    this.errors = errors;
  }
}

const EDITOR_ASSET_RE = /^editor\.[0-9a-f]+\.js$/;

/** The package's own root, from this file: `src/generator/` → the package. */
const PKG_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * The base stylesheet: the shell markup's structure, stated once for every site
 * that declares `shell.base`. It carries no colour, so it is the same bytes
 * whatever a site's palette is.
 */
const BASE_SHEET = fileURLToPath(new URL('../base.css', import.meta.url));

const readText = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null);

/**
 * The editor bundle the pages will load: the package's own build, read through
 * its manifest — the asset name, its size and its SHA-256 — so a page can never
 * carry a URL the artifact does not have.
 * @returns {{ file: string, url: string, manifest: Object }}
 */
function editorAsset() {
  const manifestFile = join(PKG_ROOT, 'dist', 'manifest.json');
  if (!existsSync(manifestFile)) {
    throw new DeclarationError(`${manifestFile} is missing — build the package's bundle (\`npm run build\`).`);
  }
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const file = join(PKG_ROOT, 'dist', manifest.asset);
  if (!existsSync(file)) {
    throw new DeclarationError(`${manifest.asset} is missing from the package's dist/ — rebuild the package.`);
  }
  const bytes = readFileSync(file);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== manifest.sha256 || bytes.length !== manifest.bytes) {
    throw new DeclarationError(`${manifest.asset} does not match its manifest — rebuild the package.`);
  }
  return { file, url: manifest.asset, manifest, bytes: bytes.length, sha256 };
}

/** The bundled packages' notices, as the site serves them. */
function notices(manifest) {
  const head = `${manifest.name} ${manifest.version} — editor bundle ${manifest.asset}\n` +
               `third-party notices, as recorded in its release manifest\n`;
  const body = manifest.licenses
    .map((item) => `\n${item.package} ${item.version} — ${item.license ?? 'see notice'}\n\n${item.notice}\n`)
    .join('');
  return `${head}${body}`;
}

/**
 * A short hash of everything the build ships: the build itself, every file
 * under the static directory (names and sizes; a stylesheet, script or JSON
 * file by its bytes as well), and the site's own prose. A page URL carrying it
 * is a URL no cache can answer with the previous build.
 * @param {Object} decl
 * @param {(p: string) => string} at
 * @returns {string} 8 hex characters
 */
function buildStamp(decl, at, pages = []) {
  const hash = createHash('sha1');
  for (const file of [decl.paths.bundle, decl.paths.module].filter(Boolean)) {
    if (existsSync(at(file))) hash.update(readFileSync(at(file)));
  }
  if (decl.paths.static && existsSync(at(decl.paths.static))) {
    const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
    for (const file of walk(at(decl.paths.static)).sort()) {
      hash.update(file);
      hash.update(String(statSync(file).size));
      if (/\.(css|js|json)$/.test(file)) hash.update(readFileSync(file));
    }
  }
  for (const file of [decl.paths.readme, decl.carrier.landing?.file].filter(Boolean)) {
    hash.update(readText(at(file)) ?? '');
  }
  // A page carrier's own prose is part of what ships: a rebuilt page, not a
  // rebuilt script, is what the reader would otherwise get from a cache.
  for (const page of pages) hash.update(page.file).update(page.body);
  // The base stylesheet is the package's, not the site's, so a package upgrade
  // that changes it must move the stamp the page's stylesheet URL carries.
  if (decl.shell.base) hash.update(readFileSync(BASE_SHEET));
  return hash.digest('hex').slice(0, 8);
}

/**
 * The page's config block, its tokens resolved. Declared tokens:
 * `bundle`, `module`, `index`, `editor`, `notices`, `stamp`, `dep:<name>` (a
 * copied dependency build) and `pin:<name>:<field>` (a pinned CDN artifact).
 */
function pageConfig(decl, urls, stamp) {
  const pins = pinUrls(decl.pins);
  const tokens = {
    bundle: urls.bundle,
    module: urls.module,
    index: urls.index,
    editor: urls.editor,
    notices: urls.notices,
    stamp,
  };
  for (const [name, url] of Object.entries(urls.deps)) tokens[`dep:${name}`] = url;
  for (const name of Object.keys(decl.pins)) {
    for (const field of Object.keys(decl.pins[name])) {
      const url = pins.url(name, field);
      if (url) tokens[`pin:${name}:${field}`] = url;
    }
  }
  return resolveValue(decl.runner.config, tokens);
}

/**
 * A plugin by name: `paths.plugins/<name>.mjs`, a default export with
 * `validate(parsed, ctx)` and `render(ctx)`.
 */
async function loadPlugins(decl, at) {
  const out = [];
  for (const name of decl.plugins) {
    const file = at(join(decl.paths.plugins, `${name}.mjs`));
    if (!existsSync(file)) throw new DeclarationError(`plugin ${name} is declared but ${file} is not there`);
    const plugin = (await import(pathToFileURL(file).href)).default;
    if (!plugin || typeof plugin !== 'object') {
      throw new DeclarationError(`plugin ${name} has no default export object`);
    }
    out.push({ name, data: plugin.data ?? null, validate: plugin.validate ?? null, render: plugin.render ?? null });
  }
  return out;
}

/**
 * Build a site.
 * @param {Object} declaration  the site's `docs.config.js` default export
 * @param {{ root?: string, log?: Object }} [options]
 * @returns {Promise<{ files: Map<string,string>, modules: Object[], doclets: Object[],
 *   examples: number, warnings: string[], stamp: string, out: string, editor: Object }>}
 */
export async function build(declaration, { root = process.cwd(), log = console } = {}) {
  if (!declaration?.paths?.pkg) throw new DeclarationError('paths.pkg is required — the package manifest');
  const at = (p) => join(root, p);
  const pkg = JSON.parse(readFileSync(at(declaration.paths.pkg), 'utf8'));
  const decl = normalize(declaration, pkg);

  const readme = readText(at(decl.paths.readme)) ?? '';
  const landing = decl.carrier.landing ? readText(at(decl.carrier.landing.file)) : null;
  if (decl.carrier.landing && landing == null) {
    throw new DeclarationError(`${decl.carrier.landing.file} is declared as the landing carrier and is not there`);
  }
  for (const file of [decl.paths.bundle, decl.paths.module]) {
    if (!file || existsSync(at(file))) continue;
    throw new DeclarationError(`${file} not found — run \`npm run build\` first.`);
  }
  for (const [name, file] of Object.entries(decl.paths.deps)) {
    if (!existsSync(at(file))) throw new DeclarationError(`${file} not found — ${name} is not installed.`);
  }
  for (const file of decl.paths.readmeAssets) {
    if (!existsSync(at(file))) throw new DeclarationError(`${file} is declared as a README asset and is not there`);
  }

  // The site's plugins, by name: they are the one place its code runs here.
  const plugins = await loadPlugins(decl, at);

  const pageDir = decl.carrier.pages.dir ? at(decl.carrier.pages.dir) : null;
  if (pageDir && !existsSync(pageDir)) {
    throw new DeclarationError(`${decl.carrier.pages.dir} is declared as the page carrier and is not there`);
  }
  const inventory = decl.paths.inventory ? JSON.parse(readText(at(decl.paths.inventory)) ?? 'null') : null;
  const redirects = decl.paths.redirects ? JSON.parse(readText(at(decl.paths.redirects)) ?? 'null') : null;

  // Parse, then read the build the doclets are checked against.
  const parsed = parseSources({
    src: at(decl.paths.src),
    carriers: decl.carrier.docs ? [at(decl.carrier.docs)] : [],
    surface: decl.parse.surface,
    members: decl.parse.members,
    ignore: decl.parse.ignore,
    private: decl.parse.private,
  });
  // The page tree, where the site's pages are files: the carrier reads it once
  // and every later step — the plugins, the checks, the renderer — reads that.
  const pages = pageDir ? loadPages(pageDir) : null;
  const tree = pages ? buildTree(pages) : null;
  const order = pages ? readingOrder(tree.roots).map((path) => tree.byPath.get(path)) : null;

  const surfaceFile = decl.surface?.module ? decl.paths.module : decl.paths.bundle;
  const built = decl.surface && surfaceFile
    ? await readSurface(decl.surface, at(surfaceFile))
    : { api: null, errors: [] };

  const link = linker({
    parsed,
    references: decl.references,
    namespaces: decl.namespaces,
    ownerOrder: decl.ownerOrder,
    brand: decl.brand.name,
  });

  // What a site's own analysis supplies the carrier's slots with: the blocks a
  // page's directives name, the page's foot, and the index entries its names
  // earn. A plugin's `data` runs before the checks, because a directive no data
  // claims is one of them.
  const data = {};
  for (const plugin of plugins) {
    if (!plugin.data) continue;
    const added = await plugin.data(parsed, { declaration: decl, pages, tree, order, link, readme }) ?? {};
    for (const [key, value] of Object.entries(added)) {
      if (key === 'notes') continue;
      // A supplied list is appended to; a supplied map of page → block is merged.
      data[key] = Array.isArray(value) ? [...(data[key] ?? []), ...value]
        : { ...(data[key] ?? {}), ...value };
    }
    for (const note of added.notes ?? []) log.log(`[docs] note  ${note}`);
  }

  // Validate — the package's checks, then each plugin's own. Errors stop the
  // build, warnings print, and a code the declaration names in `strict` fails it.
  const validateCtx = {
    declaration: decl, api: built.api, surfaceErrors: built.errors, readme, link, parsed,
    pages, tree, order, inventory, data,
  };
  const { errors, warnings } = validate(parsed, validateCtx);
  for (const plugin of plugins) {
    if (!plugin.validate) continue;
    const added = await plugin.validate(parsed, validateCtx) ?? {};
    for (const w of added.warnings ?? []) warnings.push(`${plugin.name}  ${w}`);
    for (const e of added.errors ?? []) errors.push(`${plugin.name}  ${e}`);
  }
  for (const w of warnings) log.warn(`[docs] warn  ${w}`);
  for (const e of errors) log.error(`[docs] error ${e}`);
  if (errors.length) throw new BuildError(errors);

  // The stamp over what ships, then the URLs a page names, then the page's config.
  const stamp = decl.stamp ? buildStamp(decl, at, pages ?? []) : '';
  const editor = editorAsset();
  const urls = {
    bundle: decl.outputs.bundle,
    module: decl.outputs.module,
    deps: decl.outputs.deps,
    index: decl.outputs.index,
    editor: decl.outputs.editor ? `${decl.outputs.editor}/${editor.url}` : null,
    notices: decl.outputs.notices,
  };
  const state = {
    declaration: decl,
    brand: decl.brand,
    link,
    urls,
    config: pageConfig(decl, urls, stamp),
    readme,
    landing,
    stamp,
    pages,
    order,
    slots: data.slots ?? {},
    index: data.index ?? [],
    redirects,
    inventory,
  };

  // Render, then the site's plugins: they add pages and anchors, and nothing else.
  const files = render(parsed, state);
  if (plugins.length) {
    const pluginCtx = {
      ...state,
      parsed,
      rendered: files,
      emit: (file, html) => files.set(file, html),
      shell: (page) => shell(state, page),
      output: (name) => decl.outputs[name],
    };
    for (const plugin of plugins) {
      if (!plugin.render) continue;
      const added = await plugin.render(pluginCtx) ?? {};
      for (const [file, html] of added.pages ?? []) files.set(file, html);
      for (const [name, href] of added.anchors ?? []) link.addAnchor(name, href);
    }
  }

  // Write site/ from scratch, but keep every editor asset an earlier build wrote:
  // a page served from a cache still asks for the editor it was built against.
  const out = at(decl.paths.site);
  const assets = decl.outputs.editor ? join(out, decl.outputs.editor) : null;
  const retained = assets && existsSync(assets)
    ? readdirSync(assets).filter((name) => EDITOR_ASSET_RE.test(name))
      .map((name) => [name, readFileSync(join(assets, name))])
    : [];
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const [file, html] of files) {
    mkdirSync(dirname(join(out, file)), { recursive: true });
    writeFileSync(join(out, file), html);
  }
  if (urls.bundle) copyFileSync(at(decl.paths.bundle), join(out, urls.bundle));
  if (urls.module) copyFileSync(at(decl.paths.module), join(out, urls.module));
  // The README's own relative references, at the site-relative path it writes
  // them at: a landing page that points at `hero.png` beside it finds it there.
  for (const file of decl.paths.readmeAssets) {
    const target = join(out, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(at(file), target);
  }
  // The shell's structure, where a site states a path for it; the page links it
  // before the site's own stylesheet.
  if (decl.shell.base) {
    const target = join(out, decl.shell.base);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(BASE_SHEET, target);
  }
  if (assets) {
    mkdirSync(assets, { recursive: true });
    copyFileSync(editor.file, join(assets, editor.url));
    for (const [name, bytes] of retained) writeFileSync(join(assets, name), bytes);
  }
  if (urls.notices) writeFileSync(join(out, urls.notices), notices(editor.manifest));
  for (const [name, file] of Object.entries(decl.paths.deps)) {
    copyFileSync(at(file), join(out, decl.outputs.deps[name]));
  }
  if (decl.paths.static && existsSync(at(decl.paths.static))) {
    cpSync(at(decl.paths.static), out, { recursive: true });
  }

  // Every reference the written site makes, resolved on disk — a page reads
  // correctly to the generator and 404s in the browser otherwise.
  const broken = [...linkCheck(out, files), ...indexCheck(files, decl.outputs.index)];
  for (const e of broken) log.error(`[docs] error ${e}`);
  if (broken.length) throw new BuildError(broken);

  return {
    files,
    modules: parsed.modules,
    doclets: parsed.doclets,
    pages: pages?.length ?? 0,
    sketches: (pages ?? []).reduce((n, p) => n + sketchFences(p.body).filter((code) => /(^|[^\w$])(?:async\s+)?function\s+setup\s*\(/.test(code)).length, 0),
    examples: parsed.doclets.reduce((n, d) => n + d.examples.length, 0),
    warnings,
    stamp,
    out: decl.paths.site,
    editor: {
      url: urls.editor, bytes: editor.bytes, sha256: editor.sha256, retained: retained.length,
    },
  };
}

/**
 * The search index's hrefs are never in the HTML, so the link check cannot see
 * them: every entry must name a page the build wrote.
 * @param {Map<string,string>} files
 * @param {string} index  the index's own file
 * @returns {string[]}
 */
function indexCheck(files, index) {
  const problems = [];
  for (const [file, body] of files) {
    if (file !== index) continue;
    for (const entry of JSON.parse(body)) {
      const [page] = entry.h.split('#');
      const target = /\.html$/.test(page) ? page : `${page}index.html`;
      if (!files.has(target)) problems.push(`${file}  ${entry.n ?? entry.t} → ${entry.h} is not a page`);
    }
  }
  return problems;
}

/**
 * Resolve every `href`/`src` the site emits, relative to the file that carries
 * it. A directory URL resolves to its `index.html`; fragments and absolute
 * URLs are not this check's business.
 * @param {string} out  absolute path of the written site
 * @param {Map<string,string>} files  site-relative file → HTML
 * @returns {string[]} one line per broken reference
 */
function linkCheck(out, files) {
  const seen = new Set();
  const problems = [];
  for (const [file, html] of files) {
    for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const target = m[1].replace(/&amp;/g, '&');
      if (/^(?:[a-z]+:|\/\/|#|data:|mailto:)/i.test(target)) continue;
      const [pathPart] = target.split('#')[0].split('?');
      if (!pathPart) continue;
      const resolved = resolve(dirname(join(out, file)), pathPart);
      const fileTarget = pathPart.endsWith('/') || !/\.[a-z0-9]+$/i.test(pathPart)
        ? join(resolved, 'index.html') : resolved;
      if (existsSync(fileTarget)) continue;
      const key = `${file} → ${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      problems.push(`${file} links to ${target}, which is not there`);
    }
  }
  return problems;
}
