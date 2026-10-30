/** Restricted native Studio authoring; candidate preparation never saves content. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { foldConsumedWork, type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { applyChildComposition, appendDelegatedPolicyOverrides, captureDelegatedPolicyOverrides,
  resolveChildAgentOptions, resolveChildDepth } from '@deepseek-ai/dsh-subagent'
import { defineTool, type ToolDefinition, type ToolExecution } from '@deepseek-ai/dsh-tools'
import type { StudioAuthoringObservation, StudioAuthoringReference, StudioAuthoringRequest,
  StudioAuthoringResumeRequest, StudioAuthoringRun, StudioAuthoringScope } from './authoring-agent.types.ts'
import { readStudioAuthoringMaterial, readStudioPanelComponents, STUDIO_AUTHORING_METHOD_GUIDANCE } from './authoring-material.ts'
export type * from './authoring-agent.types.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'yugoo-design': { readonly kind: 'yugoo-design' } & (
      | { readonly form?: never }
      | { readonly form: 'notice'; readonly summary: string }
    )
  }
}

const MAX_EVENTS = 8192
const PREPARE_REPLACEMENT_GUIDANCE = 'Each prepare starts from the bound saved revision and replaces the entire previous unsaved proposal; calls do not accumulate. When correcting diagnostics, resend the full set of all still-intended unsaved file replacements, including unchanged files from the previous proposal.'
const clone = <T>(value: T): T => structuredClone(value)
const encode = (value: unknown) => JSON.stringify(value)

function snapshotScope(value: StudioAuthoringScope): StudioAuthoringScope {
  const scope = clone(value)
  assert.ok(typeof scope.id === 'string' && scope.id.length > 0)
  assert.ok(Number.isSafeInteger(scope.expectedRevision) && scope.expectedRevision >= 0)
  assert.ok(Array.isArray(scope.allowedPaths) && scope.allowedPaths.length > 0
    && scope.allowedPaths.every(path => typeof path === 'string' && path.length > 0))
  Object.freeze(scope.allowedPaths)
  if (scope.bundle) Object.freeze(scope.bundle)
  return Object.freeze(scope)
}

function messageBinding(message: UserMessage): Omit<StudioAuthoringReference, 'messageId'> | undefined {
  if (message.source.kind !== 'yugoo-design') return
  return (message.source as typeof message.source & {
    readonly studioAuthoring?: Omit<StudioAuthoringReference, 'messageId'>
  }).studioAuthoring
}

/** Inbox state is needed to distinguish unrun cancellation from an empty turn. */
function account(events: readonly SessionEvent[], reference: StudioAuthoringReference) {
  const queues = new Map<string, UserMessage[]>(), owned = events.filter(event => event.seq > reference.afterSeq)
  let turn: number | null = null, consumedTurn: number | null = null, dropped = false, bound = false
  for (const event of events) {
    if (event.type === 'turn/start' && event.seq > reference.afterSeq) turn = event.data.turn
    if (event.type === 'agent/inbox/spliced') {
      const data = event.data, queue = queues.get(data.target) ?? []
      const removed = queue.splice(data.start, data.removedCount ?? 0, ...data.inserted)
      queues.set(data.target, queue)
      for (const message of data.inserted) if (message.id === reference.messageId) {
        const { messageId: _id, ...expected } = reference
        assert.deepEqual(messageBinding(message), expected, 'Native Studio binding differs from the retained reference')
        bound = true
      }
      if (removed.some(message => message.id === reference.messageId)) {
        if (data.outcome === 'canceled') dropped = true
        else if (turn !== null) consumedTurn = turn
      }
    }
    if (event.type === 'user/message' && event.data.id === reference.messageId) {
      const { messageId: _id, ...expected } = reference
      assert.deepEqual(messageBinding(event.data), expected, 'Native Studio message binding mismatch')
      bound = true; consumedTurn = turn
    }
  }
  const pendingInput = [...queues.values()].some(queue => queue.length > 0)
  const consumed = consumedTurn !== null
  const startIndex = owned.findIndex(event => event.type === 'turn/start' && event.data.turn === consumedTurn)
  const endIndex = owned.findIndex(event => event.type === 'turn/end' && event.data.turn === consumedTurn)
  const end = startIndex >= 0 && endIndex >= startIndex ? foldConsumedWork(owned.slice(startIndex, endIndex + 1)).end : undefined
  const matchingEnd = end && consumed && end.data.turn === consumedTurn ? end : undefined
  const reason = matchingEnd?.data.reason.kind
  const interrupted = reason === 'interrupted' || reason === 'forked'
  const terminal = !interrupted && (dropped || !!matchingEnd)
  const status = interrupted ? 'unknown' : dropped || reason === 'aborted' ? 'cancelled'
    : reason === 'completed' ? 'completed'
    : matchingEnd ? 'failed' : consumed ? 'running' : bound ? 'queued' : 'unknown'
  return { bound, status, consumed, turn: consumedTurn ?? turn, terminal, reason,
    pendingInput, throughSeq: events.at(-1)?.seq ?? -1 } as const
}

