/**
 * @file The page carrier — a site whose pages are Markdown files: one page per
 * file at its published address, the symbol strip its front matter binds, the
 * example lifted where its fence stands, the one shortcode, the child anchors,
 * the pager, the search index and the redirect stubs.
 * @license AGPL-3.0-only
 *
 * A page shows, in order: its title, the strip of the documented name it claims,
 * its Markdown, the pages under it, the block a plugin supplies at its foot, and
 * the previous and next pages of the reading order. Every link is relative, so
 * the site serves unchanged under whatever base path it is deployed to, and the
 * directory the pages live in is part of every URL.
 *
 * The blocks the package cannot compute — a host's reference tables, the names a
 * page's examples use — are slots: a page's prose writes `<!-- uses: NAME -->`
 * and a plugin supplies that name's HTML for that page, and the same plugin
 * supplies the page's `foot`. The carrier decides where a slot goes and refuses
 * a directive nothing claims; what is in it is the site's.
 */

import { marked, markdownWith } from './markdown.js';
import { buildTree, from, readingOrder, slug, snake, urlOf } from './pages.js';

const SETUP_RE = /(^|[^\w$])(?:async\s+)?function\s+setup\s*\(/;
const DIRECTIVE_RE = /<!--\s*uses:\s*(\w+)\s*-->\n?/g;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** The fence lines of a Markdown body: a sketch is a `js` fence that defines `setup()`. */
export const sketchFences = (md) => [...String(md).matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1]);

