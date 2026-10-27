import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import YAML from 'yaml'
import { DSH_SOURCE_PACKAGES, REGISTRY, REPOSITORY, integrity, sha256, selectDshRelease, publicationOrder, registryState, preflight, nextPublication, confirmPublication, verifyDshReceipt } from './prepare-dsh-release.mjs'

const version = '0.1.0-beta.9'
const bytes = Buffer.from('synthetic archive; no product/Host acceptance')
const entries = () => DSH_SOURCE_PACKAGES.map((sourceName, index) => ({ sourceName, name: '@yugoo-design/' + sourceName, version,
  filename: 'yugoo-design-' + sourceName + '-' + version + '.tgz', bytes: bytes.length, sha256: sha256(bytes), integrity: integrity(bytes),
  dependencies: index ? ['@yugoo-design/' + DSH_SOURCE_PACKAGES[index - 1]] : [] }))
const manifest = { schemaVersion: 1, hosts: { dsh: { aggregatePackage: '@yugoo-design/dsh-design-system-dsh', aggregateVersion: version, registry: REGISTRY } } }
function registry(states = new Map(), mutate = {}) {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push(String(url)); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit')
    assert.ok(options.signal instanceof AbortSignal)
    const entry = entries().find(x => String(url).includes(encodeURIComponent(x.name)) || String(url).includes('/' + x.name + '/-/'))
    assert.ok(entry, String(url))
    if (String(url).endsWith('.tgz')) return { status: mutate.tarStatus ?? 200, body: (async function* () { yield mutate.bytes ?? bytes })() }
    const state = states.get(entry.name) ?? 'absent'
    if (state === 'error') throw Error('network failed')
    if (state === 'absent') return { status: 404 }
    return { status: mutate.status ?? 200, json: async () => ({ name: mutate.name ?? entry.name, version: mutate.version ?? version,
      dist: { integrity: mutate.integrity ?? entry.integrity, tarball: mutate.tarball ?? `${REGISTRY}/${entry.name}/-/${entry.sourceName}-${version}.tgz` } }) }
  }
  return { fetchImpl, calls }
}
test('DSH version comes only from the existing host manifest and exact DSH tag', () => {
  assert.deepEqual(selectDshRelease({ manifest }), { version })
  assert.deepEqual(selectDshRelease({ manifest, expectedVersion: version, releaseRef: `refs/tags/dsh-v${version}`, requireTag: true }), { version })
  for (const releaseRef of [undefined, 'refs/heads/main', `refs/tags/v${version}`, 'refs/tags/dsh-v0.1.0-beta.8', `refs/tags/dsh-v${version}\n`]) assert.throws(() => selectDshRelease({ manifest, releaseRef, requireTag: true }))
  for (const expectedVersion of ['latest', '0.1.0-beta.8', '$(id)', version + '\n']) assert.throws(() => selectDshRelease({ manifest, expectedVersion }))
  assert.throws(() => selectDshRelease({ manifest: { ...manifest, hosts: { dsh: { ...manifest.hosts.dsh, registry: 'https://example.invalid' } } } }))
})
test('all ten form a strict dependency DAG and aggregate is last', () => {
  assert.deepEqual(publicationOrder([...entries()].reverse()), entries())
  for (const rows of [entries().slice(1), [...entries(), entries()[0]], entries().map((x, i) => i ? x : { ...x, dependencies: [entries().at(-1).name] }), entries().map((x, i) => i ? x : { ...x, version: '0.1.0-beta.8' })]) assert.throws(() => publicationOrder(rows))
})
test('only 404 means absent; skip requires metadata AND actual tarball integrity', async () => {
  const entry = entries()[0]
  assert.equal(await registryState(entry, registry()), 'absent')
  const states = new Map([[entry.name, 'identical']])
  const normal = registry(states)
  assert.equal(await registryState(entry, normal), 'identical'); assert.equal(normal.calls.length, 2)
  for (const mutate of [{ status: 403 }, { status: 503 }, { name: '@other/a' }, { version: '0.1.0-beta.8' },
    { integrity: integrity(Buffer.from('other')) }, { bytes: Buffer.alloc(bytes.length) }, { bytes: Buffer.alloc(bytes.length - 1) },
    { bytes: Buffer.alloc(bytes.length + 1) }, { tarStatus: 404 }, { tarball: 'https://example.invalid/package.tgz' },
    { tarball: `${REGISTRY}/@yugoo-design/yugoo-design-git-native/-/other.tgz` },
    { tarball: `${REGISTRY}/${entry.name}/-/${entry.sourceName}-${version}.tgz?token=unexpected` }]) {
    await assert.rejects(registryState(entry, registry(states, mutate)))
  }
  await assert.rejects(registryState(entry, registry(new Map([[entry.name, 'error']]))), /network failed/)
})
test('partial publication preflights all ten before returning a plan', async () => {
  const rows = entries(), states = new Map(rows.slice(0, 4).map(x => [x.name, 'identical']))
  const normal = registry(states)
  const plan = await preflight(rows, normal)
  assert.equal(plan.filter(x => x.state === 'identical').length, 4)
  assert.equal(plan.filter(x => x.state === 'absent').length, 6)
  assert.equal(normal.calls.length, 14)
  states.set(rows[9].name, 'error')
  await assert.rejects(preflight(rows, registry(states)), /network failed/)
})
test('a dependent cannot publish until exact dependencies are visible; retries skip identical entries', async () => {
  const rows = entries(), receipt = { entries: rows }, states = new Map()
  await assert.rejects(nextPublication(receipt, 1, registry(states)), /Required dependency is not published/)
  assert.equal((await nextPublication(receipt, 0, registry(states))).action, 'publish')
  states.set(rows[0].name, 'identical')
  assert.equal((await nextPublication(receipt, 0, registry(states))).action, 'skip')
  assert.equal((await nextPublication(receipt, 1, registry(states))).action, 'publish')
  let waits = 0
  await confirmPublication(rows[1], { ...registry(states), wait: async () => { waits++; states.set(rows[1].name, 'identical') } })
  assert.equal(waits, 1)
  await assert.rejects(confirmPublication(rows[2], { ...registry(states), attempts: 2, wait: async () => {} }), /stop without republishing/)
})
test('archive receipt rejects changed source, bytes, paths or publication order', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ci-guard-')); t.after(() => rm(root, { recursive: true, force: true }))
  const folder = join(root, 'distribution/tarballs'); await mkdir(folder, { recursive: true })
  const sourceCommit = 'a'.repeat(40), rows = entries()
  for (const entry of rows) await writeFile(join(folder, entry.filename), bytes)
  const receipt = { kind: 'dsh-same-source-release', sourceCommit, registry: REGISTRY, version, entries: rows, published: false }
  const file = join(root, 'release-receipt.json'); await writeFile(file, JSON.stringify(receipt))
  await verifyDshReceipt(file, { sourceCommit })
  await assert.rejects(verifyDshReceipt(file, { sourceCommit: 'b'.repeat(40) }), /source commit changed/)
  for (const bad of [{ ...receipt, entries: [...rows].reverse() }, { ...receipt, entries: rows.map((x, i) => i ? x : { ...x, filename: '../bad.tgz' }) }]) {
    await writeFile(file, JSON.stringify(bad)); await assert.rejects(verifyDshReceipt(file, { sourceCommit }))
  }
  await writeFile(file, JSON.stringify(receipt)); await writeFile(join(folder, rows[0].filename), Buffer.alloc(bytes.length))
  await assert.rejects(verifyDshReceipt(file, { sourceCommit }), /Prepared tarball changed/)
})
test('DSH workflow has independent triggers, fixed-source fences and GHA-only OIDC publication', async () => {
  const text = await readFile(new URL('../.github/workflows/publish-dsh.yml', import.meta.url), 'utf8')
  const flow = YAML.parse(text)
  assert.deepEqual(flow.on.push.tags, ['dsh-v*-beta.*'])
  assert.deepEqual(flow.permissions, { contents: 'read' })
  assert.equal(flow.jobs.dryrun.permissions, undefined)
  assert.deepEqual(flow.jobs.publish.permissions, { contents: 'read', 'id-token': 'write' })
  assert.match(flow.jobs.publish.if, new RegExp(REPOSITORY))
  for (const repository of [REPOSITORY, 'example/fork']) for (const ref of ['refs/heads/main', `refs/tags/dsh-v${version}`, `refs/tags/v${version}`, 'refs/tags/dsh-v999.0.0-beta.1']) {
    for (const event_name of ['push', 'workflow_dispatch', 'pull_request']) for (const publish of [undefined, false, true]) {
      const selected = Object.entries(flow.jobs).filter(([, job]) => new Function('github', 'inputs', 'startsWith', `return (${job.if})`)({ repository, ref, event_name }, { publish }, (value, prefix) => value.startsWith(prefix))).map(([id]) => id)
      const expected = repository !== REPOSITORY ? [] : event_name === 'workflow_dispatch'
        ? [publish && ref.startsWith('refs/tags/dsh-v') ? 'publish' : 'dryrun'] : event_name === 'push' && ref.startsWith('refs/tags/dsh-v') ? ['publish'] : []
      assert.deepEqual(selected, expected)
    }
  }
  assert.equal(flow.jobs.publish.steps, flow.jobs.dryrun.steps)
  const steps = flow.jobs.publish.steps
  const selector = steps.findIndex(x => x.id === 'release'), fence = steps.findIndex(x => x.run?.includes('merge-base --is-ancestor HEAD origin/main'))
  const install = steps.findIndex(x => x.run?.includes('pnpm install')), preflightStep = steps.findIndex(x => x.run?.includes('prepare-dsh-release.mjs preflight'))
  const publish = steps.findIndex(x => x.run?.includes('npm publish'))
  assert.ok(selector < fence && fence < install && install < preflightStep && preflightStep < publish)
  assert.match(steps[fence].run, /GITHUB_SHA/)
  assert.equal(steps[publish].if, "github.job == 'publish'")
  assert.match(steps[publish].run, /npm publish "\$tarball" --ignore-scripts --access public --tag beta --registry=https:\/\/registry.npmjs.org/)
  assert.match(steps[publish].run, /prepare-dsh-release.mjs next/)
  assert.match(steps[publish].run, /prepare-dsh-release.mjs confirm/)
  assert.doesNotMatch(text, /NODE_AUTH_TOKEN|NPM_TOKEN|dist-tag rm|unpublish|continue-on-error/)
  const companion = YAML.parse(await readFile(new URL('../.github/workflows/publish-companion.yml', import.meta.url), 'utf8'))
  assert.deepEqual(companion.on.push.tags, ['v*-beta.*'])
  assert.match(companion.jobs.publish.steps.find(x => x.run?.includes('npm publish')).run, /RELEASE_TARBALL/)
  const helper = await readFile(new URL('./prepare-dsh-release.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(helper, /spawnSync\([^\n]+['"]publish['"]|execFileSync\([^\n]+['"]publish['"]/)
})
