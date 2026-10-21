/** Private, bounded wire for one save's managed Git executor. No Git authority. */
import type { Duplex } from 'node:stream'
export { nativeGitOperation, nativeGitFailure, isNativeGitFailure } from './git-native-operation.ts'

// A JSON response contains at most the existing 1 MiB stdout + 256 KiB stderr
// tails. JSON escaping takes at most six bytes per retained byte.
const MAX_FRAME = 8 << 20
export const GIT_BYTES_CHUNK = 64 << 10

export type GitFrame = { kind: 'json'; value: unknown } | { kind: 'bytes'; id: number; bytes: Buffer }

/**
 * Optional observation only, not Git/result authority. All marks are rounded
 * milliseconds since the worker receives this decoded run, never absolute clocks:
 * spawn() return, 'spawn', first chunks consumed by the existing output iterators,
 * 'exit', 'close', completion of each existing drain, then reply construction's
 * end immediately before frame writing. Missing events stay absent. Drain marks
 * include the existing bounded drain policy; they do not certify lossless EOF.
 */
export const GIT_WORKER_TIMING_FIELDS = ['workerSpawnReturnMs', 'workerSpawnEventMs',
  'workerFirstStdoutMs', 'workerFirstStderrMs', 'workerExitMs', 'workerCloseMs',
  'workerStdoutDrainedMs', 'workerStderrDrainedMs', 'workerUntilReplyStartMs'] as const
export type GitWorkerTiming = Partial<Record<typeof GIT_WORKER_TIMING_FIELDS[number], number>>

/** Drop unknowns and the entire observation on any invalid known field; never throw. */
export function gitWorkerTiming(value: unknown): GitWorkerTiming | undefined {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return
    const result: GitWorkerTiming = {}
    for (const name of GIT_WORKER_TIMING_FIELDS) {
      const property = Object.getOwnPropertyDescriptor(value, name)
      if (property === undefined) continue
      if (!('value' in property) || !Number.isSafeInteger(property.value) || property.value < 0 || property.value > 0x7fffffff) return
      result[name] = property.value
    }
    const until = result.workerUntilReplyStartMs
    if (until === undefined || Object.values(result).some(mark => mark > until)) return
    return result
  } catch { return undefined }
}

export async function writeGitFrame(channel: Duplex, value: unknown): Promise<void> {
  await writeFrame(channel, 0, Buffer.from(JSON.stringify(value), 'utf8'))
}

export async function writeGitBytes(channel: Duplex, id: number, bytes: Uint8Array): Promise<void> {
  if (bytes.byteLength > GIT_BYTES_CHUNK) throw new Error('design git: oversized worker byte chunk')
  const payload = Buffer.allocUnsafe(4 + bytes.byteLength)
  payload.writeUInt32BE(id)
  payload.set(bytes, 4)
  await writeFrame(channel, 1, payload)
}

async function writeFrame(channel: Duplex, kind: number, payload: Buffer): Promise<void> {
  if (payload.length > MAX_FRAME) throw new Error('design git: worker frame exceeded its limit')
  const frame = Buffer.allocUnsafe(5 + payload.length)
  frame[0] = kind
  frame.writeUInt32BE(payload.length, 1)
  frame.set(payload, 5)
  await new Promise<void>((resolve, reject) => {
    channel.write(frame, (error?: Error | null) => error ? reject(error) : resolve())
  })
}

export async function* readGitFrames(channel: AsyncIterable<Uint8Array>): AsyncGenerator<GitFrame> {
  const header = Buffer.allocUnsafe(5)
  let headerBytes = 0, payloadBytes = 0, kind = 0
  let payload: Buffer | undefined
  for await (const chunk of channel) {
    let offset = 0
    while (offset < chunk.byteLength) {
      if (payload === undefined) {
        const count = Math.min(5 - headerBytes, chunk.byteLength - offset)
        header.set(chunk.subarray(offset, offset + count), headerBytes)
        headerBytes += count; offset += count
        if (headerBytes !== 5) continue
        kind = header[0]!
        const size = header.readUInt32BE(1)
        if (size > MAX_FRAME || (kind !== 0 && kind !== 1)
          || (kind === 1 && (size < 4 || size > GIT_BYTES_CHUNK + 4))) {
          throw new Error('design git: invalid worker frame')
        }
        payload = Buffer.allocUnsafe(size)
        payloadBytes = 0
      }
      const count = Math.min(payload.length - payloadBytes, chunk.byteLength - offset)
      payload.set(chunk.subarray(offset, offset + count), payloadBytes)
      payloadBytes += count; offset += count
      if (payloadBytes !== payload.length) continue
      if (kind === 0) yield { kind: 'json', value: JSON.parse(payload.toString('utf8')) as unknown }
      else yield { kind: 'bytes', id: payload.readUInt32BE(0), bytes: Buffer.from(payload.subarray(4)) }
      payload = undefined; headerBytes = 0
    }
  }
  if (headerBytes !== 0 || payload !== undefined) throw new Error('design git: truncated worker frame')
}

export function gitMessage(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('design git: invalid worker message')
  return value as Record<string, unknown>
}
