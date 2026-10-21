import assert from 'node:assert/strict'
import test from 'node:test'
import { StudioKitDraftService } from '../src/kit-drafts.ts'

const root = '/retained/demo'
const kitPin = { name: 'demo', version: '1.0' }
const mindset = '---\nname: demo\nversion: "1.0"\ndescription: Demo\n---\n# Method\nThink carefully.\n<design_skills>\n## alpha\nAlpha method.\n## beta\nBeta method.\n</design_skills>\n'
function fixture() {
  const files = new Map([[`${root}/mindset.md`, mindset]])
  for (const name of ['alpha', 'beta']) {
    files.set(`${root}/skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: Example\n---\nMethod.\n`)
    files.set(`${root}/skills/${name}/skill.yaml`, `name: ${name}\nversion: "1.0"\ntitle: {en: ${name}, zh: ${name}}\nlabel: {en: ${name}, zh: ${name}}\nexecution: {handoff: none}\npresentation: {mode: none}\n`)
    files.set(`${root}/skills/${name}/schema.yaml`, 'type: object\nproperties:\n  summary: {type: string}\n')
    files.set(`${root}/skills/${name}/validation.yaml`, `skill: ${name}\nrules:\n  - id: summary\n    scope: [completion]\n    code: ${name}.summary\n    message: Enter summary\n    check: {non_empty_string: summary}\n`)
  }
  const fs = {
    async readText(path) { return files.get(path) },
    async readResource(path) { const content = files.get(path); return content === undefined ? undefined : { kind: 'text', content } },
    async listDir(path) { return [...new Set([...files.keys()].filter(p => p.startsWith(`${path}/`)).map(p => p.slice(path.length + 1).split('/')[0]))].sort() },
    async isDirectory(path) { return [...files.keys()].some(p => p.startsWith(`${path}/`)) },
    async realPath(path) { return path },
  }
  const records = new Map()
  const repository = {
    async create(value) { const row = structuredClone({ ...value, id: `draft-${records.size}`, revision: 0 }); records.set(row.id, row); return structuredClone(row) },
    async read(id) { if (!records.has(id)) throw new Error('Missing draft'); return structuredClone(records.get(id)) },
    async list() { return structuredClone([...records.values()]) },
    async replace(id, revision, value) {
      const current = records.get(id)
      if (current.revision !== revision || current.confirmed) throw new Error('CAS conflict')
      const row = structuredClone({ ...value, id, revision: revision + 1 }); records.set(id, row); return structuredClone(row)
    },
  }
  const sources = {
    async capture() { return { id: 'snapshot-1', root, fs } },
    async open(id) { assert.equal(id, 'snapshot-1'); return { id, root, fs } },
  }
  const service = new StudioKitDraftService(repository, sources)
  return { service, files, records, repository, sources }
}
const edit = (record, changes = {}) => ({ id: record.id, expectedRevision: record.revision, mindsetSource: record.mindsetSource, relationsSource: record.relationsSource, ...changes })

test('copy exact Kit; edit/validate/confirm/fork without changing retained files or mounts', async () => {
  const { service, files } = fixture()
  const before = [...files]
  const initial = await service.create({ kit: kitPin })
  assert.equal(initial.baseSnapshot, 'snapshot-1')
  assert.deepEqual(initial.mounts, [{ name: 'alpha', version: '1.0' }, { name: 'beta', version: '1.0' }])
  const saved = await service.save(edit(initial, { mindsetSource: mindset.replace('name: demo', 'name: custom_demo').replace('Think carefully.', 'Think visually.') }))
  const valid = await service.validate({ id: saved.id, expectedRevision: saved.revision })
  assert.equal(valid.valid, true, JSON.stringify(valid))
  assert.equal(valid.candidateKit.name, 'custom_demo')
  assert.equal(saved.baseKit.name, 'demo')
  const confirmed = await service.confirm({ id: saved.id, expectedRevision: saved.revision })
  assert.equal(confirmed.draft.confirmed, true)
  await assert.rejects(service.save(edit(confirmed.draft)), /locked/)
  const fork = await service.fork(saved.id)
  assert.equal(fork.confirmed, false)
  assert.notEqual(fork.id, saved.id)
  assert.equal(fork.mindsetSource, saved.mindsetSource)
  assert.equal((await service.list()).length, 2)
  assert.deepEqual([...files], before)
})

