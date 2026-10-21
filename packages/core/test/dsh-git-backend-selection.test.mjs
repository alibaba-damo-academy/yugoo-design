/** Real Service/store/Git publication; fake Windows admission is not a Host test. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Duplex, PassThrough } from 'node:stream'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import DesignService from '../src/design-service.ts'
import { nodeDesignProjectSpawn } from '../src/design-project.ts'
import { nodeFs } from '../src/service-tools.ts'
import { executeNativeGit } from '../src/git-native.ts'
import { GIT_BYTES_CHUNK, readGitFrames, writeGitBytes, writeGitFrame } from '../src/dsh-git-protocol.ts'

function deferred() {
  let resolve
  const promise = new Promise(yes => { resolve = yes })
  return { promise, resolve }
}

/** The provider and wire are fixtures; native and CLI Git operations are real. */
function publicRuntime(root) {
  const done = deferred(), requests = [], launches = []
  const runtime = Object.create(LocalSubprocessRuntime.prototype)
  // Test the Desktop-compatible public route, even when the test SDK also
  // happens to expose the optional strict native method on its prototype.
  runtime.spawnNativeContained = undefined
  runtime.resolveExecutable = async executable => executable
  let serving, parent, worker
  runtime.spawn = spec => {
    const up = new PassThrough(), down = new PassThrough()
    parent = Duplex.from({ readable: down, writable: up })
    worker = Duplex.from({ readable: up, writable: down })
    launches.push(spec)
    serving = (async () => {
      await writeGitFrame(worker, { type: 'ready', version: 1 })
      for await (const frame of readGitFrames(worker)) {
        assert.equal(frame.kind, 'json')
        const request = frame.value
        requests.push(request)
        if (request.type === 'close') {
          await writeGitFrame(worker, { type: 'closed' })
          worker.end()
          done.resolve({ exitCode: 0, signal: null })
          break
        }
        assert.equal(request.cwd, root)
        let result, bytes
        if (request.type === 'native') {
          const native = await executeNativeGit(root, request.operation)
          result = { type: 'native-result', id: request.id, value: native.value }
          bytes = native.bytes
        } else {
          assert.equal(request.type, 'run')
          const cli = await nodeDesignProjectSpawn({ argv: request.argv, cwd: root, env: request.env,
            ...(request.binaryMax === undefined ? {} : { binaryStdout: { maxBytes: request.binaryMax } }) })
          result = { type: 'result', id: request.id, exitCode: cli.exitCode, stdout: cli.stdout, stderr: cli.stderr }
          bytes = cli.stdoutBytes
        }
        if (bytes !== undefined) {
          for (let offset = 0; offset < bytes.byteLength; offset += GIT_BYTES_CHUNK) {
            await writeGitBytes(worker, request.id, bytes.subarray(offset, offset + GIT_BYTES_CHUNK))
          }
        }
        await writeGitFrame(worker, result)
      }
    })()
    // Observe fixture failures immediately; dispose() still rethrows them.
    void serving.catch(error => { parent.destroy(error); done.resolve({ exitCode: 1, signal: null }) })
    return { control: parent, collected: {}, done: done.promise,
      terminate() { parent.destroy(); worker.destroy(); done.resolve({ exitCode: 0, signal: null }) },
      async waitForExit() { await done.promise; return true } }
  }
  return { runtime, requests, launches, async dispose() {
    parent?.destroy(); worker?.destroy(); await serving
  } }
}

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-backend-selection-'))
  const backend = process.env.YUGOO_GIT_BACKEND
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')
  const calls = [], agent = { id: 'backend-selection-session' }
  const project = { projectId: '11111111-1111-4111-8111-111111111111', root,
    designFilesRoot: join(root, 'design_files'), stateRoot: join(root, 'state'),
    kit: { name: 'fixture', version: '1.0' } }
  const path = join(project.designFilesRoot, 'sample', 'sample.json')
  const command = async (...args) => {
    const result = await nodeDesignProjectSpawn({ argv: ['git', ...args], cwd: root })
    assert.equal(result.exitCode, 0, result.stderr)
    return result.stdout.trim()
  }
  const fallback = async request => {
    calls.push(request.argv)
    return nodeDesignProjectSpawn(request)
  }
  let managed
  try {
    delete process.env.YUGOO_GIT_BACKEND
    await command('init', '-q')
    await mkdir(join(project.designFilesRoot, 'sample'), { recursive: true })
    await writeFile(path, '{"title":"Initial"}\n')
    await command('add', '--', 'design_files')
    await command('-c', 'user.name=Fixture', '-c', 'user.email=fixture@local', 'commit', '-qm', 'Initial')
    const initial = await command('rev-parse', 'HEAD')
    const design = Object.create(DesignService.prototype)
    Object.assign(design, {
      context: { get: () => undefined },
      projectMutationScope: new AsyncLocalStorage(), projectMutations: new Map(),
      workspaceReadScope: new AsyncLocalStorage(), workspaceGitReaders: new Map(),
      activeWorkspaces: new WeakMap([[agent, { project, binding: { revision: 1 }, values: {} }]]),
      projectContentEpochs: new Map(), workspaceContentEpochs: new WeakMap([[agent, 0]]),
      resolveProjectKit: () => ({ ...project.kit, skills: [] }),
      projectForAgent: async () => project, spawnAdapter: () => fallback,
    })
    const write = () => design.withSelectedDesignFilesMutation(agent, nodeFs, new AbortController().signal,
      (_project, store) => store.write('sample', { title: 'Updated' }, { origin: 'panel', settleEvent: async () => {} }))
    const startup = () => {
      const entered = deferred(), release = deferred()
      const original = design.currentSelection.bind(design)
      design.currentSelection = async (...args) => {
        const selection = await original(...args)
        entered.resolve(); await release.promise
        return selection
      }
      return { entered: entered.promise, release: () => release.resolve() }
    }
    const usePublicRuntime = () => {
      managed = publicRuntime(root)
      design.context.get = () => managed.runtime
      return managed
    }
    Object.defineProperty(process, 'platform', { value: 'win32' })
    await run({ design, write, startup, usePublicRuntime, calls, command, path, initial })
  } finally {
    Object.defineProperty(process, 'platform', platform)
    if (backend === undefined) delete process.env.YUGOO_GIT_BACKEND
    else process.env.YUGOO_GIT_BACKEND = backend
    await managed?.dispose()
    await rm(root, { recursive: true, force: true })
  }
}

