/** Source-plane tests: node --import tsx --test packages/studio/tests/content-archive.test.mjs */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { resolve, relative } from 'node:path'
import { exportStudioContentArchive, exportStudioSourceArchive, prepareStudioContentImport, readStudioContentArchive } from '../src/content-archive.ts'

const root = resolve('/fixture/archive_kit')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
function source() {
  const map = new Map(Object.entries({
    'mindset.md': '---\nname: archive_kit\nversion: "1.0"\ndescription: Archive fixture\n---\n# Method\n<design_skills>\n## alpha\nAlpha method.\n## beta\nBeta method.\n</design_skills>\n',
    'LICENSE': 'Fixture license content\n',
    'NOTICE': 'Fixture notice\n',
    ...Object.fromEntries(['alpha', 'beta'].flatMap(name => [
      [`skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: ${name} method\n---\n# ${name}\nOriginal content.\n`],
      [`skills/${name}/skill.yaml`, `name: ${name}\nversion: "1.0"\ntitle: { zh: ${name}, en: ${name} }\nlabel: { zh: ${name}, en: ${name} }\nexecution: { handoff: none }\npresentation: { mode: none }\n`],
      [`skills/${name}/schema.yaml`, 'type: object\nproperties:\n  summary:\n    type: string\n'],
      [`skills/${name}/validation.yaml`, `skill: ${name}\nrules:\n  - id: summary\n    scope: [completion]\n    code: ${name}.summary\n    message: summary required\n    check:\n      non_empty_string: summary\n`],
    ])),
    'skills/alpha/.image.bin': Buffer.from([0, 255, 128, 1]),
    'skills/alpha/reference/sample.bin': Buffer.from([0, 255, 128, 42]),
    'skills/alpha/assets/pixel.png': Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    'skills/alpha/reference/notes.md': '中文\r\nOriginal byte-exact guidance.\r\n',
    'skills/alpha/reference/custom.asset': 'Unknown resource types must remain valid UTF-8.\n',
    'skills/alpha/scripts/author.mjs': 'throw new Error("must never execute")\n',
  }).map(([path, bytes]) => [path, Buffer.from(bytes)]))
  const key = path => relative(root, path).split('\\').join('/')
  const children = path => {
    const name = key(path), prefix = name ? `${name}/` : ''
    return [...new Set([...map.keys()].filter(file => file.startsWith(prefix)).map(file => file.slice(prefix.length).split('/')[0]))].sort()
  }
  return { root, map, async listFiles() { return [...map.keys()] }, async readBytes(path) { return map.get(key(path)) },
    fs: { async readText(path) { const bytes = map.get(key(path)); return bytes === undefined ? undefined : new TextDecoder('utf8', { fatal: true }).decode(bytes) },
      async listDir(path) { return children(path) }, async isDirectory(path) { return children(path).length > 0 } } }
}
const request = kind => ({ kind, pin: { name: kind === 'kit' ? 'archive_kit' : 'alpha', version: '1.0' },
  provenance: { source: 'fixture:synthetic-content', license: 'Apache-2.0' }, dependencies: kind === 'bundle' ? [{ name: 'beta', version: '1.0' }] : undefined })

test('archive metadata is optional and supplied strings, original files and integrity remain intact', async () => {
  const snapshot = source()
  const original = readStudioContentArchive(await exportStudioContentArchive(snapshot, request('kit')))
  for (const provenance of [undefined, {}, { source: '' }, { license: '' }, { source: 'raw source' }, { license: 'Original notice\nnot an SPDX identifier' }]) {
    const input = { ...request('kit') }
    if (provenance === undefined) delete input.provenance
    else input.provenance = provenance
    const json = await exportStudioContentArchive(snapshot, input)
    const archive = readStudioContentArchive(json)
    assert.deepEqual(archive.provenance, provenance)
    assert.equal(Object.hasOwn(archive, 'provenance'), provenance !== undefined)
    assert.deepEqual(archive.files, original.files)
    assert.equal((await prepareStudioContentImport(json)).validation.valid, true)
    const altered = JSON.parse(json)
    altered.provenance = { source: 'changed metadata' }
    assert.throws(() => readStudioContentArchive(JSON.stringify(altered)), /integrity/)
  }
})

