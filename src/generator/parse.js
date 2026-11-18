/**
 * @file The doc-block parser — source plus carrier files → a module table and a
 * doclet table, the input every later step of the generator reads.
 * @license AGPL-3.0-only
 *
 * Public-symbol rule, as the two sites state it today.
 *   - A block above an `export` names that export (an `@function`, `@constant`,
 *     `@typedef` or `@name` tag wins over the inference).
 *   - A block above an indented member of one nominated class names that member
 *     — `members: 'Quadrille'` — and its owner defaults to the class.
 *   - When `surface` is set, `src/index.js` is read for `export { … } from`
 *     declarations and only the names it re-exports are public.
 *   - `@ignore` either keeps the block out of the site and visible to a coverage
 *     check (`ignore: 'keep'`) or drops it (`ignore: 'skip'`).
 *   - Carrier files (`carriers: [dirs]`) are documentation-only: every doclet in
 *     them is public and marked `reexport`, so a validator can check it against
 *     the build.
 *
 * What it emits is the union of what the two sites' parsers emit, so one parser
 * can replace both: `kind`, `via`, `name`, `owner`, `module`, `file`, `line`,
 * `description`, `detail`, `tagDescription`, `params`, `properties`, `orphans`,
 * `returns`, `examples`, `type`, `group`, `page`, `ignore`, `reexport`,
 * `static`, `surfaces`, `surfaceParams`, `sigs`, `explicitName`, `exportName`.
 * A renderer reads the fields it knows and ignores the rest.
 *
 * Two merges keep a surface one page. A getter and its setter merge into the
 * getter's doclet, which keeps both descriptions. A static helper and the
 * instance method that delegates to it merge into one `surface` doclet carrying
 * both signatures.
 *
 * Adapted from the parsers of p5.quadrille.js and webgl.tree, which it replaces.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'comment-parser';

const EXPORT_RE  = /^export\s+(?:default\s+)?(?:async\s+)?(function|class|const|let|var)\*?\s+([A-Za-z_$][\w$]*)/;
const MEMBER_RE  = /^(static\s+)?(get\s+|set\s+)?(async\s+)?\*?\s*([A-Za-z_$][\w$]*)\s*[=(]/;
const CAPTION_RE = /^<caption>([\s\S]*?)<\/caption>\s*$/;
const REEXPORT_RE = /^export\s*\{([^}]*)\}\s*from\b/gm;

// ── Token reconstruction ────────────────────────────────────────────────────
// comment-parser tokenizes every tag line into name / type / description, so a
// tag whose payload is free text (@example, @returns, @file) loses its first
// word into `name`. Rebuild from the raw tokens instead. With
// `spacing: 'preserve'` a continuation line's indentation lives in
// `postDelimiter` (one space past the `*` is the standard gutter).

/** Text after `@tag` (and after `{type}` on the first line), all lines. */
function tail(tag) {
  return tag.source.map((s, i) => {
    const k = s.tokens;
    if (i === 0) return k.name + k.postName + k.description;
    return k.postDelimiter.slice(1) + k.tag + k.postTag + k.name + k.postName +
           k.type + k.postType + k.description;
  }).join('\n').replace(/\s+$/, '');
}

/** Continuation lines only (everything after the tag's own line). */
function continuation(tag) {
  return tag.source.slice(1).map((s) => {
    const k = s.tokens;
    return k.postDelimiter.slice(1) + k.tag + k.postTag + k.name + k.postName +
           k.type + k.postType + k.description;
  }).join('\n').replace(/^\n+|\s+$/g, '');
}

/** Drop the blank lines an example carries at either end. */
function trimBlank(code) {
  const lines = code.split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join('\n');
}

/**
 * An @example: optional `<caption>` as its first line (on the tag line or the
 * line after), code on the rest.
 * @param {Object} tag  a comment-parser tag
 * @returns {{ caption: string|null, code: string }}
 */