test('an entry-pinned native backend survives a startup env flip on the public managed route', { timeout: 10000 }, async () => fixture(async ({ write, startup, usePublicRuntime, calls, command, path }) => {
  const managed = usePublicRuntime(), gate = startup()
  process.env.YUGOO_GIT_BACKEND = 'native'
  const saving = write()
  await gate.entered
  process.env.YUGOO_GIT_BACKEND = 'cli'
  gate.release()
  const result = await saving
  assert.equal(managed.launches.length, 1, 'the factory must receive the entry pin despite changed global env')
  assert.ok(managed.requests.some(request => request.type === 'native' && request.operation.kind === 'publish'))
  assert.equal(managed.requests.some(request => request.type === 'run' && request.argv.includes('commit-tree')), false)
  assert.deepEqual(calls, [], 'the save stays inside its managed route')
  assert.equal(await command('rev-parse', 'HEAD'), result.commit)
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { title: 'Updated' })
}))

test('an entry-pinned native write rejects a wrong-world provider after startup env flips to CLI', { timeout: 10000 }, async () => fixture(async ({ design, write, startup, calls, command, initial }) => {
  design.context.get = () => ({ spawn() { throw Error('wrong-world runtime must never launch') } })
  const gate = startup()
  process.env.YUGOO_GIT_BACKEND = 'native'
  const saving = write()
  const rejected = assert.rejects(saving, /native backend requires a managed Git scope/)
  await gate.entered
  process.env.YUGOO_GIT_BACKEND = 'cli'
  gate.release()
  await rejected
  assert.equal(calls.some(argv => argv.includes('commit-tree') || argv[1] === 'update-ref'), false)
  assert.equal(await command('rev-parse', 'HEAD'), initial)
}))

test('the default CLI mutation remains usable and cannot become native during startup', { timeout: 10000 }, async () => fixture(async ({ write, startup, usePublicRuntime, calls, command, path }) => {
  const managed = usePublicRuntime(), gate = startup()
  delete process.env.YUGOO_GIT_BACKEND
  const saving = write()
  await gate.entered
  process.env.YUGOO_GIT_BACKEND = 'native'
  gate.release()
  const result = await saving
  assert.equal(managed.launches.length, 0, 'default CLI must not adopt a later native env change')
  assert.equal(calls.filter(argv => argv.includes('commit-tree')).length, 1)
  assert.equal(calls.filter(argv => argv[1] === 'update-ref').length, 1)
  assert.equal(await command('rev-parse', 'HEAD'), result.commit)
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { title: 'Updated' })
}))
