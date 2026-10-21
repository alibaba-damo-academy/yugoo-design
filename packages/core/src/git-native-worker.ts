/** Fixed trusted worker entry. It accepts structured library operations, never argv. */
import { parentPort } from 'node:worker_threads'
import { isAbsolute } from 'node:path'
import { nativeGitCancellation } from './git-native-cancellation.ts'
import { nativeGitOperation, nativeGitFailure } from './git-native-operation.ts'

if (!parentPort) throw new Error('design git: native worker requires its owning executor')
const port = parentPort
let busy = false
port.on('message', (message: unknown) => { void run(message) })

async function run(message: unknown): Promise<void> {
  if (!message || typeof message !== 'object' || !('type' in message) || message.type !== 'run'
    || !('id' in message) || !Number.isSafeInteger(message.id) || Number(message.id) <= 0
    || !('cwd' in message) || typeof message.cwd !== 'string' || !isAbsolute(message.cwd)
    || !('operation' in message) || !('cancelled' in message)
    || !(message.cancelled instanceof SharedArrayBuffer) || message.cancelled.byteLength !== 4 || busy) {
    throw new Error('design git: invalid native worker envelope')
  }
  busy = true
  const id = message.id
  try {
    const operation = nativeGitOperation(message.operation)
    const signal = nativeGitCancellation(new Int32Array(message.cancelled))
    signal.throwIfAborted()
    let native: typeof import('./git-native.ts')
    try { native = await import('./git-native.ts') }
    catch { port.postMessage({ type: 'result', id, failure: 'native-unavailable' }); return }
    // executeNativeGit opens/frees a fresh repository for every request.
    const result = await native.executeNativeGit(message.cwd, operation, signal)
    // Do not throw for late cancellation here: the parent must see a committed receipt.
    port.postMessage({ type: 'result', id, value: result.value,
      ...(result.bytes === undefined ? {} : { bytes: result.bytes }) })
  } catch (error) { port.postMessage({ type: 'result', id, failure: nativeGitFailure(error) }) }
  finally { busy = false }
}
