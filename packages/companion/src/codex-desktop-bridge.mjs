/** Launch directly through the selected host with its bundled Node runtime.
 * Companion's ordinary Node must not spawn this process: host admission checks
 * the native launch chain. This bridge handles only its bound save lane.
 */
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { callCompanion } from './connection-file.mjs'
import { createCodexDesktopConnection } from './codex-desktop-connection.mjs'
import { requireThreadId } from './codex-connection.mjs'

async function main() {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== '--connection' || !isAbsolute(args[1])) throw Error('CODEX_DESKTOP_CONNECTION_REQUIRED')
  const path = args[1]
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw Error('CODEX_DESKTOP_PRIVATE_CONNECTION_REQUIRED')
  const initial = await readFile(path, 'utf8')
  const connection = JSON.parse(initial)
  if (connection.host !== 'codex' || connection.codexDesktop !== true || connection.threadId !== process.env.CODEX_THREAD_ID
    || await realpath(connection.nativeCwd) !== await realpath(process.cwd())) throw Error('CODEX_DESKTOP_CONNECTION_MISMATCH')
  const native = createCodexDesktopConnection(connection.threadId)
  const instance = randomUUID()
  let generation
  const call = async params => {
    if (await readFile(path, 'utf8') !== initial) throw Error('CODEX_DESKTOP_CONNECTION_CHANGED')
    return callCompanion(path, { method: 'desktopBridge', params: { ...params, instance, ...(generation ? { generation } : {}) } })
  }
  let stopping = false, ready = false
  process.once('SIGINT', () => { stopping = true })
  process.once('SIGTERM', () => { stopping = true })
  try {
    await native.probe()
    const admission = await call({ operation: 'ready', threadId: connection.threadId })
    requireThreadId(admission.generation)
    generation = admission.generation
    ready = true
    console.log(JSON.stringify({ ready: true, threadId: connection.threadId, pid: process.pid }))
    while (!stopping) {
      const { message } = await call({ operation: 'next' })
      if (!message) continue
      let receipt
      try { receipt = await native.send(message.text) }
      catch (error) { receipt = { accepted: false, notSubmitted: error?.notSubmitted === true, status: 'unknown' }; stopping = true }
      await call({ operation: 'settle', messageId: message.id, receipt })
    }
  } catch (error) {
    console.error(/^CODEX_DESKTOP_[A-Z_]+$/.test(error?.message) ? error.message : 'CODEX_DESKTOP_BRIDGE_STOPPED')
    process.exitCode = 1
  } finally {
    if (ready) await call({ operation: 'stop' }).catch(() => {})
  }
}

// Startup validation must not expose private file bytes in parser errors.
await main().catch(error => {
  console.error(/^CODEX_DESKTOP_[A-Z_]+$/.test(error?.message) ? error.message : 'CODEX_DESKTOP_BRIDGE_STOPPED')
  process.exitCode = 1
})
