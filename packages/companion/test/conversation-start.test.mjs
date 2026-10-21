import assert from 'node:assert/strict'
import { test } from 'node:test'
import { open, mkdtemp, mkdir, writeFile, appendFile, readFile, stat, rename, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { establishConversationStart, createDesignConversationObserver } from '../src/conversation-start.mjs'
import { createCodexTranscript } from '../src/codex-transcript.mjs'

const threadId = '00000000-0000-4000-8000-000000000001'
const line = value => JSON.stringify(value) + '\n'
const message = (id, text) => line({ type: 'event_msg', payload: { type: 'item_completed', turn_id: 't', item: { type: 'AgentMessage', id, content: [{ type: 'Text', text }] } } })
const event = type => line({ type: 'event_msg', payload: { type } })
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'conversation-start-'))
  try {
    const projectRoot = join(root, 'project'); await mkdir(projectRoot)
    const transcriptPath = join(root, 'native.jsonl')
    const header = line({ type: 'session_meta', payload: { id: threadId, cwd: projectRoot } })
    await writeFile(transcriptPath, header + event('task_started') + message('old', 'Old native history'))
    const options = { stateRoot: join(root, 'state'), projectId: 'project-one', projectRoot, nativeCwd: projectRoot, transcriptPath, threadId }
    const observer = boundary => createCodexTranscript({ path: transcriptPath, threadId, projectRoot, startBoundary: boundary })
    await fn({ root, header, options, observer, transcriptPath })
  } finally { await rm(root, { recursive: true, force: true }) }
}

test('design activation excludes old history, persists one concurrent winner, and restores the same start after append', async () => fixture(async ({ options, observer, transcriptPath }) => {
  const records = await Promise.all(Array.from({ length: 3 }, () => establishConversationStart(options)))
  records.forEach(record => assert.deepEqual(record, records[0]))
  const boundary = records[0], live = observer(boundary)
  assert.equal((await live.read()).recordedStatus, 'unknown')
  assert.deepEqual((await live.read()).rows, [])
  await appendFile(transcriptPath, event('task_started') + message('new', 'New design message') + event('task_complete'))
  const result = await live.read()
  assert.equal(result.designSessionStartedAt, boundary.activatedAt)
  assert.deepEqual(result.rows.map(row => row.text), ['New design message'])
  assert.equal(result.recordedStatus, 'completed')
  const restored = await establishConversationStart(options)
  assert.deepEqual(restored, boundary)
  assert.deepEqual((await observer(restored).read()).rows, result.rows)
  const stored = join(options.stateRoot, options.projectId, 'native-bindings', threadId, 'conversation-start.json')
  if (process.platform !== 'win32') assert.equal((await stat(stored)).mode & 0o777, 0o600)
  assert.ok(!(await readFile(stored, 'utf8')).includes('New design message'))
  const other = join(options.stateRoot, 'another-cwd'); await mkdir(other)
  await assert.rejects(establishConversationStart({ ...options, nativeCwd: other }), /another project/)
  const record = JSON.parse(await readFile(stored, 'utf8')); record.projectId = 'wrong-project'
  await writeFile(stored, JSON.stringify(record))
  await assert.rejects(establishConversationStart(options), /another project/)
}))

test('sparse gigabyte log activation reads only a bounded header and anchor, then reads new append bytes', async () => fixture(async ({ options, transcriptPath }) => {
  const file = await open(transcriptPath, 'r+')
  try { await file.truncate(1024 * 1024 * 1024); await file.write(Buffer.from('\n'), 0, 1, 1024 * 1024 * 1024 - 1) } finally { await file.close() }
  let readBytes = 0
  const openFile = async (...args) => {
    const fd = await open(...args)
    return { stat: () => fd.stat(), close: () => fd.close(), async read(...readArgs) {
      const result = await fd.read(...readArgs); readBytes += result.bytesRead; return result
    } }
  }
  const boundary = await establishConversationStart({ ...options, openFile })
  assert.equal(boundary.startOffset, 1024 * 1024 * 1024)
  assert.ok(readBytes <= 4096 + 512, `${readBytes} bytes must not scan old history`)
  const live = createCodexTranscript({ path: transcriptPath, projectRoot: options.projectRoot, threadId, startBoundary: boundary, openFile })
  readBytes = 0
  assert.deepEqual((await live.read()).rows, [])
  assert.ok(readBytes <= 4096 + 512)
  await appendFile(transcriptPath, message('new', 'Only this session'))
  readBytes = 0
  assert.equal((await live.read()).rows[0].text, 'Only this session')
  assert.ok(readBytes <= 4096 + 1024)
}))

