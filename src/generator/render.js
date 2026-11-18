/**
 * @file Render — the module and doclet tables into the site's HTML: one page per
 * module, the README as the landing page, the search index, the pager, and the
 * shell every page is wrapped in.
 * @license AGPL-3.0-only
 *
 * Every URL this file writes is relative, so the site serves unchanged under
 * whatever base path it is deployed to; the addresses it carries — an external
 * library's documentation, the stack's repositories — are the declaration's
 * reference data and are absolute.
 *
 * Types render verbatim: nothing here parses a type expression.
 */

import { resolveValue } from './declaration.js';
import { liveModules, anchorOf, pageOf, qualified } from './links.js';
import { firstSentence, marked } from './markdown.js';
import { depthOf } from './pages.js';
import { renderPages } from './pagerender.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const DEMO_RE = /```js\n([\s\S]*?)```\n?/;
const CAPTION_RE = /<!--\s*caption:\s*([\s\S]*?)\s*-->\n?/;

// ── Fragments ───────────────────────────────────────────────────────────────

const type = (t) => (t ? `<code class="type">${esc(t)}</code>` : '');

function signature(d, namespaces) {
  const list = d.params.map((p) => (p.optional ? `[${p.name}]` : p.name)).join(', ');
  return `${esc(qualified(d, namespaces))}(${esc(list)})`;
}

function fieldRows(rows, link, depth = 0) {
  return rows.map((r) => `
      <tr class="depth-${depth}">
        <td><code>${esc(r.name)}</code>${r.optional ? ' <span class="opt">optional</span>' : ''}</td>
        <td>${type(r.type)}</td>
        <td>${r.default != null ? `<code>${esc(r.default)}</code>` : ''}</td>
        <td>${link.mdInline(r.description)}</td>
      </tr>${fieldRows(r.children, link, depth + 1)}`).join('');
}

function fieldTable(rows, link, caption) {
  if (!rows.length) return '';
  return `
    <table class="fields">
      <thead><tr><th>${caption}</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
      <tbody>${fieldRows(rows, link)}
      </tbody>
    </table>`;
}

/** A runnable example: the textarea the runner mounts, the stage it draws on, Run and Reset. */
export function example(ex, id, i, { module = false } = {}) {
  const eid = `${id}-example-${i + 1}`;
  return `
    <figure class="example" id="${esc(eid)}"${module ? ' data-mode="module"' : ''}>
      ${ex.caption ? `<figcaption>${esc(ex.caption)}</figcaption>` : ''}
      <div class="editor"><textarea class="source" spellcheck="false" aria-label="sketch source">${esc(ex.code)}</textarea></div>
      <div class="stage" data-stage></div>
      <div class="toolbar">
        <button type="button" data-run>Run</button>
        <button type="button" data-reset>Reset</button>
      </div>
    </figure>`;
}

function functionDoclet(d, link, namespaces, moduleExamples) {
  const id = anchorOf(d);
  return `
  <article class="doclet function" id="${esc(id)}">
    <h3><a class="anchor" href="#${esc(id)}"><code>${signature(d, namespaces)}</code></a></h3>
    <div class="description">${link.md(d.description)}</div>
    ${fieldTable(d.params, link, 'Parameter')}
    ${d.returns ? `<p class="returns"><strong>Returns</strong> ${type(d.returns.type)} ${link.mdInline(d.returns.description)}</p>` : ''}
    ${d.examples.length ? `<div class="examples">${d.examples.map((ex, i) => example(ex, id, i, { module: moduleExamples })).join('')}</div>` : ''}
  </article>`;
}

function typedefDoclet(d, link) {
  const id = anchorOf(d);
  return `
  <article class="doclet typedef" id="${esc(id)}">
    <h3><a class="anchor" href="#${esc(id)}"><code>${esc(d.name)}</code></a> ${type(d.type)}</h3>
    <div class="description">${link.md(d.description || d.tagDescription)}</div>
    ${fieldTable(d.properties, link, 'Property')}
  </article>`;
}

