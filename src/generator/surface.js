/**
 * @file The built surface — the IIFE a page loads or the ES module it imports,
 * read for what it actually exports, so every documented name can be checked
 * against the build rather than against the doc block that claims it.
 * @license AGPL-3.0-only
 *
 * An IIFE is evaluated once in a function scope and the name it leaves behind
 * — or the host global it installs onto — is what the pages read; an ES build
 * is imported and its namespace is that same object. Either way the walk is the
 * same: a path from that object, as the declaration's `owners` states it (one
 * path, or several when an owner's names sit in more than one place), and
 * `path()` for the object a factory returns, whose methods are read off the
 * factory's source.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The parameter names a function's source declares, in order: defaults
 * dropped, a rest parameter by its name, a destructured one as null (not
 * compared). Reads a declaration, a method or an arrow.
 * @param {string} src
 * @returns {Array<string|null>}
 */
export function paramNames(src) {
  const s = String(src).trimStart();
  const bare = /^(?:async\s+)?([\w$]+)\s*=>/.exec(s);
  if (bare) return [bare[1]];
  const out = [];
  let depth = 0, cur = '';
  for (let k = s.indexOf('(') + 1; k > 0 && k < s.length; k++) {
    const c = s[k];
    if (c === ')' && depth === 0) break;
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((p) => {
    const raw = p.trim();
    const name = raw.replace(/^\.\.\./, '').split('=')[0].trim();
    if (/^[{[]/.test(name)) return null;
    return raw.startsWith('...') ? `...${name}` : name;   // an open list, kept visible
  });
}

/** A property descriptor anywhere up the prototype chain. */
function descriptorOf(obj, name) {
  for (let o = obj; o; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, name);
    if (d) return d;
  }
  return null;
}

/**
 * One declared path, read off the api: the members `has(name)` and the
 * parameters `params(name)` of an object, or of the object literal a factory
 * returns (read off the factory's source).
 * @returns {{ has: (name: string) => boolean, params: (name: string) => Array<string|null> }|null}
 */
function scopeAt(api, path) {
  const factory = path.endsWith('()');
  // An empty path is the surface itself: a carrier whose documented names are
  // the build's own top-level exports.
  const target = path === '' ? api : (factory ? path.slice(0, -2) : path).split('.')
    .reduce((o, k) => (o == null ? o : o[k]), api);
  if (target == null) return null;
  if (factory) {
    const src = String(target);
    // A member the factory defines in its body (`name(a, b) {`), or attaches to
    // the object it returns (`result.name = function (a, b) {}`).
    const at = (name) => src.search(new RegExp(`[\\s,{](?:get\\s+)?${name}\\s*\\(|\\.${name}\\s*=`));
    return {
      has: (name) => at(name) >= 0,
      params: (name) => paramNames(src.slice(at(name) + 1).replace(/^get\s+/, '')),
    };
  }
  return {
    has: (name) => descriptorOf(target, name) !== null,
    params: (name) => {
      const d = descriptorOf(target, name);
      // An ES module namespace exports its members as getters: the descriptor
      // carries no `value`, so the member is read through the namespace.
      const fn = d && typeof d.value === 'function' ? d.value : target[name];
      return typeof fn === 'function' ? paramNames(String(fn)) : [];
    },
  };
}

/**
 * An owner's members in the build, per the declared `owners` entry: one path
 * from the surface, several when the build hosts the owner's names in more
 * than one place (a class whose methods split between two prototypes), or an
 * empty path for the surface itself.
 * @param {Object} api  the evaluated global or the imported namespace
 * @param {Object<string, string|string[]|null>} owners
 * @param {string} owner
 * @returns {{ has: (name: string) => boolean, params: (name: string) => Array<string|null> }|null}
 *   null when the owner is not declared, declared `null`, or not in the build
 */
export function ownerScope(api, owners, owner) {
  const spec = owners?.[owner];
  if (spec == null) return null;
  const scopes = (Array.isArray(spec) ? spec : [spec]).map((p) => scopeAt(api, p)).filter(Boolean);
  if (!scopes.length) return null;
  if (scopes.length === 1) return scopes[0];
  return {
    has: (name) => scopes.some((s) => s.has(name)),
    params: (name) => scopes.find((s) => s.has(name))?.params(name) ?? [],
  };
}

/**
 * The build, read once.
 * @param {{ global?: string, module?: string, globals?: Object }} surface
 *        `global`: the name the IIFE leaves in scope, evaluated with the
 *        declared globals plus `window`/`document` (a browser build loaded in
 *        Node). `module`: an ES build, imported and used as the namespace.
 * @param {string} bundle  absolute path of the build to read
 * @returns {Promise<{ api: Object|null, errors: string[] }>}
 */
export async function readSurface(surface, bundle) {
  if (!surface) return { api: null, errors: [] };
  if (surface.module) {
    try {
      return { api: await import(pathToFileURL(bundle).href), errors: [] };
    } catch (e) {
      return { api: null, errors: [`build: importing ${bundle} failed — ${e.message}`] };
    }
  }
  if (!surface.global) return { api: null, errors: [] };
  const names = ['window', 'document', ...Object.keys(surface.globals ?? {})];
  const values = [globalThis, undefined, ...Object.values(surface.globals ?? {})];
  try {
    const code = readFileSync(bundle, 'utf8');
    const api = new Function(...names, `${code}\n;return typeof ${surface.global} === 'undefined' ? null : ${surface.global};`)(...values);
    return api ? { api, errors: [] } : { api: null, errors: [`build: ${bundle} leaves no ${surface.global} behind`] };
  } catch (e) {
    return { api: null, errors: [`build: evaluating ${bundle} failed — ${e.message}`] };
  }
}
