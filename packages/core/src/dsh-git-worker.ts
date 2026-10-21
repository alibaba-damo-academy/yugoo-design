/** Private Node target for one Panel save. GitVersioning in the parent owns CAS. */
import { spawn } from 'node:child_process'
import { openInheritedControlChannel } from '@deepseek-ai/dsh-subprocess/control'
import { OutputCollector } from '@deepseek-ai/dsh-subprocess-local/output'
import { GIT_BYTES_CHUNK, gitMessage, gitWorkerTiming, nativeGitFailure, nativeGitOperation, readGitFrames, writeGitBytes, writeGitFrame } from './dsh-git-protocol.ts'
import type { GitWorkerTiming } from './dsh-git-protocol.ts'
import type { NativeGitOperation } from './git-native-contract.ts'

const channel = openInheritedControlChannel()
const root = process.argv[2]
if (root === undefined) throw new Error('design git: missing worker repository')
let active: ReturnType<typeof spawn> | undefined
let activeNative: AbortController | undefined
let closing = false

// The parent owns the complete native range. EOF/error also stops the direct
// Git child promptly; this is not a replacement descendant/process-tree owner.
const stop = (): void => { activeNative?.abort(); active?.kill('SIGKILL') }
channel.once('error', stop)
channel.once('end', stop)

/** Native bindings run only here, inside the existing managed subprocess range. */
async function executeNative(message: Record<string, unknown>): Promise<void> {
  const { id, cwd } = message
  let operation: NativeGitOperation
  try {
    if (!Number.isInteger(id) || Number(id) <= 0 || Number(id) > 0xffff_ffff || cwd !== root) {
      throw new Error('design git: invalid native worker request')
    }
    operation = nativeGitOperation(message.operation)
  } catch {
    await writeGitFrame(channel, { type: 'native-result', id, failure: 'invalid-request' })
    return
  }
  const controller = new AbortController()
  activeNative = controller
  try {
    let native: typeof import('./git-native.ts')
    try { native = await import('./git-native.ts') }
    catch {
      await writeGitFrame(channel, { type: 'native-result', id, failure: 'native-unavailable' })
      return
    }
    const result = await native.executeNativeGit(root!, operation, controller.signal)
    if (operation.kind === 'blob') {
      if (!(result.bytes instanceof Uint8Array) || result.bytes.length !== operation.size) {
        throw new Error('design git: native blob size mismatch')
      }
      for (let offset = 0; offset < result.bytes.length; offset += GIT_BYTES_CHUNK) {
        await writeGitBytes(channel, Number(id), result.bytes.subarray(offset, offset + GIT_BYTES_CHUNK))
      }
    } else if (result.bytes !== undefined) throw new Error('design git: unexpected native bytes')
    await writeGitFrame(channel, { type: 'native-result', id, value: result.value })
  } catch (error) {
    await writeGitFrame(channel, { type: 'native-result', id, failure: nativeGitFailure(error) })
  } finally { activeNative = undefined }
}

