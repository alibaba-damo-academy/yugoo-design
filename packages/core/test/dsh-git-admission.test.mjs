/** Public-boundary source fixtures, not native-container evidence. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'

const options = subprocess => ({ subprocess, root: '/repo', signal: new AbortController().signal, assertScope: async () => {} })
async function asWindows(operation) {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'win32' })
  try { return await operation() } finally { Object.defineProperty(process, 'platform', platform) }
}

test('missing optional local package returns before a helper starts; broken transitive imports remain errors', async () => {
  for (const missing of ['@deepseek-ai/dsh-subprocess-local', 'broken-transitive-dependency']) {
    const hook = registerHooks({ resolve(specifier, context, next) {
      if (specifier === '@deepseek-ai/dsh-subprocess-local') throw Object.assign(new Error(`Cannot find package '${missing}' imported from fixture`), { code: 'ERR_MODULE_NOT_FOUND' })
      return next(specifier, context)
    } })
    try {
      const { openDshGitScope } = await import(`../src/dsh-git-scope.ts?missing=${encodeURIComponent(missing)}`)
      const run = asWindows(() => openDshGitScope(options({ spawn() { assert.fail('helper must not start') } })))
      if (missing === '@deepseek-ai/dsh-subprocess-local') assert.equal(await run, undefined)
      else await assert.rejects(run, /broken-transitive-dependency/)
    } finally { hook.deregister() }
  }
})

test('old API and a different runtime identity retain the old adapter before executable lookup', async () => {
  const { openDshGitScope } = await import('../src/dsh-git-scope.ts?admission=legacy')
  const old = Object.create(LocalSubprocessRuntime.prototype)
  old.spawnNativeContained = undefined
  old.resolveExecutable = () => assert.fail('old provider must not resolve a helper')
  assert.equal(await asWindows(() => openDshGitScope(options(old))), undefined)
  const other = {
    spawnNativeContained() { assert.fail('another execution world must not start the helper') },
    resolveExecutable() { assert.fail('another execution world must not resolve local paths') },
  }
  assert.equal(await asWindows(() => openDshGitScope(options(other))), undefined)
})

test('a present native-only entry refusing launch never falls back', async () => {
  const { openDshGitScope } = await import('../src/dsh-git-scope.ts?admission=refusal')
  const local = Object.create(LocalSubprocessRuntime.prototype)
  let calls = 0
  const failure = Object.assign(new Error('native unavailable'), { name: 'NativeContainmentUnavailableError' })
  local.resolveExecutable = async value => value
  local.spawn = () => assert.fail('native refusal must not fall back')
  local.spawnNativeContained = () => { calls++; throw failure }
  await assert.rejects(asWindows(() => openDshGitScope(options(local))), error => error === failure)
  assert.equal(calls, 1)
})

test('spawned handle without control is terminated and range-joined with an independent signal', async () => {
  const { openDshGitScope } = await import('../src/dsh-git-scope.ts?admission=no-control')
  const local = Object.create(LocalSubprocessRuntime.prototype)
  let stopped = 0, joined = 0
  local.resolveExecutable = async value => value
  local.spawnNativeContained = () => ({
    control: undefined, containment: 'windows-job', collected: {}, done: Promise.resolve({ exitCode: 1, signal: null }),
    terminate() { stopped++ }, async waitForExit(signal) { joined++; assert.equal(signal.aborted, false); return false },
  })
  await assert.rejects(asWindows(() => openDshGitScope(options(local))), error => (
    error instanceof AggregateError && /no control channel/.test(String(error.cause)) && /not confirmed/.test(String(error))
  ))
  assert.ok(stopped > 0)
  assert.equal(joined, 1)
})

test('missing-control cleanup remains bounded when the provider ignores its signal, and late true does not repair startup', async t => {
  const { openDshGitScope } = await import('../src/dsh-git-scope.ts?admission=unbounded-provider')
  const local = Object.create(LocalSubprocessRuntime.prototype)
  let reached, late, signal, stopped = 0, joined = 0
  const entered = new Promise(resolve => { reached = resolve })
  local.resolveExecutable = async value => value
  local.spawnNativeContained = () => ({
    control: undefined, containment: 'windows-job', collected: {}, done: Promise.resolve({ exitCode: 1, signal: null }),
    terminate() { stopped++ }, waitForExit(bound) { joined++; signal = bound; reached(); return new Promise(resolve => { late = resolve }) },
  })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const run = asWindows(() => openDshGitScope(options(local)))
  const rejected = assert.rejects(run, error => error instanceof AggregateError
    && /no control channel/.test(String(error.cause)) && /worker range timed out/.test(String(error.errors[1])))
  await entered; assert.equal(signal.aborted, false)
  t.mock.timers.tick(15_000); await rejected
  assert.equal(signal.aborted, true); assert.equal(joined, 1); assert.ok(stopped > 0)
  late(true); await new Promise(resolve => setImmediate(resolve))
  assert.equal(joined, 1, 'startup is not retried or retrospectively accepted')
})
