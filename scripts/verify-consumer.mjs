#!/usr/bin/env node
/**
 * @file The consumer gate: the bytes a consumer installs, resolved the way a
 * consumer resolves them.
 * @license AGPL-3.0-only
 *
 * `npm test` ends here. The suite builds the artifact and imports it from the
 * repository; this script packs the tarball, installs it production-only into a
 * throwaway project, and asks that project's own resolver for the package. Four
 * things must hold, and none of them is visible from inside the repository:
 *
 *   - the manifest resolves through the package's export map;
 *   - the asset the manifest names hashes to the SHA-256 the manifest states;
 *   - no production dependency of the package appears in the editor's bundle
 *     graph: the generator may need Node packages (it runs at build time), but a
 *     page must never receive one;
 *   - the root export is absent — a site imports the served bundle, never the
 *     adapter's source, so `@nakednous/scholion` itself does not resolve;
 *   - the generator's export does resolve, and imports: a site's `npm run docs`
 *     runs it out of a production-only install, so its own dependencies have to
 *     be there and none of them may be a development one.
 *
 * The throwaway project sets its own npm cache inside its directory, so the
 * gate does not depend on the machine's cache being writable. The pack runs with
 * `--ignore-scripts`: the suite has already built the artifact this gate
 * verifies, and a rebuild here would test different bytes than the ones
 * `npm test` just ran.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

let failures = 0;
const check = (what, ok, detail = '') => {
  console.log(`${ok ? '✔' : '✗'} ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

function run(command, args, cwd, env) {
  return execFileSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const dir = mkdtempSync(join(tmpdir(), 'scholion-consumer-'));
const env = {
  ...process.env,
  npm_config_cache: join(dir, 'cache'),
  npm_config_audit: 'false',
  npm_config_fund: 'false',
  npm_config_update_notifier: 'false',
};

try {
  // npm's `--json` reports an object keyed by package name, or an array, by version.
  const reported = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', dir], root, env));
  const packed = (Array.isArray(reported) ? reported[0] : Object.values(reported)[0]) ?? {};
  const tarball = join(dir, packed.filename ?? '');
  check('the tarball is packed', Boolean(packed.filename) && packed.filename.endsWith('.tgz'), basename(tarball));

  const consumer = join(dir, 'consumer');
  mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'),
    `${JSON.stringify({ name: 'consumer', private: true, type: 'module' }, null, 2)}\n`);
  run('npm', ['install', tarball, '--omit=dev', '--no-audit', '--no-fund'], consumer, env);
  check('a production-only install completes', true);

  const require = createRequire(join(consumer, 'index.js'));
  const installed = dirname(require.resolve(`${pkg.name}/manifest.json`));
  const manifest = JSON.parse(readFileSync(join(installed, 'manifest.json'), 'utf8'));
  check('the export map resolves the manifest', manifest.name === pkg.name,
    `${pkg.name} ${manifest.version}`);

  const bytes = readFileSync(join(installed, manifest.asset));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  check('the asset the manifest names hashes to the manifest',
    sha256 === manifest.sha256 && bytes.length === manifest.bytes,
    `${manifest.asset} ${bytes.length} B`);

  const installedPkg = JSON.parse(readFileSync(join(installed, '..', 'package.json'), 'utf8'));
  const declared = Object.keys(installedPkg.dependencies ?? {});
  const inBundle = declared.filter((name) => name in manifest.packages);
  check('no production dependency reaches the editor bundle',
    inBundle.length === 0,
    declared.length ? `declared ${declared.join(' ')}, bundled ${inBundle.join(' ') || 'none'}` : 'none declared');
  check('the installed package ships the build and the source',
    Array.isArray(installedPkg.files) && installedPkg.files.includes('dist'));

  let rootResolves = true;
  try {
    require.resolve(pkg.name);
  } catch (_) {
    rootResolves = false;
  }
  check('the root export is absent, so no site can import the adapter by name', !rootResolves);

  const generator = await import(pathToFileURL(require.resolve(`${pkg.name}/generator`)).href);
  check('the generator resolves and imports from a production-only install',
    ['parseSources', 'validate', 'render', 'build'].every((name) => typeof generator[name] === 'function'),
    Object.keys(generator).join(' '));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures) {
  console.error(`[consumer] ${failures} check(s) failed`);
  process.exit(1);
}
console.log('[consumer] the packed bytes are the installed bytes, and the root is sealed');
