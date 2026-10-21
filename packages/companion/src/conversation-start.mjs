/** Durable start of one project's design conversation; never reads old turns. */
import { open, realpath, mkdir, writeFile, link, unlink, rename } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { join, dirname, basename } from 'node:path'
import { nativeScope } from './native-identity.mjs'

const HEADER_BYTES = 1024 * 1024
const ANCHOR_BYTES = 256
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

export async function readCodexHeader(file, { threadId, projectRoot, parentRunId }) {
  let bytes = Buffer.alloc(0), end = -1
  while (bytes.length < HEADER_BYTES && end < 0) {
    const block = Buffer.alloc(Math.min(4096, HEADER_BYTES - bytes.length))
    const { bytesRead } = await file.read(block, 0, block.length, bytes.length)
    if (!bytesRead) break
    bytes = Buffer.concat([bytes, block.subarray(0, bytesRead)])
    end = bytes.indexOf(10)
  }
  if (end < 0) {
    const error = new Error(bytes.length === HEADER_BYTES ? 'Native transcript metadata exceeds limit.' : 'Native transcript metadata is incomplete.')
    if (bytes.length < HEADER_BYTES) error.code = 'DESIGN_TRANSCRIPT_PENDING'
    throw error
  }
  let event
  try { event = JSON.parse(bytes.subarray(0, end).toString('utf8')) }
  catch { throw new Error('Invalid native transcript metadata.') }
  if (event.type !== 'session_meta' || event.payload?.id !== threadId) throw new Error('Codex transcript UUID does not match the bound conversation.')
  if (typeof event.payload.cwd !== 'string' || await realpath(event.payload.cwd) !== await realpath(projectRoot)) throw new Error('Codex transcript cwd does not match the bound project.')
  const child = event.payload.source?.subagent
  if (parentRunId ? child?.thread_spawn?.parent_thread_id !== parentRunId : child !== undefined) throw new Error('Codex transcript parent does not match the bound conversation.')
}

export async function transcriptAnchor(file, offset) {
  const bytes = Buffer.alloc(Math.min(ANCHOR_BYTES, offset))
  const { bytesRead } = await file.read(bytes, 0, bytes.length, offset - bytes.length)
  if (bytesRead !== bytes.length) throw new Error('Native transcript boundary is no longer available.')
  return { hash: digest(bytes), length: bytes.length, partial: offset > 0 && bytes.at(-1) !== 10 }
}

export async function verifyTranscriptBoundary(file, stat, boundary) {
  if (!Number.isSafeInteger(boundary?.startOffset) || boundary.startOffset < 0
    || boundary.identity !== `${stat.dev}:${stat.ino}` || stat.size < boundary.startOffset
    || boundary.anchor?.length !== Math.min(ANCHOR_BYTES, boundary.startOffset)
    || typeof boundary.anchor.hash !== 'string' || !/^[a-f0-9]{64}$/.test(boundary.anchor.hash)
    || typeof boundary.anchor.partial !== 'boolean') throw new Error('Native transcript design-session boundary does not match this file.')
  const anchor = await transcriptAnchor(file, boundary.startOffset)
  if (anchor.hash !== boundary.anchor.hash || anchor.partial !== boundary.anchor.partial) throw new Error('Native transcript design-session boundary was changed.')
}

const pendingError = () => Object.assign(new Error('Native transcript is not ready for a design-session start.'), { code: 'DESIGN_TRANSCRIPT_PENDING' })

