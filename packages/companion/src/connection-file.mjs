/** Local CLI-to-companion transport. It cannot start or resume a model thread. */
import { readFile } from 'node:fs/promises'
import { unknownDeliveryError } from './notification-delivery.mjs'

export async function callCompanion(connectionFile, request) {
  const connection = JSON.parse(await readFile(connectionFile, 'utf8'))
  const origin = new URL(connection.origin)
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('Expected a loopback companion connection.')
  if (typeof connection.token !== 'string' || !/^[a-f0-9]{64}$/.test(connection.token)) throw new Error('Invalid companion access token.')
  const response = await fetch(`${origin.origin}/api`, { method: 'POST', redirect: 'error',
    // Native submission includes readiness/privacy checks before the provider's
    // delivery deadline. An outer abort is still unknown, never a retry signal.
    signal: AbortSignal.timeout(request?.method === 'sendPrompt' ? 90000 : 30000), headers: { 'Content-Type': 'application/json', Origin: origin.origin, 'X-Design-Token': connection.token },
    body: JSON.stringify(request),
  })
  const result = await response.json()
  if (!response.ok) {
    if (result.delivery === 'unknown') throw unknownDeliveryError(result)
    throw new Error(result.error ?? 'Companion call failed.')
  }
  return result
}
