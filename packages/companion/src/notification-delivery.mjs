// Public failure receipts never include message bodies, raw RPC errors or credentials.
export const UNKNOWN_DELIVERY_MESSAGE = 'Codex notification delivery is unknown; inspect the original session before retrying.'
const setupMessages = {
  'proxy-connect': 'Codex native notification setup is unavailable: the original host connection could not be opened. Check its connection settings; no message was submitted.',
  'websocket-handshake': 'Codex native notification setup is unavailable: the connection handshake did not complete. Check the original host connection settings; no message was submitted.',
  initialize: 'Codex native notification setup is unavailable: the original host initialization did not complete. Check its connection settings; no message was submitted.',
}
const stages = new Set(['queue-add', 'post-add-read', 'queue-start'])
const confirmed = new Set(['initialized', 'thread-read', 'queue-added', 'post-add-read', 'queue-started'])
const categories = new Set(['rpc-rejected', 'timeout', 'disconnected', 'protocol', 'send-failed', 'invalid-response', 'invalid-state', 'unknown'])
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i

export function notificationDeliveryReceipt(value) {
  if (value?.delivery === 'not-submitted' && value.notSubmitted === true && Object.hasOwn(setupMessages, value.stage)) {
    return { delivery: 'not-submitted', status: 'unavailable', notSubmitted: true, stage: value.stage,
      transportCategory: categories.has(value.transportCategory) ? value.transportCategory : 'unknown',
      ...(Number.isInteger(value.rpcCode) && value.rpcCode >= -2147483648 && value.rpcCode <= 2147483647 ? { rpcCode: value.rpcCode } : {}),
    }
  }
  if (value?.delivery !== 'unknown') return undefined
  const receipt = { delivery: 'unknown' }
  if (stages.has(value.stage)) receipt.stage = value.stage
  if (confirmed.has(value.lastConfirmed)) receipt.lastConfirmed = value.lastConfirmed
  for (const key of ['clientUserMessageId', 'queuedSubmissionId', 'turnId']) {
    if (typeof value[key] === 'string' && uuid.test(value[key])) receipt[key] = value[key]
  }
  receipt.transportCategory = categories.has(value.transportCategory) ? value.transportCategory : 'unknown'
  if (Number.isInteger(value.rpcCode) && value.rpcCode >= -2147483648 && value.rpcCode <= 2147483647) receipt.rpcCode = value.rpcCode
  return receipt
}

export function notificationErrorResponse(error) {
  const receipt = notificationDeliveryReceipt(error)
  return receipt ? { error: receipt.delivery === 'unknown' ? UNKNOWN_DELIVERY_MESSAGE : setupMessages[receipt.stage], ...receipt } : undefined
}

export function notificationSetupError(details) {
  const receipt = notificationDeliveryReceipt({ ...details, delivery: 'not-submitted', notSubmitted: true })
  if (!receipt) throw Error('Invalid notification setup stage.')
  return Object.assign(new Error(setupMessages[receipt.stage]), receipt)
}

export function unknownDeliveryError(details) {
  return Object.assign(new Error(UNKNOWN_DELIVERY_MESSAGE), notificationDeliveryReceipt({ ...details, delivery: 'unknown' }))
}