/** Whether a page carries the video shortcode. */
export const hasVideo = (md) => /\{\{<\s*youtube\b/.test(String(md));

// ── The shortcode ───────────────────────────────────────────────────────────

/** A well-formed shortcode: `{{< youtube ID >}}`, caption optional. */
const YOUTUBE_RE = /\{\{<\s*youtube\s+([A-Za-z0-9_-]{11})(?:\s+"([^"]*)")?\s*>\}\}/g;

/** Anything shortcode-shaped: a closed `{{< … >}}`, or a lone opener. */
const ANY_RE = /\{\{<[\s\S]*?>\}\}|\{\{[<%]/;

/** A line that opens or closes a code fence. */
const FENCE_RE = /^ {0,3}(?:```|~~~)/;

/** Calls `fn(line)` for every line outside a code fence, and joins what it returns. */
function onProse(md, fn) {
  let fenced = false;
  return String(md).split('\n').map((line) => {
    if (FENCE_RE.test(line)) { fenced = !fenced; return line; }
    return fenced ? line : fn(line);
  }).join('\n');
}

/**
 * A page's Markdown with every well-formed shortcode replaced by a placeholder,
 * plus the videos it named. A fence is a listing: a shortcode inside one stays as
 * written, which is how a page documents the syntax.
 * @returns {{ body: string, videos: { placeholder: string, id: string, caption: string|null }[] }}
 */
export function expandShortcodes(md) {
  const videos = [];
  const body = onProse(md, (line) => line.replace(YOUTUBE_RE, (_, id, caption) => {
    const placeholder = `@@video-${videos.length}@@`;
    videos.push({ placeholder, id, caption: caption ?? null });
    return placeholder;
  }));
  return { body, videos };
}

/**
 * Every shortcode-shaped run that is not a well-formed one — an unknown name, a
 * mistyped or missing id, a `{{% … %}}` an older site left behind. A shortcode
 * the renderer cannot resolve ships as literal text, so it fails the build.
 * @returns {{ line: number, text: string }[]} body-relative, 1-based
 */
export function shortcodeErrors(md) {
  const bad = [];
  let fenced = false;
  String(md).split('\n').forEach((line, i) => {
    if (FENCE_RE.test(line)) { fenced = !fenced; return; }
    if (fenced) return;
    if (ANY_RE.test(line.replace(YOUTUBE_RE, ''))) bad.push({ line: i + 1, text: line.trim() });
  });
  return bad;
}

/** A page's text with every shortcode-shaped run dropped. */
export const withoutShortcodes = (md) => String(md).replace(/\{\{<[\s\S]*?>\}\}/g, ' ');

// ── The page's own blocks ───────────────────────────────────────────────────

/** A shortcode's figure: a poster that links to the watch page, which the site's script upgrades. */
function video(id, caption) {
  return `
      <figure class="video" data-video="${esc(id)}">
        <a class="play" href="https://www.youtube.com/watch?v=${esc(id)}">
          <img src="https://i.ytimg.com/vi/${esc(id)}/hqdefault.jpg" alt="" loading="lazy" width="480" height="360">
        </a>${caption ? `
        <figcaption>${esc(caption)}</figcaption>` : ''}
      </figure>`;
}

/**
 * Footnotes: the definitions are lifted to a list at the foot of the page and
 * each reference becomes a link to it. Fenced code is left alone.
 */
function footnotes(md) {
  const defs = [];
  const parts = md.split(/(```[\s\S]*?```)/g);
  const body = parts.map((seg, i) => {
    if (i % 2) return seg;
    return seg.replace(/^[ \t]*\[\^([^\]]+)\]:[ \t]*(.+)$/gm, (_, id, text) => {
      defs.push([id, text.trim()]);
      return '';
    });
  }).join('');
  if (!defs.length) return md;
  const linked = body.split(/(```[\s\S]*?```)/g).map((seg, i) => (i % 2 ? seg :
    seg.replace(/\[\^([^\]]+)\]/g, (_, id) =>
      `<sup class="fnref" id="fnref-${id}"><a href="#fn-${id}">${id}</a></sup>`))).join('');
  const list = defs.map(([id, text]) =>
    `<li id="fn-${id}">${marked.parseInline(text)} <a class="fnback" href="#fnref-${id}" aria-label="back">↩</a></li>`).join('\n');
  return `${linked}\n\n<section class="footnotes">\n<ol>\n${list}\n</ol>\n</section>\n`;
}

// ── The signature strip ─────────────────────────────────────────────────────

/** `(...)` from a surface's params, variadics and optionals marked. */
function paramsOf(list) {
  return `(${list.map((prm) => {
    const name = prm.type?.startsWith('...') ? `...${prm.name}` : prm.name;
    return prm.optional ? `[${name}]` : name;
  }).join(', ')})`;
}

const type = (t) => (t ? `<code class="type">${esc(t)}</code>` : '');

/**
 * One line per surface the doclet documents, each with the parameter list that
 * surface declares: a static helper and the instance method that delegates to it
 * are one page with two signatures, and one list cannot be both.
 */
function signatures(d) {
  const owner = d.owner;
  const lines = [];
  for (const surface of d.surfaces ?? ['instance']) {
    const call = `${esc(d.name)}${d.kind === 'accessor' ? '' : esc(paramsOf(d.surfaceParams?.[surface] ?? d.params))}`;
    if (surface === 'instance') lines.push(`q.${call}`);
    else lines.push(`${esc(owner)}.${call}`);
  }
  return lines.length ? lines : [`${esc(owner)}.${esc(d.name)}`];
}

function fieldRows(rows, depth = 0) {
  return rows.map((r) => `
        <tr class="depth-${depth}">
          <td><code>${esc(r.name)}</code>${r.optional ? ' <span class="opt">optional</span>' : ''}</td>
          <td>${type(r.type)}</td>
          <td>${r.default != null ? `<code>${esc(r.default)}</code>` : ''}</td>
          <td>${esc(r.description)}</td>
        </tr>${fieldRows(r.children, depth + 1)}`).join('');
}

/**
 * The source-backed part of a page: the signatures it documents, their return
 * type, a parameter table only where the page states none of its own, and the
 * line of source that implements it.
 */
function apiStrip(page, d, source) {
  if (!d) return '';
  const hasOwnTable = /^##\s+Parameters\b/m.test(page.body);
  const rows = d.params.length && !hasOwnTable ? `
      <details class="api-params">
        <summary>Parameters</summary>
        <table class="fields">
          <thead><tr><th>Param</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
          <tbody>${fieldRows(d.params)}
          </tbody>
        </table>
      </details>` : '';
  const ret = d.returns ? ` <span class="arrow">→</span> ${type(d.returns.type)}` : '';
  const line = source
    ? `\n        <a class="source" href="${source}#L${d.line}" title="the line that implements it">${esc(`${d.file}:${d.line}`)}</a>`
    : '';
  return `
      <aside class="api">
        ${signatures(d).map((s) => `<span class="sigline"><code class="sig">${s}</code>${ret}</span>`).join('\n        ')}
        ${rows}${line}
      </aside>`;
}

// ── The page body ───────────────────────────────────────────────────────────

/** A runnable example: the strip of the page's own code, the stage, Run and Reset. */
function pageExample(code, id) {
  return `
      <figure class="example" id="${esc(id)}">
        <div class="editor"><textarea class="source" spellcheck="false" aria-label="sketch source">${esc(code)}</textarea></div>
        <div class="stage" data-stage></div>
        <div class="toolbar">
          <button type="button" data-run>Run</button>
          <button type="button" data-reset>Reset</button>
          <span class="hint">edit, then run</span>
        </div>
      </figure>`;
}

/** The Markdown renderer for one page: its sketches lifted, its other fences plain. */
function pageMarked(lifted) {
  return markdownWith(({ text, lang }) => {
    if (lang?.startsWith('js') && SETUP_RE.test(text)) {
      const id = `sketch-${lifted.size}`;
      lifted.set(id, pageExample(text, id));
      return `<p>@@${id}@@</p>\n`;
    }
    return `<pre><code class="lang-${esc(lang ?? '')}">${esc(text)}</code></pre>\n`;
  });
}

/**
 * The page's prose: shortcodes, the slots its directives name, the sketches
 * lifted out of its fences, footnotes at its foot.
 */
function bodyHtml(page, slots) {
  const lifted = new Map();
  const md = pageMarked(lifted);
  const { body: prose, videos } = expandShortcodes(page.body);
  const tables = new Map();
  const body = prose.replace(DIRECTIVE_RE, (_, which) => {
    const id = `table-${which}`;
    tables.set(id, slots[which] ?? '');
    return `<p>@@${id}@@</p>\n`;
  });
  let html = md.parse(footnotes(body));
  for (const [id, table] of tables) {
    html = html.replace(`<p>@@${id}@@</p>\n`, table).replace(`@@${id}@@`, table);
  }
  for (const { placeholder, id, caption } of videos) {
    const figure = video(id, caption);
    html = html.replace(`<p>${placeholder}</p>\n`, figure).replace(placeholder, figure);
  }
  for (const [id, figure] of lifted) {
    html = html.replace(`<p>@@${id}@@</p>\n`, figure).replace(`@@${id}@@`, figure);
  }
  return html;
}

/** The pages under this one, as headings whose ids are the anchors a link uses. */
function childrenHtml(page, childrenOf, dir) {
  const kids = childrenOf.get(page.path) ?? [];
  if (!kids.length) return '';
  return `
      <section class="children">
        <h2 class="children-title">${kids.length} ${kids.length === 1 ? 'page' : 'pages'}</h2>
        ${kids.map((k) => `
        <h3 id="${slug(k.title)}"><a href="${from(page, urlOf(dir, k.path))}">${esc(k.title)}</a></h3>`).join('')}
      </section>`;
}

/** The previous and next pages of the reading order. */
function prevNext(page, order, dir) {
  const i = order.findIndex((p) => p.path === page.path);
  const back = i > 0 ? order[i - 1] : null;
  const fwd = i >= 0 && i < order.length - 1 ? order[i + 1] : null;
  if (!back && !fwd) return '';
  return `
      <nav class="pager">
        ${back ? `<a class="back" href="${from(page, urlOf(dir, back.path))}">← ${esc(back.title)}</a>` : '<span></span>'}
        ${fwd ? `<a class="fwd" href="${from(page, urlOf(dir, fwd.path))}">${esc(fwd.title)} →</a>` : '<span></span>'}
      </nav>`;
}

/** Pages as a navigation tree: a folder is a `<details>` whose summary is the page. */
function navList(nodes, page, activePath, dir) {
  return `<ul>${nodes.map((n) => {
    const href = from(page, urlOf(dir, n.path));
    const current = n.path === activePath;
    const mark = current ? ' aria-current="page"' : '';
    const open = activePath.startsWith(`${n.path}/`) ? ' open' : '';
    if (!n.children.length) return `\n        <li><a href="${href}"${mark}>${esc(n.title)}</a></li>`;
    return `\n        <li><details${open}><summary${current ? ' data-current="true"' : ''}><a href="${href}"${mark}>${esc(n.title)}</a></summary>${navList(n.children, page, activePath, dir)}</details></li>`;
  }).join('')}
      </ul>`;
}

// ── Search index and stubs ──────────────────────────────────────────────────

/** The first paragraph of a page's Markdown, shortcodes already resolved. */
function firstParagraph(md) {
  const withoutFences = withoutShortcodes(md).replace(/```[\s\S]*?```/g, '');
  for (const block of withoutFences.split(/\n\s*\n/)) {
    const t = block.trim();
    if (!t || t.startsWith('#') || t.startsWith('>') || t.startsWith('|') || t.startsWith('-') || t.startsWith('*')) continue;
    return t;
  }
  return '';
}

/** A summary as one line of plain text: links read as their text, emphasis dropped. */
function plainSentence(text) {
  const plain = (text || '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(plain);
  return m ? m[1] : plain.slice(0, 160);
}

/**
 * The carrier's index: one entry per documented name, the entries a plugin
 * supplies, then one per page. A symbol's address is its page, a page's its own,
 * and each entry carries the kind the site's search shows.
 */
function searchIndex(parsed, pages, canonical, extras, dir) {
  const out = [];
  for (const d of parsed.doclets) {
    if (d.ignore) continue;
    const path = canonical.get(d.name) ?? d.page ?? (d.group ? `${d.group}/${snake(d.name)}` : null);
    out.push({ t: d.name, h: urlOf(dir, path), k: 'symbol', s: plainSentence(d.description || d.tagDescription) });
  }
  out.push(...extras);
  for (const p of pages) {
    out.push({
      t: p.title, h: urlOf(dir, p.path), k: p.isIndex ? 'section' : 'page',
      s: plainSentence(firstParagraph(p.body)),
    });
  }
  return out;
}

/** A meta-refresh stub, with a canonical link and a visible way out. */
function stub(target, home) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Moved</title>
  <link rel="canonical" href="${target}">
  <meta http-equiv="refresh" content="0; url=${target}">
</head>
<body>
  <p>This page moved. <a href="${target}">Continue</a> or <a href="${home}">start from the index</a>.</p>
</body>
</html>
`;
}

// ── Entry ───────────────────────────────────────────────────────────────────

/**
 * The paths a doclet renders on: the `@page` it names, else `<group>/<snake(name)>`.
 * @returns {string|null}
 */
export function canonicalPath(d) {
  return d.page ?? (d.group ? `${d.group}/${snake(d.name)}` : null);
}

/** The canonical page of every documented name, by name. */
export function canonicalPages(doclets) {
  const out = new Map();
  for (const d of doclets) {
    if (d.ignore) continue;
    const path = canonicalPath(d);
    if (path) out.set(d.name, path);
  }
  return out;
}

/**
 * The documented name each page renders the strip of: the doclets' canonical
 * pages, the later block winning where two names land on one page.
 * @returns {Map<string, Object>} page path → doclet
 */
export function docletOfPage(doclets) {
  const out = new Map();
  for (const d of doclets) {
    if (d.ignore) continue;
    const path = canonicalPath(d);
    if (path) out.set(path, d);
  }
  return out;
}

/**
 * Render a site whose pages are Markdown files.
 * @param {{ modules: Object[], doclets: Object[] }} parsed
 * @param {Object} state  the build's state — see `render`
 * @returns {Map<string, string>} site-relative file → HTML
 */
export function renderPages(parsed, state) {
  const { declaration: decl, shell } = state;
  const dir = decl.carrier.pages.dir;
  const pages = state.pages ?? [];
  const slots = state.slots ?? {};
  const extras = state.index ?? [];
  const { byPath, childrenOf, roots } = buildTree(pages);
  const order = readingOrder(roots).map((path) => byPath.get(path));
  const canonical = canonicalPages(parsed.doclets);
  const byPagePath = docletOfPage(parsed.doclets);
  const files = new Map();

  // The landing page: the site's README through the carrier's own renderer — its
  // fences are fences like any page's, and its links are its own where the
  // declaration says its prose is written as written — and the carrier's own
  // section under it when the declaration states one.
  const landing = decl.carrier.landing ? state.landing ?? '' : null;
  const readme = decl.references.readme === 'plain'
    ? bodyHtml({ path: '', body: state.readme ?? '' }, {})
    : marked.parse(state.link.resolve(state.readme ?? '', true));
  const landingHtml = landing == null ? '' :
    `\n    <section class="${esc(decl.carrier.landing.section)}">${bodyHtml({ path: '', body: landing }, {})}</section>`;
  files.set('index.html', shell(state, {
    title: 'README', active: 'index.html',
    nav: navList(roots, { path: '' }, '', dir),
    body: `    <article class="readme">${readme}</article>${landingHtml}`,
  }));

  for (const p of pages) {
    const d = byPagePath.get(p.path) ?? null;
    const pageSlots = slots[p.path] ?? {};
    const body = `
    <article class="page">
      <h1>${esc(p.title)}</h1>${apiStrip(p, d, decl.carrier.pages.source)}
      <div class="prose">${bodyHtml(p, pageSlots)}</div>${childrenHtml(p, childrenOf, dir)}${pageSlots.foot ?? ''}${prevNext(p, order, dir)}
    </article>`;
    files.set(`${urlOf(dir, p.path)}index.html`, shell(state, {
      page: p, title: p.title, active: p.path, nav: navList(roots, p, p.path, dir),
      video: decl.runner.video ? hasVideo(p.body) : false, body,
    }));
  }

  // A path an earlier site published that no page answers any more.
  for (const [gone, to] of Object.entries(state.redirects?.pages ?? {})) {
    const stand = { path: gone };
    files.set(`${urlOf(dir, gone)}index.html`,
      stub(to ? from(stand, urlOf(dir, to)) : from(stand, 'index.html'), from(stand, 'index.html')));
  }

  files.set(decl.outputs.index, JSON.stringify(searchIndex(parsed, pages, canonical, extras, dir)));
  return files;
}
