import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createAdvisoryEvidence } from '../src/advisory-evidence.ts'

const signal = () => new AbortController().signal
async function fixture(count = 33) {
  const metadata = { kind: 'dsh-design-project', formatVersion: 3, id: randomUUID(), name: 'Large exact Kit',
    createdAt: '2026-10-18T00:00:00.000Z', knowledge: { provider: 'ladybug-wasm' }, kit: { name: 'fixture', version: '1.0' } }
  const skills = Array.from({ length: count }, (_, i) => ({ name: `bundle_${i}`, version: '1.0', content: 'Method', metadata: {} }))
  const definitions = new Map(skills.map(skill => [skill.name, { skill, resources: Object.fromEntries(
    Array.from({ length: 40 }, (_, j) => [`reference/complete-domain-method-${j}.md`, `Original ${skill.name} resource ${j}`])) }]))
  const evidence = await createAdvisoryEvidence({ commit: 'a'.repeat(40), projectId: metadata.id, signal: signal(),
    git: { listPathsAt: async () => ['project.json', 'design_files/bundle_0/bundle_0.json'],
      readBytesAt: async (_commit, path) => Buffer.from(path === 'project.json' ? JSON.stringify(metadata) : '{"fact":"saved"}') },
    resolveKit: () => ({ name: 'fixture', version: '1.0', resources: {}, skills }), resolveBundle: pin => definitions.get(pin.name) })
  return { evidence, definitions, metadata }
}

test('large resource indexes remain completely discoverable through bounded pinned pages', async () => {
  const { evidence, definitions, metadata } = await fixture()
  assert.ok(Buffer.byteLength(JSON.stringify(evidence.manifest)) <= 131072)
  assert.equal(evidence.manifest.discovery.complete, false)
  assert.equal(evidence.manifest.discovery.bundles, 33)
  const revision = evidence.manifest.discovery.manifestRevision
  const readAll = (kind, bundle) => {
    let offset = 0; const all = []
    for (;;) {
      const page = evidence.discover({ kind, bundle, offset, limit: 100 }, signal())
      assert.equal(page.manifestRevision, revision)
      assert.equal(page.project, metadata.id); assert.equal(page.checkpoint, 'a'.repeat(40))
      assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 131072)
      all.push(...page.entries)
      if (page.complete) { assert.equal(page.nextOffset, null); return all }
      assert.ok(page.nextOffset > offset); offset = page.nextOffset
    }
  }
  assert.deepEqual(readAll('files'), ['project.json', 'design_files/bundle_0/bundle_0.json'])
  const pins = readAll('bundles'); assert.equal(pins.length, 33)
  let total = 0
  for (const pin of pins) {
    assert.equal(pin.version, '1.0')
    const entries = readAll('resources', pin.bindingKey)
    assert.equal(entries.length, pin.resourceCount)
    for (const entry of entries) {
      const original = definitions.get(pin.bindingKey).resources[entry.path] ?? 'Method'
      assert.equal(entry.sha256, createHash('sha256').update(original).digest('hex'))
    }
    total += entries.length
  }
  assert.equal(total, evidence.manifest.discovery.resources)
  definitions.get('bundle_32').resources['reference/complete-domain-method-39.md'] = 'later live change'
  const last = evidence.resource('bundle_32', 'reference/complete-domain-method-39.md', 0, 12000, signal())
  assert.equal(last.content, 'Original bundle_32 resource 39')
})

test('discovery rejects invalid scope/cursors, obeys cancellation and shares the read budget', async () => {
  const { evidence } = await fixture()
  for (const options of [ { kind: 'resources', bundle: 'foreign' }, { kind: 'files', offset: -1 },
    { kind: 'files', offset: 3 }, { kind: 'files', limit: 101 }, { kind: 'files', prefix: '../private' },
    { kind: 'bundles', bundle: 'bundle_0' }, { kind: 'invalid' } ]) {
    assert.throws(() => evidence.discover(options, signal()))
  }
  const aborted = new AbortController(); aborted.abort()
  assert.throws(() => evidence.discover({ kind: 'bundles' }, aborted.signal))
  const one = await fixture(1)
  for (let i = 0; i < 256; i++) one.evidence.discover({ kind: 'bundles' }, signal())
  assert.throws(() => one.evidence.discover({ kind: 'bundles' }, signal()), /read budget exhausted/)
  assert.throws(() => one.evidence.resource('bundle_0', 'SKILL.md', 0, 12000, signal()), /read budget exhausted/)
})
