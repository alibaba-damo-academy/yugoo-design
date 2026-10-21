/** Shared native FileChanged/asyncRewake inbox. Host adapters supply identity, not a scheduler. */
import { constants } from 'node:fs'
import { link, mkdir, open, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, isAbsolute, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export function createNativeHookTransport({ host, label, noticeFile, inspectProcess, nativeHookProcess, registrationEvents = ['SessionStart'], requireTranscript = false, resumeEvents = [] }) {
  const prefixes = { qoder: 'qoder', 'claude-code': 'claude', qwenwork: 'qwenwork' }
  const prefix = prefixes[host]
  if (!prefix || noticeFile !== `.design-system-${prefix}-notify`) throw new Error('Unsupported native Hook adapter.')
  if (resumeEvents.length && !requireTranscript) throw Error('Resumable notifications require exact transcript binding.')
  const resumeRetentionMs = 24 * 60 * 60 * 1000
  const marker = `design-system-${prefix}-hook:`
  const defaultRoot = () => join(homedir(), '.local/state/design-system', `${prefix}-hooks`)
  const windowsStorage = process.platform === 'win32' ? import('./windows-private-storage.mjs') : undefined
  async function assertPrivate(path, stat) {
    if (windowsStorage) {
      const checked = await (await windowsStorage).assertWindowsPrivate(path)
      if (checked.dev !== stat.dev || checked.ino !== stat.ino) throw new Error('Private notification path changed during inspection.')
    }
    else if ((stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) throw new Error('Invalid private notification.')
  }
  async function privateDirectory(path) {
    if (windowsStorage) await (await windowsStorage).ensureWindowsPrivateDirectory(path)
    else await mkdir(path, { recursive: true, mode: 0o700 })
  }
  async function privateWrite(path, text, options) {
    if (windowsStorage) await (await windowsStorage).assertWindowsPrivate(dirname(path), { directory: true })
    await writeFile(path, text, options)
    if (windowsStorage) await (await windowsStorage).assertWindowsPrivate(path)
  }
  async function paths({ sessionId, hookRoot = defaultRoot() }) {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sessionId ?? '')) throw new Error(`Exact ${label} session UUID required.`)
    return { directory: join(hookRoot, sessionId) }
  }
  async function privateJson(path) {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.size > 262144) throw new Error('Invalid private notification.')
      await assertPrivate(path, stat)
      return JSON.parse(await file.readFile('utf8'))
    } finally { await file.close() }
  }

  async function createConnection(options) {
    const location = await paths(options)
    const binding = await privateJson(join(location.directory, 'binding.json')).catch(error => {
      if (error.code === 'ENOENT') throw new Error(`${label} notification Hook is not registered. Load the updated plugin in this session and reopen the Panel.`)
      throw error
    })
    if (requireTranscript) {
      if (!options.nativeCwd || !options.transcriptPath || await realpath(options.nativeCwd) !== binding.cwd || await realpath(options.transcriptPath) !== binding.transcriptPath) throw new Error(`${label} native workspace/transcript does not match its Hook binding.`)
    }
    location.cwd = binding.cwd
    location.trigger = join(binding.cwd, noticeFile)
    const resolveSession = options.resolveSession ?? (async () => {
      const binding = await privateJson(join(location.directory, 'binding.json')).catch(error => {
        if (error.code === 'ENOENT') throw new Error(`${label} notification Hook is not registered. Load the updated plugin in this session and reopen the Panel.`)
        throw error
      })
      const current = await inspectProcess(binding.pid)
      if (!current.supported || current.procStart !== binding.procStart) throw new Error(`${label} instance has ended; reopen the Panel.`)
      return current
    })
    const initial = await resolveSession(options)
    const instance = JSON.stringify([initial.pid, initial.procStart])
    await privateDirectory(location.directory)
    async function send(text, probe = false) {
      const current = await resolveSession(options)
      if (JSON.stringify([current.pid, current.procStart]) !== instance) throw new Error(`${label} process changed; reopen the Panel to bind the current instance.`)
      if (typeof text !== 'string' || Buffer.byteLength(text) > 196608) throw new Error('Notification must be text below 192 KiB.')
      const id = randomUUID(), base = join(location.directory, id)
      let expires
      if (!probe && resumeEvents.length && (await readdir(location.directory)).filter(name => name.endsWith('.queued')).length >= 64) throw Error('Pending notification limit reached; resume the original conversation before sending more.')
      try {
        // The shared cwd file carries no message or authority; each Hook reads only
        // its native session's private inbox. Concurrent changes may coalesce.
        // A pre-existing unrelated file must never be truncated.
        let trigger
        const temporaryTrigger = `${location.trigger}.${id}`
        // Trigger contains no payload and is outside the private inbox; do not
        // change the user's cwd ACL. Its own ACL must still be private.
        await writeFile(temporaryTrigger, `${marker}${id}`, { mode: 0o600, flag: 'wx' })
        try {
          if (windowsStorage) await (await windowsStorage).assertWindowsPrivate(temporaryTrigger)
          await link(temporaryTrigger, location.trigger)
        }
        catch (error) { if (error.code !== 'EEXIST') throw error }
        finally { await rm(temporaryTrigger, { force: true }) }
        trigger = await open(location.trigger, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK)
        try {
          const stat = await trigger.stat()
          if (!stat.isFile() || stat.size > 256) {
            throw new Error('Notification trigger conflicts with an existing file.')
          }
          try { await assertPrivate(location.trigger, stat) }
          catch { throw new Error('Notification trigger conflicts with an existing file.') }
          if (!(await trigger.readFile('utf8')).startsWith(marker)) throw new Error('Notification trigger conflicts with an existing file.')
          // Preparing/validating the wake-up file is not delivery wait time.
          // Publish the inbox only after that work so its lifetime is available
          // to the native receiver, then signal exactly once.
          expires = Date.now() + (options.timeoutMs ?? 10000)
          const message = { id, sessionId: options.sessionId, cwd: location.cwd, instance, text, probe, expires, created: Date.now() }
          await privateWrite(`${base}.tmp`, JSON.stringify(message), { mode: 0o600, flag: 'wx' })
          await rename(`${base}.tmp`, `${base}.pending`)
          await trigger.write(`${marker}${id}`, 0, 'utf8')
        } finally { await trigger.close() }
        while (Date.now() < expires) {
          try {
            const receipt = await privateJson(`${base}.receipt`)
            if (receipt.id === id) return { accepted: receipt.accepted === true, status: receipt.accepted === true ? 'hook_received' : 'unavailable' }
          } catch (error) { if (error.code !== 'ENOENT') throw error }
          await delay(50)
        }
        if (!probe && resumeEvents.length) {
          // Only an unclaimed message is safe to retain. The same atomic rename
          // races the receiver claim; never enqueue a message it already claimed.
          try {
            await rename(`${base}.pending`, `${base}.queued`)
            return { accepted: true, status: 'queued_for_resume' }
          } catch (error) { if (error.code !== 'ENOENT') throw error }
        }
        return { accepted: false, status: 'unknown' }
      } finally {
        // Never resend. A timeout does not prove the native model missed it.
        await Promise.all(['tmp', 'pending', 'receipt'].map(ext => rm(`${base}.${ext}`, { force: true })))
      }
    }
    const ready = await send('', true)
    if (!ready.accepted) throw new Error(`${label} notification Hook did not respond. Load the updated plugin in this exact session and reopen the Panel.`)
    return { host, threadId: options.sessionId, send: text => send(text), async probe() {
      const receipt = await send('', true)
      return { status: receipt.accepted ? 'available' : receipt.status === 'unknown' ? 'unknown' : 'unavailable' }
    } }
  }

  async function receiveHook(event, options = {}) {
    const resuming = resumeEvents.includes(event.hook_event_name)
    if ((!resuming && event.hook_event_name !== 'FileChanged') || event.agent_id) return ''
    const location = await paths({ ...options, sessionId: event.session_id, nativeCwd: event.cwd })
    let binding
    try { binding = await privateJson(join(location.directory, 'binding.json')) } catch (error) { if (error.code === 'ENOENT') return ''; throw error }
    location.cwd = binding.cwd
    location.trigger = join(binding.cwd, noticeFile)
    if (requireTranscript && (!event.transcript_path || await realpath(event.transcript_path) !== binding.transcriptPath)) return ''
    // Native Windows watchers normalize separators to '/', while join uses '\\'.
    // Require an absolute path and compare its native lexical representation.
    if (resuming && (!event.cwd || await realpath(event.cwd) !== binding.cwd)) return ''
    if (!resuming && (typeof event.file_path !== 'string' || !isAbsolute(event.file_path) || resolve(event.file_path) !== resolve(location.trigger) || event.event === 'unlink')) return ''
    let entries
    try { entries = await readdir(location.directory) } catch (error) { if (error.code === 'ENOENT') return ''; throw error }
    if (resuming && !entries.some(name => name.endsWith('.queued'))) return ''
    const messages = []; let bytes = 0
    const native = await (options.resolveSession ?? nativeHookProcess)()
    if (native.pid !== binding.pid || native.procStart !== binding.procStart) return ''
    const instance = JSON.stringify([native.pid, native.procStart])
    // Sort available notifications by submission time, not random UUID names.
    const pending = []
    for (const name of entries.filter(name => /^[0-9a-f-]{36}\.(pending|queued)$/.test(name) && (name.endsWith('.queued') ? resumeEvents.length > 0 : !resuming))) {
      try { const item = await privateJson(join(location.directory, name)); pending.push({ name, created: item.created ?? 0, size: typeof item.text === 'string' ? Buffer.byteLength(item.text) : 0 }) }
      catch { /* A sender may expire/remove its file while this Hook runs. */ }
    }
    pending.sort((a, b) => a.created - b.created || a.name.localeCompare(b.name))
    for (const { name, size: pendingSize } of pending) {
      const queued = name.endsWith('.queued')
      if (queued && bytes + pendingSize > 196608) continue // Keep remaining events for the next native boundary.
      const id = name.slice(0, name.lastIndexOf('.'))
      const base = join(location.directory, id)
      try { await rename(join(location.directory, name), `${base}.claimed`) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
      await options.afterClaim?.(base)
      let message
      try { message = await privateJson(`${base}.claimed`) } catch { continue }
      finally { await rm(`${base}.claimed`, { force: true }) }
      if (message.sessionId !== event.session_id || message.cwd !== location.cwd || message.instance !== instance || message.id !== id || (queued ? message.probe || !Number.isFinite(message.created) || message.created + resumeRetentionMs <= Date.now() : message.expires <= Date.now())) continue
      if (typeof message.text !== 'string') continue
      const size = Buffer.byteLength(message.text)
      const accepted = message.probe || bytes + size <= 196608
      try {
        if (!queued) {
          await privateWrite(`${base}.ack-tmp`, JSON.stringify({ id: message.id, accepted }), { flag: 'wx', mode: 0o600 })
          await rename(`${base}.ack-tmp`, `${base}.receipt`)
        }
      } catch { continue }
      if (!message.probe && accepted) { messages.push(message.text); bytes += size }
    }
    return messages.length ? 'Design System browser notification (not a permission approval):\n\n' + messages.join('\n\n') : ''
  }

  async function registerHook(event, options = {}) {
    if (![...registrationEvents, 'CwdChanged'].includes(event.hook_event_name) || event.agent_id) return []
    const location = await paths({ ...options, sessionId: event.session_id, nativeCwd: event.cwd })
    const native = await (options.resolveSession ?? nativeHookProcess)()
    const path = join(location.directory, 'binding.json')
    try {
      const existing = await privateJson(path)
      if (existing.pid === native.pid && existing.procStart === native.procStart) {
        if (requireTranscript && await realpath(event.transcript_path) !== existing.transcriptPath) throw new Error('Native transcript changed within the same instance.')
        return [join(existing.cwd, noticeFile)]
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (!registrationEvents.includes(event.hook_event_name)) return []
    await privateDirectory(location.directory)
    // Do not remove the shared binding on SessionEnd: a late callback could race
    // the next startup. Native PID/starttime checks reject dead instances.
    const temporary = `${path}.${randomUUID()}`
    const cwd = await realpath(event.cwd)
    await privateWrite(temporary, JSON.stringify({ ...native, cwd, ...(requireTranscript ? { transcriptPath: await realpath(event.transcript_path) } : {}) }), { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
    return [join(cwd, noticeFile)]
  }

  return { createConnection, receiveHook, registerHook }
}
