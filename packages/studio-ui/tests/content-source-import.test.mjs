import test from 'node:test'
import assert from 'node:assert/strict'
import { zipSync } from 'fflate'
import { readStudioImportFiles } from '../src/content-source-import.ts'
import { encodeStudioContentZip } from '../src/content-zip.ts'
import { readStudioContentArchive } from '../../studio/src/content-archive.ts'
import { createStudioInstances } from '../../studio/src/node/studio-instances.mjs'
import { adapters, originalFiles, entry, pin } from '../../companion/test/fixtures/studio-changes-fixture.mjs'
import { STUDIO_AUTHORING_RPC_SCHEMAS } from '../../studio-dsh/src/authoring.remote-client.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const text = (name, value, webkitRelativePath) => ({ name, size: Buffer.byteLength(value), webkitRelativePath, text: async () => value })
const zip = entries => {
  const data = zipSync(Object.fromEntries(Object.entries(entries).map(([path, value]) => [path, Buffer.from(value)])))
  return { name: '来源.zip', size: data.length, arrayBuffer: async () => data.buffer, text: async () => { throw Error('Not text') } }
}
test('bare Skill, folder and ordinary ZIP preserve complete original bytes without manifest or license', async () => {
  const skill = '# 方法\n保持原始内容。\n'
  for (const files of [
    [text('SKILL.md', skill)],
    [text('SKILL.md', skill, '来源/SKILL.md'), text('notes.md', 'notes', '来源/reference/notes.md')],
    [zip({ '来源/': '', '来源/SKILL.md': skill, '来源/reference/pixel.png': Buffer.from([137, 80, 0, 255]) })],
  ]) {
    const result = await readStudioImportFiles('bundle', files)
    assert.equal(Buffer.from(result.files.find(file => file.path === 'SKILL.md').base64, 'base64').toString(), skill)
    assert.equal(result.files.some(file => file.path === 'skill.yaml'), false, 'missing files are not fabricated')
  }
})
test('traditional Skill folder and ZIP retain references, scripts and binary assets through save, reopen and export', async t => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-skill-resources-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const options = { stateRoot, ...adapters() }
  const sources = {
    'SKILL.md': Buffer.from('---\nname: ordinary_skill\ndescription: Read references/guide.md and use scripts/check.py.\n---\n# Method\n'),
    'references/guide.md': Buffer.from('# Reference\r\nSee ../assets/sample.png.\r\n'),
    'references/nested/example.json': Buffer.from('{"message":"示例"}\n'),
    'scripts/check.py': Buffer.from('#!/usr/bin/env python3\nprint("example")\n'),
    'assets/sample.png': Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255]),
    'assets/empty.txt': Buffer.alloc(0),
  }
  const folder = Object.entries(sources).map(([path, bytes]) => ({
    name: path.split('/').at(-1), size: bytes.length, webkitRelativePath: 'ordinary-skill/' + path,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => { throw Error('Resources must be read as bytes') },
  }))
  for (const selected of [folder, [zip(Object.fromEntries(Object.entries(sources).map(([path, bytes]) => ['ordinary-skill/' + path, bytes])))]]) {
    const imported = await readStudioImportFiles('bundle', selected)
    const service = await createStudioInstances(options)
    let record = await service.importSources(imported)
    assert.equal(record.readiness.ready, false, 'ordinary Skills are retained without fabricated Bundle definitions')
    const revised = sources['SKILL.md'].toString() + '\nHuman note.\n'
    record = await service.saveFile({ id: record.id, expectedRevision: record.revision, path: 'SKILL.md', content: revised })
    const reopened = await createStudioInstances(options)
    const bytes = encodeStudioContentZip(await reopened.exportArchive({ id: record.id, expectedRevision: record.revision }))
    const roundTrip = await readStudioImportFiles('bundle', [{ name: 'exported.zip', size: bytes.length,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      text: async () => { throw Error('Use ZIP bytes') },
    }], async value => readStudioContentArchive(value))
    assert.deepEqual(roundTrip.files.map(file => file.path).sort(), Object.keys(sources).sort())
    for (const file of roundTrip.files) assert.deepEqual(Buffer.from(file.base64, 'base64'),
      file.path === 'SKILL.md' ? Buffer.from(revised) : sources[file.path], file.path)
  }
})
test('Kit checks its own two core files, independent of Bundle requirements', async () => {
  const result = await readStudioImportFiles('kit', [zip({ 'kit/mindset.md': '# Mindset', 'kit/kit.yaml': 'bundles: []' })])
  assert.deepEqual(result.files.map(file => file.path), ['mindset.md', 'kit.yaml'])
  await assert.rejects(readStudioImportFiles('kit', [text('SKILL.md', '# Skill')]), /mindset.md/)
  await assert.rejects(readStudioImportFiles('bundle', [text('panel.yaml', 'root: {}')]), /SKILL.md/)
})
test('ambiguous and unsafe folder paths are not flattened into a different Skill', async () => {
  await assert.rejects(readStudioImportFiles('bundle', [zip({ 'one/SKILL.md': 'one', 'two/SKILL.md': 'two' })]), /SKILL.md/)
  await assert.rejects(readStudioImportFiles('bundle', [text('SKILL.md', 'one'), text('x', 'x', '../x')]), /Unsafe/)
})

test('Kit and Bundle display names survive actual saved-source ZIP export and reimport without changing method bytes', async t => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-title-roundtrip-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const options = { stateRoot, ...adapters() }, service = await createStudioInstances(options)
  for (const kind of ['kit', 'bundle']) {
    const title = kind === 'kit' ? { zh: '阅读套件', en: 'Reading kit' } : { zh: '阅读笔记', en: 'Reading notes' }
    const files = kind === 'kit' ? [entry('mindset.md', '---\nname: reading_kit\nversion: "1.0"\ndescription: Reading guidance.\n---\n# Method\n'),
      entry('kit.yaml', 'version: 1\nmounts: []\n')] : originalFiles
    let record = await service.importSources({ kind, title, files })
    if (kind === 'kit') record = await service.updateMounts({ id: record.id, expectedRevision: record.revision, bundles: [pin] })
    const source = await service.exportArchive({ id: record.id, expectedRevision: record.revision })
    assert.deepEqual(readStudioContentArchive(source).title, title)
    const bytes = encodeStudioContentZip(source)
    const imported = await readStudioImportFiles(kind, [{ name: 'source.zip', size: bytes.length,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      text: async () => { throw Error('Use binary ZIP bytes') } }], async value => readStudioContentArchive(value))
    assert.deepEqual(imported.title, title)
    const copy = await service.importSources(imported)
    assert.deepEqual(STUDIO_AUTHORING_RPC_SCHEMAS.read.result.parse(copy), copy,
      'localized readiness uses the existing strict wire fields')
    assert.deepEqual(copy.title, { zh: title.zh + ' (2)', en: title.en + ' (2)' })
    assert.notEqual(copy[kind].name, record[kind].name)
    const method = kind === 'kit' ? 'mindset.md' : 'SKILL.md'
    const before = (await service.readFile({ id: record.id, path: method })).content
    const after = (await service.readFile({ id: copy.id, path: method })).content
    assert.equal(after, kind === 'kit' ? before.replaceAll(record.kit.name, copy.kit.name) : before)
    assert.deepEqual((await (await createStudioInstances(options)).read(copy.id)).title, copy.title)
  }
})