/** Public Host records for this exact request; execution remains native. */
function conversation(events: readonly SessionEvent[], ref: StudioAuthoringReference,
  state: Pick<StudioAuthoringObservation, 'status' | 'terminal'>): NonNullable<StudioAuthoringObservation['conversation']> {
  const rows: Array<NonNullable<StudioAuthoringObservation['conversation']>['rows'][number]> = []
  const calls = new Map<string, typeof rows[number]>()
  for (const event of events) {
    if (event.seq <= ref.afterSeq) continue
    if (event.type === 'assistant/message' && event.surfaceOp === 'append') {
      // Only public text. Thinking blocks, compacted replacements, provider streams
      // and system/developer context are not conversation messages.
      const text = event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').slice(0, 16384)
      if (text) rows.push({ id: String(event.data.message.id), role: 'assistant', label: 'Agent', text, status: 'completed' })
    } else if (event.type === 'tool/call') {
      const row = { id: String(event.data.callId), role: 'tool' as const, label: event.data.name, text: '', status: 'running' }
      rows.push(row); calls.set(row.id, row)
    } else if (event.type === 'tool/result' && event.surfaceOp === 'append') {
      const row = calls.get(String(event.data.message.toolCallId))
      if (row) {
        row.status = event.data.message.isError ? 'failed' : 'completed'
        row.text = event.data.error?.reason?.slice(0, 16384) ?? ''
      }
    }
  }
  if (state.terminal) for (const row of calls.values()) if (row.status === 'running') row.status = state.status === 'cancelled' ? 'cancelled' : 'unknown'
  return { rows: rows.slice(-200), omitted: Math.max(0, rows.length - 200) }
}

