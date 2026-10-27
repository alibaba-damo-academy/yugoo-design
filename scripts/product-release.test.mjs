import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readProductRelease, validateProductRelease, validateReleaseVersion, productReleaseHosts, selectProductRelease } from './product-release.mjs'
import { validateProductManifest, validatePackInventory } from './prepare-product-release.mjs'
const product = await readProductRelease(fileURLToPath(new URL('../', import.meta.url)))
const hosts = { schemaVersion: 1, hosts: { dsh: { aggregatePackage: '@yugoo-design/dsh-design-system-dsh', registry: 'https://registry.npmjs.org' } } }

test('product.json is the sole canonical stable identity and version source', () => {
  assert.deepEqual(validateProductRelease(product), product)
  for (const value of [undefined, null, [], {}, { ...product, name: '@yugoo-design/companion' }, { ...product, bin: 'design-system' },
    { ...product, schemaVersion: 2 }, { ...product, betaVersion: '1.0.0' }]) assert.throws(() => validateProductRelease(value))
  for (const value of ['latest', '0.1.0-beta.1', '0.1.0-rc.1', 'v0.1.0', '01.0.0', '0.1.0+build', '0.1.0\n', '9007199254740992.0.0']) assert.throws(() => validateReleaseVersion(value))
})
test('host mapping derives exact product version without changing its versionless source', () => {
  const before = structuredClone(hosts), bound = productReleaseHosts(product, hosts)
  assert.equal(bound.hosts.dsh.aggregateVersion, product.version); assert.deepEqual(hosts, before)
  for (const value of [{ ...hosts, version: product.version }, { ...hosts, hosts: { dsh: { ...hosts.hosts.dsh, aggregateVersion: product.version } } },
    { ...hosts, hosts: { dsh: { ...hosts.hosts.dsh, registry: 'https://example.invalid' } } }]) assert.throws(() => productReleaseHosts(product, value))
})
test('only the exact formal product tag can select publication', () => {
  assert.deepEqual(selectProductRelease({ product, releaseRef: `refs/tags/v${product.version}`, requireTag: true }), { version: product.version })
  for (const releaseRef of [undefined, 'refs/heads/main', `refs/tags/dsh-v${product.version}`, `refs/tags/v${product.version}-beta.1`, 'refs/tags/v999.0.0']) assert.throws(() => selectProductRelease({ product, releaseRef, requireTag: true }))
  assert.throws(() => selectProductRelease({ product, expectedVersion: '999.0.0' }))
})
test('product package metadata rejects old identity, aliases, beta and lifecycle changes', () => {
  const manifest = { name: product.name, version: product.version, bin: { [product.bin]: 'bin/yugoo-design.mjs' },
    repository: { type: 'git', url: 'git+https://github.com/alibaba-damo-academy/yugoo-design.git' },
    publishConfig: { access: 'public', tag: 'latest' }, engines: { node: '>=22.19.0' }, dependencies: { '@ladybugdb/wasm-core': '0.21.1' } }
  validateProductManifest(manifest, product.version)
  for (const change of [{ name: '@yugoo-design/companion' }, { bin: { 'design-system': 'bin/yugoo-design.mjs' } }, { publishConfig: { access: 'public', tag: 'beta' } },
    { scripts: { prepublishOnly: 'unexpected' } }, { repository: { type: 'git', url: 'https://example.invalid' } }, { engines: { node: '>=20' } }]) assert.throws(() => validateProductManifest({ ...manifest, ...change }, product.version))
})
test('packing preserves exact product identity, inventory and byte sizes', () => {
  const pack = { name: product.name, version: product.version, filename: `yugoo-design-${product.version}.tgz`, files: [{ path: 'package.json', size: 10 }] }
  validatePackInventory(pack, { 'package.json': { bytes: 10 } }, product.version)
  for (const changed of [{ ...pack, filename: 'companion.tgz' }, { ...pack, files: [] }, { ...pack, files: [{ path: 'package.json', size: 11 }] }]) assert.throws(() => validatePackInventory(changed, { 'package.json': { bytes: 10 } }, product.version))
})

test('product preparation forwards acquired native artifacts and stable identity to the actual builder call', () => {
  // Stop at the heavyweight build boundary; no compilation, packing or native host acceptance.
  const entry = new URL('./prepare-product-release.mjs', import.meta.url).href
  const mock = `import assert from 'node:assert/strict';
    export async function buildSameSourceCandidate(input) {
      assert.deepEqual(input, { ladybugDependency: '0.21.1', nativeGitArtifactRoot: '/owned/native-artifacts',
        candidate: { fixture: false, scope: '@yugoo-design', packageName: 'yugoo-design', version: ${JSON.stringify(product.version)}, distribution: 'stable' } });
      throw new Error('verified-native-builder-handoff');
    }
    export function verifyStagedUiCandidateAssociations() { throw new Error('unexpected association check'); }`
  const script = `import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    registerHooks({resolve(specifier, context, nextResolve) {
      if (specifier === './build-companion-npm-candidate.mjs' && context.parentURL === ${JSON.stringify(entry)})
        return {url: ${JSON.stringify('data:text/javascript,' + encodeURIComponent(mock))}, shortCircuit: true};
      return nextResolve(specifier, context);
    }});
    const {prepareProductArchive} = await import(${JSON.stringify(entry)});
    await assert.rejects(prepareProductArchive({version:${JSON.stringify(product.version)}, nativeArtifactRoot:'/owned/native-artifacts', output:'/owned/output', npmCli:'/owned/npm-cli.js'}), /^Error: verified-native-builder-handoff$/);`
  execFileSync(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] })
})