test('optional bilingual titles survive the envelope and are covered by its integrity hash', async () => {
  const snapshot = source(), title = { en: 'Reading kit', zh: '阅读套件' }
  const serialized = await exportStudioContentArchive(snapshot, { ...request('kit'), title })
  const archive = readStudioContentArchive(serialized)
  assert.deepEqual(archive.title, title)
  assert.equal(readStudioContentArchive(await exportStudioContentArchive(snapshot, request('kit'))).title, undefined,
    'existing archives without a display title keep their original canonical envelope')
  const changed = JSON.parse(serialized); changed.title.zh = '另一个名称'
  assert.throws(() => readStudioContentArchive(JSON.stringify(changed)), /integrity/)
})

test('source export preserves incomplete Bundle and Kit bytes without a definition-load requirement', async () => {
  for (const kind of ['bundle', 'kit']) {
    const snapshot = source()
    snapshot.map.clear()
    if (kind === 'bundle') {
      snapshot.bundle = request(kind).pin
      snapshot.map.set('SKILL.md', Buffer.from('# Unfinished method\r\n'))
    } else {
      snapshot.map.set('mindset.md', Buffer.from('# Unfinished mindset\r\n'))
      snapshot.map.set('kit.yaml', Buffer.from('not: [finished'))
    }
    snapshot.map.set('assets/original.bin', Buffer.from([0, 255, 42]))
    snapshot.map.set('NOTICE', Buffer.from('Preserve the original notice\n'))
    const input = { kind, pin: request(kind).pin }
    await assert.rejects(exportStudioContentArchive(snapshot, input))
    const json = await exportStudioSourceArchive(snapshot, input)
    const archive = readStudioContentArchive(json)
    assert.equal(archive.provenance, undefined)
    assert.deepEqual(archive.files.map(file => file.path), [...snapshot.map.keys()].sort())
    for (const file of archive.files) assert.deepEqual(Buffer.from(file.base64, 'base64'), snapshot.map.get(file.path))
    assert.equal((await prepareStudioContentImport(json)).validation.valid, false, 'raw export does not claim a complete definition')
    snapshot.map.set('../outside', Buffer.from('unsafe'))
    await assert.rejects(exportStudioSourceArchive(snapshot, input), /path/)
  }
})
function seal(value) { const { sha256: _, ...data } = value; return JSON.stringify({ ...data, sha256: sha(JSON.stringify(data)) }) }
function alteredFile(value, path, bytes) {
  const copy = structuredClone(value), file = copy.files.find(file => file.path === path)
  file.base64 = Buffer.from(bytes).toString('base64'); file.bytes = Buffer.byteLength(bytes); file.sha256 = sha(bytes)
  return seal(copy)
}

