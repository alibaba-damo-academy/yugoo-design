// Public failure receipts never include message bodies, raw RPC errors or credentials.
export const UNKNOWN_DELIVERY_MESSAGE = 'Codex notification delivery is unknown; inspect the original session before retrying.'
const stages = new Set(['queue-add', 'post-add-read', 'queue-start'])
const confirmed = new Set(['initialized', 'thread-read', 'queue-added', 'post-add-read', 'queue-started'])
const categories = new Set(['rpc-rejected', 'timeout', 'disconnected', 'protocol', 'send-failed', 'invalid-response', 'invalid-state', 'unknown'])
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i

export function notificationDeliveryReceipt(value) {
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
  return receipt ? { error: UNKNOWN_DELIVERY_MESSAGE, ...receipt } : undefined
}

export function unknownDeliveryError(details) {
  return Object.assign(new Error(UNKNOWN_DELIVERY_MESSAGE), notificationDeliveryReceipt({ ...details, delivery: 'unknown' }))
}