function exampleOf(tag) {
  const k     = tag.source[0].tokens;
  const head  = (k.name + k.postName + k.type + k.postType + k.description).trim();
  const lines = (head ? [head] : []).concat(continuation(tag).split('\n'));
  const cap   = CAPTION_RE.exec(lines[0].trim());
  return {
    caption: cap ? cap[1].trim() : null,
    code:    trimBlank((cap ? lines.slice(1) : lines).join('\n')),
  };
}

/** A @param / @property row. */
function fieldOf(tag) {
  return {
    name:        tag.name,
    type:        tag.type,
    optional:    tag.optional,
    default:     tag.default ?? null,
    description: tag.description.trim(),
    children:    [],
  };
}

/**
 * Nest dotted names under their parent (`opts.display` under `opts`). A row whose
 * parent was never declared is kept as a root and reported as an orphan.
 * @returns {{ roots: Object[], orphans: string[] }}
 */
function groupDotted(rows) {
  const roots = [], byName = new Map(), orphans = [];
  for (const r of rows) {
    const dot = r.name.lastIndexOf('.');
    const parent = dot > 0 ? byName.get(r.name.slice(0, dot)) : null;
    if (dot > 0 && !parent) orphans.push(r.name);
    (parent ? parent.children : roots).push(r);
    byName.set(r.name, r);
  }
  return { roots, orphans };
}

/** First non-blank line at or after `from`, with its index. */
function nextCodeLine(lines, from) {
  for (let i = from; i < lines.length; i++) {
    if (lines[i].trim()) return { index: i, text: lines[i] };
  }
  return null;
}

/** The `[from, to]` line range of the top-level `class <name> { … }`, 0-based. */
function classRange(lines, name) {
  const start = lines.findIndex((l) => new RegExp(`^class\\s+${name}\\b`).test(l));
  if (start < 0) return null;
  for (let i = start + 1; i < lines.length; i++) if (/^}/.test(lines[i])) return [start, i];
  return null;
}

// ── Per-file parse ──────────────────────────────────────────────────────────

/**
 * One file's blocks: the module header, and every public doclet.
 * @param {string} dir   the directory the file lives in
 * @param {string} file  its name
 * @param {{ members?: string|null }} options
 */
