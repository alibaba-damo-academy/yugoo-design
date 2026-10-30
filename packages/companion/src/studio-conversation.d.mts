import type { StudioInstance } from '../../studio-ui/src/InstanceWorkbench.tsx'
import type { StudioPreparedSourceChanges } from '../../studio-ui/src/source-candidate-state.ts'
export interface StudioConversationBinding { bindingId: string; threadId: string; host?: string }
export interface StudioConversationTarget extends StudioConversationBinding { id: string; expectedRevision: number; bundle?: { name: string; version: string } }
export interface StudioEditingContext { intent: 'create' | 'edit'; currentFile?: string }
export interface StudioConversationReceipt { accepted?: boolean; status?: string; threadId?: string }
export interface StudioConversationScope { record?: Pick<StudioInstance, 'id' | 'revision'>; dirty: boolean; busy: boolean; previewBundle?: {name: string; version: string} }
export function studioConversationScopeMatches(scope: StudioConversationScope | undefined, target: StudioConversationTarget | undefined): boolean
export function studioCandidateForReview(scope: StudioConversationScope | undefined, request: {studio: StudioConversationTarget}, prepared: StudioPreparedSourceChanges): StudioPreparedSourceChanges
export function studioConversationTarget(value: unknown): Readonly<StudioConversationTarget>
export function studioEditingContext(value: unknown): Readonly<StudioEditingContext> | undefined
export function studioConversationHandoff(search: string): {requestId: string; studio: StudioConversationTarget} | undefined
export function readStudioConversationTarget(input: { target: unknown; binding: StudioConversationBinding; context?: StudioEditingContext; readInstance(input: {id: string}): Promise<StudioInstance> }): Promise<StudioConversationTarget & Pick<StudioInstance, 'kind' | 'title'> & {context?: Readonly<StudioEditingContext>}>
export function createStudioConversationClient(input: { rpc(method: string, params?: {}): Promise<any>; requestId(): string; onRequest?(requestId: string, studio: StudioConversationTarget): void }): {
  connect(): Promise<StudioConversationBinding>
  send(input: { text: string; id: string; expectedRevision: number; bundle?: { name: string; version: string }; context?: StudioEditingContext; beforeSend?(): void }): Promise<StudioConversationReceipt>
}