export async function establishConversationStart({ stateRoot, projectId, projectRoot, nativeCwd,
  threadId, transcriptPath, openFile = open, host = 'codex', readHeader = readCodexHeader,
  purpose = 'presentation', findStart }) {
  if (!['presentation', 'main'].includes(purpose) || !(purpose === 'main'
    ? ['codex', 'workbuddy', 'qwenwork', 'qoder', 'claude-code'] : ['codex', 'workbuddy']).includes(host)) throw new Error('Unsupported conversation boundary host.')
  if (typeof projectId !== 'string' || !/^[\w-]+$/.test(projectId)) throw new Error('Exact project identity required for conversation start.')
  const directory = join(stateRoot, projectId, 'native-bindings', nativeScope(host, threadId))
  const path = join(directory, purpose === 'main' ? 'main-conversation-start.json' : 'conversation-start.json')
  const binding = { projectId, host, threadId, projectRoot: await realpath(projectRoot),
    nativeCwd: await realpath(nativeCwd), transcriptPath: join(await realpath(dirname(transcriptPath)), basename(transcriptPath)) }
  const load = async () => {
    let stored
    try { stored = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK) }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
    try {
      const info = await stored.stat()
      if (!info.isFile() || info.size > 16 * 1024) throw new Error('Invalid design conversation start record.')
      const record = JSON.parse(await stored.readFile('utf8'))
      if (record.version !== 1 || !Number.isFinite(Date.parse(record.activatedAt))
        || ![undefined, 'pending', 'active'].includes(record.status)
        || Object.entries(binding).some(([key, value]) => record[key] !== value)
        || !Number.isSafeInteger(record.startOffset) || record.startOffset < 0
        || typeof record.identity !== 'string' || !/^\d+:\d+$/.test(record.identity)
        || record.anchor?.length !== Math.min(ANCHOR_BYTES, record.startOffset)
        || typeof record.anchor.hash !== 'string' || !/^[a-f0-9]{64}$/.test(record.anchor.hash)
        || typeof record.anchor.partial !== 'boolean') throw new Error('Design conversation start belongs to another project or conversation, or is invalid.')
      return record
    } finally { await stored.close() }
  }
  // Validate owner state independently: a missing transcript must not hide corrupt state.
  let record = await load(), file
  try {
    try { file = await openFile(transcriptPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK) }
    catch (error) { if (error.code === 'ENOENT') throw pendingError(); throw error }
    const stat = await file.stat()
    const capturedAt = new Date().toISOString()
    if (!stat.isFile()) throw new Error('Codex transcript is not a regular file.')
    if (record) await verifyTranscriptBoundary(file, stat, record)
    let incomplete
    try { await readHeader(file, { threadId, projectRoot: binding.nativeCwd }) }
    catch (error) { if (error.code !== 'DESIGN_TRANSCRIPT_PENDING') throw error; incomplete = error }
    const publish = async (next, replace = false) => {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      let temporary = join(directory, `${randomUUID()}.tmp`)
      try {
        await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' })
        if (replace) { await rename(temporary, path); temporary = undefined; return next }
        try { await link(temporary, path); return next }
        catch (error) { if (error.code !== 'EEXIST') throw error; return await load() }
      } finally { if (temporary) await unlink(temporary) }
    }
    if (!record) {
      const startOffset = !incomplete && purpose === 'main' ? await findStart(file, stat) : stat.size
      if (!Number.isSafeInteger(startOffset) || startOffset < 0 || startOffset > stat.size) throw new Error('Invalid native main conversation start.')
      record = await publish({ version: 1, ...binding, activatedAt: capturedAt,
        status: incomplete ? 'pending' : 'active', identity: `${stat.dev}:${stat.ino}`,
        startOffset, anchor: await transcriptAnchor(file, startOffset) })
      await verifyTranscriptBoundary(file, await file.stat(), record)
    }
    if (incomplete) throw incomplete
    if (record.status === 'pending') {
      const startOffset = purpose === 'main' ? await findStart(file, await file.stat()) : record.startOffset
      record = await publish({ ...record, status: 'active', startOffset, anchor: await transcriptAnchor(file, startOffset) }, true)
    }
    return record
  } finally {
    await file?.close()
  }
}

/** Retry only unavailable transcript evidence; invalid initial identity remains fatal. */
export async function createDesignConversationObserver(options) {
  let observer, busy
  const activate = async () => {
    const startBoundary = await establishConversationStart(options)
    observer = options.createObserver({ path: options.transcriptPath, threadId: options.threadId,
      projectRoot: options.nativeCwd, startBoundary, ...(options.openFile ? { openFile: options.openFile } : {}) })
  }
  try { await activate() } catch (error) { if (error.code !== 'DESIGN_TRANSCRIPT_PENDING') throw error }
  const read = async () => {
    try {
      if (!observer) await activate()
      return await observer.read()
    } catch (error) {
      return { available: false, threadId: options.threadId, recordedStatus: 'unknown', rows: [], omitted: 0,
        ...(error.code === 'DESIGN_TRANSCRIPT_PENDING' ? { designSessionPending: true } : {}),
        error: error.code === 'DESIGN_TRANSCRIPT_PENDING'
          ? '原生日志尚未就绪，尚无可用同步起点；首次可验证后开始同步，等待期间消息不保证包含。'
          : `原生日志暂不可读：${error.code ?? error.message}` }
    }
  }
  return { read() { if (!busy) busy = read().finally(() => { busy = undefined }); return busy } }
}
