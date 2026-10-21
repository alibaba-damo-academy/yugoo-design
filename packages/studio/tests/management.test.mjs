/** Keyless acceptance for the read-only Studio workspace view. */
import assert from 'node:assert/strict'
import { StudioManagementService } from '../lib/index.js'

function bundle(name, version, description) {
  return Object.freeze({ name, version, definition: Object.freeze({ name, version, description }) })
}

function kit(name, version, bundles) {
  return Object.freeze({
    name,
    version,
    definition: Object.freeze({ name, version, skills: bundles.map((entry) => entry.definition), resources: {} }),
    bundles: Object.freeze(bundles),
  })
}

const shared = bundle('shared', '1.0', 'Shared workflow capability')
const analysis = bundle('analysis', '1.0', 'Analysis capability')
const snapshot = Object.freeze({
  kits: Object.freeze([
    kit('kit_a', '1.0', [shared, analysis]),
    kit('kit_b', '1.0', [shared]),
  ]),
})
const service = new StudioManagementService({ async snapshot() { return snapshot } })

// The default workspace lists every Kit pin and the full Bundle catalog.
const all = await service.workspace()
assert.equal(all.query, '')
assert.deepEqual(all.kits, [
  { name: 'kit_a', version: '1.0' },
  { name: 'kit_b', version: '1.0' },
])
assert.deepEqual(all.bundles, [
  { name: 'analysis', version: '1.0', description: 'Analysis capability', usedBy: [{ name: 'kit_a', version: '1.0' }] },
  { name: 'shared', version: '1.0', description: 'Shared workflow capability', usedBy: [{ name: 'kit_a', version: '1.0' }, { name: 'kit_b', version: '1.0' }] },
])

// Queries trim, lowercase-match, and are echoed on the view.
const searched = await service.workspace('  SHARED  ')
assert.equal(searched.query, 'SHARED')
assert.deepEqual(searched.bundles.map((entry) => entry.name), ['shared'])
assert.deepEqual(searched.kits, all.kits, 'the Kit list is unfiltered')

// The view is JSON-only and deeply frozen; no definition object leaks.
const roundTrip = JSON.parse(JSON.stringify(all))
assert.deepEqual(roundTrip, all)
assert.ok(!JSON.stringify(all).includes('definition'))
assert.ok(Object.isFrozen(all) && Object.isFrozen(all.bundles[0]) && Object.isFrozen(all.bundles[0].usedBy[0]))

// An empty catalog renders empty lists, never undefined.
const empty = new StudioManagementService({ async snapshot() { return Object.freeze({ kits: Object.freeze([]) }) } })
const blank = await empty.workspace()
assert.deepEqual(blank.kits, [])
assert.deepEqual(blank.bundles, [])

console.log('DESIGN STUDIO READ-ONLY WORKSPACE OK')

const localized = new StudioManagementService({ async snapshot() { return { kits: [{ name: 'kit', version: '1', definition: { name: 'kit', version: '1', mindsetSource: '# Kit', resources: {}, skills: [] }, bundles: [{ name: 'questions', version: '1', definition: {
  name: 'questions', version: '1', description: 'Authoritative method routing remains English',
  title: { zh: '智能提问', en: 'Smart Questions' }, pickerDescription: { zh: '澄清产品意图', en: 'Clarify product intent' },
} }] }] } } })
const translated = await localized.workspace('澄清')
assert.equal(translated.bundles.length, 1)
assert.equal(translated.bundles[0].title.zh, '智能提问')
assert.equal(translated.bundles[0].displayDescription.en, 'Clarify product intent')
assert.equal(translated.bundles[0].description, 'Authoritative method routing remains English')
assert.ok(Object.isFrozen(translated.bundles[0].title))
assert.equal((await localized.workspace('智能')).bundles.length, 1)

const copy = { zh: '中文套件简介', en: 'Kit display introduction' }
const withKitCopy = new StudioManagementService({ async snapshot() { return { kits: [{ ...kit('kit_copy', '1', [shared]), definition: {
  description: 'Original routing', pickerDescription: copy, mindsetSource: '# my ORIGINAL body', resources: {}, skills: [],
} }] } } })
const copiedCatalog = await withKitCopy.workspace()
assert.deepEqual(copiedCatalog.kits[0].displayDescription, copy)
assert.equal(copiedCatalog.kits[0].description, 'Original routing')
assert.ok(Object.isFrozen(copiedCatalog.kits[0].displayDescription))
const copiedWorkspace = (await withKitCopy.readKitWorkspace('kit_copy', '1')).workspace
assert.deepEqual(copiedWorkspace.displayDescription, copy)
assert.equal(copiedWorkspace.mindsetSource, '# my ORIGINAL body')