/** Host-owned adapter. No filesystem store, provider client, or native profile is created. */
export function createStudioAuthoringAgent(ctx: Context) {
  const live = new Map<string, StudioAuthoringRun>()
  const starting = new Set<Promise<void>>()
  const cleanupFailures = new Set<unknown>()
  const lifetime = new AbortController()
  let disposing: Promise<void> | undefined
  const durable = new Set<string>()
  const key = (ref: StudioAuthoringReference) => `${ref.sessionId}:${ref.epoch}`

  async function observe(reference: StudioAuthoringReference): Promise<StudioAuthoringObservation> {
    const ref = clone(reference), lease = await ctx.sessionQuery.observeSession(SessionId(ref.sessionId), { projectionMode: 'none' })
    try {
      assert.equal(String(lease.header.id), ref.sessionId)
      assert.equal(String(lease.header.parentSession), ref.parentSessionId, 'Native Studio parent changed')
      assert.ok(lease.events.length <= MAX_EVENTS, 'Studio native evidence exceeds the bounded observation limit')
      // A later epoch must never be credited to an earlier invocation.
      const next = lease.events.find(event => event.seq > ref.afterSeq && event.type === 'agent/inbox/spliced'
        && event.data.inserted.some(message => messageBinding(message)?.epoch !== undefined
          && messageBinding(message)?.epoch !== ref.epoch))
      const events = next ? lease.events.filter(event => event.seq < next.seq) : lease.events
      const { bound, ...state } = account(events, ref)
      return { reference: ref, ...state, source: lease.source,
        durable: durable.has(key(ref)), conversation: bound ? conversation(events, ref, state) : { rows: [], omitted: 0 } }
    } finally { lease[Symbol.dispose]() }
  }

  async function start(request: StudioAuthoringRequest, previous?: StudioAuthoringReference): Promise<StudioAuthoringRun> {
    const { invocationId, workspaceRoot, prompt, signal: callerSignal, onReference, onPrepared } = request
    const signal = callerSignal ? AbortSignal.any([callerSignal, lifetime.signal]) : lifetime.signal
    // Caller callbacks need not cooperate with cancellation. Observe their eventual
    // settlement, but stop startup promptly without leaving an owned child behind.
    const waitFor = <T>(operation: () => T | Promise<T>): Promise<T> => new Promise((resolve, reject) => {
      signal.throwIfAborted()
      const onAbort = () => reject(signal.reason)
      signal.addEventListener('abort', onAbort, { once: true })
      Promise.resolve().then(() => { signal.throwIfAborted(); return operation() }).then(
        value => { signal.removeEventListener('abort', onAbort); resolve(value) },
        error => { signal.removeEventListener('abort', onAbort); reject(error) },
      )
    })
    previous = previous === undefined ? undefined : clone(previous)
    signal?.throwIfAborted()
    const scope = snapshotScope(request.scope), parent = request.parent
    assert.equal(ctx.agents.get(parent.id), parent, 'Studio requires the exact live native parent')
    assert.ok(isAbsolute(workspaceRoot), 'Studio requires an explicit isolated native workspace')
    assert.ok(typeof invocationId === 'string' && invocationId.length > 0)
    assert.ok(typeof prompt === 'string' && prompt.trim() && Buffer.byteLength(prompt) <= 128 * 1024)
    const read = request.ports.read.bind(request.ports), prepare = request.ports.prepare.bind(request.ports)
    // S3 remains the validator and source authority. Check its current grant before native effects.
    const checked = await waitFor(() => read({ paths: [scope.allowedPaths[0]] })) as { scope?: StudioAuthoringScope }
    assert.deepEqual(checked.scope, scope, 'S3 authoring scope differs from the native binding')
    signal?.throwIfAborted()
    assert.equal(ctx.agents.get(parent.id), parent, 'Studio caller closed during source preflight')
    if (previous) {
      assert.equal(previous.parentSessionId, String(parent.id), 'Studio resume parent changed')
      assert.equal(previous.scope.id, scope.id, 'Studio resume cannot select another instance')
      assert.ok(scope.expectedRevision >= previous.scope.expectedRevision, 'Studio resume cannot restore an older source revision')
      const prior = await waitFor(() => observe(previous!))
      assert.ok(!prior.pendingInput && prior.consumed, 'Native delivery is unconsumed or unknown; do not redispatch it')
      assert.equal(ctx.agents.get(SessionId(previous.sessionId)), undefined, 'Native Studio session is already live')
    }
    const sessionId = previous?.sessionId ?? randomUUID(), epoch = randomUUID()
    const events: SessionEvent[] = [], staged = new Map<ToolExecution['token'], unknown>()
    let child: Agent | undefined, handle: AgentHandle | undefined, ref: StudioAuthoringReference | undefined
    let currentTurn: number | null = null, finished = false, prepared: unknown, diagnostic: string | undefined
    let overflow = false, disposed: Promise<void> | undefined
    const policy = captureDelegatedPolicyOverrides(parent), depth = resolveChildDepth(parent, undefined)
    const disposeOwned = () => disposed ??= (async () => {
      try { await handle?.dispose() }
      catch (error) { cleanupFailures.add(error); throw error }
    })()
    // Native session publication cannot be reentered by cancellation appends.
    const onAbort = () => queueMicrotask(() => {
      if (!finished && child && ctx.agents.get(child.id) === child) child.cancel({ kind: 'parent' })
    })
    const setup = (childCtx: Context, agent: Agent) => {
      signal.throwIfAborted()
      assert.equal(agent.session.header.cwd, workspaceRoot, 'Native Studio workspace changed; explicit migration is required')
      child = agent
      appendDelegatedPolicyOverrides(agent.session, policy)
      appendDelegatedPolicyOverrides(agent.session, { sandboxMode: 'read-only', approvalPolicy: 'never', permissionPreset: undefined })
      applyChildComposition(childCtx, parent, { toolFilter: { allow: [] } })
      childCtx.tools.presentAs('native')
      childCtx.on('session/event', (session, event) => {
        if (session !== agent.session) return
        if (event.type === 'turn/start') currentTurn = event.data.turn
        if (events.length < MAX_EVENTS) events.push(event)
        else overflow = true
      })
      const definitions = new Map<string, ToolDefinition>()
      const register = (definition: ToolDefinition) => {
        Object.freeze(definition); definitions.set(definition.name, definition); childCtx.tools.register(definition)
      }
      const output = { schema: { type: 'object' as const, properties: { content: { type: 'string' as const, required: true as const } }, additionalProperties: false as const },
        render: (_args: unknown, value: { content: string }) => [{ type: 'text' as const, text: value.content }] }
      const returned = (value: unknown) => {
        const content = encode(value)
        assert.ok(content !== undefined && Buffer.byteLength(content) <= 5 * 1024 * 1024, 'Studio tool receipt exceeds its bounded budget')
        return { content }
      }
      register(defineTool({ name: 'studio_authoring_read', description: 'Read the exact bound Studio source, packaged creator methods with authoring:{resource?,offset?}, or actual component references with components:{name?,reference?,type?,offset?}. Read authoring:{} for the index first and follow nextOffset. Discover components:{}, then read an exact name with reference contract/docs/examples; type selects a referenced contract declaration only. Large references are JSON text pages; follow nextOffset with the same selectors and components.offset. These are read-only guidance, not editable source. Scope is fixed by the Host; no project or arbitrary filesystem access.',
        parameters: { paths: { type: 'array', items: { type: 'string' } },
          authoring: { type: 'object', properties: { resource: { type: 'string' }, offset: { type: 'integer' } }, additionalProperties: false },
          components: { type: 'object', properties: { name: { type: 'string' }, reference: { type: 'string', enum: ['contract', 'docs', 'examples'] }, type: { type: 'string' }, offset: { type: 'integer' } }, additionalProperties: false } }, output,
        async execute(args, exec) {
          exec.signal.throwIfAborted()
          if (args.authoring !== undefined && Object.keys(args).some(key => key !== 'authoring')) throw new Error('Read authoring methods separately from bound source paths')
          if (args.components !== undefined && Object.keys(args).some(key => key !== 'components')) throw new Error('Read component references separately from bound source paths')
          const value = args.authoring !== undefined ? await readStudioAuthoringMaterial(args.authoring)
            : args.components !== undefined ? await readStudioPanelComponents(args.components) : await read(args)
          exec.signal.throwIfAborted(); return returned(value)
        } }))
      register(defineTool({ name: 'studio_authoring_prepare', description: `Prepare full-file additions and replacements through S1 for human diff/real-preview review. Read, replace or add source files within this working copy. The initial allowedPaths list is a reading focus, not a file-edit restriction. ${PREPARE_REPLACEMENT_GUIDANCE} Never saves or publishes. Finish after a valid candidate.`,
        parameters: { changes: { type: 'array', required: true, items: { type: 'object', properties: { path: { type: 'string', required: true }, content: { type: 'string', required: true } }, additionalProperties: false } } }, output,
        async execute(args, exec) {
          exec.signal.throwIfAborted()
          const changes = args.changes.map(change => {
            assert.ok(typeof change.path === 'string' && typeof change.content === 'string', 'Complete Studio replacement required')
            return { path: change.path, content: change.content }
          })
          const value = await prepare({ changes })
          exec.signal.throwIfAborted()
          const response = returned(value); staged.set(exec.token, clone(value)); return response
        } }))
      childCtx.tools.guard(exec => signal.aborted || exec.agent !== agent || exec.parent !== undefined || finished || ctx.agents.get(parent.id) !== parent
        || !definitions.has(exec.name) || childCtx.tools.get(exec.name, agent) !== definitions.get(exec.name)
        ? 'Operation is outside the exact Studio read/prepare capability' : undefined)
      childCtx.on('tools/result', (exec, result) => {
        if (exec.agent !== agent || !staged.has(exec.token)) return
        const value = staged.get(exec.token); staged.delete(exec.token)
        if (result.isError || exec.signal.aborted || signal?.aborted || ctx.agents.get(parent.id) !== parent) return
        prepared = value
        const projectionFailed = () => { diagnostic = 'Candidate projection failed; the same S3 receipt remains available through readPrepared.' }
        try { void Promise.resolve(onPrepared?.(clone(value))).catch(projectionFailed) } catch { projectionFailed() }
      })
      const manifestIdentity = scope.bundle
        ? `For the selected Bundle manifest: Set skill.yaml identity to ${encode(scope.bundle.name)} and version to ${encode(scope.bundle.version)}. Keep skill.yaml name and SKILL.md frontmatter name as the runtime name read from SKILL.md; the catalog identity is separate and must not replace that runtime name.`
        : ''
      childCtx.systemPrompt.section({ name: 'studio:customization-methods', order: 550,
        text: `Work only on this Host-bound Studio source scope: ${encode(scope)}. ${manifestIdentity} ${STUDIO_AUTHORING_METHOD_GUIDANCE} Use studio_authoring_read with {authoring:{}} for the creator index, then {authoring:{resource,offset}} for its exact resources. Read bound source and the actual component catalog separately with {paths:[...]}. Use studio_authoring_prepare for full-file candidates, including new source files in this working copy; allowedPaths names the initial read only, and validation/preview diagnostics come from S1. ${PREPARE_REPLACEMENT_GUIDANCE} No filesystem, shell, project/GRA, save, publication, or delegation is granted. A prepared candidate is for human review, not saved content. Finish your native turn after preparing the requested candidate.` })
    }
    try {
      const common = { parentAgent: parent, agentOptions: resolveChildAgentOptions(parent, undefined, depth), signal: signal, setup }
      handle = previous ? await parent.ctx.agents.resume({ ...common, resumeSessionId: SessionId(sessionId) })
        : await parent.ctx.agents.create({ ...common, sessionId: SessionId(sessionId), meta: { cwd: workspaceRoot,
          parentSession: parent.session.id, delegationDepth: depth, isSeeded: false } })
      signal.throwIfAborted()
      assert.equal(String(handle.agent.id), sessionId)
      const lease = await ctx.sessionQuery.observeSession(SessionId(sessionId), { projectionMode: 'none' })
      let afterSeq: number
      try { signal.throwIfAborted(); afterSeq = lease.cursor } finally { lease[Symbol.dispose]() }
      const binding = { sessionId, parentSessionId: String(parent.id), invocationId: invocationId, epoch, afterSeq, scope }
      // Use the existing producer-owned message source. No unknown required Session event is introduced.
      const source = { kind: 'yugoo-design' as const, studioAuthoring: binding }
      const message = createUserMessage({ source, content: [{ type: 'text', text: prompt }] })
      ref = Object.freeze({ ...binding, messageId: String(message.id) })
      await waitFor(() => onReference?.(clone(ref!)))
      signal?.throwIfAborted()
      signal?.addEventListener('abort', onAbort, { once: true })
      signal?.throwIfAborted()
      try { handle.agent.followup(message) } catch { diagnostic = 'Native dispatch acknowledgement is unknown; do not redispatch this input.' }
    } catch (error) { await disposeOwned(); throw error }
    const reference = ref!, owned = handle!
    const result = (async (): Promise<StudioAuthoringObservation> => {
      try {
        await owned.agent.whenIdle()
        const checkpoint = await ctx.sessions.flush(owned.agent.session)
        if (checkpoint && ctx.get('sessionPersistence')) {
          durable.add(key(reference))
          if (durable.size > 256) durable.delete(durable.values().next().value!)
        }
        const observation = await observe(reference)
        if (overflow) return { ...observation, status: 'unknown', terminal: false, diagnostic: 'Native evidence limit exceeded; retain and inspect the original session.' }
        return diagnostic ? { ...observation, diagnostic } : observation
      } catch {
        return { reference, status: 'unknown', consumed: false, turn: currentTurn, terminal: false,
          throughSeq: events.at(-1)?.seq ?? reference.afterSeq, source: 'live', durable: durable.has(key(reference)), pendingInput: true,
          diagnostic: 'Native settlement or persistence could not be verified; retain this address and inspect without redispatch.' }
      } finally {
        finished = true; signal?.removeEventListener('abort', onAbort)
        await disposeOwned(); live.delete(key(reference))
      }
    })()
    void result.catch(() => {})
    const run: StudioAuthoringRun = {
      reference, result, observe: () => observe(reference), readPrepared: () => prepared === undefined ? undefined : clone(prepared),
      cancel({ expectedTurn }) {
        if (finished) return result
        // No await between the exact owned-handle/turn fence and native cancellation.
        assert.equal(ctx.agents.get(owned.agent.id), owned.agent, 'Native Studio handle is no longer owned')
        assert.equal(currentTurn, expectedTurn, 'Native Studio turn changed; refresh before stopping')
        owned.agent.cancel({ kind: 'user' })
        return result
      },
      async dispose() { if (!finished) owned.agent.cancel({ kind: 'disposed' }); await result; await disposeOwned() },
    }
    live.set(key(reference), run)
    return Object.freeze(run)
  }
  async function admit(request: StudioAuthoringRequest, previous?: StudioAuthoringReference) {
    lifetime.signal.throwIfAborted()
    let settled!: () => void
    const pending = new Promise<void>(resolve => { settled = resolve })
    // Register before invoking any caller code, including a reentrant read port.
    starting.add(pending)
    try {
      const run = await start(request, previous)
      if (lifetime.signal.aborted) { await run.dispose(); lifetime.signal.throwIfAborted() }
      return run
    }
    finally { starting.delete(pending); settled() }
  }
  /** Permanently close admission, then drain both startup and owned native runs. */
  const dispose = () => {
    if (disposing) return disposing
    let resolve!: () => void, reject!: (reason: unknown) => void
    disposing = new Promise<void>((done, failed) => { resolve = done; reject = failed })
    lifetime.abort(new Error('Studio authoring adapter is disposed'))
    void Promise.allSettled([...starting, ...[...live.values()].map(run => Promise.resolve().then(() => run.dispose()))]).then(settled => {
      // Startup markers join settlement, not cleanup success. Preserve failures
      // from exact-owned handles even when the start promise rejected separately.
      const failures = new Set([...cleanupFailures,
        ...settled.filter((value): value is PromiseRejectedResult => value.status === 'rejected').map(value => value.reason)])
      if (failures.size) reject(new AggregateError([...failures], 'Owned Studio native cleanup failed'))
      else resolve()
    })
    return disposing
  }
  ctx.effect(() => dispose)
  return Object.freeze({ start: (request: StudioAuthoringRequest) => admit(request), observe, dispose,
    resume(request: StudioAuthoringResumeRequest) {
      assert.equal(request.explicit, true, 'Native Studio continuation requires explicit authorization')
      return admit(request, request.previous)
    } })
}
