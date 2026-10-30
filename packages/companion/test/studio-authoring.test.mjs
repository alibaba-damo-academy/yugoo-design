import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createStudioAuthoring } from '../src/studio-authoring.mjs'
import { createStudioInstances } from '../src/studio-instances.mjs'
import { PANEL_COMPONENT_CATALOG, GENERATED_COMPONENT_KINDS } from '../../core/src/panel-component-catalog.ts'
import { adapters, additions, pin, originalFiles, textOf } from './fixtures/studio-changes-fixture.mjs'

// Same real Core catalog projection as design_list_panel_components, not a
// fabricated component or a second registry. The host owns the shared reader.
const actualCatalog = () => ({ components: Object.entries(PANEL_COMPONENT_CATALOG).map(([name, entry]) => ({
  name, description: entry.description, sourceBound: entry.sourceBound === true,
  ownsWorkspace: entry.ownsWorkspace === true, generated: GENERATED_COMPONENT_KINDS.includes(name),
})), contract: 'Runtime vocabulary and composition guidance only; not a complete parameter schema or standard A2UI specification.' })
const narrow = service => ({ read: input => service.read(input), readFile: input => service.readFile(input), prepareChanges: input => service.prepareChanges(input) })
async function fixture(t) {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-authoring-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const ports = adapters(), options = { stateRoot, ...ports }, service = await createStudioInstances(options)
  const record = await service.copy({ kind: 'bundle', bundle: pin })
  const scope = { id: record.id, expectedRevision: record.revision,
    allowedPaths: [...additions().map(change => change.path), 'reference/pending.md'] }
  const api = createStudioAuthoring({ scope, instances: narrow(service), readComponents: actualCatalog })
  return { stateRoot, options, service, record, scope, api }
}
const schema = () => textOf(originalFiles, 'schema.yaml')

test('scoped read and real S1 candidate remain unsaved; the existing UI alone saves and reopens the exact replacements', async t => {
  const { stateRoot, options, service, record, scope, api } = await fixture(t)
  assert.deepEqual(Object.keys(api).sort(), ['prepare', 'read'])
  assert.ok(Object.isFrozen(api)); assert.equal(api.save, undefined)
  const before = await service.read(record.id), snapshots = await readdir(join(stateRoot, 'studio-instance-drafts/snapshots'))
  const view = await api.read()
  assert.deepEqual(view.components, actualCatalog())
  assert.deepEqual(view.files.map(file => file.path), scope.allowedPaths)
  assert.deepEqual(view.files.at(-1), { path: 'reference/pending.md', exists: false })
  assert.equal(view.files.find(file => file.path === 'schema.yaml').content, schema())
  assert.equal(view.scope.baseSnapshot, undefined, 'no repository location is exposed')
  const prepared = await api.prepare({ changes: additions() })
  assert.equal(prepared.candidate.valid, true, JSON.stringify(prepared.candidate.diagnostics))
  assert.deepEqual(prepared.request, { id: record.id, expectedRevision: record.revision, changes: additions() })
  for (const diff of prepared.candidate.diff) assert.equal(diff.after, prepared.request.changes.find(change => change.path === diff.path).content)
  assert.equal(prepared.candidate.preview.revision, record.revision + 1)
  assert.equal((await service.read(record.id)).baseSnapshot, before.baseSnapshot)
  assert.deepEqual(await readdir(join(stateRoot, 'studio-instance-drafts/snapshots')), snapshots)
  assert.equal((await service.readFile({ id: record.id, path: 'schema.yaml' })).content, schema())
  // Deliberately outside the adapter: existing, user-owned UI save authority.
  const saved = await service.saveChanges({ ...prepared.request, mode: 'validated', digest: prepared.candidate.digest })
  const reopened = await createStudioInstances(options)
  assert.equal((await reopened.readFile({ id: record.id, path: 'schema.yaml' })).content, additions()[0].content)
  await assert.rejects(api.read(), /changed.*bind/i)
  await assert.rejects(api.prepare({ changes: additions() }), /changed.*bind/i)
  const next = createStudioAuthoring({ scope: { ...scope, expectedRevision: saved.revision }, instances: narrow(reopened), readComponents: actualCatalog })
  const second = await next.prepare({ changes: [{ path: 'reference/pending.md', content: 'Second explicitly bound candidate.\n' }] })
  assert.equal(second.candidate.baseRevision, saved.revision)
  assert.deepEqual(second.candidate.diff, [{ path: 'reference/pending.md', after: 'Second explicitly bound candidate.\n' }])
  assert.equal((await reopened.read(record.id)).revision, saved.revision, 'the next prepare also grants no save')
})