test('Kit deterministic export/import preserves full raw source, binary assets, notices and derived exact membership', async () => {
  const snapshot = source(), json = await exportStudioContentArchive(snapshot, request('kit'))
  assert.equal(json, await exportStudioContentArchive(snapshot, request('kit')))
  const prepared = await prepareStudioContentImport(json)
  assert.equal(prepared.validation.valid, true)
  assert.equal(prepared.executionGranted, false)
  assert.equal(prepared.requiresTrustReview, true)
  assert.deepEqual(prepared.archive.dependencies, [{ name: 'alpha', version: '1.0' }, { name: 'beta', version: '1.0' }])
  assert.equal(prepared.files.length, snapshot.map.size)
  for (const file of prepared.files) assert.deepEqual(Buffer.from(file.base64, 'base64'), snapshot.map.get(file.path))
  assert.ok(Object.isFrozen(prepared.archive.files[0]))
  assert.deepEqual(Object.keys(prepared.files[0]), ['path', 'base64', 'bytes', 'sha256'])
})
test('independent Bundle contains only itself; context required; exact declared dependencies checked without installation', async () => {
  const snapshot = source(), json = await exportStudioContentArchive(snapshot, request('bundle'))
  const archive = readStudioContentArchive(json)
  assert.ok(archive.files.every(file => !file.path.startsWith('skills/')))
  assert.ok(!archive.files.some(file => file.path === 'mindset.md'))
  const unbound = await prepareStudioContentImport(json)
  assert.equal(unbound.validation.valid, false)
  assert.match(unbound.validation.diagnostics[0].message, /requires.*context/)
  const bound = await prepareStudioContentImport(json, { validationContext: snapshot })
  assert.equal(bound.validation.valid, true)
  const incomplete = structuredClone(archive); incomplete.files = incomplete.files.filter(file => file.path !== 'schema.yaml')
  assert.equal((await prepareStudioContentImport(seal(incomplete), { validationContext: snapshot })).validation.valid, false)
  const unresolved = structuredClone(archive); unresolved.dependencies[0].version = '2.0'
  assert.match((await prepareStudioContentImport(seal(unresolved), { validationContext: snapshot })).validation.diagnostics[0].message, /dependency.*unresolved/)
})
test('metadata, bytes and exact identities have integrity checks, not publication authority', async () => {
  const archive = readStudioContentArchive(await exportStudioContentArchive(source(), request('kit')))
  for (const mutation of [copy => { copy.provenance.license = 'changed' }, copy => { copy.files[0].base64 = 'AA==' }, copy => { copy.files[0].bytes++ }]) {
    const copy = structuredClone(archive); mutation(copy)
    assert.throws(() => readStudioContentArchive(JSON.stringify(copy)), /integrity|byte count/)
  }
  const wrong = structuredClone(archive); wrong.pin.version = '2.0'
  assert.match((await prepareStudioContentImport(seal(wrong))).validation.diagnostics[0].message, /identity/)
  const membership = structuredClone(archive); membership.dependencies.reverse()
  assert.match((await prepareStudioContentImport(seal(membership))).validation.diagnostics[0].message, /member pins/)
  const invalid = alteredFile(archive, 'skills/alpha/schema.yaml', 'type: invalid_schema_type\n')
  assert.equal((await prepareStudioContentImport(invalid)).validation.valid, false)
  await assert.rejects(exportStudioContentArchive(source(), { ...request('kit'), pin: { name: 'archive_kit', version: '2.0' } }), /pin/)
  await assert.rejects(exportStudioContentArchive(source(), { ...request('kit'), dependencies: [] }), /pins/)
})
test('malformed UTF-8 methods and definitions cannot be relabeled as opaque resources', async () => {
  const archive = readStudioContentArchive(await exportStudioContentArchive(source(), request('kit')))
  for (const path of ['mindset.md', 'skills/alpha/SKILL.md', 'skills/alpha/skill.yaml',
    'skills/alpha/schema.yaml', 'skills/alpha/validation.yaml', 'skills/alpha/reference/notes.md',
    'skills/alpha/reference/custom.asset', 'skills/alpha/scripts/author.mjs']) {
    const malformed = Buffer.concat([source().map.get(path), Buffer.from([255])])
    const snapshot = source(); snapshot.map.set(path, malformed)
    await assert.rejects(exportStudioContentArchive(snapshot, request('kit')), /UTF-8|utf-8/)
    const prepared = await prepareStudioContentImport(alteredFile(archive, path, malformed))
    assert.equal(prepared.validation.valid, false, path)
    assert.deepEqual(prepared.contents, [], path)
    assert.equal(prepared.executionGranted, false)
  }
})
test('cross-platform unsafe paths, links/modes, native payloads, duplicate paths and malformed base64 fail closed', async () => {
  const archive = readStudioContentArchive(await exportStudioContentArchive(source(), request('kit')))
  for (const path of ['../escape', '/absolute', 'C:/drive', 'a\\b', 'a//b', '.git/config', 'A/.GIT/config', 'node_modules/pkg', 'a/CON.txt', 'COM¹', 'assets/LPT².txt', 'assets/com³.bin', 'a/file:ads', 'a/end.', 'a/end ', 'a/native.exe', 'a/native.dll']) {
    const copy = structuredClone(archive); copy.files[0].path = path
    assert.throws(() => readStudioContentArchive(seal(copy)), /Unsafe|unsupported/)
  }
  const unicode = structuredClone(archive); unicode.files[0].path = 'assets/普通图像¹.bin'
  unicode.files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  assert.ok(readStudioContentArchive(seal(unicode)).files.some(file => file.path === 'assets/普通图像¹.bin'))
  for (const extra of [{ mode: 0o777 }, { link: '/outside' }]) {
    const copy = structuredClone(archive); Object.assign(copy.files[0], extra)
    assert.throws(() => readStudioContentArchive(seal(copy)), /fields/)
  }
  const duplicate = structuredClone(archive); duplicate.files.push({ ...duplicate.files[0], path: duplicate.files[0].path.toLowerCase() })
  assert.throws(() => readStudioContentArchive(seal(duplicate)), /Duplicate|conflicting/)
  const collision = structuredClone(archive); collision.files.push({ ...collision.files[0], path: 'skills' })
  assert.throws(() => readStudioContentArchive(seal(collision)), /collision/)
  const dirCase = structuredClone(archive); dirCase.files.find(file => file.path === 'skills/alpha/reference/notes.md').path = 'Skills/alpha/reference/notes.md'
  assert.throws(() => readStudioContentArchive(seal(dirCase)), /conflicting/)
  const bad64 = structuredClone(archive); bad64.files[0].base64 = 'Zh=='
  assert.throws(() => readStudioContentArchive(seal(bad64)), /integrity/)
})
test('bounded count, bytes, envelope and unknown formats reject before preparing data', async () => {
  const archive = readStudioContentArchive(await exportStudioContentArchive(source(), request('kit')))
  const count = structuredClone(archive); count.files = Array.from({ length: 4097 }, () => count.files[0])
  assert.throws(() => readStudioContentArchive(seal(count)), /count/)
  assert.throws(() => readStudioContentArchive(' '.repeat(32 * 1024 * 1024 + 1)), /32 MiB/)
  const bytes = Buffer.alloc(16 * 1024 * 1024 + 1), large = structuredClone(archive)
  large.files = [{ path: 'large.bin', base64: bytes.toString('base64'), bytes: bytes.length, sha256: sha(bytes) }]
  assert.throws(() => readStudioContentArchive(seal(large)), /16 MiB/)
  const accepted = source(); accepted.map.set('large.bin', Buffer.alloc(1024 * 1024))
  assert.equal((await prepareStudioContentImport(await exportStudioContentArchive(accepted, request('kit')))).validation.valid, true)
  const unknown = structuredClone(archive); unknown.format = 'tar/v1'
  assert.throws(() => readStudioContentArchive(seal(unknown)), /format/)
})
test('native renderer references stay untrusted even when definitions compile', async () => {
  const snapshot = source()
  snapshot.map.set('skills/alpha/skill.yaml', Buffer.from(snapshot.map.get('skills/alpha/skill.yaml').toString().replace('mode: none', 'mode: native, renderer: synthetic.provider/v1')))
  snapshot.map.delete('skills/alpha/scripts/author.mjs')
  const prepared = await prepareStudioContentImport(await exportStudioContentArchive(snapshot, request('kit')))
  assert.equal(prepared.validation.valid, true)
  assert.equal(prepared.requiresTrustReview, true)
  assert.equal(prepared.executionGranted, false)
})