async function execute(message: Record<string, unknown>): Promise<void> {
  let timing: { received: number; marks: GitWorkerTiming } | undefined
  if (message.timing === true) {
    try { const received = performance.now(); if (Number.isFinite(received)) timing = { received, marks: {} } }
    catch { /* Observation failure cannot reject a Git command. */ }
  }
  const mark = (name: keyof GitWorkerTiming): void => {
    if (timing === undefined || (name !== 'workerUntilReplyStartMs' && timing.marks[name] !== undefined)) return
    try {
      const ms = Math.round(performance.now() - timing.received)
      if (Number.isSafeInteger(ms) && ms >= 0 && ms <= 0x7fffffff) timing.marks[name] = ms
    } catch { /* Optional timing never changes output/drain/result handling. */ }
  }
  const observed = (result: Record<string, unknown>): Record<string, unknown> => {
    if (timing === undefined) return result
    mark('workerUntilReplyStartMs')
    const value = gitWorkerTiming(timing.marks)
    return value === undefined ? result : { ...result, timing: value }
  }
  const { id, argv, cwd, env, binaryMax } = message
  if (!Number.isInteger(id) || Number(id) <= 0 || Number(id) > 0xffff_ffff
    || !Array.isArray(argv) || argv.length === 0 || argv[0] !== 'git'
    || !argv.every(arg => typeof arg === 'string') || cwd !== root
    || typeof env !== 'object' || env === null || Array.isArray(env)
    || !Object.values(env).every(value => typeof value === 'string')
    || (binaryMax !== undefined && (!Number.isSafeInteger(binaryMax) || Number(binaryMax) < 0))) {
    throw new Error('design git: invalid worker command')
  }
  const stdout = new OutputCollector(1 << 20, 'stdout', undefined)
  const stderr = new OutputCollector(1 << 18, 'stderr', undefined)
  const child = spawn(argv[0] as string, argv.slice(1) as string[], {
    cwd, env: env as Record<string, string>, windowsHide: true,
    shell: false, stdio: ['ignore', 'pipe', 'pipe'],
  })
  mark('workerSpawnReturnMs')
  if (timing !== undefined) child.once('spawn', () => mark('workerSpawnEventMs'))
  active = child
  let drainTimer: ReturnType<typeof setTimeout> | undefined
  let drainExpired = false
  child.once('exit', () => {
    mark('workerExitMs')
    drainTimer = setTimeout(() => {
      drainExpired = true
      // A descendant can inherit a collected pipe after Git exits. Match the
      // original adapter's five-second text drain rather than awaiting close
      // forever. Exact binary reads retain their caller-owned pipe semantics.
      if (binaryMax === undefined) child.stdout?.destroy()
      child.stderr?.destroy()
    }, 5000)
  })
  const outcome = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => { mark('workerCloseMs'); resolve(code) })
  })
  let bytes = 0, overflow = false
  const drainStdout = async (): Promise<void> => {
    try {
    for await (const chunk of child.stdout!) {
      mark('workerFirstStdoutMs')
      const data = Buffer.from(chunk as Uint8Array)
      if (binaryMax === undefined) stdout.push(data)
      else {
        bytes += data.length
        if (bytes > Number(binaryMax)) { overflow = true; continue }
        for (let offset = 0; offset < data.length; offset += GIT_BYTES_CHUNK) {
          await writeGitBytes(channel, Number(id), data.subarray(offset, offset + GIT_BYTES_CHUNK))
        }
      }
    }
    } catch (error) { if (!drainExpired || binaryMax !== undefined) throw error }
    mark('workerStdoutDrainedMs')
  }
  const drainStderr = async (): Promise<void> => {
    try { for await (const chunk of child.stderr!) { mark('workerFirstStderrMs'); stderr.push(Buffer.from(chunk as Uint8Array)) } }
    catch (error) { if (!drainExpired) throw error }
    mark('workerStderrDrainedMs')
  }
  try {
    const [exitCode] = await Promise.all([outcome, drainStdout(), drainStderr()])
    stdout.seal(); stderr.seal()
    await writeGitFrame(channel, observed(overflow
      ? { type: 'result', id, failure: 'binary-overflow' }
      : { type: 'result', id, exitCode, stdout: binaryMax === undefined ? stdout.readFrom(0).text : '', stderr: stderr.readFrom(0).text }))
  } catch {
    // Paths, environment, output and arbitrary exception text never enter the
    // worker's diagnostics. An uncertain command is never replayed here.
    child.kill('SIGKILL')
    await writeGitFrame(channel, observed({ type: 'result', id, failure: 'execution-failed' }))
    throw new Error('design git: worker command failed')
  } finally {
    if (drainTimer !== undefined) clearTimeout(drainTimer)
    active = undefined
  }
}

try {
  await writeGitFrame(channel, { type: 'ready', version: 1 })
  for await (const frame of readGitFrames(channel)) {
    if (frame.kind !== 'json') throw new Error('design git: unexpected worker bytes')
    const message = gitMessage(frame.value)
    if (message.type === 'close') {
      closing = true
      await writeGitFrame(channel, { type: 'closed' })
      channel.end()
      break
    }
    if (message.type === 'native') await executeNative(message)
    else if (message.type === 'run') await execute(message)
    else throw new Error('design git: unexpected worker request')
  }
  if (!closing) throw new Error('design git: worker channel ended before close')
} catch {
  stop()
  process.exitCode = 1
  channel.destroy()
}