test('caller cannot override object identity, revision, deletion or path/size budgets before host access', async t => {
  const { service, scope } = await fixture(t)
  let calls = 0
  const instances = Object.fromEntries(['read', 'readFile', 'prepareChanges'].map(key => [key, async input => { calls++; return service[key](input) }]))
  const api = createStudioAuthoring({ scope, instances, readComponents: actualCatalog })
  for (const input of [
    { id: 'another-instance', paths: ['schema.yaml'] },
    { expectedRevision: 99 }, { allowedPaths: ['SKILL.md'] },
    { paths: ['../schema.yaml'] }, { paths: ['schema.yaml', 'schema.yaml'] }, { paths: [] },
  ]) await assert.rejects(api.read(input))
  for (const input of [
    { id: 'another-instance', changes: additions() }, { mode: 'validated', changes: additions() },
    { bundle: pin, changes: additions() }, { sampleSource: '{}', changes: additions() },
    { changes: [{ path: 'schema.yaml', content: null }] },
    { changes: [{ path: 'schema.yaml', content: 'x'.repeat(1_048_577) }] },
    { changes: [{ path: 'schema.yaml', content: schema(), scope: 'expanded' }] },
  ]) await assert.rejects(api.prepare(input))
  assert.equal(calls, 0)
  assert.throws(() => createStudioAuthoring({ scope: { ...scope, allowedPaths: Array.from({ length: 65 }, (_, i) => `reference/${i}.md`) }, instances, readComponents: actualCatalog }), /1–64/)
  assert.throws(() => createStudioAuthoring({ scope: { ...scope, allowedPaths: ['schema.yaml', 'schema.yaml'] }, instances, readComponents: actualCatalog }), /duplicate/)
})

test('scope and replacements are copied before awaits, and catalog reads stay live without a second cache', async t => {
  const { service, scope } = await fixture(t)
  let enter, release
  const entered = new Promise(resolve => { enter = resolve }), gate = new Promise(resolve => { release = resolve })
  let calls = 0
  const api = createStudioAuthoring({ scope, instances: narrow(service), readComponents: async () => {
    calls++; if (calls === 1) { enter(); await gate }
    return { ...actualCatalog(), currentRead: calls }
  } })
  const changes = additions(), result = api.prepare({ changes })
  await entered
  scope.id = 'foreign'; scope.expectedRevision = 99; scope.allowedPaths.push('SKILL.md')
  changes[0].path = 'SKILL.md'; changes[0].content = 'mutated after dispatch'
  release()
  const prepared = await result
  assert.deepEqual(prepared.request.changes, additions())
  assert.equal(prepared.components.currentRead, 1)
  assert.ok(Object.isFrozen(prepared.scope)); assert.ok(Object.isFrozen(prepared.scope.allowedPaths))
  assert.throws(() => prepared.scope.allowedPaths.push('SKILL.md'), TypeError)
  const method = await api.read({ paths: ['SKILL.md'] })
  assert.equal(method.scope.id, prepared.scope.id)
  const paths = ['schema.yaml'], reading = api.read({ paths }); paths[0] = 'SKILL.md'
  const view = await reading
  assert.equal(view.files[0].path, 'schema.yaml'); assert.equal(view.components.currentRead, 3)
})

test('a concurrent UI save during multi-file read rejects the whole response, including an otherwise old matching file receipt', async t => {
  const { service, record, scope } = await fixture(t)
  let saved = false
  const api = createStudioAuthoring({ scope, readComponents: actualCatalog, instances: {
    ...narrow(service), async readFile(input) {
      const old = await service.readFile(input)
      if (!saved && input.path === 'schema.yaml') {
        saved = true
        await service.saveFile({ id: record.id, expectedRevision: 0, path: 'SKILL.md', content: 'Concurrent human text retained.' })
      }
      return old
    },
  } })
  await assert.rejects(api.read({ paths: ['schema.yaml', 'panel.yaml'] }), /changed.*bind/i)
  assert.equal((await service.readFile({ id: record.id, path: 'SKILL.md' })).content, 'Concurrent human text retained.')
})