function bytesSnapshot(root, entries) {
  const map = new Map(entries)
  const key = path => relative(root, path).split('\\').join('/')
  const children = path => { const name = key(path), prefix = name ? `${name}/` : ''
    return [...new Set([...map.keys()].filter(file => file.startsWith(prefix)).map(file => file.slice(prefix.length).split('/')[0]))].sort() }
  return { root, map, async listFiles() { return [...map.keys()] }, async readBytes(path) { return map.get(key(path)) },
    fs: { async readText(path) { const bytes = map.get(key(path)); return bytes === undefined ? undefined : new TextDecoder('utf8', {fatal:true}).decode(bytes) },
      async listDir(path) { return children(path) }, async isDirectory(path) { return children(path).length > 0 } } }
}
function independent() {
  const legacy = source()
  const snapshot = bytesSnapshot(resolve('/fixture/independent-kit'), [...legacy.map].filter(([path]) => !path.startsWith('skills/')))
  snapshot.map.set('kit.yaml', Buffer.from('version: 1\nmounts:\n  - {bindingKey: alpha, name: alpha_fork, version: "1.0"}\n  - {bindingKey: beta, name: beta, version: "1.0"}\n'))
  snapshot.sourceId = 'fixture:kit'
  snapshot.bundles = ['alpha', 'beta'].map(name => {
    const prefix = `skills/${name}/`
    const bundle = bytesSnapshot(resolve('/fixture/independent-bundles', name), [...legacy.map].filter(([path]) => path.startsWith(prefix)).map(([path, bytes]) => [path.slice(prefix.length), bytes]))
    if (name === 'alpha') bundle.map.set('skill.yaml', Buffer.from('identity: alpha_fork\n' + bundle.map.get('skill.yaml')))
    bundle.map.set('LICENSE', Buffer.from(`${name} Bundle license\n`))
    bundle.map.set('NOTICE', Buffer.from(`${name} Bundle notice\n`))
    return { name: name === 'alpha' ? 'alpha_fork' : name, version: '1.0', sourceId: 'fixture:bundle', snapshot: bundle }
  })
  return snapshot
}

