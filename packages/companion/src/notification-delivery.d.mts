/** Allowlisted delivery evidence; excludes raw host errors and message bodies. */
export type NotificationTransportCategory = 'rpc-rejected' | 'timeout' | 'disconnected' | 'protocol' | 'send-failed' | 'invalid-response' | 'invalid-state' | 'unknown'
export interface NotificationNotSubmittedReceipt {
  delivery: 'not-submitted'
  status: 'unavailable'
  notSubmitted: true
  stage: 'proxy-connect' | 'websocket-handshake' | 'initialize'
  transportCategory: NotificationTransportCategory
  rpcCode?: number
}
export interface NotificationUnknownReceipt {
  delivery: 'unknown'
  stage?: 'queue-add' | 'post-add-read' | 'queue-start'
  lastConfirmed?: 'initialized' | 'thread-read' | 'queue-added' | 'post-add-read' | 'queue-started'
  clientUserMessageId?: string
  queuedSubmissionId?: string
  turnId?: string
  transportCategory: NotificationTransportCategory
  rpcCode?: number
}
export type NotificationDeliveryReceipt = NotificationNotSubmittedReceipt | NotificationUnknownReceipt
export const UNKNOWN_DELIVERY_MESSAGE: string
export function notificationDeliveryReceipt(value: unknown): NotificationDeliveryReceipt | undefined
export function notificationErrorResponse(error: unknown): (NotificationDeliveryReceipt & { error: string }) | undefined
export function notificationSetupError(details: unknown): Error & NotificationNotSubmittedReceipt
export function unknownDeliveryError(details: unknown): Error & NotificationUnknownReceipt
