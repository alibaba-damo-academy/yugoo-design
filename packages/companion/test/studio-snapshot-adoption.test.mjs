/** Active trial capture and stateless archive validation; no extraction or execution. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { readStudioContentArchive } from '../../studio/src/content-archive.ts'
import { createStudioDraftPorts } from '../src/studio-panel-drafts.mjs'

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

test('captured source bytes reopen with confinement', async t => {
  const f = await fixture(t), pin = { name: 'installed_demo', version: '1.0' }
  for (const kind of ['panel']) {
    const { sources, repository } = await createStudioDraftPorts(f.options, kind)
    const snapshot = await sources.capture(pin)
    const opened = await sources.open(snapshot.id)
    assert.deepEqual(await opened.fs.readBytes(join(opened.root, 'reference/pixel.bin')), Buffer.from([0, 255, 1, 128]))
    await assert.rejects(opened.fs.readText(join(opened.root, '..', 'outside')), /escapes/)
    const reopened = await (await createStudioDraftPorts(f.options, kind)).sources.open(snapshot.id)
    assert.deepEqual(await reopened.fs.readBytes(join(reopened.root, 'reference/pixel.bin')), Buffer.from([0, 255, 1, 128]))
    await assert.rejects(sources.open('../escape'), /snapshot/)
  }
})

test('stateless decoding rejects unsafe or unverified envelopes without source writes', async t => {
  const f = await fixture(t), { sources } = await createStudioDraftPorts(f.options, 'panel')
  assert.throws(() => readStudioContentArchive('not-json'))
  const broken = JSON.parse(envelope()); broken.files[0].base64 = 'AA=='
  assert.throws(() => readStudioContentArchive(JSON.stringify(broken)), /integrity/i)
  const unsafe = content('imported_demo'); unsafe.set('../escape', 'unsafe')
  assert.throws(() => readStudioContentArchive(envelope(unsafe)), /path/i)
  assert.deepEqual(await readdir(join(f.stateRoot, 'studio-panel-drafts/snapshots')), [])
  await assert.rejects(createStudioDraftPorts(f.options, '../escape'), /namespace/)
})

test('installed capture remains byte-identical and uses the same deduplicating writer', async t => {
  const f = await fixture(t), { sources } = await createStudioDraftPorts(f.options, 'panel')
  const installed = { name: 'installed_demo', version: '1.0' }
  const captured = await sources.capture(installed)
  assert.equal((await sources.capture(installed)).id, captured.id)
  await assert.rejects(sources.capture({ name: 'imported_demo', version: '1.0' }), /installed Kit/)
  const snapshotPath = join(f.stateRoot, 'studio-panel-drafts/snapshots', `${captured.id}.json`)
  await writeFile(snapshotPath, '[]')
  await assert.rejects(sources.open(captured.id), /integrity/)
})

test('capture preserves the writer lock', async t => {
  const f = await fixture(t), { sources } = await createStudioDraftPorts(f.options, 'panel')
  const lock = join(f.stateRoot, 'studio-panel-drafts/write.lock'); await mkdir(lock)
  await assert.rejects(sources.capture({ name: 'installed_demo', version: '1.0' }), /saved elsewhere/)
  assert.ok((await readdir(join(f.stateRoot, 'studio-panel-drafts'))).includes('write.lock'))
})