test('a concurrent UI save during actual Core preparation cannot return a stale candidate or overwrite the human edit', async t => {
  const { service, record, scope } = await fixture(t)
  let preparations = 0
  const api = createStudioAuthoring({ scope, readComponents: actualCatalog, instances: {
    ...narrow(service), async prepareChanges(input) {
      preparations++
      const candidate = await service.prepareChanges(input)
      await service.saveFile({ id: record.id, expectedRevision: 0, path: 'SKILL.md', content: 'Human changed source while preview compiled.' })
      return candidate
    },
  } })
  await assert.rejects(api.prepare({ changes: additions() }), /changed.*bind/i)
  await assert.rejects(api.prepare({ changes: additions() }), /changed.*bind/i)
  assert.equal(preparations, 1, 'stale scopes do not dispatch another prepare')
  assert.equal((await service.readFile({ id: record.id, path: 'schema.yaml' })).content, schema())
  assert.equal((await service.readFile({ id: record.id, path: 'SKILL.md' })).content, 'Human changed source while preview compiled.')
})

test('actual Core errors remain an unsaved invalid candidate, while missing/oversized catalogs cannot fall back or prepare', async t => {
  const { service, record, scope, api } = await fixture(t)
  const invalid = await api.prepare({ changes: [{ path: 'schema.yaml', content: 'type: object\nproperties: []\n' }] })
  assert.equal(invalid.candidate.valid, false); assert.ok(invalid.candidate.diagnostics.length)
  assert.equal((await service.read(record.id)).revision, 0)
  assert.equal((await service.readFile({ id: record.id, path: 'schema.yaml' })).content, schema())
  let preparations = 0
  const instances = { ...narrow(service), async prepareChanges(input) { preparations++; return service.prepareChanges(input) } }
  for (const readComponents of [() => ({ components: [] }), () => ({ ...actualCatalog(), oversized: 'x'.repeat(262_144) }), () => { throw Error('Catalog unavailable') }]) {
    const unavailable = createStudioAuthoring({ scope, instances, readComponents })
    await assert.rejects(unavailable.read({ paths: ['schema.yaml'] }), /catalog/i)
    await assert.rejects(unavailable.prepare({ changes: additions() }), /catalog/i)
  }
  assert.equal(preparations, 0)
})

test('read bounds and exact preview Bundle binding are enforced independently of model requests', async t => {
  const { service, scope, record } = await fixture(t)
  const binary = createStudioAuthoring({ scope: { ...scope, allowedPaths: ['reference/preserved.bin'] }, instances: narrow(service), readComponents: actualCatalog })
  await assert.rejects(binary.read(), /editable UTF-8/)
  const wrongBundle = createStudioAuthoring({ scope: { ...scope, bundle: pin }, instances: narrow(service), readComponents: actualCatalog })
  assert.notDeepEqual(record.bundle, pin, 'the copied Bundle has its independent local pin')
  await assert.rejects(wrongBundle.read(), /Bundle is outside/)
  await assert.rejects(wrongBundle.prepare({ changes: additions() }), /Bundle is outside/)
  const bounded = createStudioAuthoring({ scope, readComponents: actualCatalog, instances: {
    ...narrow(service), async read(input) {
      const actual = await service.read(input)
      return { ...actual, files: scope.allowedPaths.map(path => ({ path, editable: true, bytes: 1_048_576 })) }
    },
  } })
  await assert.rejects(bounded.read(), /4 MiB/)
})


test('authoring can read, replace and add files in the bound copy without saving', async t => {
  const { api, service, record } = await fixture(t)
  const path = 'reference/new-authoring-file.md', content = '# Additional method\n'
  const prepared = await api.prepare({ changes: [{ path, content }] })
  assert.equal(prepared.request.id, record.id)
  assert.ok(prepared.candidate.diff.some(file => file.path === path && file.after === content))
  assert.equal((await service.read({ id: record.id })).files.some(file => file.path === path), false)
  const method = await api.prepare({ changes: [{ path: 'SKILL.md', content: textOf(originalFiles, 'SKILL.md') + '\nAdditional guidance.\n' }] })
  assert.ok(method.candidate.diff.some(file => file.path === 'SKILL.md'))
  assert.equal((await api.read({ paths: ['reference/probe.md'] })).files[0].exists, false)
  await assert.rejects(api.prepare({ changes: [{ path: '../outside.md', content }] }))
  const saved = await service.saveChanges({ ...prepared.request, mode: 'draft' })
  assert.equal((await service.readFile({ id: saved.id, path })).content, content)
})