function parseFile(dir, file, { members }) {
  const text   = readFileSync(join(dir, file), 'utf8');
  const lines  = text.split('\n');
  const range  = members ? classRange(lines, members) : null;
  const result = { file, module: null, blocks: [] };

  for (const b of parse(text, { spacing: 'preserve' })) {
    const line  = b.source[0].number + 1;                     // 1-based
    const last  = b.source[b.source.length - 1].number;       // 0-based, inclusive
    const next  = nextCodeLine(lines, last + 1);
    const tagOf = (n) => b.tags.find((t) => t.tag === n) ?? null;
    const all   = (n) => b.tags.filter((t) => t.tag === n);
    const exp   = next ? EXPORT_RE.exec(next.text.trim()) : null;

    const block = {
      file, line,
      tags:       b.tags.map((t) => t.tag),
      exportName: exp ? exp[2] : null,
      exportKind: exp ? exp[1] : null,
      public:     false,
      doclet:     null,
    };
    result.blocks.push(block);

    // Module header — @module / @file / @license, prose before or after.
    const moduleTag = tagOf('module');
    if (moduleTag || tagOf('file')) {
      // The rendered prose: text before the first tag, plus the continuation of
      // the last tag that is not @details — whose text stays in the source.
      const n = b.tags.length;
      const lastTag = n === 0 ? null : (b.tags[n - 1].tag === 'details' && n > 1 ? b.tags[n - 2] : b.tags[n - 1]);
      const prose = [b.description.trim(), lastTag ? continuation(lastTag) : ''].filter(Boolean).join('\n\n');
      const descTag = tagOf('description');
      block.module = {
        name:        moduleTag?.name ?? file.replace(/\.js$/, ''),
        file,
        line,
        title:       tagOf('file') ? tail(tagOf('file')).trim() : '',
        license:     tagOf('license')?.name ?? '',
        description: descTag ? tail(descTag).trim() : prose,
        detail:      tagOf('details') ? tail(tagOf('details')).trim() : '',
      };
      if (!result.module) result.module = block.module;
      continue;
    }

    // Public? — an explicit tag wins over inference; `@ignore` is the caller's
    // rule (kept for a coverage check, or dropped).
    const fnTag = tagOf('function'), constTag = tagOf('constant');
    const tdTag = tagOf('typedef'), nameTag = tagOf('name');
    const member = next && /^ {2}\S/.test(next.text) && range &&
                   next.index > range[0] && next.index < range[1]
      ? MEMBER_RE.exec(next.text.trim()) : null;

    let via = null, name = null, kind = null, staticMember = false, accessor = null;
    if (nameTag)       { via = 'name';     name = nameTag.name;   kind = 'function'; }
    else if (fnTag)    { via = 'function'; name = fnTag.name;     kind = 'function'; }
    else if (constTag) { via = 'constant'; name = constTag.name;  kind = 'constant'; }
    else if (tdTag)    { via = 'typedef';  name = tdTag.name;     kind = 'typedef'; }
    else if (member)   {
      via = 'member';
      name = member[4];
      staticMember = !!member[1];
      accessor = (member[2] ?? '').trim() || null;
      kind = accessor ? `accessor:${accessor}` : staticMember ? 'static' : 'method';
    } else if (block.exportName) {
      via  = 'export';
      name = block.exportName;
      kind = /^(function|class)$/.test(block.exportKind) ? 'function' : 'constant';
    }
    if (!name) continue;

    const params = groupDotted(all('param').map(fieldOf));
    const props  = groupDotted(all('property').map(fieldOf));
    const ret    = tagOf('returns');
    const typeTag = tagOf('type');

    block.public = true;
    block.doclet = {
      kind, via, name,
      owner:         tagOf('memberof')?.name ?? (via === 'member' ? members : null),
      module:        null,
      file, line,
      description:   b.description.trim(),
      detail:        tagOf('details') ? tail(tagOf('details')).trim() : '',
      tagDescription: (constTag ?? tdTag)?.description.trim() ?? '',
      params:        params.roots,
      properties:    props.roots,
      orphans:       [...params.orphans, ...props.orphans],
      returns:       ret ? { type: ret.type, description: tail(ret).trim() } : null,
      examples:      all('example').map(exampleOf),
      type:          typeTag?.type ?? constTag?.type ?? tdTag?.type ?? null,
      group:         tagOf('group')?.name ?? null,
      page:          tagOf('page') ? tail(tagOf('page')).trim() : null,
      ignore:        !!tagOf('ignore'),
      reexport:      false,
      static:        staticMember,
      surfaces:      [via === 'member' ? (staticMember ? 'static' : 'instance') : 'namespace'],
      surfaceParams: null,
      sigs:          [],
      explicitName:  fnTag?.name ?? nameTag?.name ?? null,
      exportName:    block.exportName,
    };
  }
  return result;
}

