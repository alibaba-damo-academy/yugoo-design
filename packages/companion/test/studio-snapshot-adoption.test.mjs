/** Source-plane adoption; no HTTP, catalog installation, extraction or execution. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { createStudioDraftPorts, createStudioKitDrafts, createStudioPanelDrafts } from '../src/studio-panel-drafts.mjs'

const sha = text => createHash('sha256').update(text).digest('hex')
const bundle = { name: 'alpha', version: '1.0' }
function content(name) {
  return new Map([
    ['mindset.md', `---\nname: ${name}\nversion: "1.0"\ndescription: Example\n---\n# Method\nThink.\n<design_skills>\n## alpha\nAlpha method.\n</design_skills>\n`],
    ['skills/alpha/SKILL.md', '---\nname: alpha\ndescription: Example\n---\nMethod.\n'],
    ['skills/alpha/skill.yaml', 'name: alpha\nversion: "1.0"\ntitle: {en: Alpha, zh: Alpha}\nlabel: {en: Alpha, zh: Alpha}\nexecution: {handoff: none}\npresentation: {mode: declarative, renderer: pilot-design/v2}\n'],
    ['skills/alpha/schema.yaml', 'type: object\nproperties:\n  summary: {type: string}\n'],
    ['skills/alpha/validation.yaml', 'skill: alpha\nrules:\n  - id: summary\n    scope: [completion]\n    code: alpha.summary\n    message: Enter summary\n    check: {non_empty_string: summary}\n'],
    ['skills/alpha/panel.yaml', 'version: 1\npanel_kind: evidence_workbook\nrenderer: workspace\nitem_name: Example\nsections: []\nfields:\n  - key: summary\n    control: text\n    label: Summary\nui:\n  component: structured_data\n  id: summary-view\n  source: summary\n'],
    ['skills/alpha/renderer.md', '---\nversion: 1\nrenderer: pilot-design/v2\nfields: [{source: summary, title: Summary}]\ncollections: []\n---\nSummary.\n'],
    ['LICENSE', 'Synthetic fixture only\r\n'],
    ['reference/pixel.bin', Buffer.from([0, 255, 1, 128])],
    ['scripts/inert.mjs', 'throw Error("must not execute")\n'],
  ])
}
function envelope(files = content('imported_demo'), name = 'imported_demo', kind = 'kit') {
  const data = { format: 'studio-content-archive/v1', kind, pin: { name, version: '1.0' },
    provenance: { source: 'synthetic:test', license: 'fixture-only' }, dependencies: kind === 'kit' ? [bundle] : [],
    files: [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, value]) => { const bytes = Buffer.from(value); return { path, base64: bytes.toString('base64'), bytes: bytes.length, sha256: sha(bytes) } }) }
  return JSON.stringify({ ...data, sha256: sha(JSON.stringify(data)) })
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'yugoo-snapshot-adoption-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const stateRoot = join(root, 'state'), kitRoot = join(root, 'installed')
  await mkdir(stateRoot); await mkdir(kitRoot)
  const installed = content('installed_demo')
  for (const [path, bytes] of installed) { await mkdir(join(kitRoot, path, '..'), { recursive: true }); await writeFile(join(kitRoot, path), bytes) }
  const options = { stateRoot, kitRoot, readInstalledKit: () => ({ name: 'installed_demo', version: '1.0' }) }
  return { options, stateRoot, kitRoot, installed }
}

test('archive bytes → existing snapshot → independent Kit/Panel copies and durable reopen', async t => {
  const f = await fixture(t), pin = { name: 'imported_demo', version: '1.0' }, source = envelope()
  for (const kind of ['kit', 'panel']) {
    const { sources } = await createStudioDraftPorts(f.options, kind)
    const snapshot = await sources.retain(source)
    const again = await sources.retain(source)
    assert.equal(again.id, snapshot.id)
    const entries = JSON.parse(await readFile(join(f.stateRoot, `studio-${kind}-drafts/snapshots/${snapshot.id}.json`), 'utf8'))
    assert.equal(new Map(entries).get('reference/pixel.bin'), Buffer.from([0, 255, 1, 128]).toString('base64'))
    const service = await (kind === 'kit' ? createStudioKitDrafts(f.options) : createStudioPanelDrafts(f.options))
    const input = { snapshotId: snapshot.id, kit: pin, bundle }
    const draft = await service.createFromSnapshot(input)
    assert.equal(draft.confirmed, false); assert.equal(draft.revision, 0); assert.equal(draft.baseSnapshot, snapshot.id)
    const other = await service.createFromSnapshot(input)
    assert.notEqual(other.id, draft.id)
    const edit = kind === 'kit' ? { mindsetSource: draft.mindsetSource + '\nOwn edit\n', relationsSource: null }
      : { panelSource: draft.panelSource + '\n# Own edit\n', sampleSource: '{"summary":"Own sample"}' }
    const saved = await service.save({ id: draft.id, expectedRevision: 0, ...edit })
    await assert.rejects(service.save({ id: draft.id, expectedRevision: 0, ...edit }), /changed/)
    const reopened = await (kind === 'kit' ? createStudioKitDrafts(f.options) : createStudioPanelDrafts(f.options))
    assert.deepEqual(await reopened.read(draft.id), saved)
    assert.equal((await reopened.read(other.id)).revision, 0)
    const confirmed = await reopened.confirm({ id: draft.id, expectedRevision: 1 })
    assert.equal(confirmed.draft.confirmed, true, JSON.stringify(confirmed))
    assert.equal((await reopened.fork(draft.id)).confirmed, false)
    await assert.rejects(service.createFromSnapshot({ ...input, kit: { ...pin, version: '2.0' } }), /selected Kit pin/)
    if (kind === 'panel') await assert.rejects(service.createFromSnapshot({ ...input, bundle: { ...bundle, version: '2.0' } }), /declarative Bundle version/)
    await assert.rejects(service.createFromSnapshot({ ...input, snapshotId: '../escape' }), /snapshot/)
    assert.deepEqual(await readdir(join(f.stateRoot, `studio-${kind}-drafts/snapshots`)), [`${snapshot.id}.json`])
  }
  for (const [path, bytes] of f.installed) assert.deepEqual(await readFile(join(f.kitRoot, path)), Buffer.from(bytes))
  assert.deepEqual(await readdir(f.stateRoot), ['studio-kit-drafts', 'studio-panel-drafts'])
})

test('retain rejects unsafe/unverified envelopes and standalone Bundle context without writes', async t => {
  const f = await fixture(t), { sources } = await createStudioDraftPorts(f.options, 'kit')
  await assert.rejects(sources.retain('not-json'))
  const broken = JSON.parse(envelope()); broken.files[0].base64 = 'AA=='
  await assert.rejects(sources.retain(JSON.stringify(broken)), /integrity/i)
  const unsafe = content('imported_demo'); unsafe.set('../escape', 'unsafe')
  await assert.rejects(sources.retain(envelope(unsafe)), /path/i)
  await assert.rejects(sources.retain(envelope(new Map([['SKILL.md', 'method']]), 'alpha', 'bundle')), /complete Kit archive/)
  assert.deepEqual(await readdir(join(f.stateRoot, 'studio-kit-drafts/snapshots')), [])
  await assert.rejects(createStudioDraftPorts(f.options, '../escape'), /namespace/)
})

test('installed capture remains byte-identical and uses the same deduplicating writer', async t => {
  const f = await fixture(t), { sources } = await createStudioDraftPorts(f.options, 'kit')
  const installed = { name: 'installed_demo', version: '1.0' }
  const captured = await sources.capture(installed)
  assert.equal((await sources.retain(envelope(f.installed, installed.name))).id, captured.id)
  const service = await createStudioKitDrafts(f.options)
  assert.equal((await service.create({ kit: installed })).baseSnapshot, captured.id)
  await assert.rejects(service.create({ kit: { name: 'imported_demo', version: '1.0' } }), /installed Kit/)
  const snapshotPath = join(f.stateRoot, 'studio-kit-drafts/snapshots', `${captured.id}.json`)
  await writeFile(snapshotPath, '[]')
  await assert.rejects(service.createFromSnapshot({ snapshotId: captured.id, kit: installed }), /integrity/)
})

test('retain preserves the existing finite snapshot quota and writer lock', async t => {
  const f = await fixture(t), { sources } = await createStudioDraftPorts(f.options, 'panel')
  let first
  for (let i = 0; i < 16; i++) { const files = content('imported_demo'); files.set('NOTICE', `retained ${i}`); const snapshot = await sources.retain(envelope(files)); first ??= snapshot }
  await assert.rejects(sources.retain(envelope()), /limit reached/)
  assert.equal((await readdir(join(f.stateRoot, 'studio-panel-drafts/snapshots'))).length, 16)
  assert.ok(await sources.open(first.id))
  const lock = join(f.stateRoot, 'studio-panel-drafts/write.lock'); await mkdir(lock)
  await assert.rejects(sources.retain(envelope()), /saved elsewhere/)
  assert.ok((await readdir(join(f.stateRoot, 'studio-panel-drafts'))).includes('write.lock'))
})
