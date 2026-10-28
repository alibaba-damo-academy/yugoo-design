/** Terminal lifecycle for the standalone CLI only; never installed by a host. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const signals = ['SIGINT', 'SIGTERM']
// Original threads@1.7.0 npm file. A dependency change needs a new lifecycle review.
const implementationHash = 'a9e228bb553ddf9a6469a597a691295da473f75a35e4e68583b446f5665d9833'

function ownKnowledgeSignals(runtimeUrl) {
  const ladybugEntry = createRequire(runtimeUrl).resolve('@ladybugdb/wasm-core/nodejs')
  const ladybugRoot = dirname(dirname(ladybugEntry))
  const ladybug = JSON.parse(readFileSync(join(ladybugRoot, 'package.json'), 'utf8'))
  if (ladybug.name !== '@ladybugdb/wasm-core' || ladybug.version !== '0.21.1'
    || ladybugEntry !== join(ladybugRoot, 'nodejs/index.js')
    || createHash('sha256').update(readFileSync(ladybugEntry)).digest('hex') !== '570b3134e2598b85ca91281f438985ed155d5af4a67ae1f20cd62586e5c5207f'
    || createHash('sha256').update(readFileSync(join(ladybugRoot, 'nodejs/dispatcher.js'))).digest('hex') !== '05cd8809faa119a2ebeebab64c8d8faa54f5e58fa3d0beb23a06ca13ae128288') {
    throw new Error('Unreviewed Knowledge database entry; cannot start standalone Companion safely')
  }
  const threadsEntry = createRequire(ladybugEntry).resolve('threads')
  const root = dirname(dirname(threadsEntry))
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const implementationPath = join(root, 'dist/master/implementation.node.js')
  if (manifest.name !== 'threads' || manifest.version !== '1.7.0'
    || createHash('sha256').update(readFileSync(implementationPath)).digest('hex') !== implementationHash) {
    throw new Error('Unreviewed Knowledge worker signal implementation; cannot start standalone Companion safely')
  }
  const cache = createRequire(ladybugEntry).cache
  if (cache[implementationPath]) throw new Error('Knowledge worker already loaded outside the standalone CLI lifecycle')
  // Load only the existing, declared public dependency entry. Its dispatcher
  // synchronously selects the verified threads implementation (no worker starts
  // until a database call). Do not infer ownership from an async runtime import
  // or add a computed/private dependency loader to the published CLI.
  const before = new Map(signals.map(name => [name, process.rawListeners(name)]))
  createRequire(runtimeUrl)('@ladybugdb/wasm-core/nodejs')
  if (!cache[implementationPath]?.loaded) throw new Error('Knowledge worker implementation did not load through the reviewed public entry')
  const owned = signals.map(name => {
    const previous = before.get(name)
    const current = process.rawListeners(name)
    const added = current.filter(listener => !previous.includes(listener))
    if (!previous.every(listener => current.includes(listener)) || added.length !== 1
      || Function.prototype.toString.call(added[0]) !== '() => terminateWorkersAndMaster()') {
      throw new Error('Unexpected Knowledge worker signal registration; listeners left unchanged')
    }
    return [name, added[0]]
  })
  // Leave every unrelated listener intact. Public runtime shutdown terminates
  // the actual Ladybug worker after its database handles have drained.
  for (const [name, listener] of owned) process.removeListener(name, listener)
}

/** Finite CLI diagnostics use the same verified signal ownership and public terminal shutdown. */
export async function runStandaloneKnowledgeOperation({ runtimeUrl, loadRuntime, run }) {
  ownKnowledgeSignals(runtimeUrl)
  let runtime
  try {
    runtime = await loadRuntime()
    return await run(runtime)
  } finally { await runtime?.shutdownLadybugKnowledgeRuntime() }
}

export async function startStandaloneCompanion({ runtimeUrl, loadRuntime, start }) {
  ownKnowledgeSignals(runtimeUrl)
  let server, loading, closing
  // Keep the existing Knowledge loader as the sole runtime import authority.
  const loadOwnedRuntime = () => loading ??= Promise.resolve().then(loadRuntime)
  // Defer startup until the handlers and shared opening promise are installed.
  const opening = Promise.resolve().then(async () => {
    server = await start({ loadRuntime: loadOwnedRuntime })
    return server
  })
  const close = () => closing ??= (async () => {
    let failure
    try { await opening } catch (error) { failure = error }
    try { await server?.close() } catch (error) { failure ??= error }
    try {
      if (loading) await (await loading).shutdownLadybugKnowledgeRuntime()
    } catch (error) { failure ??= error }
    if (failure) throw failure
  })()
  const onSignal = () => {
    // Repeated signals join the same teardown, including in-flight startup.
    void close().then(() => process.exit(0), error => {
      console.error('Companion shutdown failed:', error.message ?? error)
      process.exit(1)
    })
  }
  for (const name of signals) process.on(name, onSignal)
  try { return await opening } catch (error) {
    try { await close() } finally {
      for (const name of signals) process.removeListener(name, onSignal)
    }
    throw error
  }
}
