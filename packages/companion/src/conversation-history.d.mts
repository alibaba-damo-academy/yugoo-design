import type { RecordedConversation } from './conversation.tsx'
import type { DesignPanelWorkspaceRead } from '../../panel/src/client/types.ts'
type Attempt = NonNullable<DesignPanelWorkspaceRead['executionAttempts']>[number]
export function conversationWork(value?: RecordedConversation, attempts?: readonly Attempt[]): {status:string;activeId:string|null}
export function conversationHistory(rows?: RecordedConversation['rows'], attempts?: readonly Attempt[]): (
  { kind: 'message'; row: RecordedConversation['rows'][number] } |
  { kind: 'producer'; attempt: Attempt; earlier?: boolean }
)[]
export function compactConversationHistory(rows?: RecordedConversation['rows'], attempts?: readonly Attempt[]): (
  { kind: 'message'; row: RecordedConversation['rows'][number] } |
  { kind: 'producer'; attempt: Attempt; earlier?: boolean } |
  { kind: 'activity'; rows: RecordedConversation['rows'] }
)[]
