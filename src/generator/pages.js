/**
 * @file The page tree — a site's Markdown pages, their front matter and their
 * addresses: the carrier a documentation site is built from when its pages are
 * files rather than symbols.
 * @license AGPL-3.0-only
 *
 * A page is a Markdown file under the carrier's directory. Its address is its
 * path without `.md`, written under the directory's own name:
 * `docs/mutators/fill/fill_value.md` → `docs/mutators/fill/fill_value/index.html`.
 * `_index.md` is its directory's page. The directory's name is therefore part of
 * every URL, which is why the site states it.
 *
 * Front matter is a flat `key: value` block:
 *
 *   title    the page's title; also the anchor its parent lists it under, slugged
 *   weight   order among its siblings
 *   symbol   the documented name the page carries, if any. Absent → a supplement
 *            (a listing, a draw parameter, a walkthrough); `none` → a page that
 *            names a symbol in its title and deliberately claims none.
 *
 * The tree is the navigation and the reading order: a directory page is a node,
 * every other page a leaf, siblings ordered by weight and then by title.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const KEY_RE = /^([A-Za-z_][\w-]*):\s*(.*)$/;

/** The front matter's flat `key: value` pairs, quotes stripped, and the body. */
export function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = KEY_RE.exec(line);
    if (!kv) continue;
    data[kv[1]] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return { data, body: text.slice(m[0].length) };
}

/** `createQuadrille(width, height)` → `createQuadrille`; null when the title is not a bare name. */
export function symbolOfTitle(title) {
  if (!title) return null;
  const head = title.split('(')[0].replace(/^Quadrille\./, '').trim();
  return /^[A-Za-z_$][\w$]*$/.test(head) ? head : null;
}

/** `memory2D` → `memory_2d`: the slug a page's address uses for a name. */
export const snake = (name) => String(name)
  .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
  .toLowerCase();

/** A heading's id, and the anchor a parent page lists a child under. */
export const slug = (title) => String(title).toLowerCase()
  .replace(/[^\w\- ]+/g, '').replace(/ /g, '-');

/** Every file under a directory, depth first. */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

/**
 * Every page of a carrier directory, parents before their children.
 * @param {string} dir  absolute path of the carrier's directory
 * @returns {Object[]} pages — `file`, `path`, `dir`, `isIndex`, `group`, `parent`,
 *   `title`, `weight`, `symbol`, `body`
 */
export function loadPages(dir) {
  const pages = [];
  for (const file of walk(dir).filter((f) => f.endsWith('.md')).sort()) {
    const rel = relative(dir, file).replace(/\\/g, '/');
    const parentDir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    const isIndex = basename(rel) === '_index.md';
    const path = isIndex ? parentDir : rel.replace(/\.md$/, '');
    const { data, body } = frontMatter(readFileSync(file, 'utf8'));
    pages.push({
      file: rel,
      path,
      dir: parentDir,
      isIndex,
      group: path.split('/')[0],
      parent: isIndex ? (parentDir.includes('/') ? parentDir.slice(0, parentDir.lastIndexOf('/')) : '') : parentDir,
      title: data.title ?? path.split('/').pop(),
      weight: Number(data.weight ?? 0),
      symbol: data.symbol ?? null,
      body,
    });
  }
  return pages;
}

/** Pages as a navigation tree: `_index` pages are the nodes, the others the leaves. */
export function buildTree(pages) {
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const childrenOf = new Map();
  for (const p of pages) if (p.isIndex) childrenOf.set(p.path, []);
  for (const p of pages) {
    const kids = childrenOf.get(p.parent);
    if (kids) kids.push(p);
  }
  const sortKids = (list) => list
    .sort((a, b) => a.weight - b.weight || a.title.localeCompare(b.title))
    .map((k) => ({ path: k.path, title: k.title, children: sortKids(childrenOf.get(k.path) ?? []) }));
  const roots = pages.filter((p) => p.isIndex && p.parent === '')
    .sort((a, b) => a.weight - b.weight || a.title.localeCompare(b.title))
    .map((r) => ({ path: r.path, title: r.title, children: sortKids(childrenOf.get(r.path) ?? []) }));
  return { byPath, childrenOf, roots };
}

/** Every page path in reading order: the tree, depth first. */
export function readingOrder(nodes, out = []) {
  for (const n of nodes) {
    out.push(n.path);
    readingOrder(n.children, out);
  }
  return out;
}

/** The site-relative URL of a page: `mutators/fill` → `docs/mutators/fill/`. */
export const urlOf = (dir, path) => `${dir}/${path}/`;

/** How many levels up a page sits from the site root (`docs/<path>/index.html`). */
export const depthOf = (path) => (path ? path.split('/').length + 1 : 0);

/** A site-relative URL as seen from a page. */
export const from = (page, url) => `${'../'.repeat(depthOf(page.path))}${url}`;
