/** Reconstruct read-only artifact history from existing, paired Host observations. */
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { DesignArtifactHistoryEntry } from './artifact-activity.ts'
import { DESIGN_EXECUTION_PROVENANCE_SCHEMA, renderDesignExecutionProvenance, type DesignExecutionProvenance } from './dsh-execution-provenance.ts'
import { validateJsonSchemaValue, valueSchemaSpecToJsonSchema } from '@deepseek-ai/dsh-tools'
import { requireDesignFileRelativePath } from './design-file-path.ts'
import { designSessionEvents } from './dsh-session-events.ts'

const provenanceSchema = valueSchemaSpecToJsonSchema(DESIGN_EXECUTION_PROVENANCE_SCHEMA)

export interface DesignHistorySession {
  readonly meta: SessionHeader
  readonly events: readonly SessionEvent[]
  readonly inheritedEventCount?: number
}

/** Official live/persisted read handle, shared with the existing log reader. */
export async function inspectDesignHistorySession(context: unknown, id: string, signal: AbortSignal): Promise<DesignHistorySession | undefined> {
  const host = context as {
    sessions?: { get(id: string): { header: SessionHeader; inheritedEventCount?: number;
      snapshotEvents?: () => readonly SessionEvent[]; events?: readonly SessionEvent[] } | undefined }
    sessionPersistence?: { open(id: string, access: 'read', options: { signal: AbortSignal }): Promise<{
      header: SessionHeader; inheritedEventCount: number
      read(offset: undefined, length: undefined, options: { signal: AbortSignal }): Promise<{ events: readonly SessionEvent[] }>
      close(): Promise<void>
    }> }
  }
  signal.throwIfAborted()
  const live = host.sessions?.get(id)
  if (live !== undefined) return { meta: live.header, events: designSessionEvents(live), inheritedEventCount: live.inheritedEventCount }
  if (host.sessionPersistence === undefined) return undefined
  try {
    const handle = await host.sessionPersistence.open(id, 'read', { signal })
    try {
      const { events } = await handle.read(undefined, undefined, { signal })
      return { meta: handle.header, events, inheritedEventCount: handle.inheritedEventCount }
    } finally { await handle.close() }
  } catch { signal.throwIfAborted(); return undefined }
}

type Assignment = { artifactId: string; artifactKind: string; artifactFile: string;
  phase: 'completed' | 'failed' | 'cancelled'; attemptId?: string; diagnostic?: string }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
function json(text: string): unknown { try { return JSON.parse(text) } catch { return undefined } }
function messageText(event: Extract<SessionEvent, { type: 'tool/result' }>): string {
  return event.data.message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n')
}

/** Only the Host renderer's final provenance section, never prose or model-authored messages. */
function provenance(text: string): DesignExecutionProvenance | undefined {
  const heading = 'Execution provenance (Host observations and accepted publication, not a model assessment):\n'
  const offset = text.lastIndexOf(heading)
  if (offset === -1) return undefined
  const value = json(text.slice(offset + heading.length).split('\n')[0] ?? '')
  if (validateJsonSchemaValue(provenanceSchema, value).length > 0) return undefined
  const parsed = value as unknown as DesignExecutionProvenance
  return text.endsWith(renderDesignExecutionProvenance(parsed)) ? parsed : undefined
}

function ownEvents(session: DesignHistorySession): readonly SessionEvent[] {
  const inherited = session.inheritedEventCount
  if (inherited === undefined && session.meta.isSeeded) return []
  if (inherited !== undefined && (!Number.isSafeInteger(inherited) || inherited < 0 || inherited > session.events.length)) return []
  return session.events.slice(inherited ?? 0)
}

/** Pair actual delegation arguments with their tool result, not a child label or prompt. */
function assignments(events: readonly SessionEvent[], skill: string): readonly Assignment[] {
  const calls = new Map<string, { name: string; args: Record<string, unknown> }>()
  const result: Assignment[] = []
  for (const event of events) {
    if (event.type === 'tool/call' && ['design_delegate', 'design_delegate_frontier'].includes(event.data.name)) {
      const args = json(event.data.arguments)
      if (object(args)) calls.set(event.data.callId, { name: event.data.name, args })
    }
    if (event.type !== 'tool/result') continue
    const call = calls.get(event.data.message.toolCallId)
    if (call === undefined) continue
    const value = json(messageText(event))
    const items = call.name === 'design_delegate_frontier' ? call.args.items : [call.args]
    if (!Array.isArray(items)) continue
    for (const item of items) {
      if (!object(item) || typeof item.artifact_id !== 'string' || typeof item.artifact_kind !== 'string'
        || typeof item.artifact_file !== 'string' || !item.artifact_file.startsWith(`${skill}/`)) continue
      try { requireDesignFileRelativePath(item.artifact_file) } catch { continue }
      const outputs = call.name === 'design_delegate_frontier' && object(value) && Array.isArray(value.items) ? value.items : undefined
      const output = outputs?.find(candidate => object(candidate) && candidate.artifact_id === item.artifact_id
        && candidate.artifact_kind === item.artifact_kind && candidate.artifact_file === item.artifact_file)
      const receipt = call.name === 'design_delegate' ? value : object(output) ? output.artifact : undefined
      const state = object(output) ? output.status : event.data.message.isError ? 'failed' : object(receipt) ? 'completed' : undefined
      if (!['completed', 'failed', 'cancelled'].includes(String(state))) continue
      if (state === 'completed' && (!object(receipt) || receipt.path !== item.artifact_file || typeof receipt.attempt !== 'string')) continue
      result.push({ artifactId: item.artifact_id, artifactKind: item.artifact_kind, artifactFile: item.artifact_file,
        phase: state as Assignment['phase'],
        ...(object(receipt) && typeof receipt.attempt === 'string' ? { attemptId: receipt.attempt } : {}),
        ...(object(output) && typeof output.diagnostic === 'string' ? { diagnostic: output.diagnostic } : {}) })
    }
  }
  return result
}

