/**
 * @file Reference resolution — a name written in prose or in a signature → the
 * address the declaration says it lives at.
 * @license AGPL-3.0-only
 *
 * Two kinds of name, both the site's data and both resolved here:
 *
 *   - a *package* (the stack's own libraries) — its repository, its npm page,
 *     or its documentation's front page, whatever the declaration states;
 *   - an *external library's name* (`twgl.createProgramInfo`, `p5.Vector`) —
 *     its documentation grammar, declared as a base and a template per shape.
 *
 * The grammar. A name is the prefix alone or the prefix plus one or two
 * dot-separated segments:
 *
 *   prefix.member          → `url.one`
 *   prefix.first.member    → `url.qualified`, with `{ns}` = first
 *
 * and a one-segment member takes a different template when the declaration
 * singles it out: `url.pages` (a member documented on a page of its own) wins
 * over `url.namespaces` (a list) which wins over `url.classes` (a pattern).
 * `{member}`, `{ns}` and `{name}` are the substitutions; `{name}` is the whole
 * name as written, which is what a link's text usually reads.
 */

/** Fill a declared template's `{member}` / `{ns}` / `{name}`, and leave anything else alone. */
const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (all, key) => (key in vars ? vars[key] : all));

/** The segment shapes both external grammars can express. */
const SEGMENT = /^[\w$]+$/;

/** The address of a package named in prose, or null. */
export const packageUrl = (references, name) => references?.packages?.[name] ?? null;

/**
 * The template a one-segment member takes.
 * @param {Object} url  the declared `url` grammar
 * @param {string} member
 * @returns {string|undefined}
 */
function oneSegment(url, member) {
  if (url.pages?.[member]) return url.pages[member];
  if (url.namespaces?.includes(member)) return url.namespace;
  if (url.classes && new RegExp(url.classes).test(member)) return url.class;
  return url.one;
}

/**
 * A name as an external library documents it.
 * @param {Object} references  the declaration's reference data
 * @param {string} name
 * @returns {{ url: string, text: string }|null} null when no grammar claims the name
 */
export function externalRef(references, name) {
  const parts = String(name).split('.');
  if (!parts.every((part) => SEGMENT.test(part))) return null;
  for (const ext of references?.externals ?? []) {
    if (parts[0] !== ext.prefix || parts.length < 2 || parts.length > 3) continue;
    const member = parts[parts.length - 1];
    const ns = parts.length === 3 ? parts[1] : '';
    const template = parts.length === 3 ? ext.url?.qualified : oneSegment(ext.url ?? {}, member);
    if (!template) return null;
    const vars = { member, ns, name };
    return { url: `${ext.base ?? ''}${fill(template, vars)}`, text: fill(ext.text ?? '{name}', vars) };
  }
  return null;
}

/**
 * The address a name resolves to, a package first and an external grammar
 * second, or null when nothing claims it.
 */
export function referenceUrl(references, name) {
  return packageUrl(references, name) ?? externalRef(references, name)?.url ?? null;
}
