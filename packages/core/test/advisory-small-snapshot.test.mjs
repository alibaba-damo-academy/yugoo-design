import test from 'node:test'
import assert from 'node:assert/strict'
import { createAdvisoryEvidence } from '../src/advisory-evidence.ts'
import { GitBlobSizeLimitError } from '../src/git.ts'

const COMMIT = 'a'.repeat(40)
const PROJECT = '11111111-1111-4111-8111-111111111111'
const MAX_RAW_BYTES = 32768
const MAX_SERIALIZED_BYTES = 32768
const MAX_TOTAL_BYTES = 8_388_608
const MAX_FILE_BYTES = 1_048_576
const freshSignal = () => new AbortController().signal

async function fixture(entries = { 'design_files/facts.txt': 'Saved facts.' }, options = {}) {
  const metadata = { kind: 'dsh-design-project', formatVersion: 3, id: PROJECT, name: 'Small snapshot',
    createdAt: '2026-10-15T00:00:00.000Z', knowledge: { provider: 'ladybug-wasm' }, kit: { name: 'fixture', version: '1.0' } }
  const projectText = JSON.stringify(metadata, null, 2) + '\n'
  const projectBytes = options.projectBytes?.(Buffer.from(projectText)) ?? Buffer.from(projectText)
  const blobs = new Map([['project.json', projectBytes],
    ...Object.entries(entries).map(([path, value]) => [path, Buffer.isBuffer(value) ? value : Buffer.from(value)])])
  const paths = [...blobs.keys()]
  const calls = []
  let onRead
  const git = {
    async listPathsAt(commit, signal) {
      calls.push({ kind: 'list', commit, signal })
      signal.throwIfAborted()
      return paths
    },
    async readBytesAt(commit, path, signal, maxBytes) {
      const call = { kind: 'read', commit, path, signal, maxBytes }
      calls.push(call)
      signal.throwIfAborted()
      await onRead?.(call)
      const bytes = blobs.get(path)
      if (bytes === undefined) return undefined
      if (maxBytes !== undefined && bytes.length > maxBytes) throw new GitBlobSizeLimitError(path, bytes.length, maxBytes)
      return Uint8Array.from(bytes)
    },
  }
  const kit = { name: 'fixture', version: '1.0', resources: {}, skills: [
    { name: 'example', version: '1.0', content: 'Complete method.', metadata: { schemaYaml: 'type: object\n' } },
  ] }
  const evidence = await createAdvisoryEvidence({ git, commit: COMMIT, projectId: PROJECT, signal: freshSignal(),
    resolveKit: () => kit, resolveBundle: () => undefined })
  return { evidence, blobs, paths, calls, projectText,
    reads: () => calls.filter(call => call.kind === 'read'),
    intercept(callback) { onRead = callback } }
}

function assertComplete(snapshot, expected) {
  assert.equal(snapshot.project, PROJECT)
  assert.equal(snapshot.checkpoint, COMMIT)
  assert.equal(snapshot.complete, true)
  assert.deepEqual(snapshot.files.map(file => file.path).sort(), [...expected.keys()].sort())
  for (const file of snapshot.files) {
    const content = expected.get(file.path)
    assert.deepEqual(file, { checkpoint: COMMIT, path: file.path, offset: 0,
      totalCharacters: Array.from(content).length, complete: true, content })
  }
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot), 'utf8') <= MAX_SERIALIZED_BYTES)
}

test('creating ordinary evidence does not pre-read facts or alter the existing tools', async () => {
  const f = await fixture()
  assert.deepEqual(f.reads().map(call => call.path), ['project.json'])
  assert.equal(f.calls.filter(call => call.kind === 'list').length, 1)
  assert.deepEqual(f.evidence.list('design_files/'), ['design_files/facts.txt'])
  assert.equal(f.evidence.resource('example', 'schema.yaml', 0, 12000, freshSignal()).content, 'type: object\n')
  assert.equal(f.reads().length, 1, 'discovery and Bundle resources must not eagerly read project facts')
})