/**
 * Exact Host pin provenance + native tool result + delegation + immutable ancestry.
 * No new ledger, directory scan, model assessment or current-execution restoration.
 */
export async function readDesignArtifactHistory(input: {
  readonly projectId: string
  readonly skill?: string
  readonly runId?: string
  readonly main: DesignHistorySession
  readonly inspect: (runId: string) => Promise<DesignHistorySession | undefined>
  readonly signal: AbortSignal
}): Promise<readonly DesignArtifactHistoryEntry[]> {
  const events = ownEvents(input.main)
  const calls = new Map<string, { index: number; name: string; args: unknown }>()
  const history = new Map<string, DesignArtifactHistoryEntry>()
  for (let index = 0; index < events.length; index += 1) {
    input.signal.throwIfAborted()
    const event = events[index]!
    if (event.type === 'tool/call') calls.set(event.data.callId, { index, name: event.data.name, args: json(event.data.arguments) })
    if (event.type !== 'tool/result') continue
    const call = calls.get(event.data.message.toolCallId)
    if (call === undefined || !['run_design_skill', 'design_publish'].includes(call.name)) continue
    const observed = provenance(messageText(event))
    if (observed === undefined || observed.projectId !== input.projectId
      || observed.parentSessionId !== String(input.main.meta.id)
      || (input.skill !== undefined && observed.skill !== input.skill)) continue
    if (input.runId !== undefined && !observed.workerAttempts.some(worker => worker.runId === input.runId)) continue
    const root = calls.get(observed.rootCallId)
    if (root?.name !== 'run_design_skill' || !object(root.args) || root.args.name !== observed.skill) continue
    if (observed.mode === 'subagent' && event.data.message.toolCallId !== observed.rootCallId) continue
    if (observed.mode === 'main' && call.name !== 'design_publish') continue
    const parents: { id: string; assignments: readonly Assignment[] }[] = []
    if (observed.mode === 'main') {
      // A later unrelated Bundle must not provide assignments to this invocation.
      if (events.slice(root.index + 1, call.index).some(item => item.type === 'tool/call' && item.data.name === 'run_design_skill')) continue
      parents.push({ id: String(input.main.meta.id), assignments: assignments(events.slice(root.index + 1, index + 1), observed.skill) })
    } else {
      for (const id of observed.producerRunIds) {
        const parent = await input.inspect(id)
        if (parent?.meta.id !== id || parent.meta.parentSession !== input.main.meta.id) continue
        parents.push({ id, assignments: assignments(ownEvents(parent), observed.skill) })
      }
    }
    for (const worker of observed.workerAttempts) {
      if (input.runId !== undefined && worker.runId !== input.runId) continue
      if (worker.runId === undefined || worker.artifactFile === undefined
        || !['completed', 'failed', 'cancelled'].includes(worker.phase)) continue
      for (const parent of parents) {
        const matching = parent.assignments.filter(item => item.artifactFile === worker.artifactFile && item.phase === worker.phase
          && (item.attemptId === undefined || item.attemptId === worker.attemptId))
        const identities = new Set(matching.map(item => JSON.stringify([item.artifactId, item.artifactKind])))
        if (matching.length === 0 || identities.size !== 1) continue
        const child = await input.inspect(worker.runId)
        if (child?.meta.id !== worker.runId || child.meta.parentSession !== parent.id) continue
        const assignment = matching.at(-1)!
        const entry: DesignArtifactHistoryEntry = { skill: observed.skill, artifactId: assignment.artifactId,
          artifactKind: assignment.artifactKind, artifactFile: assignment.artifactFile, invocationId: observed.invocationId,
          runId: worker.runId, parentRunId: parent.id, phase: worker.phase as Assignment['phase'], timestamp: event.time,
          ...(assignment.diagnostic === undefined ? {} : { diagnostic: assignment.diagnostic }) }
        const key = JSON.stringify([entry.skill, entry.artifactKind, entry.artifactId, entry.artifactFile])
        if ((history.get(key)?.timestamp ?? -1) <= entry.timestamp) history.set(key, Object.freeze(entry))
      }
    }
  }
  return Object.freeze([...history.values()])
}