function constantsTable(list, link, namespaces) {
  return `
  <table class="constants">
    <thead><tr><th>Name</th><th>Type</th><th>Description</th></tr></thead>
    <tbody>${list.map((d) => `
      <tr id="${esc(anchorOf(d))}">
        <td><a class="anchor" href="#${esc(anchorOf(d))}"><code>${esc(qualified(d, namespaces))}</code></a></td>
        <td>${type(d.type)}</td>
        <td>${link.mdInline(d.description || d.tagDescription)}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

/** An owner's section; the module's own members need no heading under its title. */
function ownerSection(owner, list, link, { module, namespaces, moduleExamples }) {
  const consts = list.filter((d) => d.kind === 'constant');
  const rest = list.filter((d) => d.kind !== 'constant');
  return `
  <section class="owner" id="${esc(owner)}">
    ${owner === module || namespaces.includes(owner) ? '' : `<h2>${esc(owner)}</h2>`}
    ${consts.length ? constantsTable(consts, link, namespaces) : ''}
    ${rest.map((d) => (d.kind === 'typedef' ? typedefDoclet(d, link) : functionDoclet(d, link, namespaces, moduleExamples))).join('')}
  </section>`;
}

// ── The shell ───────────────────────────────────────────────────────────────

/** The stored choice, applied before the first paint so no page flashes. */
const boot = `(function(){try{
  var d=document.documentElement,s=localStorage.getItem('docs-theme')||'system',
      m=window.matchMedia('(prefers-color-scheme: dark)').matches,
      n=window.matchMedia('(max-width: 900px)').matches,
      r=localStorage.getItem(n?'docs-nav':'docs-rail');
  d.dataset.themeChoice=(s==='light'||s==='dark')?s:'system';
  d.dataset.theme=(s==='light'||s==='dark')?s:(m?'dark':'light');
  if(r==='collapsed'||r==='expanded')d.dataset.rail=r;
}catch(e){}})();`;

/** The picker: a button, and the three choices it opens. */
const themeControl = (extra = '') => `
      <div class="theme-switch${extra ? ' ' + extra : ''}">
        <button class="theme-toggle" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="Change theme">
          <svg class="i i-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
          <svg class="i i-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z"/></svg>
          <svg class="i i-auto" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg>
          <span class="theme-label">System</span>
        </button>
        <div class="theme-menu" role="menu" hidden>
          <button type="button" role="menuitemradio" data-theme-choice="light" aria-checked="false"><span>Light</span><span class="tick" aria-hidden="true">✓</span></button>
          <button type="button" role="menuitemradio" data-theme-choice="dark" aria-checked="false"><span>Dark</span><span class="tick" aria-hidden="true">✓</span></button>
          <button type="button" role="menuitemradio" data-theme-choice="system" aria-checked="true"><span>System</span><span class="tick" aria-hidden="true">✓</span></button>
        </div>
      </div>`;

/**
 * The page: head, chrome, main, footer.
 *
 * `nav` is either the flat list of a module site's pages or, for a site whose
 * pages are a tree, the tree's own markup. `page` is the page being written,
 * where the site has one: its depth from the site root is what a nested page's
 * `{root}` token resolves to, and every URL the shell itself writes is relative
 * to it.
 *
 * @param {Object} state  what every page of this site shares — brand, shell, runner, config
 * @param {{ title: string, active: string, body: string, nav: Object[]|string,
 *   pager?: string, page?: Object, video?: boolean }} page
 */
export function shell(state, { title, active, body, nav, pager = '', page = null, video = false }) {
  const { brand, declaration: decl, urls } = state;
  // The page's prefix to the site root: no prefix on a flat site's pages.
  const root = page ? '../'.repeat(depthOf(page.path)) : '';
  const config = resolveValue(state.config, { root });
  // Every site-local URL this shell writes is relative to the page: a nested
  // page's assets are the same files, four levels up.
  const v = (url) => (url == null ? url : `${root}${url}${state.stamp ? `?v=${state.stamp}` : ''}`);
  // A JSON data block, not code: `<` is escaped so a value can never close the element.
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  const scripts = [
    decl.runner.script,
    decl.runner.search,
    decl.runner.chrome,
    ...decl.runner.extra,
    ...(video ? [decl.runner.video] : []),
  ].filter(Boolean);
  const attrs = decl.mode === 'esm' ? 'type="module"' : 'defer';
  const icon = (f) => `<link rel="icon" sizes="${f.sizes}" href="${v(f.href)}">`;
  const modules = typeof nav === 'string' ? nav : `<ul class="modules">${nav.map((n) => `
        <li><a href="${n.href}"${n.href === active ? ' aria-current="page"' : ''}>${esc(n.label)}</a></li>`).join('')}
      </ul>`;
  const icons = decl.shell.favicon.map(icon).join('\n  ');
  // The package's base first, where a site states one: it is the structure of
  // this markup, and the site's own file overrides its variables.
  const sheets = [decl.shell.base, decl.shell.stylesheet]
    .filter(Boolean).map((href) => `<link rel="stylesheet" href="${v(href)}">`).join('\n  ');
  const footer = `${esc(brand.name)} v${esc(brand.version)} · ${esc(brand.license ?? '')}` +
    (urls.notices ? ` ·\n      <a href="${v(urls.notices)}">third-party notices</a>` : '');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script>${boot}</script>
  <title>${esc(title)} — ${esc(brand.name)}</title>
  ${icons ? `${icons}\n  ` : ''}${sheets}
  <script type="application/json" id="docs-config">${json}</script>
  ${scripts.map((src) => `<script ${attrs} src="${v(src)}"></script>`).join('\n  ')}
</head>
<body>
  <button class="rail-reopen" type="button" data-rail-toggle aria-controls="site-sidebar" aria-expanded="false" aria-label="Show the navigation">☰</button>
  <nav class="sidebar" id="site-sidebar" aria-label="Documentation">
    <div class="side-head">
      <a class="brand" href="${root}index.html">${esc(brand.name)}</a>
      <span class="version">v${esc(brand.version)}</span>
      ${themeControl('head-theme')}
      <button class="rail-toggle" type="button" data-rail-toggle aria-controls="site-sidebar" aria-expanded="true" aria-label="Hide the navigation">«</button>
    </div>
    <input class="search" type="search" placeholder="${esc(decl.shell.search.placeholder)}" aria-label="${esc(decl.shell.search.label)}" autocomplete="off">
    <div class="side-nav" id="site-nav">
      ${modules}
      <ul class="results" hidden></ul>
    </div>
    <div class="side-foot">${themeControl()}
    </div>
  </nav>
  <main>
${body}${pager}
    <footer>${footer}</footer>
  </main>
</body>
</html>
`;
}

// ── The landing page's own section ──────────────────────────────────────────

/**
 * A declared carrier file rendered as a section of the landing page, its one
 * ```js fence lifted out as a live module demo placed where the fence was. An
 * `<!-- caption: … -->` above it is the figure's caption.
 */
function landingSection(landing, { id, section }) {
  const demo = DEMO_RE.exec(landing);
  if (!demo) return `    <section class="${esc(section)}">${marked.parse(landing)}</section>`;
  const caption = CAPTION_RE.exec(landing);
  const [before, after] = landing.replace(CAPTION_RE, '').split(demo[0]);
  const figure = example({ caption: caption ? caption[1] : null, code: demo[1] }, id, 0, { module: true });
  return `    <section class="${esc(section)}">${marked.parse(before)}<div class="examples">${figure}</div>${marked.parse(after || '')}</section>`;
}

// ── Search index ────────────────────────────────────────────────────────────

/** One entry per public doclet: name, owner, page#anchor, first sentence. */
function searchIndex(doclets) {
  return doclets.map((d) => ({
    n: d.name,
    o: d.owner,
    h: `${pageOf(d.module)}#${anchorOf(d)}`,
    s: firstSentence(d.description || d.tagDescription),
  }));
}

// ── Entry ───────────────────────────────────────────────────────────────────

/**
 * @param {{ modules: Object[], doclets: Object[] }} parsed
 * @param {Object} state  { declaration, brand, link, urls, config, readme, landing, stamp }
 * @returns {Map<string, string>} site-relative file → HTML
 */
export function render(parsed, state) {
  if (state.declaration.carrier.pages.kind === 'markdown') {
    return renderPages(parsed, { ...state, shell });
  }
  const { declaration: decl, link, urls } = state;
  const pages = new Map();
  const modules = liveModules(parsed);
  // A site whose examples are module scripts has its figure say so: the runner
  // reads `data-mode` off the figure rather than inferring it from the source.
  const moduleExamples = decl.examples.syntax === 'module';
  const nav = modules.map((m) => ({
    href: pageOf(m.name),
    label: m.name.slice(m.name.lastIndexOf('/') + 1),
  }));

  // Modules in order, each with its doclets in source order.
  const byModule = new Map();
  for (const d of parsed.doclets) {
    if (!byModule.has(d.module)) byModule.set(d.module, []);
    byModule.get(d.module).push(d);
  }

  pages.set(decl.outputs.index, JSON.stringify(searchIndex(parsed.doclets)));

  const landing = decl.carrier.landing ? landingSection(state.landing ?? '', decl.carrier.landing) : '';
  const readme = marked.parse(
    decl.references.readme === 'plain' ? (state.readme ?? '') : link.resolve(state.readme ?? '', true),
  );
  pages.set('index.html', shell(state, {
    title: 'README', active: 'index.html', nav,
    body: `    <article class="readme">${readme}</article>${landing ? `\n${landing}` : ''}`,
  }));

  const pagerOf = (i) => {
    const back = i > 0 ? nav[i - 1] : null;
    const fwd = i < nav.length - 1 ? nav[i + 1] : null;
    if (!back && !fwd) return '';
    return `
    <nav class="pager" aria-label="Previous and next page">
      ${back ? `<a class="back" href="${back.href}">← ${esc(back.label)}</a>` : '<span></span>'}
      ${fwd ? `<a class="fwd" href="${fwd.href}">${esc(fwd.label)} →</a>` : '<span></span>'}
    </nav>`;
  };

  modules.forEach((m, i) => {
    const list = byModule.get(m.name);
    // Owners in order of first appearance, the ones the declaration puts first
    // ahead of them all.
    const owners = [...new Set(list.map((d) => d.owner))]
      .sort((a, b) => rank(a) - rank(b));
    function rank(owner) {
      const at = decl.ownerOrder.indexOf(owner);
      return at < 0 ? decl.ownerOrder.length : at;
    }
    const body = `
    <header class="module">
      <h1>${esc(m.name)}</h1>
      ${m.title ? `<p class="lead">${link.mdInline(m.title)}</p>` : ''}
      <div class="description">${link.md(m.description)}</div>
    </header>
    ${owners.map((o) => ownerSection(o, list.filter((d) => d.owner === o), link,
    { module: m.name, namespaces: decl.namespaces, moduleExamples })).join('')}`;
    pages.set(pageOf(m.name), shell(state, {
      title: m.name, active: pageOf(m.name), nav, pager: pagerOf(i), body,
    }));
  });

  return pages;
}
