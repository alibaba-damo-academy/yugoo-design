/** Official native SDK plus actual retained S1; scripted model, no real Host/model acceptance. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
// The shared fixture installs the exact official graph before importing SDK or
// Core-dependent services. It preserves the original H2 context/storage setup.
import { fixture as sdkFixture, call, stop, deferred } from './fixtures/authoring-sdk.mjs'

const { createStudioAuthoringSession } = await import(process.env.STUDIO_AUTHORING_AGENT_BUILT === '1' ? '../lib/authoring-session.js' : '../src/authoring-session.ts')
const { createStudioInstances } = await import('../../companion/src/studio-instances.mjs')
const { createStudioInstanceAdapters } = await import('dsh-design-studio/node')
const { adapters, additions, originalFiles, textOf, pin } = await import('../../companion/test/fixtures/studio-changes-fixture.mjs')
const { PANEL_COMPONENT_CATALOG, GENERATED_COMPONENT_KINDS } = await import('../../core/src/panel-component-catalog.ts')
const catalog = () => ({ components: Object.entries(PANEL_COMPONENT_CATALOG).map(([name, entry]) => ({ name,
  description: entry.description, sourceBound: entry.sourceBound === true, ownsWorkspace: entry.ownsWorkspace === true,
  generated: GENERATED_COMPONENT_KINDS.includes(name) })) })
const sequence = (changes, n) => [call('studio_authoring_read', {}), call('studio_authoring_prepare', { changes }), stop()][n % 3]

test('repeated native prepares replace the whole unsaved proposal against the same saved revision', { timeout: 15000 }, async t => {
  const first = additions(), partial = [{ ...first[0], content: first[0].content.replace('review, closed', 'review, blocked, closed') }]
  const complete = [partial[0], ...first.slice(1)]
  const f = await fixture(t, { step: n => n < 3 ? call('studio_authoring_prepare', { changes: [first, partial, complete][n] }) : stop() })
  const run = await f.bridge.start(f.request)
  assert.equal((await run.result).status, 'completed'); assert.equal(f.candidates.length, 3)
  for (const [index, changes] of [first, partial, complete].entries()) {
    const prepared = f.candidates[index]
    assert.deepEqual(prepared.request.changes, changes)
    assert.equal(prepared.request.expectedRevision, 0); assert.equal(prepared.candidate.baseRevision, 0); assert.equal(prepared.candidate.revision, 1)
    assert.deepEqual(prepared.candidate.diff.map(file => file.path).sort(), changes.map(file => file.path).sort())
  }
  assert.equal(f.candidates[1].candidate.diff.some(file => file.path === 'panel.yaml'), false, 'a later partial proposal does not inherit earlier unsaved files')
  assert.deepEqual(f.bridge.readPrepared(run.reference), f.candidates[2])
  assert.equal((await f.instances.read(f.record.id)).revision, 0)
  assert.equal((await f.instances.readFile({ id: f.record.id, path: 'panel.yaml' })).content, textOf(originalFiles, 'panel.yaml'))
})

async function fixture(t, options = {}) {
  const sdk = await sdkFixture(t, { step: n => sequence(additions(), n), ...options })
  const storage = { stateRoot: join(sdk.root, 'source-state'), ...adapters() }
  const instances = await createStudioInstances(storage), record = await instances.copy({ kind: 'bundle', bundle: pin })
  const workspaceRoot = join(sdk.root, 'isolated-authoring'); await mkdir(workspaceRoot)
  const retained = [], candidates = []
  const bridgeOptions = { ctx: sdk.ctx, parent: sdk.parent.agent, instances, readComponents: catalog, workspaceRoot,
    retainReference: ref => { retained.push(structuredClone(ref)) } }
  const bridge = createStudioAuthoringSession(bridgeOptions); t.after(() => bridge.dispose())
  const request = { invocationId: randomUUID(), id: record.id, expectedRevision: record.revision,
    paths: additions().map(change => change.path), prompt: 'Add a review status to this exact working copy.',
    onPrepared: value => candidates.push(value) }
  return { ...sdk, storage, instances, record, retained, candidates, bridgeOptions, bridge, request }
}

test('actual S1 candidate and native completion stay distinct across two explicit revisions, user save and fresh reopen', { timeout: 15000 }, async t => {
  const prepared = deferred(), finish = deferred(); t.after(() => finish.resolve())
  const f = await fixture(t, { async step(n) { if (n === 2) await finish.promise; return sequence(additions(), n) } })
  const run = await f.bridge.start({ ...f.request, onPrepared: value => { f.candidates.push(value); prepared.resolve() } })
  await prepared.promise
  assert.equal(f.retained.length, 1); assert.deepEqual(f.retained[0], run.reference)
  assert.equal((await run.observe()).status, 'running')
  const candidate = f.bridge.readPrepared(run.reference)
  assert.deepEqual(candidate, f.candidates[0]); assert.equal(candidate.candidate.valid, true)
  assert.deepEqual(candidate.request.changes, additions())
  assert.equal(candidate.request.bundle.name, f.record.bundle.name)
  assert.equal((await f.instances.read(f.record.id)).revision, 0, 'native prepare never saves')
  finish.resolve(); assert.equal((await run.result).status, 'completed')
  assert.ok(f.seen.every(names => names.length === 2 && names.includes('studio_authoring_read') && names.includes('studio_authoring_prepare')))
  const saved = await f.instances.saveChanges({ ...candidate.request, mode: 'validated', digest: candidate.candidate.digest })
  const reopened = await createStudioInstances(f.storage)
  for (const change of additions()) assert.equal((await reopened.readFile({ id: saved.id, path: change.path })).content, change.content)
  const second = await f.bridge.resume({ ...f.request, invocationId: randomUUID(), expectedRevision: saved.revision,
    previous: run.reference, explicit: true, prompt: 'Review the saved status and refine the current source.' })
  assert.equal(second.reference.sessionId, run.reference.sessionId); assert.notEqual(second.reference.epoch, run.reference.epoch)
  assert.equal((await second.result).status, 'completed')
  const next = second.readPrepared(); assert.equal(next.candidate.baseRevision, saved.revision)
  const savedAgain = await reopened.saveChanges({ ...next.request, mode: 'validated', digest: next.candidate.digest })
  assert.equal(savedAgain.revision, 2)
  assert.equal((await (await createStudioInstances(f.storage)).read(saved.id)).revision, 2)
  assert.equal((await f.bridge.observe(run.reference)).turn, (await run.result).turn)
})

test('actual instance revision, noneditable paths and Bundle pin reject before native admission', { timeout: 15000 }, async t => {
  const f = await fixture(t)
  for (const delta of [
    { expectedRevision: 99 }, { paths: ['reference/preserved.bin'] },
    { paths: ['../schema.yaml'] }, { paths: ['schema.yaml', 'schema.yaml'] }, { bundle: pin },
  ]) await assert.rejects(f.bridge.start({ ...f.request, ...delta }))
  await assert.rejects(f.bridge.start({ ...f.request, id: randomUUID() }))
  assert.equal(f.childIds.length, 0); assert.equal(f.calls(), 0); assert.equal(f.retained.length, 0)
  assert.equal(f.bridge.save, undefined)
})

test('a blank Kit owns a new native authoring session without selecting a mounted Bundle', { timeout: 15000 }, async t => {
  let changes = []
  const f = await fixture(t, { step: n => sequence(changes, n) })
  const kit = await f.instances.create({ kind: 'kit', title: { zh: '独立方法', en: 'Independent method' } })
  assert.deepEqual(kit.mounts, [])
  const method = await f.instances.readFile({ id: kit.id, path: 'mindset.md' })
  changes = [{ path: 'mindset.md', content: method.content + '\nExplain the decisions this Kit helps people make.\n' }]
  const run = await f.bridge.start({ ...f.request, id: kit.id, expectedRevision: kit.revision,
    paths: ['mindset.md'], prompt: 'Clarify this exact new Kit method. Prepare only; do not add a Bundle.' })
  await run.result
  assert.notEqual(run.reference.sessionId, String(f.parent.agent.id))
  assert.equal(run.reference.scope.id, kit.id)
  assert.equal(run.reference.scope.bundle, undefined)
  assert.deepEqual(run.reference.scope.allowedPaths, ['mindset.md'])
  const proposed = run.readPrepared()
  assert.ok(proposed, 'the actual scoped S3 prepare port accepts Kit-owned source')
  assert.equal(proposed.request.bundle, undefined)
  assert.deepEqual(proposed.request.changes, changes)
  assert.equal(proposed.candidate.preview, undefined, 'no mounted Bundle was fabricated for Panel preview')
  assert.equal((await f.instances.read({ id: kit.id })).revision, kit.revision)
  const saved = await f.instances.saveChanges({ ...proposed.request, digest: proposed.candidate.digest, mode: 'draft' })
  assert.equal(saved.revision, kit.revision + 1)
  assert.equal((await f.instances.readFile({ id: kit.id, path: 'mindset.md' })).content, changes[0].content)
  assert.deepEqual((await f.instances.read({ id: kit.id })).mounts, [])
})

test('an actual blank Bundle can prepare unfinished source, then repair it in its exact native scope and save/reopen', { timeout: 20000 }, async t => {
  let changes = []
  const f = await fixture(t, { step: n => sequence(changes, n) })
  const blank = await f.instances.create({ kind: 'bundle', title: { zh: '观察方法', en: 'Observation method' } })
  const method = await f.instances.readFile({ id: blank.id, path: 'SKILL.md' })
  const paths = blank.files.filter(file => file.editable).map(file => file.path)
  const input = { ...f.request, id: blank.id, expectedRevision: blank.revision, bundle: blank.bundle, paths }
  const initialPreview = await f.instances.preview({ id: blank.id, expectedRevision: blank.revision })
  assert.equal(initialPreview.preview, undefined)
  assert.match(JSON.stringify(initialPreview.diagnostics), /rules must not be empty/)
  assert.doesNotMatch(JSON.stringify(initialPreview.diagnostics), /label must be/)
  await assert.rejects(f.bridge.start({ ...input, bundle: pin }), /exact Bundle/)
  assert.equal(f.childIds.length, 0)
  changes = [{ path: method.path, content: method.content + '\nProposed domain method.\n' }]
  const first = await f.bridge.start(input)
  await first.result
  assert.deepEqual(first.reference.scope.bundle, blank.bundle)
  assert.deepEqual(first.reference.scope.allowedPaths, paths)
  const invalid = first.readPrepared()
  assert.equal(invalid.candidate.valid, false)
  await assert.rejects(f.instances.saveChanges({ ...invalid.request, digest: invalid.candidate.digest, mode: 'validated' }), /failed Core preview/)
  assert.equal((await f.instances.read(blank.id)).revision, 0)
  const draft = await f.instances.saveFile({ id: blank.id, expectedRevision: 0, path: method.path, content: method.content + '\nUser-owned saved draft.\n' })
  assert.equal(draft.createdBlank, true); assert.equal(draft.revision, 1)
  const panel = textOf(originalFiles, 'panel.yaml')
    .replace('i18n:\n  default_locale: zh-CN\n  locales: {zh-CN: locales/zh-CN.json, en-US: locales/en-US.json}\n', '')
    .replaceAll('$t:', '')
  changes = ['SKILL.md', 'schema.yaml', 'validation.yaml', 'reference/preview.json'].map(path => ({
    path, content: textOf(originalFiles, path).replaceAll('observations', blank.bundle.name),
  }))
  changes.push({ path: 'panel.yaml', content: panel },
    { path: 'reference/output-contract.md', content: '# Observation output\nPreserve supplied observation text and its declared status.\n' })
  const resumed = await f.bridge.resume({ ...input, invocationId: randomUUID(), expectedRevision: draft.revision,
    previous: first.reference, explicit: true, prompt: 'Finish this same Bundle definition using the supplied observation fixture.' })
  await resumed.result
  const repaired = resumed.readPrepared()
  assert.equal(repaired.candidate.valid, true, JSON.stringify(repaired.candidate.diagnostics))
  assert.ok(repaired.candidate.preview)
  const saved = await f.instances.saveChanges({ ...repaired.request, digest: repaired.candidate.digest, mode: 'validated' })
  assert.equal(saved.changeReceipt.validation, 'preview_passed')
  const reopened = await createStudioInstances(f.storage)
  assert.equal((await reopened.read(saved.id)).revision, 2)
  for (const change of changes) assert.equal((await reopened.readFile({ id: saved.id, path: change.path })).content, change.content)
})

test('concurrent human save remains authoritative and native preparation cannot project or overwrite the old revision', { timeout: 15000 }, async t => {
  const entered = deferred(), release = deferred(); t.after(() => release.resolve())
  const f = await fixture(t, { async step(n) { if (n === 1) { entered.resolve(); await release.promise } return sequence(additions(), n) } })
  const run = await f.bridge.start(f.request); await entered.promise
  await f.instances.saveFile({ id: f.record.id, expectedRevision: 0, path: 'SKILL.md', content: 'Human edit is retained.' })
  release.resolve(); await run.result
  assert.equal(f.candidates.length, 0); assert.equal(run.readPrepared(), undefined)
  assert.ok(f.toolResults.some(result => result.name === 'studio_authoring_prepare' && result.isError))
  assert.equal((await f.instances.readFile({ id: f.record.id, path: 'SKILL.md' })).content, 'Human edit is retained.')
  assert.equal((await f.instances.readFile({ id: f.record.id, path: 'schema.yaml' })).content, textOf(originalFiles, 'schema.yaml'))
})

test('parent/reference identity, cold observation and explicit new-input resume never grant foreign control or replay unknown delivery', { timeout: 15000 }, async t => {
  const f = await fixture(t), run = await f.bridge.start(f.request); await run.result
  const cold = createStudioAuthoringSession(f.bridgeOptions); t.after(() => cold.dispose())
  assert.equal((await cold.observe(run.reference)).status, 'completed')
  assert.throws(() => cold.cancel(run.reference, { expectedTurn: null }), /exact owned/)
  const foreign = { ...run.reference, parentSessionId: randomUUID() }
  await assert.rejects(cold.observe(foreign), /another native parent/)
  await assert.rejects(cold.resume({ ...f.request, previous: foreign, explicit: true }), /another native parent/)
  const unknown = { ...run.reference, messageId: randomUUID() }, calls = f.calls(), children = f.childIds.length
  assert.equal((await cold.observe(unknown)).status, 'unknown')
  await assert.rejects(cold.resume({ ...f.request, previous: unknown, explicit: true }), /unconsumed or unknown/)
  assert.throws(() => f.bridge.cancel(unknown, { expectedTurn: null }), /differs/)
  assert.throws(() => f.bridge.resume({ ...f.request, previous: run.reference, explicit: false }), /explicit/)
  assert.equal(f.calls(), calls); assert.equal(f.childIds.length, children)
  await f.parent.dispose()
  await assert.rejects(f.bridge.observe(run.reference), /disconnected/)
  assert.throws(() => f.bridge.cancel(run.reference, { expectedTurn: null }), /disconnected/)
})

test('parent-bound cancellation fences the actual turn and preserves user content', { timeout: 15000 }, async t => {
  const entered = deferred()
  const f = await fixture(t, { async step(_n, request) { entered.resolve(); await new Promise(resolve => request.signal.addEventListener('abort', resolve, { once: true })); return stop() } })
  const run = await f.bridge.start(f.request); await entered.promise
  const state = await f.bridge.observe(run.reference)
  assert.throws(() => f.bridge.cancel(run.reference, { expectedTurn: state.turn + 1 }), /turn changed/)
  const ended = await f.bridge.cancel(run.reference, { expectedTurn: state.turn })
  assert.equal(ended.status, 'cancelled'); assert.equal(ended.terminal, true)
  assert.equal(f.ctx.agents.get(f.parent.agent.id), f.parent.agent)
  assert.equal((await f.instances.read(f.record.id)).revision, 0)
})

test('source selection, prompt and callbacks are captured before the first metadata await', { timeout: 15000 }, async t => {
  const f = await fixture(t), entered = deferred(), release = deferred(); t.after(() => release.resolve())
  const read = f.instances.read.bind(f.instances)
  const bridge = createStudioAuthoringSession({ ...f.bridgeOptions, instances: { ...f.instances, async read(input) {
    entered.resolve(); await release.promise; return read(input)
  } } }); t.after(() => bridge.dispose())
  const request = { ...f.request, paths: [...f.request.paths], bundle: { ...f.record.bundle }, onPrepared: value => f.candidates.push(value) }
  const oldPrompt = request.prompt, oldId = request.invocationId, starting = bridge.start(request)
  await entered.promise
  request.paths[0] = 'SKILL.md'; request.id = randomUUID(); request.expectedRevision = 99; request.prompt = 'changed'; request.invocationId = 'changed'
  request.bundle.name = 'changed_after_validation'
  request.onPrepared = () => assert.fail('mutated callback must not run')
  release.resolve(); const run = await starting; await run.result
  assert.equal(run.reference.invocationId, oldId); assert.equal(run.reference.scope.id, f.record.id)
  assert.deepEqual(run.reference.scope.allowedPaths, f.request.paths)
  assert.deepEqual(run.reference.scope.bundle, f.record.bundle)
  assert.equal(f.candidates.length, 1)
  const message = f.ctx.sessionPersistence.rows.get(run.reference.sessionId).events.find(event => event.type === 'user/message' && event.data.id === run.reference.messageId)
  assert.equal(message.data.content[0].text, oldPrompt)
})

test('closing during metadata admission leaves no native work or retained address', { timeout: 15000 }, async t => {
  const f = await fixture(t), entered = deferred(), release = deferred(); t.after(() => release.resolve())
  const read = f.instances.read.bind(f.instances)
  const bridge = createStudioAuthoringSession({ ...f.bridgeOptions, instances: { ...f.instances, async read(input) {
    entered.resolve(); await release.promise; return read(input)
  } } })
  const starting = bridge.start(f.request), rejected = assert.rejects(starting, /disposed/)
  await entered.promise; const closing = bridge.dispose(); assert.equal(bridge.dispose(), closing)
  await closing; await rejected
  release.resolve()
  await assert.rejects(bridge.start(f.request), /disposed/)
  assert.equal(f.calls(), 0); assert.equal(f.childIds.length, 0); assert.equal(f.retained.length, 0)
})

test('a parent disconnected during actual metadata admission cannot create or resume native work', { timeout: 15000 }, async t => {
  const f = await fixture(t), entered = deferred(), release = deferred(); t.after(() => release.resolve())
  const read = f.instances.read.bind(f.instances)
  const bridge = createStudioAuthoringSession({ ...f.bridgeOptions, instances: { ...f.instances, async read(input) {
    entered.resolve(); await release.promise; return read(input)
  } } }); t.after(() => bridge.dispose())
  const starting = bridge.start(f.request), rejected = assert.rejects(starting, /disconnected/)
  await entered.promise; await f.parent.dispose(); release.resolve(); await rejected
  assert.equal(f.calls(), 0); assert.equal(f.childIds.length, 0); assert.equal(f.retained.length, 0)
  assert.equal((await f.instances.read(f.record.id)).revision, 0)
})

test('Kit source authoring preserves mounted membership and requires an exact pin only for Bundle preview', { timeout: 15000 }, async t => {
  let changes = []
  const f = await fixture(t, { step: n => sequence(changes, n) }), kit = { name: 'neutral_kit', version: '1.0' }
  const entry = (path, content) => ({ path, base64: Buffer.from(content).toString('base64') })
  let files = [entry('mindset.md', '---\nname: neutral_kit\nversion: "1.0"\n---\nUser purpose.\n<design_skills>\n## observations\n\nRecord observations.\n</design_skills>\n')]
  const adapter = createStudioInstanceAdapters({ listBundles: async () => [pin],
    captureBundle: async () => ({ files: structuredClone(originalFiles), sourceId: 'trusted:session-kit' }),
    captureKit: async requested => { assert.deepEqual(requested, kit); return { files } },
  })
  files = await adapter.composition.projectMounts({ kit, kitFiles: files, mounts: [{ bindingKey: pin.name, ...pin }] })
  const instances = await createStudioInstances({ stateRoot: join(f.root, 'kit-state'), ...adapter })
  const copy = await instances.copy({ kind: 'kit', kit }), before = await instances.readFile({ id: copy.id, path: 'mindset.md' })
  changes = [{ path: 'mindset.md', content: before.content.replace('User purpose.', 'Clarified user purpose.') }]
  const bridge = createStudioAuthoringSession({ ...f.bridgeOptions, instances }); t.after(() => bridge.dispose())
  const request = { ...f.request, id: copy.id, paths: ['mindset.md'] }
  await assert.rejects(bridge.start({ ...request, bundle: { name: 'foreign_bundle', version: '1.0' } }), /explicit mounted Bundle/)
  assert.equal(f.calls(), 0)
  const sourceRun = await bridge.start({ ...request, invocationId: randomUUID() }); await sourceRun.result
  assert.equal(sourceRun.reference.scope.bundle, undefined)
  assert.equal(sourceRun.readPrepared().request.bundle, undefined)
  assert.equal(sourceRun.readPrepared().candidate.preview, undefined)
  assert.match(sourceRun.readPrepared().request.changes[0].content, /## observations/)
  const run = await bridge.start({ ...request, bundle: pin }); await run.result
  const prepared = run.readPrepared()
  assert.equal(prepared.candidate.valid, true, JSON.stringify(prepared.candidate.diagnostics))
  assert.deepEqual(prepared.request.bundle, pin); assert.deepEqual(prepared.candidate.preview.bundle, pin)
  assert.match(prepared.request.changes[0].content, /## observations/)
  assert.equal((await instances.readFile({ id: copy.id, path: 'mindset.md' })).content, before.content)
})


test('native authoring projects new files beyond its initial read and saves only by explicit user action', { timeout: 15000 }, async t => {
  const path = 'reference/native-added.md', content = '# Additional method\n'
  const changes = [{ path, content }]
  const f = await fixture(t, { step: n => n === 0
    ? call('studio_authoring_read', { paths: ['SKILL.md', 'reference/not-yet-created.md'] })
    : n === 1 ? call('studio_authoring_prepare', { changes }) : stop() })
  const run = await f.bridge.start({ ...f.request, paths: ['reference/not-yet-created.md'] })
  assert.equal((await run.result).status, 'completed')
  const prepared = run.readPrepared()
  assert.ok(prepared, 'S4 projects the actual S1 candidate beyond the initial reading focus')
  assert.deepEqual(prepared.request.changes, changes)
  assert.ok(prepared.candidate.diff.some(file => file.path === path && file.after === content))
  assert.equal((await f.instances.read(f.record.id)).files.some(file => file.path === path), false)
  const saved = await f.instances.saveChanges({ ...prepared.request, mode: 'validated', digest: prepared.candidate.digest })
  const reopened = await createStudioInstances(f.storage)
  assert.equal((await reopened.readFile({ id: saved.id, path })).content, content)
  assert.equal((await reopened.read(saved.id)).revision, f.record.revision + 1)
})


test('bare SKILL authoring receives the bound catalog identity without replacing its runtime name', { timeout: 15000 }, async t => {
  const prompts = []
  let changes = []
  const f = await fixture(t, { step(n, request) {
    const { tools, ...conversation } = request
    prompts.push(JSON.stringify(conversation))
    return sequence(changes, n)
  } })
  const method = textOf(originalFiles, 'SKILL.md').replaceAll('observations', 'reading_notes')
  const imported = await f.instances.importSources({ kind: 'bundle', files: [{ path: 'SKILL.md', base64: Buffer.from(method).toString('base64') }] })
  assert.equal(imported.runtimeName, 'reading_notes')
  assert.notEqual(imported.bundle.name, imported.runtimeName)
  changes = originalFiles.filter(file => file.path !== 'SKILL.md' && !file.path.endsWith('.bin')).map(file => ({
    path: file.path, content: Buffer.from(file.base64, 'base64').toString('utf8').replaceAll('observations', 'reading_notes'),
  }))
  const manifest = changes.find(file => file.path === 'skill.yaml')
  const rejected = await f.instances.prepareChanges({ id: imported.id, expectedRevision: imported.revision, changes })
  assert.equal(rejected.valid, false, 'runtime name alone cannot replace the bound catalog identity')
  assert.match(JSON.stringify(rejected.diagnostics), /exact pin|identity/)
  manifest.content = `identity: ${imported.bundle.name}\n` + manifest.content
  const run = await f.bridge.start({ ...f.request, id: imported.id, expectedRevision: imported.revision, paths: ['SKILL.md'],
    prompt: 'Complete this imported method without changing its runtime name.' })
  assert.equal((await run.result).status, 'completed')
  const expected = `Set skill.yaml identity to ${JSON.stringify(imported.bundle.name)} and version to ${JSON.stringify(imported.bundle.version)}.`
  assert.ok(prompts.some(text => text.includes(JSON.stringify(expected).slice(1, -1))), 'the actual native model request receives the manifest catalog-identity contract')
  assert.ok(prompts.some(text => text.includes('Keep skill.yaml name and SKILL.md frontmatter name as the runtime name read from SKILL.md')))
  const prepared = run.readPrepared()
  assert.equal(prepared.candidate.valid, true, JSON.stringify(prepared.candidate.diagnostics))
  assert.equal((await f.instances.read(imported.id)).revision, imported.revision, 'native prepare does not save')
  const saved = await f.instances.saveChanges({ ...prepared.request, mode: 'validated', digest: prepared.candidate.digest })
  const reopened = await createStudioInstances(f.storage)
  assert.equal((await reopened.readFile({ id: saved.id, path: 'SKILL.md' })).content, method)
  const savedManifest = (await reopened.readFile({ id: saved.id, path: 'skill.yaml' })).content
  assert.equal(savedManifest, manifest.content)
  assert.match(savedManifest, /name: reading_notes/)
})
