/** One stable product identity/version authority; usable before dependency installation. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const PRODUCT_NAME = 'yugoo-design'
export function validateReleaseVersion(version) {
  assert.match(version ?? '', /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u, 'Exact canonical stable product version required')
  assert.ok(version.length <= 256 && version.split('.').every(part => Number.isSafeInteger(Number(part))), 'Stable version components exceed canonical semver bounds')
  return version
}
export function validateProductRelease(product) {
  assert.ok(product && typeof product === 'object' && !Array.isArray(product), 'Product release object required')
  assert.deepEqual(Object.keys(product).sort(), ['bin', 'name', 'schemaVersion', 'version'])
  assert.equal(product.schemaVersion, 1); assert.equal(product.name, PRODUCT_NAME); assert.equal(product.bin, PRODUCT_NAME)
  validateReleaseVersion(product.version)
  return structuredClone(product)
}
export async function readProductRelease(root) {
  return validateProductRelease(JSON.parse(await readFile(join(root, 'release/product.json'), 'utf8')))
}
export function productReleaseHosts(product, sourceHosts) {
  validateProductRelease(product)
  assert.deepEqual(Object.keys(sourceHosts).sort(), ['hosts', 'schemaVersion'], 'Source hosts contain only host configuration')
  assert.equal(sourceHosts.schemaVersion, 1)
  assert.equal(sourceHosts.hosts?.dsh?.aggregatePackage, '@yugoo-design/dsh-design-system-dsh')
  assert.equal(sourceHosts.hosts.dsh.registry, 'https://registry.npmjs.org')
  assert.ok(!Object.hasOwn(sourceHosts.hosts.dsh, 'aggregateVersion'), 'Source hosts must not own a second release version')
  const bound = structuredClone(sourceHosts)
  bound.hosts.dsh.aggregateVersion = product.version
  return bound
}
export function selectProductRelease({ product, expectedVersion, releaseRef, requireTag = false }) {
  validateProductRelease(product)
  if (expectedVersion !== undefined && expectedVersion !== '') assert.equal(validateReleaseVersion(expectedVersion), product.version, 'Expected version must match release/product.json')
  assert.equal(typeof requireTag, 'boolean')
  assert.ok(releaseRef === undefined || releaseRef === '' || typeof releaseRef === 'string' && /^refs\/(?:heads|tags)\//u.test(releaseRef), 'Expected branch or tag ref')
  if (requireTag || releaseRef?.startsWith('refs/tags/')) assert.equal(releaseRef, `refs/tags/v${product.version}`, 'Product tag must match release/product.json exactly')
  return { version: product.version }
}