test('a pre-activation partial UTF8 line is skipped; subsequent complete UTF8 and lifecycle are retained', async () => fixture(async ({ options, observer, transcriptPath }) => {
  const old = Buffer.from(message('partial-old', '旧消息中文'))
  const split = old.indexOf(Buffer.from('中文')) + 1
  await appendFile(transcriptPath, old.subarray(0, split))
  const boundary = await establishConversationStart(options)
  assert.equal(boundary.anchor.partial, true)
  const live = observer(boundary)
  assert.equal((await live.read()).catchingUp, true)
  const next = Buffer.from(message('new', '新消息中文'))
  await appendFile(transcriptPath, Buffer.concat([old.subarray(split), Buffer.from(event('task_started')), next.subarray(0, next.length - 5)]))
  assert.equal((await live.read()).recordedStatus, 'unknown')
  await appendFile(transcriptPath, next.subarray(next.length - 5))
  const result = await live.read()
  assert.deepEqual(result.rows.map(row => row.text), ['新消息中文'])
  assert.equal(result.recordedStatus, 'running')
}))

test('wrong files, replacement and same-inode truncate/regrow cannot reset into old history', async () => fixture(async ({ options, observer, transcriptPath, header }) => {
  const boundary = await establishConversationStart(options), live = observer(boundary)
  await appendFile(transcriptPath, message('new', 'Must not survive a rewritten cursor'))
  assert.equal((await live.read()).available, true)
  const before = await stat(transcriptPath)
  await writeFile(transcriptPath, header + ' '.repeat(before.size + 50))
  assert.equal((await stat(transcriptPath)).ino, before.ino)
  assert.equal((await live.read()).available, false)
  assert.equal((await live.read()).recordedStatus, 'unknown')
  await assert.rejects(establishConversationStart(options), /boundary/)
  await rename(transcriptPath, `${transcriptPath}.old`)
  await writeFile(transcriptPath, header + message('other', 'Replacement'))
  assert.equal((await observer(boundary).read()).available, false)
  await rm(transcriptPath)
  await symlink(`${transcriptPath}.old`, transcriptPath)
  await assert.rejects(establishConversationStart(options))
}))


test('cursor guard rejects rewritten post-activation bytes even when the saved start anchor is unchanged', async () => fixture(async ({ options, observer, transcriptPath }) => {
  const prefix = await readFile(transcriptPath)
  const boundary = await establishConversationStart(options), live = observer(boundary)
  await appendFile(transcriptPath, message('new', 'Original appended message'))
  await live.read()
  await writeFile(transcriptPath, Buffer.concat([prefix, Buffer.from(message('replacement', 'Changed appended message'.repeat(5)))]))
  const result = await live.read()
  assert.equal(result.available, false)
  assert.match(result.error, /cursor was changed/)
  assert.equal((await live.read()).available, false, 'error reset cannot discard the old cursor guard')
}))

test('session-scoped reader keeps a bounded visible list, rejects overlong lines, and merges concurrent reads', async () => fixture(async ({ options, observer, transcriptPath }) => {
  const boundary = await establishConversationStart(options), live = observer(boundary)
  await appendFile(transcriptPath, Array.from({ length: 205 }, (_, i) => message(`new-${i}`, `message ${i}`)).join(''))
  const first = live.read(), second = live.read()
  assert.equal(first, second)
  const result = await first
  assert.equal(result.rows.length, 200)
  assert.equal(result.omitted, 5, 'pre-session messages are not counted as dropped display rows')
  assert.equal(result.rows[0].text, 'message 5')
  await appendFile(transcriptPath, 'x'.repeat(8 * 1024 * 1024 + 1) + '\n')
  let overlong
  for (let i = 0; i < 5; i++) { overlong = await live.read(); if (!overlong.available) break }
  assert.equal(overlong.available, false)
  assert.match(overlong.error, /exceeds the observer limit/)
}))


