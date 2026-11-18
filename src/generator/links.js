/**
 * @file Links — the names a page carries, and the addresses they resolve to.
 * @license AGPL-3.0-only
 *
 * A doclet's address, a module's page, and every name in prose that earns a
 * link: `{@link name}`, a backticked identifier or call, a package named in
 * prose. The table is the site's doclets plus whatever its plugins add, and
 * the resolution order is fixed — a documented name first, then a package's
 * address, then an external documentation grammar, and plain code when nothing
 * claims it.
 */

import { marked, splitFences } from './markdown.js';
import { externalRef, packageUrl } from './references.js';

const LINK_RE = /\{@link\s+([^}\s]+)\s*\}/g;
// A backticked identifier in prose — `setCamera`, `update()`,
// `draw(gl, obj, M)` — that is not already a link's text: the name resolves,
// the argument list stays part of the code span.
const CODE_RE = /(^|[^[`\\])`((?:[\w$]+\.)*[\w$]+)((?:\([^`]*\))?)`/g;

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The prose scanners for package names: a declared package whose name carries a
 * scope is linked bare in prose as well as backticked, an unscoped one only
 * backticked — a bare `twgl.js` in a sentence is a library being named, not a
 * package being cited.
 * @param {Object} references
 * @returns {{ bare: RegExp|null, code: RegExp }}
 */
function packageScanners(references) {
  const names = Object.keys(references?.packages ?? {});
  const scoped = names.filter((n) => n.includes('/')).sort((a, b) => b.length - a.length);
  const all = [...names].sort((a, b) => b.length - a.length);
  const any = all.length ? all.map(escRe).join('|') : null;
  return {
    bare: scoped.length ? new RegExp(`(^|[\\s(])(${scoped.map(escRe).join('|')})(?![\\w/.-])`, 'g') : null,
    code: any ? new RegExp(`(^|[^[\`\\\\])\`(${any})\``, 'g') : null,
  };
}

// ── Addresses ───────────────────────────────────────────────────────────────

/** `webgl.tree/gizmo` → `gizmo.html`; the site's root module → its own page name. */
export const pageOf = (moduleName) => {
  const i = String(moduleName ?? '').lastIndexOf('/');
  return `${i < 0 ? String(moduleName ?? '') : String(moduleName).slice(i + 1)}.html`;
};

/** A doclet's anchor: the owner-qualified name, as the renderer writes it. */
export const anchorOf = (d) => `${d.owner}.${d.name}`;

/** Modules with at least one public doclet, in source order — the pages a build writes. */
export function liveModules({ modules, doclets }) {
  const documented = new Set(doclets.map((d) => d.module));
  return modules.filter((m) => documented.has(m.name));
}

/** A name as the reader writes it: `tree.mat4Mul` for a namespace owner, else bare. */
export const qualified = (d, namespaces = []) =>
  (namespaces.includes(d.owner) ? `${d.owner}.${d.name}` : d.name);

/**
 * The address of a table entry: a plugin's own href, a module's page (or the
 * package's repository when the module has no page of its own), a doclet's page
 * and anchor.
 */
export function hrefOf(entry, references) {
  if (entry.href) return entry.href;
  if (entry.module) {
    return packageUrl(references, entry.module.name) ?? pageOf(entry.module.name);
  }
  return `${pageOf(entry.doclet.module)}#${anchorOf(entry.doclet)}`;
}

/**
 * The table: `owner.name`, bare `name` (first wins, an owner the declaration
 * puts first winning over all), module names, and the declared aliases (a class
 * name that links to the factory making it).
 */
export function linkTable({ modules, doclets }, references = {}, ownerOrder = []) {
  const table = new Map();
  for (const m of modules) table.set(m.name, { module: m });
  for (const d of doclets) table.set(`${d.owner}.${d.name}`, { doclet: d });
  for (const d of doclets) if (!table.has(d.name)) table.set(d.name, { doclet: d });
  for (const owner of ownerOrder) {
    for (const d of doclets) if (d.owner === owner) table.set(d.name, { doclet: d });
  }
  for (const [alias, name] of Object.entries(references.aliases ?? {})) {
    if (!table.has(alias) && table.has(name)) table.set(alias, table.get(name));
  }
  return table;
}

/**
 * Bare names several owners share: auto-links leave them alone. A name one of
 * the owners the declaration puts first documents is not ambiguous — it is that
 * owner's, wherever the page sits.
 */
export function ambiguousNames(doclets, ownerOrder = []) {
  const owners = new Map();
  for (const d of doclets) {
    if (!owners.has(d.name)) owners.set(d.name, new Set());
    owners.get(d.name).add(d.owner);
  }
  return new Set([...owners]
    .filter(([, s]) => s.size > 1 && !ownerOrder.some((o) => s.has(o)))
    .map(([n]) => n));
}

/**
 * The owner the landing page reads a bare ambiguous name as: the site's own,
 * when exactly one of its modules documents it. The landing page is the
 * library's index, so a `bind` there is the bridge's `bind(gl, prog, uniforms)`
 * and not a handle's method.
 * @param {Array<Object>} doclets
 * @param {Set<string>} ambiguous
 * @param {string} prefix  the site's own module prefix, `<brand>/`
 * @returns {Map<string, Object>} name → link-table entry
 */
export function indexOwners(doclets, ambiguous, prefix) {
  const own = new Map();
  for (const d of doclets) {
    if (!ambiguous.has(d.name) || !String(d.owner).startsWith(prefix)) continue;
    own.set(d.name, own.has(d.name) ? null : { doclet: d });
  }
  return new Map([...own].filter(([, entry]) => entry));
}

// ── Prose ───────────────────────────────────────────────────────────────────

/**
 * The link machinery for one site: the table, the ambiguous set, the landing
 * page's preferences, and the two markdown renderers that apply them.
 * @param {Object} options
 * @param {{ modules: Object[], doclets: Object[] }} options.parsed
 * @param {Object} options.references  the declaration's reference data
 * @param {string[]} [options.namespaces]  owners written as a prefix in signatures
 * @param {string[]} [options.ownerOrder]  the owners a bare name prefers, in order
 * @param {string} [options.brand]  the site's name, whose modules the landing page prefers
 */
export function linker({ parsed, references = {}, namespaces = [], ownerOrder = [], brand = '' }) {
  const table = linkTable(parsed, references, ownerOrder);
  const ambiguous = ambiguousNames(parsed.doclets, ownerOrder);
  const prefer = indexOwners(parsed.doclets, ambiguous, `${brand}/`);
  const scanners = packageScanners(references);

  /** A name as a markdown link. `prefer` wins over the table for a name several owners share. */
  const linkTo = (name, call) => {
    const entry = prefer.get(name) ?? table.get(name);
    const code = `\`${name}${call}\``;
    if (entry) return `[${code}](${hrefOf(entry, references)})`;
    const ext = externalRef(references, name);
    const href = packageUrl(references, name) ?? ext?.url;
    return href ? `[\`${ext ? ext.text : name}${call}\`](${href})` : code;
  };

  /**
   * A name several owners share stays plain code unless it is written
   * `Owner.name` — or unless the page being rendered is the landing page, which
   * reads the site's own module for the bare name.
   */
  const linkToName = (name, call, usePrefer) => {
    if (ambiguous.has(name) && !(usePrefer && prefer.has(name))) return null;
    return linkTo(name, call);
  };

  /** Prose with its links resolved, fenced code untouched. */
  const resolve = (text, usePrefer = false) => splitFences(text).map((seg, i) => {
    if (i % 2) return seg;
    const link = (name, call) => linkToName(name, call, usePrefer);
    let out = seg
      .replace(LINK_RE, (_, name) => link(name, '') ?? `\`${name}\``)
      .replace(CODE_RE, (all, pre, name, call) => {
        const out = link(name, call || '');
        return out == null ? all : pre + out;
      });
    if (scanners.code) out = out.replace(scanners.code, (_, pre, name) => `${pre}[\`${name}\`](${packageUrl(references, name)})`);
    if (scanners.bare) out = out.replace(scanners.bare, (_, pre, name) => `${pre}[${name}](${packageUrl(references, name)})`);
    return out;
  }).join('');

  return {
    table,
    ambiguous,
    prefer,
    scanners,
    resolve,
    md: (text, opts) => (text ? marked.parse(resolve(text, opts?.prefer)) : ''),
    mdInline: (text, opts) => (text ? marked.parseInline(resolve(text, opts?.prefer)) : ''),
    /** A plugin's page or anchor, which prose may then link like any other name. */
    addAnchor: (name, href) => table.set(name, { href }),
  };
}