test('independent Kit exports exact mounted closure and yields separately retainable complete bytes', async () => {
  const snapshot = independent()
  snapshot.bundles.push({ name: 'unused', version: '1.0', sourceId: 'fixture:unused', snapshot: {
    root: resolve('/fixture/unmounted'), fs: { readText() { throw Error('unmounted source read') } },
    listFiles() { throw Error('unmounted tree listed') }, readBytes() { throw Error('unmounted bytes read') },
  } })
  const json = await exportStudioContentArchive(snapshot, request('kit'))
  assert.equal(json, await exportStudioContentArchive(snapshot, request('kit')))
  const result = await prepareStudioContentImport(json)
  assert.equal(result.validation.valid, true, JSON.stringify(result.validation))
  assert.equal(result.executionGranted, false)
  assert.equal(result.requiresTrustReview, true)
  assert.deepEqual(result.contents.map(item => [item.kind,item.pin.name]), [['kit','archive_kit'],['bundle','alpha_fork'],['bundle','beta']])
  for (const item of result.contents) {
    const original = item.kind === 'kit' ? snapshot : snapshot.bundles.find(bundle => bundle.name === item.pin.name).snapshot
    assert.equal(item.files.length, original.map.size)
    for (const file of item.files) assert.deepEqual(Buffer.from(file.base64,'base64'), original.map.get(file.path))
    assert.ok(Object.isFrozen(item.files))
  }
  const standalone = await exportStudioContentArchive(snapshot, {kind:'bundle',pin:{name:'alpha_fork',version:'1.0'},provenance:request('kit').provenance})
  const bundle = await prepareStudioContentImport(standalone)
  assert.equal(bundle.validation.valid,true)
  assert.equal(bundle.contents[0].pin.name,'alpha_fork')
  assert.ok(bundle.files.some(file=>file.path==='LICENSE'))
  assert.ok(!bundle.files.some(file=>file.path==='mindset.md'))
})

test('independent closure rejects missing, wrong-version, unreferenced and colliding resources without partial adoption', async () => {
  const snapshot = independent(), archive = readStudioContentArchive(await exportStudioContentArchive(snapshot,request('kit')))
  for (const mutate of [
    copy => {copy.files=copy.files.filter(file=>!file.path.startsWith('bundles/beta/'))},
    copy => {copy.dependencies[1].version='2.0'},
    copy => {copy.files.push({...copy.files.find(file=>file.path==='LICENSE'),path:'bundles/extra/1.0/LICENSE'});copy.files.sort((a,b)=>a.path<b.path?-1:1)},
  ]) {
    const copy=structuredClone(archive);mutate(copy)
    const result=await prepareStudioContentImport(seal(copy))
    assert.equal(result.validation.valid,false)
    assert.deepEqual(result.contents,[])
  }
  snapshot.map.set('bundles/private.txt',Buffer.from('Kit-owned resource must not be lost'))
  await assert.rejects(exportStudioContentArchive(snapshot,request('kit')),/collide/)
  snapshot.map.delete('bundles/private.txt')
  snapshot.bundles.push(snapshot.bundles[0])
  await assert.rejects(exportStudioContentArchive(snapshot,request('kit')),/ambiguous/)
  for (const name of ['..','../outside','C:escape','con','fork.','fork/child','alpha.fork','alpha-fork','Alpha','1alpha']) {
    const copy=structuredClone(archive);copy.dependencies[0].name=name
    assert.throws(()=>readStudioContentArchive(seal(copy)),/identity|Unsafe/)
  }
})