test('invalid drafts are recoverable but cannot be confirmed; mount removal is rejected', async () => {
  const { service } = fixture()
  let draft = await service.create({ kit: kitPin })
  draft = await service.save(edit(draft, { mindsetSource: 'unfinished' }))
  assert.equal((await service.read(draft.id)).mindsetSource, 'unfinished')
  const result = await service.confirm({ id: draft.id, expectedRevision: draft.revision })
  assert.equal(result.valid, false)
  assert.equal(result.draft, undefined)
  draft = await service.save(edit(draft, { mindsetSource: mindset.replace('## beta\nBeta method.\n', '') }))
  const mounts = await service.validate({ id: draft.id, expectedRevision: draft.revision })
  assert.equal(mounts.valid, false)
  assert.match(mounts.diagnostics[0].message, /mounts are read-only/)
  draft = await service.save(edit(draft, { mindsetSource: mindset, relationsSource: 'relations: [broken' }))
  assert.equal((await service.validate({ id: draft.id, expectedRevision: draft.revision })).valid, false)
  draft = await service.save(edit(draft, { relationsSource: null }))
  assert.equal((await service.validate({ id: draft.id, expectedRevision: draft.revision })).valid, true)
})

test('stale and racing writers cannot overwrite confirmed or changed revisions', async () => {
  const { service, repository, sources } = fixture()
  const secondClient = new StudioKitDraftService(repository, sources)
  const draft = await service.create({ kit: kitPin })
  const outcomes = await Promise.allSettled([service.save(edit(draft)), secondClient.confirm({ id: draft.id, expectedRevision: 0 })])
  assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1)
  await assert.rejects(secondClient.save(edit(draft)), /changed elsewhere/)
  await assert.rejects(service.validate({ id: draft.id, expectedRevision: 0 }), /changed elsewhere/)
  assert.equal((await secondClient.read(draft.id)).revision, 1)
})

test('retained-source drift fails closed and source pin mismatch does not create a draft', async () => {
  const { service, files, records } = fixture()
  await assert.rejects(service.create({ kit: { name: 'wrong', version: '1.0' } }), /selected Kit pin/)
  assert.equal(records.size, 0)
  const draft = await service.create({ kit: kitPin })
  files.set(`${root}/skills/alpha/skill.yaml`, files.get(`${root}/skills/alpha/skill.yaml`).replace('"1.0"', '"2.0"'))
  const result = await service.confirm({ id: draft.id, expectedRevision: 0 })
  assert.equal(result.valid, false)
  assert.match(result.diagnostics[0].message, /Retained source/)
  assert.equal((await service.read(draft.id)).confirmed, false)
})

test('bounded text, request capture and no arbitrary path edits', async () => {
  const { service, files } = fixture()
  const draft = await service.create({ kit: kitPin })
  await assert.rejects(service.save(edit(draft, { mindsetSource: 'x'.repeat(1_048_577) })), /1 MiB/)
  await assert.rejects(service.save(edit(draft, { relationsSource: {} })), /UTF-8/)
  const input = edit(draft)
  const pending = service.save(input)
  input.mindsetSource = 'mutated after request'
  const saved = await pending
  assert.equal(saved.mindsetSource, mindset)
  assert.equal(files.get(`${root}/mindset.md`), mindset)
  const preview = await service.preview({ id: saved.id, expectedRevision: saved.revision, bundle: { name: '../alpha', version: '1.0' }, sampleSource: '{}' })
  assert.match(preview.diagnostics[0].message, /exact mounted/)
  assert.equal(preview.preview, undefined)
})
