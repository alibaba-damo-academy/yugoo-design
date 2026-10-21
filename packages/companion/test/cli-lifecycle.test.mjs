import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

// Normally use the built provider and its real locked dependencies. A fixed,
// installed runtime can be supplied explicitly to test this source adapter
// without claiming that the changed CLI has already been rebuilt/installed.
const runtimeUrl = process.env.YUGOO_TEST_KNOWLEDGE_RUNTIME
  ? pathToFileURL(resolve(process.env.YUGOO_TEST_KNOWLEDGE_RUNTIME))
  : new URL('../../knowledge-ladybug/lib/index.js', import.meta.url)
const childPath = fileURLToPath(new URL('./cli-lifecycle-child.mjs', import.meta.url))

async function fixture(t, mode) {
  await access(runtimeUrl)
  const root = await mkdtemp(join(tmpdir(), 'companion-cli-signal-'))
  let selectedRuntime = runtimeUrl
  if (mode === 'unreviewed' || mode === 'unreviewed-db') {
    // Explicit refusal fixture, not an executable substitute for the real DB.
    const db = join(root, 'node_modules/@ladybugdb/wasm-core')
    const threads = join(root, 'node_modules/threads')
    await mkdir(join(db, 'nodejs'), { recursive: true })
    await mkdir(join(threads, 'dist/master'), { recursive: true })
    await writeFile(join(db, 'package.json'), JSON.stringify({name:'@ladybugdb/wasm-core', version:mode === 'unreviewed-db' ? '0.0.0' : '0.21.1', exports:{'./nodejs':'./nodejs/index.js'}}))
    const actualEntry = createRequire(runtimeUrl).resolve('@ladybugdb/wasm-core/nodejs')
    await writeFile(join(db, 'nodejs/index.js'), await readFile(actualEntry))
    await writeFile(join(db, 'nodejs/dispatcher.js'), await readFile(join(dirname(actualEntry), 'dispatcher.js')))
    await writeFile(join(threads, 'package.json'), JSON.stringify({name:'threads', version:'1.7.0', main:'dist/index.js'}))
    await writeFile(join(threads, 'dist/index.js'), 'throw Error("unreviewed threads must not execute")')
    await writeFile(join(threads, 'dist/master/implementation.node.js'), 'throw Error("changed bytes must not execute")')
    selectedRuntime = pathToFileURL(join(root, 'runtime.mjs'))
  }
  const child = spawn(process.execPath, [childPath, mode, selectedRuntime.href, root], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  let output = '', timer
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-64_000) })
  const messages = []
  child.on('message', message => messages.push(message))
  const exited = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }) })
    timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error('Owned signal fixture timed out: ' + output)) }, 20_000)
  })
  // Attach a rejection handler immediately, including while waiting for ready.
  void exited.catch(() => {})
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited.catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  return { root, child, exited, output: () => output,
    async phase(name) {
      for (let i = 0; i < 1500; i++) {
        const message = messages.find(message => message.phase === name)
        if (message) return message
        if (child.exitCode !== null || child.signalCode !== null) throw Error('Child exited before ' + name + ': ' + output)
        await delay(10)
      }
      throw Error('Child did not reach ' + name + ': ' + output)
    },
    async events() { return (await readFile(join(root, 'events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)) },
  }
}

// Keep the negative control: the same real dependency preempts the old async
// listener before handles/HTTP/marker cleanup. This test must not turn green
// merely because the fixture stopped loading Ladybug/threads.
test('real threads dependency reproduces the former premature CLI exit', async t => {
  const f = await fixture(t, 'legacy')
  const ready = await f.phase('ready')
  await access(ready.lockPath)
  f.child.kill('SIGTERM')
  assert.deepEqual(await f.exited, { code: 0, signal: null })
  await access(join(f.root, 'owned-connection-marker'))
  // proper-lockfile also has a synchronous exit hook; lock disappearance alone
  // does not prove that asynchronous database/service cleanup was awaited.
  const events = await f.events()
  assert.ok(!events.includes('provider-closed'))
  assert.ok(!events.includes('worker-terminated'))
})

for (const signal of ['SIGTERM', 'SIGINT']) test(`real Knowledge handles drain before ${signal} exits`, async t => {
  const f = await fixture(t, 'fixed')
  const ready = await f.phase('ready')
  await access(ready.lockPath)
  const url = `http://127.0.0.1:${ready.port}/`
  assert.equal(await (await fetch(url)).text(), 'owned fixture')
  f.child.kill(signal)
  await f.phase('closing')
  // Repeated identical and different signals must not bypass or repeat close.
  f.child.kill(signal)
  await delay(20)
  f.child.kill(signal === 'SIGTERM' ? 'SIGINT' : 'SIGTERM')
  assert.deepEqual(await f.exited, { code: 0, signal: null }, f.output())
  await assert.rejects(access(join(f.root, 'owned-connection-marker')), { code: 'ENOENT' })
  await assert.rejects(access(ready.lockPath), { code: 'ENOENT' })
  await assert.rejects(fetch(url))
  const events = await f.events()
  assert.equal(events.filter(event => event === 'close-start').length, 1)
  assert.equal(events.filter(event => event === 'close-end').length, 1)
  assert.ok(events.includes('original-signal-listener'))
  assert.ok(events.includes('original-once-listener'))
  assert.ok(events.includes('later-signal-listener'))
  assert.ok(events.indexOf('provider-closed') < events.indexOf('close-end'))
  assert.ok(events.indexOf('worker-terminated') > events.indexOf('close-end'), 'Public runtime shutdown awaits the real worker termination after handle/service cleanup')
})

test('signal during startup joins startup and closes the resulting service', async t => {
  const f = await fixture(t, 'starting')
  const ready = await f.phase('starting')
  f.child.kill('SIGINT')
  assert.deepEqual(await f.exited, { code: 0, signal: null }, f.output())
  await assert.rejects(access(join(f.root, 'owned-connection-marker')), { code: 'ENOENT' })
  await assert.rejects(access(ready.lockPath), { code: 'ENOENT' })
  assert.equal((await f.events()).filter(event => event === 'close-end').length, 1)
  assert.ok((await f.events()).includes('worker-terminated'))
})

test('failed close reports nonzero after terminal worker shutdown', async t => {
  const f = await fixture(t, 'close-error')
  const ready = await f.phase('ready')
  f.child.kill('SIGTERM')
  assert.deepEqual(await f.exited, { code: 1, signal: null }, f.output())
  assert.match(f.output(), /Companion shutdown failed: deliberate owned close failure/)
  await assert.rejects(access(ready.lockPath), { code: 'ENOENT' })
  await assert.rejects(access(join(f.root, 'owned-connection-marker')), { code: 'ENOENT' })
  assert.equal((await f.events()).filter(event => event === 'close-end').length, 1)
  assert.ok((await f.events()).includes('worker-terminated'), 'Close failure must still await actual worker termination')
})

test('preloaded worker implementation is refused without removing existing listeners', async t => {
  const f = await fixture(t, 'preloaded')
  assert.deepEqual(await f.exited, { code: 1, signal: null }, f.output())
  assert.match(f.output(), /already loaded outside the standalone CLI lifecycle/)
  assert.deepEqual(await f.events(), ['original-preserved', 'once-preserved'])
})

test('startup error drains the imported runtime and releases only owned signal handlers', async t => {
  const f = await fixture(t, 'startup-error')
  assert.deepEqual(await f.exited, { code: 1, signal: null }, f.output())
  assert.match(f.output(), /deliberate startup failure after runtime import/)
  assert.deepEqual(await f.events(), ['original-preserved', 'once-preserved', 'only-unowned-listeners-remain'])
})

test('changed worker bytes fail before loading dependencies or removing original listeners', async t => {
  const f = await fixture(t, 'unreviewed')
  assert.deepEqual(await f.exited, { code: 1, signal: null }, f.output())
  assert.match(f.output(), /Unreviewed Knowledge worker signal implementation/)
  assert.doesNotMatch(f.output(), /must not execute/)
  assert.deepEqual(await f.events(), ['original-preserved', 'once-preserved'])
})

test('unreviewed database version fails before synchronous public-entry execution', async t => {
  const f = await fixture(t, 'unreviewed-db')
  assert.deepEqual(await f.exited, { code: 1, signal: null }, f.output())
  assert.match(f.output(), /Unreviewed Knowledge database entry/)
  assert.doesNotMatch(f.output(), /must not execute/)
  assert.deepEqual(await f.events(), ['original-preserved', 'once-preserved'])
})
