/**
 * @file `@nakednous/scholion/generator` — the programmatic pipeline: a site's
 * declaration in, its site out, in four steps a site may also call one at a time.
 * @license AGPL-3.0-only
 *
 * The API is **unstable**: it is exported for the sibling repositories of this
 * suite, nothing is published, and it changes until a CLI rules its shape.
 *
 *   parseSources({ src, carriers, surface, members, ignore })
 *     → { modules, doclets, blocks }
 *   validate(parsed, { declaration, api, surfaceErrors, readme, link })
 *     → { errors, warnings, findings }
 *   render(parsed, state) → Map<file, html>
 *   build(declaration, { root, log }) → the site on disk, and its facts
 *
 * A step is exported as well as the whole because a site's own tool may want
 * to read the tables without rendering — the pilot's parity runs do exactly
 * that. `build` is the one a site's `npm run docs` calls.
 */

export { parseSources } from './parse.js';
export { validate } from './validate.js';
export { render } from './render.js';
export { build, BuildError } from './build.js';
export { DeclarationError } from './declaration.js';