test('a small snapshot contains every allowed original fact page, including empty, Unicode and non-JSON artifacts', async () => {
  const entries = {
    'design_files/empty.txt': '',
    'design_files/intent/原文.json': '{\r\n  "intent": "中文 😀", "number": 9007199254740993\r\n}\r\n',
    'design_files/artifacts/design.svg': '<svg><!-- saved artifact, not a JSON record --></svg>\n',
    'README.md': 'Outside canonical project evidence.',
    'design_files/_experiences/demo/view.json': 'Derived experience, not canonical facts.',
  }
  const f = await fixture(entries)
  const fullManifest = JSON.stringify(f.evidence.manifest)
  const expected = new Map([['project.json', f.projectText],
    ...Object.entries(entries).filter(([path]) => path.startsWith('design_files/') && !path.startsWith('design_files/_experiences/'))])
  const snapshot = await f.evidence.readSmallSnapshot(freshSignal())
  assertComplete(snapshot, expected)
  assert.equal(JSON.stringify(f.evidence.manifest), fullManifest)
  for (const page of snapshot.files) assert.deepEqual(await f.evidence.read(page.path, 0, 12000, freshSignal()), page)
  assert.deepEqual(f.reads().map(call => call.path).sort(), [...expected.keys()].sort(), 'each immutable file is read only once')
  assert.ok(f.calls.every(call => call.commit === COMMIT), 'all discovery and content use the same immutable checkpoint')
})

test('more than four allowed files falls back before pre-reading and leaves ordinary reads available', async () => {
  const f = await fixture(Object.fromEntries(Array.from({ length: 4 }, (_, index) => [`design_files/${index}.txt`, `Fact ${index}`])))
  assert.equal(await f.evidence.readSmallSnapshot(freshSignal()), undefined)
  assert.deepEqual(f.reads().map(call => call.path), ['project.json'])
  assert.equal((await f.evidence.read('design_files/3.txt', 0, 12000, freshSignal())).content, 'Fact 3')
})

test('aggregate UTF-8 bytes include cached files and pass only the remaining small limit to Git', async () => {
  const first = 'design_files/a.txt', second = 'design_files/b.txt'
  const text = '界'.repeat(6000)
  const f = await fixture({ [first]: text, [second]: text })
  await f.evidence.read(first, 0, 12000, freshSignal())
  assert.equal(await f.evidence.readSmallSnapshot(freshSignal()), undefined, 'two individually short pages exceed the aggregate raw-byte limit')
  const smallRead = f.reads().find(call => call.path === second)
  assert.equal(smallRead.maxBytes, MAX_RAW_BYTES - Buffer.byteLength(f.projectText) - Buffer.byteLength(text))
  assert.ok(smallRead.maxBytes > 0 && smallRead.maxBytes < Buffer.byteLength(text))
  assert.equal(f.reads().filter(call => call.path === first).length, 1, 'warm files are not read from Git again')
  assert.equal((await f.evidence.read(second, 0, 12000, freshSignal())).content, text, 'small-snapshot fallback must not narrow the normal reader')
  const warmCalls = f.reads().length
  assert.equal(await f.evidence.readSmallSnapshot(freshSignal()), undefined, 'cached bytes still count toward snapshot completeness limits')
  assert.equal(f.reads().length, warmCalls)
})

test('an oversized first file is rejected by the low Git byte cap before being exposed as a partial snapshot', async () => {
  const path = 'design_files/large.txt'
  const f = await fixture({ [path]: 'x'.repeat(MAX_RAW_BYTES + 1) })
  assert.equal(await f.evidence.readSmallSnapshot(freshSignal()), undefined)
  const call = f.reads().find(call => call.path === path)
  assert.equal(call.maxBytes, MAX_RAW_BYTES - Buffer.byteLength(f.projectText))
  const page = await f.evidence.read(path, 0, 12000, freshSignal())
  assert.equal(page.complete, false)
  assert.equal(page.nextOffset, 12000)
  assert.equal(page.totalCharacters, MAX_RAW_BYTES + 1)
})

test('JSON escaping is counted in the final serialized snapshot limit', async () => {
  const path = 'design_files/escaped.txt', text = '\0'.repeat(6000)
  const f = await fixture({ [path]: text })
  assert.ok(Buffer.byteLength(f.projectText) + Buffer.byteLength(text) < MAX_RAW_BYTES)
  assert.ok(Buffer.byteLength(JSON.stringify(text)) > MAX_SERIALIZED_BYTES)
  assert.equal(await f.evidence.readSmallSnapshot(freshSignal()), undefined)
  assert.equal((await f.evidence.read(path, 0, 12000, freshSignal())).content, text)
})