/** The `[from, to]` doclet table after the two merges, for one file. */
function mergeSurfaces(doclets) {
  // The constructor and private members are not public surface.
  let out = doclets.filter((d) => d.name !== 'constructor' && !d.name.startsWith('_'));

  // Accessor pairs are one surface: the setter joins the getter.
  for (const d of out) {
    if (d.kind !== 'accessor:set') continue;
    const getter = out.find((o) => o !== d && o.name === d.name && o.owner === d.owner &&
      o.kind === 'accessor:get');
    if (!getter) { d.kind = 'accessor'; continue; }
    getter.description = [getter.description, d.description].filter(Boolean).join('\n\n');
    getter.params.push(...d.params, ...d.properties);
    getter.examples.push(...d.examples);
    getter.kind = 'accessor';
    getter.surfaces = [d.static ? 'static' : 'instance'];
    d.mergedInto = getter.name;
    d.kind = 'accessor:merged';
  }
  out = out.filter((d) => d.kind !== 'accessor:merged');
  for (const d of out) if (d.kind === 'accessor:get') d.kind = 'accessor';

  // A static helper and the instance method that delegates to it are one
  // surface: one page, both signatures, both descriptions.
  const merged = [];
  for (const d of out) {
    const other = out.find((o) => o !== d && o.name === d.name && o.owner === d.owner &&
      o.kind !== d.kind && !o.mergedInto && o !== d);
    if (!other) { merged.push(d); continue; }
    // An already-merged doclet is in the outcome once, through the one it merged into.
    if (d.mergedInto || other.mergedInto) continue;
    const [first, second] = d.surfaces[0] === 'static' ? [d, other] : [other, d];
    first.surfaceParams = { [first.surfaces[0]]: first.params, [second.surfaces[0]]: second.params };
    first.description = first.description === second.description ? first.description
      : [first.description, second.description].filter(Boolean).join('\n\n');
    first.surfaces = ['static', 'instance'];
    first.kind = 'surface';
    first.params = first.params.length ? first.params : second.params;
    first.returns ??= second.returns;
    second.mergedInto = first.name;
    merged.push(first);
  }
  return merged;
}

/** The names `src/index.js` re-exports (`a as b` yields `b`), or null. */
function surfaceOf(srcDir) {
  let text;
  try { text = readFileSync(join(srcDir, 'index.js'), 'utf8'); } catch (_) { return null; }
  const names = new Set();
  for (const m of text.matchAll(REEXPORT_RE)) {
    for (const item of m[1].split(',')) {
      const name = item.trim().split(/\s+as\s+/).pop();
      if (name) names.add(name);
    }
  }
  return names;
}

/** Every `*.js` in a directory, sorted by name without the extension. */
const jsFiles = (dir) => readdirSync(dir).filter((f) => f.endsWith('.js'))
  .sort((a, b) => (a.slice(0, -3) < b.slice(0, -3) ? -1 : 1));

// ── Entry ───────────────────────────────────────────────────────────────────

/**
 * Parse a site's sources into the tables every later step reads.
 * @param {Object} options
 * @param {string} options.src            directory of source files
 * @param {string[]} [options.carriers]   directories of documentation-only files
 * @param {boolean} [options.surface]     gate publicity on `src/index.js`'s re-exports
 * @param {string|null} [options.members] class whose indented members are public
 * @param {'keep'|'skip'} [options.ignore] what an `@ignore` block does
 * @returns {{ modules: Object[], doclets: Object[], blocks: Object[] }}
 */
export function parseSources({ src, carriers = [], surface = false, members = null, ignore = 'keep' }) {
  const modules = [], doclets = [], blocks = [];
  const names = surface ? surfaceOf(src) : null;

  const collect = (dir, file, reexport) => {
    const r = parseFile(dir, file, { members });
    if (r.module) modules.push(r.module);
    const kept = [];
    for (const b of r.blocks) {
      blocks.push(b);
      if (!b.doclet) continue;
      if (b.doclet.ignore && ignore === 'skip') { b.public = false; b.doclet = null; continue; }
      if (names && !reexport && !b.doclet.ignore && !names.has(b.doclet.name)) {
        b.public = false; b.doclet = null; continue;
      }
      b.doclet.module = r.module?.name ?? null;
      b.doclet.owner ??= b.doclet.module;
      b.doclet.reexport = reexport;
      kept.push(b.doclet);
    }
    for (const d of mergeSurfaces(kept)) doclets.push(d);
  };

  for (const file of jsFiles(src)) collect(src, file, false);
  for (const dir of carriers) for (const file of jsFiles(dir)) collect(dir, file, true);

  return { modules, doclets, blocks };
}
