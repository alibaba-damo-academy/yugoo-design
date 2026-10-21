/** Keyless acceptance for flat Bundle discovery over a catalog snapshot. */
import assert from 'node:assert/strict'
import {
  buildStudioCompositionCatalog,
  searchStudioBundles,
} from '../lib/index.js'

function bundle(name, version, description) {
  return Object.freeze({ name, version, definition: Object.freeze({ name, version, description }) })
}

function kit(name, version, bundles) {
  return Object.freeze({
    name,
    version,
    definition: Object.freeze({ name, version }),
    bundles: Object.freeze(bundles),
  })
}

const shared = bundle('shared', '1.0', 'Shared workflow capability')
const analysis = bundle('analysis', '1.0', 'Analysis capability')
const snapshot = Object.freeze({
  kits: Object.freeze([
    kit('kit_a', '1.0', [shared, analysis]),
    kit('kit_b', '1.0', [shared]),
    kit('kit_a', '2.0', [analysis]),
  ]),
})

const catalog = buildStudioCompositionCatalog(snapshot)
assert.deepEqual(catalog.kits, [
  { name: 'kit_a', version: '1.0' },
  { name: 'kit_a', version: '2.0' },
  { name: 'kit_b', version: '1.0' },
], 'Kit pins are sorted by name then version')
assert.deepEqual(catalog.bundles.map((entry) => `${entry.name}@${entry.version}`), ['analysis@1.0', 'shared@1.0'])

const sharedEntry = catalog.bundles.find((entry) => entry.name === 'shared')
assert.deepEqual(sharedEntry.usedBy, [
  { name: 'kit_a', version: '1.0' },
  { name: 'kit_b', version: '1.0' },
], 'identical Bundle pins coalesce with sorted reverse dependencies')
assert.equal(sharedEntry.definition, shared.definition, 'the compiled definition is retained by reference')
console.log('the flat catalog coalesces Bundle pins and sorts reverse dependencies')

assert.deepEqual(searchStudioBundles(catalog, ''), catalog.bundles, 'an empty query returns the full catalog')
assert.deepEqual(searchStudioBundles(catalog, '  SHARED  ').map((entry) => entry.name), ['shared'], 'search is trimmed and case-insensitive')
assert.deepEqual(searchStudioBundles(catalog, 'analysis cap').map((entry) => entry.name), ['analysis'], 'search matches descriptions')
assert.deepEqual(searchStudioBundles(catalog, 'absent'), [], 'a non-matching query returns no entries')
assert.ok(Object.isFrozen(catalog) && Object.isFrozen(catalog.bundles[0]))

console.log('DESIGN STUDIO COMPOSITION CATALOG OK')

const independent = bundle('unmounted', '1.0', 'Independent capability')
const independentSnapshot = { ...snapshot, bundles: [shared, analysis, independent] }
const independentCatalog = buildStudioCompositionCatalog(independentSnapshot)
assert.deepEqual(independentCatalog.bundles.find(entry => entry.name === 'unmounted').usedBy, [])
const afterKitRemoval = buildStudioCompositionCatalog({ kits: [], bundles: independentSnapshot.bundles })
assert.deepEqual(afterKitRemoval.bundles.map(entry => entry.name), ['analysis', 'shared', 'unmounted'],
  'removing every Kit must not remove independently registered Bundles')
assert.ok(afterKitRemoval.bundles.every(entry => entry.usedBy.length === 0))
assert.equal(afterKitRemoval.bundles.find(entry => entry.name === 'shared').definition, shared.definition)
assert.throws(() => buildStudioCompositionCatalog({ ...snapshot, bundles: [independent] }), /studio.missing_bundle/,
  'Kit membership cannot silently register missing independent content')
assert.throws(() => buildStudioCompositionCatalog({ kits: [], bundles: [shared, shared] }), /studio.duplicate_bundle/,
  'duplicate independent identities must be resolved by the content authority')
console.log('DESIGN STUDIO INDEPENDENT BUNDLE CATALOG OK')
