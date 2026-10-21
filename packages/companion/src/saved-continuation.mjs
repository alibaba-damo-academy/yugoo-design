/** Delivery metadata only. Git/DesignJournal remain the saved-design authority. */
import { readFile, open, mkdir, rename, lstat, rm, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const id = value => typeof value === 'string' && /^[\w.-]{1,128}$/.test(value)
const retryable = entry => entry.status === 'not_submitted'
const receipt = value => Object.fromEntries(['accepted', 'status', 'threadId', 'messageId', 'queuedSubmissionId', 'notSubmitted']
  .filter(key => ['string', 'boolean'].includes(typeof value?.[key])).map(key => [key, value[key]]))

export function createSavedContinuation({ stateRoot, projectId, projectRoot, host, threadId, nativeCwd, transcriptPath }) {
  const binding = JSON.parse(JSON.stringify({ projectId, projectRoot, host, threadId, nativeCwd, transcriptPath }))
  const directory = join(stateRoot, projectId, 'saved-continuations')
  const file = join(directory, `${digest(binding)}.json`)
  let tail = Promise.resolve()
  async function privateDirectory() {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const stat = await lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Invalid saved-continuation directory.')
  }
  async function withLock(operation) {
    await privateDirectory()
    // Same atomic-directory mutation lock used by Studio storage and accepted
    // assertions. Recovery services share this binding; closure tails alone
    // cannot protect them from late receipts overwriting newer events.
    const lock = `${file}.lock`, started = Date.now()
    while (true) {
      try { await mkdir(lock, { mode: 0o700 }); break }
      catch (error) {
        if (error.code !== 'EEXIST') throw error
        if (Date.now() - started >= 5000) throw Error('Saved notification metadata is busy. After a crash, stop its services before clearing the empty binding lock; do not resend uncertain messages.')
        await delay(10)
      }
    }
    try { return await operation() } finally { await rmdir(lock) }
  }
  async function read() {
    try {
      const directoryStat = await lstat(directory)
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw Error('Invalid saved-continuation directory.')
      const stat = await lstat(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw Error('Invalid saved-continuation metadata.')
      const value = JSON.parse(await readFile(file, 'utf8'))
      if (value.format !== 1 || JSON.stringify(value.binding) !== JSON.stringify(binding) || !Array.isArray(value.entries)
        || value.entries.length > 10000 || value.entries.some(entry => !id(entry.eventId) || typeof entry.skill !== 'string'
          || typeof entry.status !== 'string' || (entry.commit !== undefined && !/^[a-f0-9]{40,64}$/.test(entry.commit)))) throw Error('Invalid saved-continuation binding or entries.')
      return value
    } catch (error) { if (error.code === 'ENOENT') return { format: 1, binding, entries: [] }; throw error }
  }
  async function write(value) {
    const text = JSON.stringify(value)
    if (Buffer.byteLength(text) > 4 * 1024 * 1024 || value.entries.length > 10000) throw Error('Saved-continuation metadata limit reached.')
    const temporary = `${file}.${randomUUID()}.tmp`
    let handle
    try { handle = await open(temporary, 'wx', 0o600); await handle.writeFile(text); await handle.sync(); await handle.close(); handle = undefined; await rename(temporary, file) }
    finally { await handle?.close(); await rm(temporary, { force: true }) }
  }
  function mutate(operation) {
    const next = tail.then(() => withLock(async () => { const value = await read(); const result = await operation(value); await write(value); return result }))
    tail = next.catch(() => {})
    return next
  }
  return {
    async prepare({ eventId, skill, payloadHash, kitHash }) {
      if (!id(eventId) || typeof skill !== 'string') throw Error('Exact save identity required.')
      return mutate(value => {
        const prior = value.entries.find(entry => entry.eventId === eventId)
        if (prior) { if (prior.payloadHash !== payloadHash || prior.skill !== skill || prior.kitHash !== kitHash) throw Object.assign(Error('Save event ID reused with different content.'), { code: 'CONTINUATION_CONFLICT' }); return }
        value.entries.push({ eventId, skill, payloadHash, kitHash, status: 'preparing' })
      })
    },
    saved(eventId, commit) {
      return mutate(value => {
        const entry = value.entries.find(entry => entry.eventId === eventId)
        if (!entry || (entry.commit && entry.commit !== commit)) throw Error('Saved checkpoint mismatch.')
        if (entry.status === 'preparing') { entry.commit = commit; entry.status = 'not_submitted' }
      })
    },
    async snapshot({ kitHash } = {}) {
      await tail
      const value = await read()
      return value.entries.map(({ eventId, skill, commit, status, result, kitHash: savedKit }) => ({ eventId, skill, commit,
        status: status === 'submitting' ? 'unknown' : savedKit !== kitHash && ['preparing', 'not_submitted'].includes(status) ? 'stale' : status,
        ...(result ? { result } : {}), retryable: savedKit === kitHash && retryable({ status }) }))
    },
    begin({ saved, text, requestId, kitHash }) {
      return mutate(value => {
        if (requestId !== undefined && !id(requestId)) throw Error('Invalid continuation request ID.')
        if (saved !== undefined && (!Array.isArray(saved) || saved.length > 128 || saved.some(item => !id(item?.eventId)))) throw Error('Invalid saved receipts.')
        const selected = saved === undefined ? value.entries.filter(entry => retryable(entry) && entry.kitHash === kitHash)
          : saved.map(item => {
            const entry = value.entries.find(entry => entry.eventId === item.eventId)
            if (!entry || item.commit !== entry.commit || entry.kitHash !== kitHash) throw Error('Unknown save event/checkpoint or Kit receipt.')
            return entry
          })
        if (new Set(selected.map(entry => entry.eventId)).size !== selected.length) throw Error('Duplicate save receipt.')
        if (!selected.length) return { entries: [], requestId }
        const textHash = digest(text)
        const key = requestId ?? digest([selected.map(entry => [entry.eventId, entry.commit]), textHash])
        if (selected.some(entry => !retryable(entry))) {
          if (selected.every(entry => entry.requestId === key && entry.textHash === textHash && entry.result?.accepted === true)) {
            return { entries: [], requestId: key, prior: selected[0].result }
          }
          return { entries: [], requestId: key, prior: { accepted: false, status: 'unknown' } }
        }
        for (const entry of selected) { entry.status = 'submitting'; entry.requestId = key; entry.textHash = textHash; delete entry.result }
        return { entries: selected.map(entry => ({ ...entry })), requestId: key }
      })
    },
    settle(requestId, result) {
      return mutate(value => {
        for (const entry of value.entries.filter(entry => entry.requestId === requestId && entry.status === 'submitting')) {
          entry.status = result?.accepted === true ? (result.status ?? 'accepted')
            : result?.notSubmitted === true || ['busy', 'denied', 'expired'].includes(result?.status) ? 'not_submitted' : 'unknown'
          entry.result = receipt(result)
        }
      })
    },
  }
}
