/**
 * @file The declaration — a site's `docs.config.js`, normalized.
 * @license AGPL-3.0-only
 *
 * A site states where its sources are, what its page carries and what its
 * names mean; the package fills in what every site shares and refuses a
 * declaration it cannot build. Nothing here reads a file: `build` does that,
 * with the directory this returns.
 */

/** A declaration the build cannot act on. */
export class DeclarationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DeclarationError';
  }
}

/** The tag vocabulary a doc block may use — the union of the sites' own sets. */
export const VOCABULARY = new Set([
  'file', 'module', 'license', 'description', 'version', 'author',
  'function', 'memberof', 'name', 'param', 'returns', 'type',
  'constant', 'typedef', 'property', 'example', 'details',
  'instance', 'private', 'throws',
  'group', 'page', 'ignore',
]);

const MODES = new Set(['esm', 'global']);
const SYNTAX = new Set(['global', 'module', 'any']);
const CHECKS = new Set(['reexports', 'all']);

/**
 * The declaration with every default filled in.
 * @param {Object} declaration  the site's `docs.config.js` default export
 * @param {Object} pkg  the site's `package.json`, for the brand it defaults to
 * @returns {Object} the normalized declaration
 */
export function normalize(declaration, pkg) {
  if (!declaration || typeof declaration !== 'object') {
    throw new DeclarationError('the declaration must be an object');
  }
  const { paths, outputs, runner } = declaration;
  if (!paths?.src) throw new DeclarationError('paths.src is required — the documented sources');
  if (!paths.pkg) throw new DeclarationError('paths.pkg is required — the package manifest');
  if (!paths.site) throw new DeclarationError('paths.site is required — where the build writes');
  if (!outputs?.index) throw new DeclarationError('outputs.index is required — the search index file');
  if (!runner?.script) throw new DeclarationError('runner.script is required — the page\'s runner');

  const m = normalizeMode(declaration.mode);
  const examples = normalizeExamples(declaration.examples);
  const surface = declaration.surface ? normalizeSurface(declaration.surface) : null;
  const strict = [...(declaration.strict ?? [])];
  for (const code of strict) {
    if (typeof code !== 'string') throw new DeclarationError('strict names finding codes — one string each');
  }

  return {
    pkg,
    brand: {
      name: declaration.brand?.name ?? pkg.name,
      version: declaration.brand?.version ?? pkg.version,
      license: declaration.brand?.license ?? pkg.license ?? null,
    },
    palette: declaration.palette ?? null,
    home: declaration.home ?? null,
    paths: {
      src: paths.src,
      pkg: paths.pkg,
      readme: paths.readme ?? 'README.md',
      bundle: paths.bundle ?? null,
      module: paths.module ?? null,
      deps: paths.deps ?? {},
      static: paths.static ?? null,
      plugins: paths.plugins ?? 'tools/docs/plugins',
      site: paths.site,
    },
    outputs: {
      bundle: outputs.bundle ?? null,
      module: outputs.module ?? null,
      deps: outputs.deps ?? {},
      index: outputs.index,
      editor: outputs.editor ?? null,
      notices: outputs.notices ?? null,
    },
    carrier: {
      docs: declaration.carrier?.docs ?? null,
      landing: declaration.carrier?.landing
        ? {
          file: declaration.carrier.landing.file,
          section: declaration.carrier.landing.section ?? 'esm',
          id: declaration.carrier.landing.id ?? 'es-modules',
        }
        : null,
    },
    parse: {
      surface: declaration.parse?.surface ?? false,
      members: declaration.parse?.members ?? null,
      ignore: declaration.parse?.ignore === 'skip' ? 'skip' : 'keep',
    },
    examples,
    surface,
    owners: declaration.owners ?? {},
    namespaces: declaration.namespaces ?? [],
    pins: declaration.pins ?? {},
    references: {
      packages: declaration.references?.packages ?? {},
      externals: declaration.references?.externals ?? [],
      aliases: declaration.references?.aliases ?? {},
    },
    groups: declaration.groups ?? [],
    areas: declaration.areas ?? [],
    mode: m,
    shell: normalizeShell(declaration.shell),
    runner: {
      script: runner.script,
      search: runner.search ?? null,
      chrome: runner.chrome ?? null,
      extra: runner.extra ?? [],
      config: runner.config ?? {},
    },
    plugins: normalizePlugins(declaration.plugins),
    stamp: declaration.stamp ?? false,
    strict,
  };
}

/** `'esm'` or `'global'`: how a page's own scripts are loaded and handed its config. */
function normalizeMode(mode) {
  const value = mode ?? 'esm';
  if (!MODES.has(value)) throw new DeclarationError(`mode must be one of ${[...MODES].join(', ')}`);
  return value;
}

/** How an `@example` is checked: its syntax, the global it reads, whether one is required. */
function normalizeExamples(examples) {
  const syntax = examples?.syntax ?? 'any';
  if (!SYNTAX.has(syntax)) throw new DeclarationError(`examples.syntax must be one of ${[...SYNTAX].join(', ')}`);
  return {
    syntax,
    global: examples?.global ?? null,
    required: examples?.required ?? false,
  };
}

/**
 * What the documented surface is checked against: `global`, the name an IIFE
 * leaves behind (evaluated with `globals`), or `module: true`, the ES build at
 * `paths.module` imported and used as the namespace.
 */
function normalizeSurface(surface) {
  if (!surface.global && !surface.module) {
    throw new DeclarationError('surface must name a global or a module — something to check the doclets against');
  }
  const check = surface.check ?? 'all';
  if (!CHECKS.has(check)) throw new DeclarationError(`surface.check must be one of ${[...CHECKS].join(', ')}`);
  return { global: surface.global ?? null, module: surface.module ?? null, globals: surface.globals ?? {}, check };
}

/** The page's chrome: the stylesheet, the favicons, the search box's two strings. */
function normalizeShell(shell) {
  return {
    stylesheet: shell?.stylesheet ?? null,
    favicon: shell?.favicon ?? [],
    title: shell?.title ?? null,
    search: {
      placeholder: shell?.search?.placeholder ?? 'Search…',
      label: shell?.search?.label ?? 'Search the API',
    },
  };
}

/** Plugin names — resolved against the declaration's own directory by `build`. */
function normalizePlugins(plugins) {
  if (plugins == null) return [];
  if (!Array.isArray(plugins)) throw new DeclarationError('plugins is a list of names');
  for (const p of plugins) {
    if (typeof p !== 'string' || !/^[\w./-]+$/.test(p)) throw new DeclarationError(`plugin ${p} is not a name`);
  }
  return [...plugins];
}

/**
 * A declaration's package pins, as the CDN URLs a page loads.
 * @param {Object} pins  `{ 'twgl.js': { version, script, module } }`
 * @param {string} [cdn]
 * @returns {{ url: (name: string, field: string) => string|null }}
 */
export function pinUrls(pins, cdn = 'https://cdn.jsdelivr.net/npm') {
  return {
    url(name, field) {
      const pin = pins?.[name];
      const path = pin?.[field];
      if (!pin?.version || !path) return null;
      return `${cdn}/${name}@${pin.version}/${path.replace(/^\//, '')}`;
    },
  };
}
