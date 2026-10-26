/** One bound save-notification lane, authenticated by Companion's connection.
 * No generic RPC, model, alternate thread selection or design persistence.
 */
import { randomUUID } from 'node:crypto'
import { requireThreadId } from './codex-connection.mjs'
import { unknownDeliveryError } from './notification-delivery.mjs'

export function createCodexDesktopRelay(threadId, { now = Date.now, leaseMs = 20000, waitMs = 5000, deliveryMs = 30000 } = {}) {
  requireThreadId(threadId)
  let owner, generation, seen = 0, pending, waiter, closed = false
  const live = () => !closed && !!owner && now() - seen < leaseMs
  const error = code => Object.assign(new Error(code), { notSubmitted: true })
  const wake = () => { if (waiter) { const next = waiter; waiter = undefined; next() } }
  const settle = (failure, value) => {
    if (!pending) return
    const item = pending
    pending = undefined
    clearTimeout(item.timer)
    failure ? item.reject(failure) : item.resolve(value)
  }
  const stop = () => {
    owner = undefined
    generation = undefined
    if (pending) settle(pending.claimed ? unknownDeliveryError({ clientUserMessageId: pending.id, transportCategory: 'disconnected' }) : error('CODEX_DESKTOP_BRIDGE_UNAVAILABLE'))
    wake()
  }
  return {
    host: 'codex', inputMode: 'desktop', threadId,
    async probe() { return { status: live() ? 'available' : 'unavailable', capability: 'desktop-message-submission' } },
    async send(text) {
      if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 128 * 1024) throw error('CODEX_DESKTOP_MESSAGE_INVALID')
      if (!live()) throw error('CODEX_DESKTOP_BRIDGE_UNAVAILABLE')
      if (pending) throw error('CODEX_DESKTOP_BRIDGE_BUSY')
      return new Promise((resolve, reject) => {
        const id = randomUUID()
        pending = { id, text, resolve, reject, claimed: false, generation,
          timer: setTimeout(() => settle(pending?.claimed ? unknownDeliveryError({ clientUserMessageId: id, transportCategory: 'timeout' }) : error('CODEX_DESKTOP_BRIDGE_UNAVAILABLE')), deliveryMs) }
        wake()
      })
    },
    async desktopBridge(params) {
      if (closed || !params || typeof params !== 'object') throw error('CODEX_DESKTOP_BRIDGE_CLOSED')
      const { operation, instance } = params
      requireThreadId(instance)
      if (operation === 'ready') {
        if (params.threadId !== threadId) throw error('CODEX_DESKTOP_BRIDGE_THREAD_MISMATCH')
        if (owner && live()) throw error('CODEX_DESKTOP_BRIDGE_ALREADY_BOUND')
        // A dead/expired bridge cannot release its lease through the live-only
        // lane. Revoke that admission before accepting this explicit fresh one;
        // claimed delivery remains unknown and is never replayed.
        if (owner) stop()
        owner = instance; generation = randomUUID(); seen = now()
        return { ready: true, threadId, generation }
      }
      const admitted = () => live() && instance === owner && params.generation === generation
      if (operation === 'stop' && instance === owner && params.generation === generation) {
        stop(); return { stopped: true }
      }
      if (!admitted()) throw error('CODEX_DESKTOP_BRIDGE_UNAVAILABLE')
      seen = now()
      if (operation === 'next') {
        if (waiter) throw error('CODEX_DESKTOP_BRIDGE_ALREADY_WAITING')
        if (!pending || pending.claimed) await new Promise(resolve => {
          const timer = setTimeout(() => { waiter = undefined; resolve() }, waitMs)
          waiter = () => { clearTimeout(timer); resolve() }
        })
        // A stop can wake this request before a new owner (even the same
        // instance UUID) binds. Never let that old request cross admissions.
        if (!admitted()) throw error('CODEX_DESKTOP_BRIDGE_UNAVAILABLE')
        seen = now()
        if (!pending || pending.claimed) return { message: null }
        pending.claimed = true
        return { message: { id: pending.id, text: pending.text } }
      }
      if (operation === 'settle') {
        if (!pending?.claimed || pending.generation !== generation || params.messageId !== pending.id) throw error('CODEX_DESKTOP_RECEIPT_MISMATCH')
        const receipt = params.receipt
        if (receipt?.accepted === true && receipt.status === 'submitted_unverified' && receipt.threadId === threadId) {
          settle(undefined, { accepted: true, status: 'submitted_unverified', threadId, messageId: pending.id })
        } else settle(receipt?.notSubmitted === true ? error('CODEX_DESKTOP_SUBMISSION_REFUSED') : unknownDeliveryError({ clientUserMessageId: pending.id, transportCategory: 'unknown' }))
        return { settled: true }
      }
      throw error('CODEX_DESKTOP_BRIDGE_OPERATION_INVALID')
    },
    close() { closed = true; stop() },
  }
}
