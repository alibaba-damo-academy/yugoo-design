/**
 * Architecture gate for the generic Design System and installable providers.
 *
 * Generic packages may define reusable primitives with domain-flavoured names.
 * They may not depend on a concrete Kit/provider or embed its globally
 * namespaced driver identities. The official Kit may ship ordinary Agent-facing
 * `.mjs` files under each Bundle's `scripts/` directory; those scripts are
 * invoked through the generic confined Host port and require no Kit build or
 * Bundle-specific Provider runtime. An adjacent `.d.mts` may describe an
 * existing `.mjs` script for typed consumers; it is not executable Kit code.
 */
import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { assertKitTestScripts, isKitRootDevelopmentFile } from './kit-test-file-policy.mjs'

const workspace = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packages = join(workspace, 'packages')
const genericPackageNames = ['core', 'panel', 'studio', 'studio-ui', 'studio-dsh']
const genericPackageRoots = genericPackageNames.map(name => join(packages, name))
const codeExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])
const ignoredDirectories = new Set(['lib', 'node_modules'])
const concretePackage = /^dsh-design-(?:skills|provider)-/u
const concreteDriverNamespace = /io\.deepseek\.design\.web-app\./gu
const moduleSpecifier = /\b(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/gu
const violations = []

async function manifest(packageRoot) {
  return JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
}

async function collectFiles(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await collectFiles(path, files)
    else files.push(path)
  }
  return files
}

function fail(path, detail) {
  violations.push(`${relative(workspace, path)}: ${detail}`)
}

for (const packageRoot of genericPackageRoots) {
  const packageJsonPath = join(packageRoot, 'package.json')
  const packageJson = await manifest(packageRoot)
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const dependency of Object.keys(packageJson[field] ?? {})) {
      if (concretePackage.test(dependency)) fail(packageJsonPath, `${field} depends on concrete package ${JSON.stringify(dependency)}`)
    }
  }

  for (const path of await collectFiles(packageRoot)) {
    if (!codeExtensions.has(extname(path))) continue
    const source = await readFile(path, 'utf8')
    concreteDriverNamespace.lastIndex = 0
    if (concreteDriverNamespace.test(source)) fail(path, 'embeds the official Web App driver namespace')
    moduleSpecifier.lastIndex = 0
    for (const match of source.matchAll(moduleSpecifier)) {
      const specifier = match[1]
      if (concretePackage.test(specifier)) fail(path, `imports concrete package ${JSON.stringify(specifier)}`)
    }
  }
}

const kitRoot = join(packages, 'skills-web-app')
const kitManifestPath = join(kitRoot, 'package.json')
const kitManifest = await manifest(kitRoot)
assert.deepEqual(
  kitManifest.designSystem?.kit,
  { root: './kits/web_app', mindset: './kits/web_app/mindset.md', manifest: './kits/web_app/kit.yaml', bundles: './bundles' },
  'the official content Kit must publish only host-neutral discovery metadata',
)
assert.equal(kitManifest.main, undefined, 'the content Kit must not publish a JavaScript entry')
assert.equal(kitManifest.exports, undefined, 'the content Kit must not publish JavaScript exports')
for (const file of assertKitTestScripts(kitManifest.scripts)) {
  assert.ok((await stat(join(kitRoot, file))).isFile(), `Kit test file must exist: ${file}`)
}
assert.deepEqual(kitManifest.devDependencies, undefined, 'the content Kit must not need build-time dependencies')
assert.deepEqual(
  Object.keys(kitManifest.dependencies ?? {}).sort(),
  ['bpmn-js', 'bpmn-moddle', 'elkjs', 'playwright'],
  'Kit dependencies are limited to engines used directly by its ordinary Skill scripts',
)
for (const field of ['optionalDependencies', 'peerDependencies']) {
  assert.deepEqual(kitManifest[field], undefined, `the content Kit must not have ${field}`)
}
assert.deepEqual(kitManifest.files, ['README.md', 'kits', 'bundles', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md'], 'the content package includes separate Kit and Bundle roots and license materials, excluding engineering tests and previews')
for (const path of await collectFiles(kitRoot)) {
  if (path === kitManifestPath || !codeExtensions.has(extname(path))) continue
  const rel = relative(kitRoot, path)
  if (isKitRootDevelopmentFile(rel)) continue
  if (/^bundles\/[^/]+\/scripts\/(?:[^/]+\/)*[^/]+\.d\.mts$/u.test(rel)) {
    assert.ok((await stat(path.replace(/\.d\.mts$/u, '.mjs'))).isFile(), 'a script declaration must describe an existing ordinary .mjs file')
    continue
  }
  if (!/^bundles\/[^/]+\/scripts\/(?:[^/]+\/)*[^/]+\.mjs$/u.test(rel)) {
    fail(path, 'Kit executable code must be an ordinary .mjs file inside one Bundle scripts/ directory')
  }
}

const providerRoot = join(packages, 'provider-web-app')
const providerManifest = await manifest(providerRoot)
assert.equal(providerManifest.exports?.['./client']?.default ?? providerManifest.exports?.['./client'], './lib/client.js', 'the provider must publish its own browser artifact')
assert.equal(providerManifest.dsh?.client?.platform, 'web', 'the provider package root must declare its browser plugin')
assert.ok((providerManifest.dsh?.client?.inject ?? []).includes('dsh-design-panel'), 'the provider browser plugin must inject the generic Panel registry')
await stat(join(providerRoot, 'src', 'index.ts'))
await stat(join(providerRoot, 'src', 'client', 'index.ts'))

const distributionRoot = join(packages, 'dsh')
const distributionManifest = await manifest(distributionRoot)
for (const dependency of ['dsh-design-skills-web-app', 'dsh-design-provider-web-app']) {
  assert.ok(Object.hasOwn(distributionManifest.dependencies ?? {}, dependency), `the official distribution must install ${dependency}`)
}
assert.equal(distributionManifest.dsh?.client, undefined, 'the distribution must not publish a combined browser client')
assert.equal(distributionManifest.exports?.['./client'], undefined, 'the distribution must not facade provider browser code')
const patch = parse(await readFile(join(distributionRoot, 'cordis.patch.yml'), 'utf8'))
const rows = patch.find(entry => entry?.insert)?.insert ?? []
assert.ok(rows.some(row => row.name === 'dsh-design-provider-web-app'), 'the provider must be mounted as a direct package-root Loader row')
assert.ok(rows.some(row => row.name === 'dsh-design-panel'), 'the generic Panel must be mounted as a direct package-root Loader row')
assert.ok(rows.some(row => row.name === 'dsh-design-core'), 'generic Core must be mounted as a direct package-root Loader row')
assert.ok(rows.some(row => row.name === 'dsh-design-core/kit-loader' && row.config?.packageName === 'dsh-design-skills-web-app'), 'the generic Kit loader must mount the official content Kit')
for (const row of rows) {
  assert.ok(!String(row.name).startsWith('dsh-design-system-dsh/'), `distribution facade row is forbidden: ${row.name}`)
}

if (violations.length > 0) {
  throw new Error([
    'Generic-package independence violations:',
    ...violations.sort().map(violation => `- ${violation}`),
  ].join('\n'))
}

console.log('GENERIC PACKAGE AND PROVIDER ARCHITECTURE OK')