test('a page longer than 12000 Unicode characters falls back without hiding its ordinary continuation', async () => {
  const path = 'design_files/paged.txt', text = 'x'.repeat(12001)
  const f = await fixture({ [path]: text })
  assert.equal(await f.evidence.readSmallSnapshot(freshSignal()), undefined)
  const first = await f.evidence.read(path, 0, 12000, freshSignal())
  assert.equal(first.complete, false)
  assert.equal(first.nextOffset, 12000)
  const last = await f.evidence.read(path, first.nextOffset, 12000, freshSignal())
  assert.equal(last.complete, true)
  assert.equal(first.content + last.content, text)
})

test('the complete-page boundary counts Unicode characters rather than UTF-16 code units', async () => {
  const path = 'design_files/unicode.txt', text = '😀'.repeat(4000) + 'x'.repeat(8000)
  assert.equal(Array.from(text).length, 12000)
  assert.ok(text.length > 12000)
  const f = await fixture({ [path]: text })
  assertComplete(await f.evidence.readSmallSnapshot(freshSignal()), new Map([['project.json', f.projectText], [path, text]]))
})

test('original UTF-8 BOM is retained and counts toward the complete-page boundary', async () => {
  const path = 'design_files/bom.txt', text = '\uFEFF' + 'x'.repeat(11999)
  const f = await fixture({ [path]: text })
  assertComplete(await f.evidence.readSmallSnapshot(freshSignal()), new Map([['project.json', f.projectText], [path, text]]))
  assert.equal((await f.evidence.read(path, 0, 12000, freshSignal())).content, text)
  const longer = await fixture({ [path]: text + 'x' })
  assert.equal(await longer.evidence.readSmallSnapshot(freshSignal()), undefined)
  const first = await longer.evidence.read(path, 0, 12000, freshSignal())
  assert.equal(first.totalCharacters, 12001); assert.equal(first.complete, false)
  assert.equal(first.content, text)
  assert.equal((await longer.evidence.read(path, first.nextOffset, 12000, freshSignal())).content, 'x')
})

test('successful repeated snapshots reuse cache and retain the remaining raw-byte cap', async () => {
  const first = 'design_files/a.txt', second = 'design_files/b.txt'
  const f = await fixture({ [first]: 'a'.repeat(11000), [second]: 'b'.repeat(10000) })
  const expected = new Map([['project.json', f.projectText], [first, 'a'.repeat(11000)], [second, 'b'.repeat(10000)]])
  assertComplete(await f.evidence.readSmallSnapshot(freshSignal()), expected)
  const calls = f.reads()
  assert.equal(calls.find(call => call.path === first).maxBytes, MAX_RAW_BYTES - Buffer.byteLength(f.projectText))
  assert.equal(calls.find(call => call.path === second).maxBytes, MAX_RAW_BYTES - Buffer.byteLength(f.projectText) - 11000)
  const warmCalls = f.reads().length
  assertComplete(await f.evidence.readSmallSnapshot(freshSignal()), expected)
  assert.equal(f.reads().length, warmCalls, 'prefetch must share the same immutable file cache as the ordinary reader')
})

test('snapshot preparation cannot bypass an exhausted shared read budget', async () => {
  const f = await fixture()
  for (let index = 0; index < 256; index++) f.evidence.list('')
  await assert.rejects(f.evidence.readSmallSnapshot(freshSignal()), /read budget exhausted/)
  assert.deepEqual(f.reads().map(call => call.path), ['project.json'])
})

test('the small read cap also respects the existing total-byte budget', async () => {
  const good = 'design_files/a.txt', bad = 'design_files/z.bin'
  const f = await fixture({ [good]: '0123456789abcdef', [bad]: Buffer.alloc(MAX_FILE_BYTES, 255) })
  for (let index = 0; index < 7; index++) {
    await assert.rejects(f.evidence.read(bad, 0, 12000, freshSignal()), error => error instanceof TypeError)
  }
  const remaining = MAX_TOTAL_BYTES - Buffer.byteLength(f.projectText) - 7 * MAX_FILE_BYTES
  f.blobs.set(bad, Buffer.alloc(remaining - 8, 255))
  await assert.rejects(f.evidence.read(bad, 0, 12000, freshSignal()), error => error instanceof TypeError)
  assert.equal(await f.evidence.readSmallSnapshot(freshSignal()), undefined)
  assert.equal(f.reads().find(call => call.path === good).maxBytes, 8, 'the prefetch cap must not reset or exceed the shared remaining bytes')
  await assert.rejects(f.evidence.read(good, 0, 12000, freshSignal()), error => error instanceof GitBlobSizeLimitError)
})

