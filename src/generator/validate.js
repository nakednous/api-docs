/**
 * @file Validation — the doclet table against the tag vocabulary, the built
 * surface, the examples' own rule, and the site's links; the README against the
 * pages and names the build writes.
 * @license AGPL-3.0-only
 *
 * Errors stop a build. Warnings print and continue, except the codes a
 * declaration names in `strict`, which fail it — the difference between a rule
 * a site states (`@example` must run) and a rule it only wants reported (a
 * public name with no doc block).
 *
 * A plugin's `validate(parsed, ctx)` runs last and adds errors and warnings of
 * its own; it is how a site keeps what is its own inside this pass.
 */

import { VOCABULARY } from './declaration.js';
import { liveModules, pageOf, anchorOf } from './links.js';
import { canonicalPath, shortcodeErrors } from './pagerender.js';
import { referenceUrl } from './references.js';
import { ownerScope } from './surface.js';
import { splitFences, slug as headingSlug } from './markdown.js';
import { symbolOfTitle } from './pages.js';

const LINK_RE = /\{@link\s+([^}\s]+)\s*\}/g;
const MODULE_SYNTAX_RE = /^\s*(import|export)\b|\bimport\s*\(|\bawait\b/m;
const SETUP_RE = /(^|[^\w$])(?:async\s+)?function\s+setup\s*\(/;

function* fields(rows) {
  for (const r of rows) { yield r; yield* fields(r.children); }
}

/** Every free-text field of a doclet that may carry `{@link}`. */
function* texts(d) {
  yield d.description;
  yield d.tagDescription;
  if (d.returns) yield d.returns.description;
  for (const f of fields(d.params)) yield f.description;
  for (const f of fields(d.properties)) yield f.description;
}

/** Every `{@link name}` target in a markdown string, fenced code excluded. */
export function linkTargets(md) {
  const out = [];
  splitFences(md ?? '').forEach((seg, i) => {
    if (i % 2) return;
    for (const m of seg.matchAll(LINK_RE)) out.push(m[1]);
  });
  return out;
}

/** Every absolute API-site target the README carries — inline or reference-style — and its line. */
export function readmeTargets(md, home) {
  const out = new Map();
  const lines = String(md).split('\n');
  lines.forEach((text, i) => {
    for (const m of text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) out.set(m[1], i + 1);
    const ref = /^\[[^\]]+\]:\s*(\S+)$/.exec(text);
    if (ref) out.set(ref[1], i + 1);
  });
  return [...out].filter(([url]) => url.startsWith(home) && url.length > home.length);
}

/**
 * @param {{ modules: Object[], doclets: Object[], blocks: Object[] }} parsed
 * @param {Object} ctx
 * @param {Object} ctx.declaration  the normalized declaration
 * @param {Object} [ctx.api]        the evaluated global or imported namespace
 * @param {string[]} [ctx.surfaceErrors]  what reading the build already failed at
 * @param {string|null} [ctx.readme]      the README's markdown, whose own links are checked
 * @param {Object} ctx.link         the linker — the name table the prose resolves through
 * @returns {{ errors: string[], warnings: string[], findings: Object[] }}
 */
export function validate(parsed, ctx) {
  const { modules, doclets, blocks } = parsed;
  const { declaration: decl, api, link, readme } = ctx;
  const findings = [];
  const at = (x) => `${x.file}:${x.line}`;
  const fail = (x, code, msg) => findings.push({ level: 'error', code, text: `${at(x)}  ${msg}` });
  const warn = (x, code, msg) => findings.push({ level: 'warning', code, text: `${at(x)}  ${msg}` });

  for (const e of ctx.surfaceErrors ?? []) findings.push({ level: 'error', code: 'surface', text: e });

  // Vocabulary — public blocks and module headers only; internal blocks are not
  // the site's prose and are not policed. A site that states its own closed set
  // is held to it, not to the package's union.
  const vocabulary = decl.parse.vocabulary ? new Set(decl.parse.vocabulary) : VOCABULARY;
  for (const b of blocks) {
    if (!b.public && !b.module) {
      // An `@ignore` block is deliberately internal — a bridge's own seam and
      // its illustration — so its tags are its own; anything else is a block
      // that meant to be on the site and is not.
      if (!b.tags.includes('ignore') && (b.tags.includes('memberof') || b.tags.includes('example'))) {
        warn(b, 'vocabulary', 'internal block carries @memberof/@example but no @function/@constant/@typedef and no export — ignored');
      }
      continue;
    }
    for (const t of b.tags) {
      if (!vocabulary.has(t)) fail(b, 'vocabulary', `tag @${t} is outside the vocabulary`);
    }
  }

  // Module headers — a file with public blocks needs one, and it states its licence.
  for (const d of doclets) {
    if (!d.module) fail(d, 'module', `no @module header in ${d.file}`);
  }
  for (const m of modules) {
    if (!m.license) fail(m, 'license', `@module ${m.name} carries no @license`);
  }

  // Names and owners.
  const seen = new Map();
  for (const d of doclets) {
    if (d.explicitName && d.exportName && d.explicitName !== d.exportName) {
      fail(d, 'name', `@function ${d.explicitName} contradicts export ${d.exportName}`);
    }
    const block = blocks.find((b) => b.doclet === d);
    if (d.via === 'function' && block && !block.tags.includes('memberof')) {
      fail(d, 'name', `@function ${d.name} without @memberof`);
    }
    const key = `${d.owner}.${d.name}`;
    if (seen.has(key)) warn(d, 'duplicate', `duplicate ${key} (first at ${seen.get(key)})`);
    else seen.set(key, at(d));
    for (const o of d.orphans) warn(d, 'orphan', `dotted @param ${o} has no parent parameter`);
  }

  // Groups and pages — read only where a site states the teaching structure.
  if (decl.groups.length) {
    const slugs = new Set(decl.groups.map((g) => g.slug));
    const pageRe = /^[a-z0-9_]+(\/[a-z0-9_]+)*$/;
    for (const d of doclets) {
      if (d.ignore) continue;
      const key = `${d.owner}.${d.name}`;
      if (!d.group) fail(d, 'group', `${key} names no @group`);
      else if (!slugs.has(d.group)) fail(d, 'group', `${key} names unknown @group ${d.group}`);
      if (d.page && !pageRe.test(d.page)) fail(d, 'group', `@page ${d.page} is not a docs path`);
    }
  }

  // Links — a documented name, a package, or an external library's grammar.
  const resolves = (target) => link.table.has(target) || referenceUrl(decl.references, target) !== null;
  for (const d of doclets) {
    for (const t of texts(d)) {
      for (const target of linkTargets(t)) {
        if (!resolves(target)) fail(d, 'links', `unresolved {@link ${target}}`);
      }
    }
  }
  for (const m of modules) {
    for (const target of linkTargets(m.description)) {
      if (!resolves(target)) fail(m, 'links', `unresolved {@link ${target}}`);
    }
  }

  // Examples — the site's own rule, declared: their syntax, the global they
  // read, whether one is required, and whether every one is a complete sketch.
  const ex = decl.examples;
  for (const d of doclets) {
    d.examples.forEach((example, i) => {
      if (ex.syntax === 'global' && MODULE_SYNTAX_RE.test(example.code)) {
        fail(d, 'example', `@example #${i + 1} of ${d.name} uses module syntax — examples are classic scripts`);
      } else if (ex.global && !new RegExp(`=\\s*${ex.global}\\b`).test(example.code)) {
        fail(d, 'example', `@example #${i + 1} of ${d.name} does not read the ${ex.global} global`);
      }
      if (ex.setup && !SETUP_RE.test(example.code)) {
        fail(d, 'example', `@example #${i + 1} of ${d.name} does not define setup()`);
      }
    });
    if (ex.required && d.kind === 'function' && d.examples.length === 0) {
      warn(d, 'example', `${d.owner}.${d.name} has no @example`);
    }
  }

  // The surface — every documented name is in the build, and a function's
  // parameters are the ones its source declares. An owner the declaration maps
  // to `null` is documented and not statically reachable, so it is not checked.
  if (decl.surface && api) {
    for (const d of doclets) {
      if (decl.surface.check === 'reexports' && !d.reexport) continue;
      if (d.ignore) continue;
      if (!Object.hasOwn(decl.owners, d.owner)) {
        fail(d, 'surface', `owner ${d.owner} of ${d.name} is not in the build`);
        continue;
      }
      if (decl.owners[d.owner] === null) continue;
      const scope = ownerScope(api, decl.owners, d.owner);
      if (!scope) { fail(d, 'surface', `owner ${d.owner} of ${d.name} is not in the build`); continue; }
      if (!scope.has(d.name)) { fail(d, 'surface', `${d.owner}.${d.name} is not in the build`); continue; }
      if (d.kind !== 'function') continue;
      const built = scope.params(d.name);
      const documented = d.params.map((p) => p.name);
      // A rest parameter opens the list: the document's own parameters are the
      // call's, and only the ones the source declares before `...` are compared.
      const rest = built.findIndex((n) => typeof n === 'string' && n.startsWith('...'));
      const fixed = rest < 0 ? built : built.slice(0, rest);
      const sameLength = rest < 0 ? fixed.length === documented.length : fixed.length <= documented.length;
      if (!sameLength || fixed.some((n, i) => n !== null && n !== documented[i])) {
        fail(d, 'surface', `${d.owner}.${d.name}(${documented.join(', ')}) does not match the build's (${built.map((n) => n ?? '{…}').join(', ')})`);
      }
    }
  }

  // A site whose pages are Markdown files: the pages against the doclet table,
  // both ways, and every address the site published before.
  if (decl.carrier.pages.kind === 'markdown') {
    pageFindings(parsed, ctx, findings, { fail, warn });
  }

  // The README's own links into the site — every one names a page this build
  // writes and, with an anchor, a name it documents. The README carries them by
  // hand, so this is what keeps them from rotting.
  if (readme && decl.home) {
    const written = new Set(['index.html']);
    for (const m of liveModules(parsed)) written.add(pageOf(m.name));
    for (const p of ctx.pages ?? []) {
      written.add(`${decl.carrier.pages.dir}/${p.path}/`);
      written.add(`${decl.carrier.pages.dir}/${p.path}/index.html`);
    }
    const documented = new Set(doclets.map((d) => `${pageOf(d.module)}#${anchorOf(d)}`));
    for (const [url, line] of readmeTargets(readme, decl.home)) {
      const [page, anchor] = url.slice(decl.home.length).split('#');
      const ok = anchor ? documented.has(`${page}#${anchor}`) : written.has(page);
      if (ok) continue;
      findings.push({
        level: 'error', code: 'readme',
        text: `${decl.paths.readme}:${line}  ${url} is ${anchor ? 'no documented name' : 'no page'} in this build`,
      });
    }
  }

  promote(findings, decl.strict);
  return {
    findings,
    errors: findings.filter((f) => f.level === 'error').map((f) => f.text),
    warnings: findings.filter((f) => f.level === 'warning').map((f) => f.text),
  };
}

/**
 * The page carrier's own rules, both directions: a page's claim is a documented
 * name, a doclet's page is a page that claims it, and every address an earlier
 * site published answers — with a page or with a redirect. A directive is a
 * block a plugin supplies: a page that asks for one nothing renders would ship
 * an empty section, so it fails the build.
 */
function pageFindings(parsed, ctx, findings, { fail, warn }) {
  const { declaration: decl, pages, data, inventory, redirects } = ctx;
  const areas = new Set([...decl.groups.map((g) => g.slug), ...decl.areas.map((a) => a.slug)]);
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const byName = new Map(parsed.doclets.map((d) => [d.name, d]));
  const claims = new Map();          // page path → the name it claims
  const anchors = new Map();         // "<parent>\0<anchor>" → the page that made it
  const slots = data.slots ?? {};

  for (const p of pages) {
    if (areas.size && !areas.has(p.group)) fail(p, 'page', `no such area: ${p.group}`);

    // An unbalanced fence swallows the rest of the page — the footnotes the
    // carrier appends included — so it is an error, never a warning.
    const fences = p.body.split('\n').filter((l) => /^ {0,3}(?:```|~~~)/.test(l)).length;
    if (fences % 2) fail(p, 'page', `${fences} code fence(s): one is never closed, and everything after it renders as code`);
    if (!Number.isFinite(p.weight) || p.weight <= 0) warn(p, 'weight', 'no positive weight — sibling order is undefined');

    // A shortcode the renderer cannot resolve is a line of literal text in the
    // prose, so a typo fails the build rather than shipping.
    for (const { line, text } of shortcodeErrors(p.body)) {
      fail(p, 'shortcode', `line ${line}: ${text} is not \`{{< youtube ID "caption" >}}\``);
    }

    // One anchor per title among siblings: the parent's child list must not
    // produce the same id twice.
    const key = `${p.parent}\u0000${headingSlug(p.title)}`;
    if (anchors.has(key)) fail(p, 'anchor', `title anchor ${headingSlug(p.title)} already used by ${anchors.get(key)}`);
    else anchors.set(key, p.file);

    if (p.symbol && p.symbol !== 'none') {
      const d = byName.get(p.symbol);
      claims.set(p.path, p.symbol);
      if (!d) fail(p, 'symbol', `symbol ${p.symbol} has no doc block`);
      else if (d.ignore) fail(p, 'symbol', `symbol ${p.symbol} is @ignore'd in ${d.file}:${d.line}`);
      else if (d.group && p.group && d.group !== p.group) fail(p, 'symbol', `symbol ${p.symbol} is @group ${d.group}, page is in ${p.group}`);
    } else if (!p.isIndex && p.symbol !== 'none') {
      const named = symbolOfTitle(p.title);
      if (named && byName.has(named)) warn(p, 'symbol', `title names ${named} but the page claims no symbol`);
    }

    // A page's own links — the chrome's are the build's, checked on disk.
    for (const [, target] of p.body.matchAll(/\]\(\s*([^)\s]+)\s*\)/g)) {
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const [bare] = target.split('#');
      const path = bare.replace(/^\.\//, '').replace(/\/$/, '').replace(/\/index\.html$/, '');
      const abs = path.startsWith('/') ? path.slice(1) : resolveRel(p, path);
      if (abs === null || byPath.has(abs) || abs === '') continue;
      fail(p, 'links', `link target ${target} is not a page`);
    }

    // The slots the page's prose asks for: a directive nothing supplies is an
    // empty section on a page that promised a table.
    for (const [, which] of p.body.matchAll(/<!--\s*uses:\s*(\w+)\s*-->/g)) {
      if (!slots[p.path]?.[which]) fail(p, 'uses', `<!-- uses: ${which} --> is supplied by no plugin`);
    }
  }

  // Canonical page per doclet: `@page`, else `<group>/<snake(name)>`.
  for (const d of parsed.doclets) {
    if (d.ignore) continue;
    const want = canonicalPath(d);
    if (!want) continue;
    const p = byPath.get(want);
    if (!p) fail(d, 'page', `${d.owner}.${d.name} renders on ${want}, which is not a page`);
    // A page that claims no symbol may carry several documented names — a strip
    // per name is the page's business; a page claiming a different one is drift.
    else if (p.symbol && p.symbol !== 'none' && p.symbol !== d.name) {
      fail(d, 'page', `${want} claims ${p.symbol}, not ${d.name}`);
    }
  }

  // What an earlier site published: a path must answer, and a child anchor must
  // be one its parent lists.
  for (const path of inventory?.pages ?? []) {
    if (byPath.has(path)) continue;
    if (redirects?.pages && path in redirects.pages) continue;
    warn({ file: 'inventory' }, 'inventory', `published path ${path} has no page — add a redirect`);
  }
  for (const anchor of inventory?.anchors ?? []) {
    const [path, id] = anchor.split('#');
    if (!byPath.has(path)) continue;
    if (!pages.some((o) => o.parent === path && headingSlug(o.title) === id)) {
      warn({ file: 'inventory' }, 'inventory', `published anchor ${anchor} is not a child anchor`);
    }
  }
  for (const gone of Object.keys(redirects?.pages ?? {})) {
    if (byPath.has(gone)) fail({ file: 'redirects' }, 'redirects', `redirect ${gone} is also a page — the stub would replace it`);
  }
}

/** Resolve a relative link from a page's URL directory to a docs-relative path. */
function resolveRel(page, target) {
  const parts = (page.path ? page.path.split('/') : []).concat(target.split('/'));
  const out = [];
  for (const part of parts) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

/** A code a site names in `strict` fails the build rather than printing. */
function promote(findings, strict) {
  if (!strict?.length) return;
  for (const f of findings) {
    if (f.level === 'warning' && strict.includes(f.code)) f.level = 'error';
  }
}
