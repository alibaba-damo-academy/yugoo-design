import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import YAML from 'yaml'
import { latestPlan, verifyLatest, readPublishedMetadata, verifyPublicCompanion, assertCompleteDshPublication } from './npm-release-tags.mjs'
const name = '@yugoo-design/companion', releaseVersion = '0.1.0-beta.24'
const versions = ['0.1.0-beta.9', '0.1.0-beta.23', releaseVersion]
const metadata = (latest = '0.1.0-beta.23', extra = []) => ({ name, versions: Object.fromEntries([...versions, ...extra].map(version => [version, { name, version }])), 'dist-tags': { latest, beta: releaseVersion } })
test('latest advances to the highest public semver, including beta, and is idempotent', () => {
  const plan = latestPlan({ name, releaseVersion, metadata: metadata() })
  assert.equal(plan.action, 'update'); assert.equal(plan.latestVersion, releaseVersion)
  assert.equal(plan.beta, releaseVersion)
  assert.equal(latestPlan({ name, releaseVersion, metadata: metadata(releaseVersion) }).action, 'skip')
  assert.equal(latestPlan({ name, releaseVersion, metadata: metadata(releaseVersion, ['0.2.0-beta.1']) }).latestVersion, '0.2.0-beta.1')
  assert.equal(latestPlan({ name, releaseVersion, metadata: metadata(releaseVersion, ['0.1.0']) }).latestVersion, '0.1.0')
})
test('an old-tag retry never selects a lower version than an existing newer publication', () => {
  const newer = '0.1.0-beta.25', data = metadata(newer, [newer])
  assert.equal(latestPlan({ name, releaseVersion, metadata: data }).latestVersion, newer)
  assert.equal(latestPlan({ name, releaseVersion, metadata: data }).action, 'skip')
  const oldPlan = latestPlan({ name, releaseVersion, metadata: metadata() })
  assert.equal(verifyLatest(oldPlan, data).latestVersion, newer)
  assert.throws(() => verifyLatest(oldPlan, metadata('0.1.0-beta.23')), /highest currently published/)
  assert.throws(() => verifyLatest(oldPlan, { ...metadata(releaseVersion), 'dist-tags': { latest: releaseVersion, beta: '0.1.0-beta.23' } }), /preserve beta/)
})
test('missing release/beta, malformed versions and unavailable registry refuse a tag plan', async () => {
  for (const data of [{ ...metadata(), name: '@other/name' }, { ...metadata(), versions: [] },
    { ...metadata(), versions: { latest: { name, version: 'latest' } } },
    { ...metadata(), 'dist-tags': { latest: releaseVersion } },
    { ...metadata(), 'dist-tags': { latest: '0.1.0-beta.99', beta: releaseVersion } }]) assert.throws(() => latestPlan({ name, releaseVersion, metadata: data }))
  assert.throws(() => latestPlan({ name, releaseVersion: '0.1.0-beta.99', metadata: metadata() }), /Release must be published/)
  for (const status of [404, 403, 429, 500]) await assert.rejects(readPublishedMetadata(name, { fetchImpl: async () => ({ status }) }))
  await assert.rejects(readPublishedMetadata(name, { fetchImpl: async () => { throw Error('network failed') } }), /network failed/)
})
test('Companion publication verification hashes actual registry bytes and checks the fresh receipt when present', async () => {
  const bytes = Buffer.from('synthetic public archive'), integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64')
  const data = metadata(); data.versions[releaseVersion].dist = { integrity, tarball: `https://registry.npmjs.org/${name}/-/companion-${releaseVersion}.tgz` }
  const fetchImpl = async (_url, options) => { assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit'); return { status: 200, body: (async function* () { yield bytes })() } }
  await verifyPublicCompanion(data, releaseVersion, { fetchImpl })
  await verifyPublicCompanion(data, releaseVersion, { fetchImpl, expected: { bytes: bytes.length, integrity } })
  await assert.rejects(verifyPublicCompanion(data, releaseVersion, { fetchImpl, expected: { bytes: bytes.length, integrity: 'sha512-incorrect' } }), /integrity differs/)
  await assert.rejects(verifyPublicCompanion(data, releaseVersion, { fetchImpl: async () => ({ status: 200, body: (async function* () { yield Buffer.alloc(bytes.length) })() }) }), /Actual published Companion integrity differs/)
  data.versions[releaseVersion].dist.tarball = 'https://example.invalid/a.tgz'
  await assert.rejects(verifyPublicCompanion(data, releaseVersion, { fetchImpl }), /Official Companion/)
})
test('DSH tag stage requires completed verification for all ten archives', () => {
  const head = 'a'.repeat(40), receipt = { entries: Array.from({ length: 10 }, (_, i) => ({ name: 'fixture-' + i })) }
  const complete = { sourceCommit: head, states: receipt.entries.map(x => ({ name: x.name, version: releaseVersion, state: 'identical' })) }
  assertCompleteDshPublication(receipt, complete, head, releaseVersion)
  for (const bad of [{ ...complete, states: complete.states.slice(0, 4) }, { ...complete, sourceCommit: 'b'.repeat(40) },
    { ...complete, states: complete.states.map((x, i) => i ? x : { ...x, state: 'absent' }) }]) assert.throws(() => assertCompleteDshPublication(receipt, bad, head, releaseVersion))
})
test('only official publish jobs may mutate latest, after publication guards, retaining workflow identities', async () => {
  for (const chain of ['companion', 'dsh']) {
    const text = await readFile(new URL(`../.github/workflows/publish-${chain}.yml`, import.meta.url), 'utf8'), flow = YAML.parse(text)
    assert.deepEqual(flow.permissions, { contents: 'read' }); assert.equal(flow.jobs.dryrun.permissions, undefined)
    assert.deepEqual(flow.jobs.publish.permissions, { contents: 'read', 'id-token': 'write' })
    const steps = flow.jobs.publish.steps, tagIndex = steps.findIndex(x => x.run?.includes('npm dist-tag add'))
    assert.ok(tagIndex >= 0); assert.equal(steps[tagIndex].if, "github.job == 'publish'")
    assert.equal(steps[tagIndex].env.RELEASE_CHAIN, chain)
    assert.match(steps[tagIndex].run, /npm-release-tags.mjs plan/); assert.match(steps[tagIndex].run, /npm-release-tags.mjs confirm/)
    assert.match(steps[tagIndex].run, /npm dist-tag add .* latest --registry=https:\/\/registry.npmjs.org/u)
    assert.doesNotMatch(text, /dist-tag rm|dist-tag add .* beta |NPM_TOKEN|NODE_AUTH_TOKEN/)
    assert.ok(steps.findIndex(x => x.run?.includes('npm publish')) < tagIndex)
    if (chain === 'dsh') assert.ok(steps.findIndex(x => x.run?.includes('prepare-dsh-release.mjs complete')) < tagIndex)
    else {
      assert.equal(steps.find(x => x.run === 'git merge-base --is-ancestor HEAD origin/main').if, "github.job == 'publish'")
      assert.equal(steps.find(x => x.run?.includes('npm install --global npm@11.21.0')).if, undefined)
    }
  }
  const helper = await readFile(new URL('./npm-release-tags.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(helper, /spawnSync|dist-tag add|execFileSync\([^\n]*npm/)
})
