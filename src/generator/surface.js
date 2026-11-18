/**
 * @file The built surface — the IIFE a page loads or the ES module it imports,
 * read for what it actually exports, so every documented name can be checked
 * against the build rather than against the doc block that claims it.
 * @license AGPL-3.0-only
 *
 * An IIFE is evaluated once in a function scope and the name it leaves behind
 * is what the pages read; an ES build is imported and its namespace is that
 * same object. Either way the walk is the same: a path from that object, as the
 * declaration's `owners` states it, and `path()` for the object literal a
 * factory returns (whose methods are read off the factory's source).
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
    const name = p.trim().replace(/^\.\.\./, '');
    return /^[{[]/.test(name) ? null : name.split('=')[0].trim();
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
 * An owner's members in the build, per the declared `owners` path: `has(name)`
 * and `params(name)`. Null when the owner is not declared or not in the build.
 * @param {Object} api  the evaluated global or the imported namespace
 * @param {Object<string, string>} owners
 * @param {string} owner
 * @returns {{ has: (name: string) => boolean, params: (name: string) => Array<string|null> }|null}
 */
export function ownerScope(api, owners, owner) {
  const path = owners?.[owner];
  if (!path) return null;
  const factory = path.endsWith('()');
  const target = (factory ? path.slice(0, -2) : path).split('.')
    .reduce((o, k) => (o == null ? o : o[k]), api);
  if (target == null) return null;
  if (factory) {
    const src = String(target);
    const at = (name) => src.search(new RegExp(`[\\s,{](?:get\\s+)?${name}\\s*\\(`));
    return {
      has: (name) => at(name) >= 0,
      params: (name) => paramNames(src.slice(at(name) + 1).replace(/^get\s+/, '')),
    };
  }
  return {
    has: (name) => descriptorOf(target, name) !== null,
    params: (name) => {
      const d = descriptorOf(target, name);
      return d && typeof d.value === 'function' ? paramNames(String(d.value)) : [];
    },
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
