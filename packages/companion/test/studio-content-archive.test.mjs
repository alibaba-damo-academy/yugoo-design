/** Source plane, no HTTP/UI/installed-host claim; HTTP still has a 12 MiB limit. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, symlink, chmod, truncate, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareStudioContentImport } from '../../studio/src/content-archive.ts'
import { createStudioContentArchives } from '../src/studio-content-archive.mjs'

const pin = { name: 'archive_fixture', version: '1.0' }
const origin = { source: 'fixture:synthetic-byte-snapshot', license: 'Apache-2.0' }
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'yugoo-studio-archive-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const stateRoot = join(root, 'state'), kitRoot = join(root, 'kit')
  await mkdir(stateRoot, { mode: 0o700 }); await mkdir(kitRoot)
  const files = {
    'mindset.md': '---\nname: archive_fixture\nversion: "1.0"\ndescription: Archive fixture\n---\n# Method\n<design_skills>\n## alpha\nAlpha method.\n</design_skills>\n',
    'LICENSE': 'Synthetic license text\n', 'NOTICE': 'Synthetic notice\n',
    'skills/alpha/SKILL.md': '---\nname: alpha\ndescription: Alpha fixture\n---\nAuthor only.\n',
    'skills/alpha/skill.yaml': 'name: alpha\nversion: "1.0"\ntitle: {zh: Alpha, en: Alpha}\nlabel: {zh: Alpha, en: Alpha}\npresentation: {mode: none}\nexecution: {handoff: none}\n',
    'skills/alpha/schema.yaml': 'type: object\nproperties:\n  summary: {type: string}\n',
    'skills/alpha/validation.yaml': 'skill: alpha\nrules:\n  - id: summary\n    scope: [completion]\n    code: alpha.summary\n    message: Required summary\n    check: {non_empty_string: summary}\n',
    'skills/alpha/.image.bin': Buffer.from([255, 0, 128, 1]),
    'skills/alpha/reference/sample.bin': Buffer.from([0, 255, 128, 42]),
    'skills/alpha/assets/pixel.png': Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    'skills/alpha/reference/中文¹.md': '中文\r\nByte-exact method.\r\n',
    'skills/alpha/scripts/author.mjs': 'throw new Error("never execute")\n',
  }
  for (const [path, bytes] of Object.entries(files)) {
    const destination = join(kitRoot, path)
    await mkdir(join(destination, '..'), { recursive: true }); await writeFile(destination, bytes)
  }
  const options = { stateRoot, kitRoot, readInstalledKit: () => pin }
  const service = await createStudioContentArchives(options)
  const request = { kind: 'kit', pin, provenance: origin }
  return { root, options, service, request, files, stateRoot, kitRoot }
}
test('real byte snapshot → inert envelope → durable new identity/reopen, no installed mutation', async t => {
  const f = await fixture(t)
  await chmod(join(f.kitRoot, 'skills/alpha/scripts/author.mjs'), 0o755)
  const json = await f.service.exportArchive(f.request)
  const first = await f.service.prepareImport({ source: json })
  assert.equal(first.validation.valid, true)
  assert.equal(first.executionGranted, false)
  assert.equal(first.requiresTrustReview, true)
  for (const file of first.archive.files) {
    assert.deepEqual(Buffer.from(file.base64, 'base64'), Buffer.from(f.files[file.path]))
    assert.deepEqual(await readFile(join(f.kitRoot, file.path)), Buffer.from(f.files[file.path]))
  }
  const reopened = await createStudioContentArchives(f.options)
  assert.deepEqual(await reopened.readImport(first.id), first)
  const second = await reopened.prepareImport({ source: json })
  assert.notEqual(second.id, first.id)
  assert.equal((await reopened.listImports()).length, 2)
  assert.deepEqual((await readdir(join(f.stateRoot, 'studio-content-imports'))).sort(), [`${first.id}.json`, `${second.id}.json`].sort())
  if (process.platform !== 'win32') assert.equal((await stat(join(f.stateRoot, 'studio-content-imports', `${first.id}.json`))).mode & 0o777, 0o600)
  await assert.rejects(reopened.readImport('../escape'), /identity/)
  const path = join(f.stateRoot, 'studio-content-imports', `${first.id}.json`)
  const corrupt = JSON.parse(await readFile(path, 'utf8')); corrupt.archive.provenance.license = 'altered'
  await writeFile(path, JSON.stringify(corrupt))
  await assert.rejects(reopened.readImport(first.id), /integrity/)
})
test('dependency-free standalone Bundle validates independently and accepts explicit trusted context', async t => {
  const f = await fixture(t)
  const source = await f.service.exportArchive({ kind: 'bundle', pin: { name: 'alpha', version: '1.0' }, provenance: origin })
  const unknown = await f.service.prepareImport({ source })
  assert.equal(unknown.validation.valid, true)
  assert.equal(unknown.executionGranted, false)
  const contextual = await f.service.prepareImport({ source, validateAgainstInstalled: true })
  assert.equal(contextual.validation.valid, true)
  assert.equal((await f.service.revalidateImport(contextual.id)).validation.valid, true)
  await writeFile(join(f.kitRoot, 'NOTICE'), 'Changed installed context')
  await assert.rejects(f.service.revalidateImport(contextual.id), /context changed/)
  await assert.rejects(f.service.prepareImport({ source, validateAgainstInstalled: 'yes' }), /boolean/)
  assert.ok(unknown.archive.files.every(file => !file.path.startsWith('skills/')))
})
test('trusted roots, private storage and real-source symlinks fail closed without repairs', async t => {
  const f = await fixture(t)
  await assert.rejects(createStudioContentArchives({ ...f.options, stateRoot: 'relative' }), /absolute/)
  await assert.rejects(createStudioContentArchives({ ...f.options, stateRoot: f.kitRoot }), /nested/)
  const alias = join(f.root, 'state-alias'); await symlink(f.stateRoot, alias, 'dir')
  await assert.rejects(createStudioContentArchives({ ...f.options, stateRoot: alias }), /symlink/)
  await symlink(join(f.kitRoot, 'LICENSE'), join(f.kitRoot, 'foreign-link'))
  await assert.rejects(f.service.exportArchive(f.request), /symlink/)
  if (process.platform !== 'win32') {
    await chmod(join(f.stateRoot, 'studio-content-imports'), 0o755)
    await assert.rejects(f.service.listImports(), /private/)
    assert.equal((await stat(join(f.stateRoot, 'studio-content-imports'))).mode & 0o777, 0o755, 'never repair pre-existing permissions')
  }
})
test('store budget and concurrent writer lock reject without deleting previous data', async t => {
  const f = await fixture(t), source = await f.service.exportArchive(f.request)
  const first = await f.service.prepareImport({ source })
  const directory = join(f.stateRoot, 'studio-content-imports'), retained = join(directory, 'retained.tmp')
  await writeFile(retained, 'owned pending content', { mode: 0o600 })
  // Sparse bounded fixture exercises cumulative accounting without copying big sources.
  await truncate(retained, 128 * 1024 * 1024)
  await assert.rejects(f.service.prepareImport({ source }), /size limit/)
  assert.equal((await stat(retained)).size, 128 * 1024 * 1024)
  assert.equal((await f.service.readImport(first.id)).id, first.id)
  await mkdir(join(directory, 'write.lock'), { mode: 0o700 })
  await assert.rejects(f.service.prepareImport({ source }), /busy/)
  assert.ok((await stat(join(directory, 'write.lock'))).isDirectory(), 'not our lock to remove')
  assert.ok((await readdir(directory)).includes(`${first.id}.json`))
})
test('invalid envelope and wrong export identity do not prepare imports', async t => {
  const f = await fixture(t)
  await assert.rejects(f.service.prepareImport({ source: 'invalid-json' }))
  await assert.rejects(f.service.exportArchive({ ...f.request, pin: { ...pin, version: '2.0' } }), /installed Kit pin/)
  assert.deepEqual(await f.service.listImports(), [])
  const compiled = await createStudioContentArchives({ ...f.options, readInstalledKit: () => ({ ...pin, compiledFunction() {} }) })
  assert.ok(await compiled.exportArchive(f.request), 'compiled catalog functions are not JSON/structured-cloned')
  const mismatch = await createStudioContentArchives({ ...f.options, readInstalledKit: () => ({ ...pin, version: '2.0' }) })
  await assert.rejects(mismatch.exportArchive({ kind: 'bundle', pin: { name: 'alpha', version: '1.0' }, provenance: origin }), /disagrees.*pin/)
})

async function independentFixture(t) {
  const f = await fixture(t), bundleRoot = join(f.root, 'bundles', 'alpha')
  await mkdir(bundleRoot, { recursive: true })
  for (const [path, bytes] of Object.entries(f.files)) {
    if (!path.startsWith('skills/alpha/')) continue
    const destination = join(bundleRoot, path.slice('skills/alpha/'.length))
    await mkdir(join(destination, '..'), { recursive: true })
    await writeFile(destination, bytes)
  }
  await writeFile(join(bundleRoot, 'LICENSE'), 'Independent Bundle license\n')
  await writeFile(join(bundleRoot, 'NOTICE'), 'Independent Bundle notice\n')
  await rm(join(f.kitRoot, 'skills'), { recursive: true })
  await writeFile(join(f.kitRoot, 'kit.yaml'), 'version: 1\nmounts:\n  - {bindingKey: alpha, name: alpha, version: "1.0"}\n')
  const bundles = [{ name: 'alpha', version: '1.0', rootDir: bundleRoot, sourceId: 'fixture:bundle' }]
  const options = { ...f.options, sourceId: 'fixture:kit', bundles,
    readInstalledKit: () => ({ ...pin, skills: [{ name: 'alpha', version: '1.0' }] }) }
  return { ...f, bundleRoot, options, service: await createStudioContentArchives(options) }
}
test('real independent closure preserves mounted bytes and reopens inert receipt without reading unmounted sources', async t => {
  const f = await independentFixture(t)
  f.options.bundles.push({ name: 'unused', version: '1.0', rootDir: join(f.root, 'absent'), sourceId: 'fixture:unused' })
  const source = await f.service.exportArchive(f.request)
  const receipt = await f.service.prepareImport({ source })
  assert.equal(receipt.validation.valid, true)
  assert.equal(receipt.executionGranted, false)
  assert.equal(receipt.requiresTrustReview, true)
  assert.equal(Object.hasOwn(receipt, 'contents'), false, 'private receipt must not duplicate every base64 payload')
  const reopened = await createStudioContentArchives(f.options)
  assert.deepEqual(await reopened.readImport(receipt.id), receipt)
  const prepared = await prepareStudioContentImport(JSON.stringify(receipt.archive))
  assert.deepEqual(prepared.contents.map(item => item.kind), ['kit', 'bundle'])
  for (const item of prepared.contents) for (const file of item.files) {
    const root = item.kind === 'kit' ? f.kitRoot : f.bundleRoot
    assert.deepEqual(Buffer.from(file.base64, 'base64'), await readFile(join(root, file.path)))
  }
  assert.ok(prepared.contents[0].files.every(file => !file.path.startsWith('bundles/')))
  assert.ok(prepared.contents[1].files.some(file => file.path === 'reference/中文¹.md'))
  const standalone = await reopened.exportArchive({ kind: 'bundle', pin: {name:'alpha',version:'1.0'}, provenance: origin })
  assert.equal((await reopened.prepareImport({ source: standalone })).validation.valid, true)
  assert.deepEqual((await readdir(f.bundleRoot)).sort(), ['.image.bin','LICENSE','NOTICE','SKILL.md','assets','reference','schema.yaml','scripts','skill.yaml','validation.yaml'])
})
test('independent source bindings reject missing pins, aliases and state overlap before emitting content', async t => {
  const f = await independentFixture(t)
  for (const bundles of [[], [{...f.options.bundles[0], version:'2.0'}], [f.options.bundles[0], f.options.bundles[0]]]) {
    const service = await createStudioContentArchives({...f.options,bundles})
    await assert.rejects(service.exportArchive(f.request), /exact Bundle source/)
  }
  const alias = join(f.root, 'bundle-alias')
  await symlink(f.bundleRoot, alias, 'dir')
  const linked = await createStudioContentArchives({...f.options,bundles:[{...f.options.bundles[0],rootDir:alias}]})
  await assert.rejects(linked.exportArchive(f.request), /symlink/)
  const nested = await createStudioContentArchives({...f.options,bundles:[{...f.options.bundles[0],rootDir:f.stateRoot}]})
  await assert.rejects(nested.exportArchive(f.request), /nested/)
  await symlink(join(f.kitRoot,'LICENSE'), join(f.bundleRoot,'foreign-link'))
  await assert.rejects(f.service.exportArchive(f.request), /symlink/)
  assert.deepEqual(await f.service.listImports(), [])
})
test('independent capture applies byte budget across Kit and Bundle roots', async t => {
  const f = await independentFixture(t)
  for (const root of [f.kitRoot, f.bundleRoot]) {
    const path = join(root, 'bounded.bin')
    await writeFile(path, '')
    await truncate(path, 9 * 1024 * 1024)
  }
  await assert.rejects(f.service.exportArchive(f.request), /bounded regular file/)
  assert.deepEqual(await f.service.listImports(), [])
  for (const root of [f.kitRoot, f.bundleRoot]) assert.equal((await stat(join(root, 'bounded.bin'))).size, 9 * 1024 * 1024)
})