test('a non-UTF-8 artifact makes optional text preparation ineligible while ordinary reads remain fatal', async () => {
  const f = await fixture({ 'design_files/binary.bin': Buffer.from([255, 254, 128]) })
  assert.equal(await f.evidence.readSmallSnapshot(freshSignal()), undefined)
  await assert.rejects(f.evidence.read('design_files/binary.bin', 0, 12000, freshSignal()), error => error instanceof TypeError)
  assert.equal((await f.evidence.read('project.json', 0, 12000, freshSignal())).content, f.projectText)
})

test('non-UTF-8 cached metadata omits the optional snapshot without changing the existing parser or cached read', async () => {
  const f = await fixture({}, { projectBytes(bytes) {
    bytes[bytes.indexOf('Small snapshot')] = 255
    return bytes
  } })
  assert.equal(await f.evidence.readSmallSnapshot(freshSignal()), undefined)
  assert.equal((await f.evidence.read('project.json', 0, 12000, freshSignal())).content, f.blobs.get('project.json').toString('utf8'))
})

test('an arbitrary reader TypeError cannot impersonate optional non-text ineligibility', async () => {
  const f = await fixture(), failure = new TypeError('arbitrary upstream error')
  f.intercept(call => { if (call.path !== 'project.json') throw failure })
  await assert.rejects(f.evidence.readSmallSnapshot(freshSignal()), error => error === failure)
})

test('a manifest-listed source becoming unavailable is not hidden as a small-snapshot fallback', async () => {
  const path = 'design_files/facts.txt', f = await fixture({ [path]: 'Saved facts.' })
  f.blobs.delete(path)
  await assert.rejects(f.evidence.readSmallSnapshot(freshSignal()), /committed file is unavailable/)
})

for (const message of ['committed blob integrity mismatch', 'committed artifact is not a regular file', 'untyped error exceeds 32768 bytes']) {
  test(`snapshot preparation propagates ${message}`, async () => {
    const f = await fixture()
    const failure = new Error(message)
    f.intercept(call => { if (call.path !== 'project.json') throw failure })
    await assert.rejects(f.evidence.readSmallSnapshot(freshSignal()), error => error === failure,
      'only GitBlobSizeLimitError may be converted to the size fallback')
  })
}

test('a pre-cancelled snapshot reads nothing and does not return cached facts as success', async () => {
  const f = await fixture()
  await f.evidence.read('design_files/facts.txt', 0, 12000, freshSignal())
  const before = f.reads().length
  const reason = new Error('cancel before snapshot'), controller = new AbortController()
  controller.abort(reason)
  await assert.rejects(f.evidence.readSmallSnapshot(controller.signal), error => error === reason)
  assert.equal(f.reads().length, before)
})

test('cancellation at raw-read completion cannot produce a successful or silently omitted snapshot', async () => {
  const f = await fixture()
  const reason = new Error('cancel completing snapshot'), controller = new AbortController()
  f.intercept(call => {
    if (call.path === 'design_files/facts.txt') {
      assert.equal(call.signal, controller.signal)
      controller.abort(reason)
    }
  })
  await assert.rejects(f.evidence.readSmallSnapshot(controller.signal), error => error === reason)
  f.intercept(undefined)
  assert.equal((await f.evidence.readSmallSnapshot(freshSignal())).complete, true, 'cancellation must not poison a later valid attempt')
})

test('snapshot and ordinary reads share the same queued immutable read', async () => {
  const f = await fixture()
  let entered, release
  const started = new Promise(resolve => { entered = resolve })
  const held = new Promise(resolve => { release = resolve })
  f.intercept(async call => {
    if (call.path === 'design_files/facts.txt') { entered(); await held }
  })
  const ordinary = f.evidence.read('design_files/facts.txt', 0, 12000, freshSignal())
  await started
  let snapshot
  try { snapshot = f.evidence.readSmallSnapshot(freshSignal()) }
  finally { release() }
  const [page, result] = await Promise.all([ordinary, snapshot])
  assert.deepEqual(result.files.find(file => file.path === page.path), page)
  assert.equal(f.reads().filter(call => call.path === page.path).length, 1)
})
