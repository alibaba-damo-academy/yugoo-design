// Isolated real-dependency signal fixture, never a host conversation or user project.
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { appendFile, rm, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { startStandaloneCompanion, runStandaloneKnowledgeOperation } from '../src/cli-lifecycle.mjs'

const [mode, runtimeHref, root] = process.argv.slice(2)
const runtimeUrl = new URL(runtimeHref)
const marker = join(root, 'owned-connection-marker')
const events = join(root, 'events.jsonl')
const projectId = '00000000-0000-4000-8000-000000000001'
const lockPath = join(root, createHash('sha256').update(projectId).digest('hex') + '.lbdb.lock')
const record = event => appendFile(events, JSON.stringify(event) + '\n')
let expectedAfterStartupFailure
const original = () => { void record('original-signal-listener') }
const onceWrappers = new Map()
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, original)
  process.once(signal, () => { void record('original-once-listener') })
  onceWrappers.set(signal, process.rawListeners(signal).at(-1))
}

async function start({ loadRuntime }) {
  const cliHandlers = process.rawListeners('SIGTERM').filter(listener => listener !== original && listener !== onceWrappers.get('SIGTERM'))
  for (const signal of ['SIGINT', 'SIGTERM']) {
    if (!process.rawListeners(signal).includes(original)) throw Error('An existing signal listener was removed')
    if (!process.rawListeners(signal).includes(onceWrappers.get(signal))) throw Error('An existing once wrapper was removed')
  }
  const require = createRequire(createRequire(runtimeUrl).resolve('@ladybugdb/wasm-core/nodejs'))
  const { Thread } = require('threads')
  const terminate = Thread.terminate
  Thread.terminate = async (...args) => {
    const result = await terminate(...args)
    await record('worker-terminated')
    return result
  }
  const runtime = await loadRuntime()
  if (mode === 'startup-error') {
    expectedAfterStartupFailure = process.rawListeners('SIGTERM').filter(listener => !cliHandlers.includes(listener))
    throw Error('deliberate startup failure after runtime import')
  }
  const provider = await runtime.LadybugDesignKnowledgeProvider.open(projectId, { databaseRoot: root })
  const http = createServer((_request, response) => response.end('owned fixture'))
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
  await writeFile(marker, 'non-secret fixture marker')
  // A later unrelated listener must also survive the lifecycle adapter.
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void record('later-signal-listener') })
  const server = { async close() {
    await record('close-start')
    process.send({ phase: 'closing' })
    await delay(200)
    await provider.close()
    await record('provider-closed')
    http.closeAllConnections()
    await new Promise((resolve, reject) => http.close(error => error ? reject(error) : resolve()))
    await rm(marker)
    await record('close-end')
    if (mode === 'close-error') throw Error('deliberate owned close failure')
  } }
  process.send({ phase: mode === 'starting' ? 'starting' : 'ready', port: http.address().port, lockPath })
  if (mode === 'starting') await delay(300)
  return server
}

try {
  if (mode === 'preloaded') {
    const require = createRequire(createRequire(runtimeUrl).resolve('@ladybugdb/wasm-core/nodejs'))
    require('threads')
  }
  if (mode === 'operation' || mode === 'operation-error') {
    await runStandaloneKnowledgeOperation({ runtimeUrl, loadRuntime: async () => {
      const runtime = await import(runtimeHref)
      return { ...runtime, async shutdownLadybugKnowledgeRuntime() {
        await runtime.shutdownLadybugKnowledgeRuntime()
        await record('terminal-shutdown')
      } }
    }, run: async runtime => {
      const result = await runtime.prepareLocalEmbedding({ cacheDir: join(root, 'absent') })
      await record('operation-' + result.status)
      if (mode === 'operation-error') throw Error('deliberate finite operation failure')
      return result
    } })
    process.disconnect()
  } else if (mode === 'legacy') {
    const server = await start({ loadRuntime: () => import(runtimeHref) })
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.close().then(() => process.exit(0)) })
  } else {
    await startStandaloneCompanion({ runtimeUrl, loadRuntime: () => import(runtimeHref), start })
  }
} catch (error) {
  console.error(error.message)
  if (['preloaded', 'startup-error', 'unreviewed', 'unreviewed-db'].includes(mode)) {
    await record(process.rawListeners('SIGTERM').includes(original) ? 'original-preserved' : 'original-removed')
    await record(process.rawListeners('SIGTERM').includes(onceWrappers.get('SIGTERM')) ? 'once-preserved' : 'once-removed')
    if (mode === 'startup-error') {
      const remaining = process.rawListeners('SIGTERM')
      await record(remaining.length === expectedAfterStartupFailure.length
        && remaining.every((listener, index) => listener === expectedAfterStartupFailure[index])
        ? 'only-unowned-listeners-remain' : 'signal-listener-ownership-mismatch')
    }
  }
  process.exitCode = 1
  process.disconnect()
}
