/** Owned, bounded loopback service that outlives a short-lived MCP request process. */
import { fork } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startWorkBuddyRelay } from './workbuddy-mcp-relay.mjs'

export function startDetachedWorkBuddyRelay() {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), ['--serve'], {
      detached: true, windowsHide: true, execArgv: [],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    const fail = error => { clearTimeout(timer); child.kill(); reject(error) }
    const timer = setTimeout(() => fail(Error('Local relay startup timed out.')), 5000)
    child.once('error', fail)
    child.once('exit', () => fail(Error('Local relay exited before startup.')))
    child.once('message', message => {
      if (!message?.origin || !message?.widgetToken || !message?.url) return fail(Error('Invalid relay startup.'))
      clearTimeout(timer)
      child.removeAllListeners('exit')
      child.removeListener('error', fail)
      child.disconnect()
      child.unref()
      resolve({ ...message, pid: child.pid, close: async () => { child.kill() } })
    })
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2] === '--serve') {
  // No model, project IO or host launcher. An abandoned widget expires in 5min;
  // even an active diagnostic expires in 15min. Credentials travel only over IPC.
  const relay = await startWorkBuddyRelay({ idleTimeoutMs: 300000, maxLifetimeMs: 900000 })
  if (!process.send) { await relay.close(); process.exitCode = 1 }
  else process.send({ origin: relay.origin, widgetToken: relay.widgetToken, url: relay.url })
}