test('each session read revalidates metadata even if inode and boundary suffix have not changed', async () => fixture(async ({ options, observer, transcriptPath, header }) => {
  // Keep a long pre-activation suffix so changing the header leaves both anchors intact.
  await appendFile(transcriptPath, message('old-padding', 'Old content'.repeat(100)))
  const boundary = await establishConversationStart(options), live = observer(boundary)
  assert.equal((await live.read()).available, true)
  const fd = await open(transcriptPath, 'r+')
  try {
    const changed = Buffer.from(header.replace(threadId, '00000000-0000-4000-8000-000000000002'))
    await fd.write(changed, 0, changed.length, 0)
  } finally { await fd.close() }
  assert.equal((await live.read()).available, false)
}))


test('missing exact transcript allows startup and activates only at first valid evidence, without replaying waiting history', async () => fixture(async ({ options, transcriptPath, header }) => {
  await rm(transcriptPath)
  const live = await createDesignConversationObserver({ ...options, createObserver: createCodexTranscript })
  const pending = await live.read()
  assert.equal(pending.available, false)
  assert.equal(pending.recordedStatus, 'unknown')
  assert.equal(pending.designSessionPending, true)
  assert.equal(Object.hasOwn(pending, 'designSessionStartedAt'), false)
  await writeFile(transcriptPath, header + message('waiting', 'Not promised before activation'))
  const ready = await live.read()
  assert.equal(ready.available, true)
  assert.deepEqual(ready.rows, [])
  assert.ok(ready.designSessionStartedAt)
  await appendFile(transcriptPath, message('after', 'After actual activation'))
  assert.equal((await live.read()).rows[0].text, 'After actual activation')
  const restarted = await createDesignConversationObserver({ ...options, createObserver: createCodexTranscript })
  assert.equal((await restarted.read()).rows[0].text, 'After actual activation')
}))

test('incomplete metadata preserves the initial candidate offset across observer restarts', async () => fixture(async ({ options, transcriptPath, header }) => {
  const firstHalf = header.slice(0, 40)
  await writeFile(transcriptPath, firstHalf)
  const first = await createDesignConversationObserver({ ...options, createObserver: createCodexTranscript })
  assert.equal((await first.read()).designSessionPending, true)
  const stored = join(options.stateRoot, options.projectId, 'native-bindings', threadId, 'conversation-start.json')
  const candidate = JSON.parse(await readFile(stored, 'utf8'))
  assert.equal(candidate.startOffset, Buffer.byteLength(firstHalf))
  assert.equal(candidate.status, 'pending')
  const restarted = await createDesignConversationObserver({ ...options, createObserver: createCodexTranscript })
  await appendFile(transcriptPath, header.slice(40) + message('after-candidate', 'This belongs to the new session'))
  const result = await restarted.read()
  assert.equal(result.rows[0].text, 'This belongs to the new session')
  assert.equal(result.designSessionStartedAt, candidate.activatedAt)
  const active = JSON.parse(await readFile(stored, 'utf8'))
  assert.equal(active.startOffset, candidate.startOffset)
  assert.equal(active.status, 'active')
}))

test('missing transcript cannot conceal corrupted owner state, missing cwd, or invalid identity', async () => fixture(async ({ options, transcriptPath, header }) => {
  await establishConversationStart(options)
  const bytes = await readFile(transcriptPath)
  await rename(transcriptPath, `${transcriptPath}.saved`)
  const suspended = await createDesignConversationObserver({ ...options, createObserver: createCodexTranscript })
  assert.equal((await suspended.read()).designSessionPending, true)
  await rename(`${transcriptPath}.saved`, transcriptPath)
  assert.equal((await suspended.read()).available, true)
  await rm(transcriptPath)
  const stored = join(options.stateRoot, options.projectId, 'native-bindings', threadId, 'conversation-start.json')
  await writeFile(stored, '{}')
  await assert.rejects(createDesignConversationObserver({ ...options, createObserver: createCodexTranscript }), /invalid/)
  await rm(stored)
  await assert.rejects(createDesignConversationObserver({ ...options, nativeCwd: join(options.projectRoot, 'missing'), createObserver: createCodexTranscript }), { code: 'ENOENT' })
  await writeFile(transcriptPath, header.replace(threadId, '00000000-0000-4000-8000-000000000002'))
  await assert.rejects(createDesignConversationObserver({ ...options, createObserver: createCodexTranscript }), /UUID/)
  await writeFile(transcriptPath, 'secret invalid metadata\n')
  await assert.rejects(createDesignConversationObserver({ ...options, createObserver: createCodexTranscript }), error => /Invalid native transcript metadata/.test(error.message) && !error.message.includes('secret'))
}))
