/** Plugin-owned one-shot file Worker; uses only public DSH Agent APIs. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { foldConsumedWork, type Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { createYugooDesignMessage } from './dsh-message-source.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import { designSessionEvents } from './dsh-session-events.ts'
import { designUnseededChildSessionMeta } from './dsh-child-session-meta.ts'
import { dshSubagentBackend } from './dsh-subagent-backend.ts'
import {
  appendDelegatedPolicyOverrides, applyChildComposition, captureDelegatedPolicyOverrides,
  finalAssistantOutput, resolveChildAgentOptions, resolveChildDepth,
  assertSubagentMaxDepth,
  type SubagentResult, type SubagentRun, type SubagentStopReason,
  type SubagentProvider, type ResolvedSubagentStartRequest, type SubagentDescriptorData,
} from '@deepseek-ai/dsh-subagent'

// Defense in depth only. Authorization comes from the host-selected allowlist
// and assignment-scoped installer, never from this finite list of names.
const FORBIDDEN_INHERITED_TOOLS = new Set([
  'run_code', 'write', 'edit', 'delete', 'move', 'copy', 'read_design_file',
  'design_validate', 'design_publish', 'design_revisions', 'design_restore_snapshot',
  'design_focus_artifact', 'design_delegate', 'design_delegate_frontier',
  'run_skill_script', 'design_worker_read_artifact',
  'design_worker_write_artifact', 'design_worker_edit_artifact',
])

export interface DesignFileWorkerRequest {
  readonly parent: Agent
  readonly signal: AbortSignal
  readonly label: string
  readonly prompt: ContentBlock[]
  readonly maxDepth: number
  readonly maxTokens?: number
  readonly descriptor?: SubagentDescriptorData
  /** Host-selected names, resolved from the parent before asynchronous creation. */
  readonly inheritedToolNames: readonly string[]
  /** Trusted host closure: install only this assignment's artifact capabilities. */
  readonly installWorkerTools: (ctx: Context, worker: Agent) => void | Promise<void>
}

export type DesignFileWorkerGrant = Pick<DesignFileWorkerRequest,
  'inheritedToolNames' | 'installWorkerTools' | 'maxTokens'>

/**
 * Bind once in the root Design plugin scope, not once per Producer/session.
 * The legacy backend registers one fixed provider; RC3 uses the Agent factory.
 * This is a trusted capability API, never a model tool: integration must derive
 * the grant from a validated live assignment, not tool arguments or model text.
 */
export function registerDesignFileWorkerDispatcher(ctx: Context): {
  start(request: Omit<DesignFileWorkerRequest, 'descriptor'>): Promise<SubagentRun>
  dispose(): void
} {
  let disposed = false
  const backend = dshSubagentBackend(ctx.subagents, 'design file worker')
  if (backend === 'agent-factory') {
    // RC3 cannot adopt an already-created native Agent as an external
    // activation. Like the Producer and readonly reviewer, create the scoped
    // child through the public factory. Frontier admission still owns capacity;
    // no SubagentRuntime manager catalog or lifecycle events are claimed here.
    return {
      async start(request) {
        if (disposed) throw new Error('design file worker: dispatcher is disposed')
        return startDesignFileWorker({ ...request, prompt: [...request.prompt],
          inheritedToolNames: [...request.inheritedToolNames] })
      },
      dispose() { disposed = true },
    }
  }
  const pending = new Map<ContentBlock[], DesignFileWorkerRequest>()
  const provider = createDesignFileWorkerProvider(request => {
    const grant = pending.get(request.prompt)
    if (grant === undefined || grant.parent !== request.parent || grant.signal !== request.signal) return undefined
    pending.delete(request.prompt)
    return grant
  })
  const unregister = ctx.subagents.registerProvider(provider)
  return {
    async start(request) {
      if (disposed) throw new Error('design file worker: dispatcher is disposed')
      // Identity is internal, not an assignment token copied into model text.
      const prompt = [...request.prompt]
      pending.set(prompt, {
        ...request, prompt, inheritedToolNames: [...request.inheritedToolNames],
      })
      try {
        return await ctx.subagents.start(provider.name, {
          parent: request.parent, signal: request.signal, prompt,
          label: request.label, maxDepth: request.maxDepth,
        })
      } finally { pending.delete(prompt) }
    },
    dispose() {
      if (disposed) return
      disposed = true
      pending.clear()
      unregister()
    },
  }
}

/**
 * Register through the public SubagentRuntime to retain lifecycle events.
 * The resolver is trusted plugin code: it must consume a live assignment bound
 * to the exact parent/request, never authorize from model-supplied labels alone.
 * No grant means no child, not a fallback to a broader provider.
 */
export function createDesignFileWorkerProvider(
  consumeGrant: (request: ResolvedSubagentStartRequest) => DesignFileWorkerGrant | undefined,
): SubagentProvider {
  return {
    name: 'dsh-design-file-worker',
    inheritsParentContext: false,
    capabilities: {
      depthLimit: true, agentOptions: false, outputSchema: false,
      toolFilter: false, persona: false,
    },
    async start(request) {
      if (request.maxDepth === undefined) throw new Error('design file worker: explicit depth limit is required')
      const grant = consumeGrant(request)
      if (grant === undefined) throw new Error('design file worker: no active assignment grant')
      return startDesignFileWorker({
        parent: request.parent, signal: request.signal, prompt: request.prompt,
        label: request.label ?? 'Design artifact Worker', maxDepth: request.maxDepth,
        descriptor: request.descriptor,
        inheritedToolNames: grant.inheritedToolNames,
        installWorkerTools: grant.installWorkerTools,
        ...(grant.maxTokens === undefined ? {} : { maxTokens: grant.maxTokens }),
      })
    },
  }
}

/** Create an assignment-scoped native child, independently of manager registration. */
export async function startDesignFileWorker(request: DesignFileWorkerRequest): Promise<SubagentRun> {
  if (request.signal.aborted) throw new Error('design file worker: cancelled before creation')
  if (!request.label.trim()) throw new Error('design file worker: label is required')
  assertSubagentMaxDepth(request.maxDepth)
  const names = [...new Set(request.inheritedToolNames)]
  if (names.some(name => FORBIDDEN_INHERITED_TOOLS.has(name))) {
    throw new Error('design file worker: forbidden inherited authority')
  }
  if (request.parent.ctx.agents.get(request.parent.id) !== request.parent) {
    throw new Error('design file worker: exact live parent required')
  }
  const tools = names.map(name => {
    const definition = request.parent.ctx.tools.get(name, request.parent)
    if (!definition) throw new Error('design file worker: inherited tool is unavailable')
    return definition
  })
  const depth = resolveChildDepth(request.parent, request.maxDepth)
  const policy = captureDelegatedPolicyOverrides(request.parent)
  const id = SessionId(randomUUID())
  const descriptor = request.descriptor
  const handle = await request.parent.ctx.agents.create({
    sessionId: id,
    parentAgent: request.parent,
    meta: designUnseededChildSessionMeta(request.parent, depth),
    agentOptions: resolveChildAgentOptions(request.parent,
      request.maxTokens === undefined ? undefined : { maxTokens: request.maxTokens }, depth),
    signal: request.signal,
    async setup(ctx, worker) {
      if (!worker) throw new Error('design file worker: creation Agent is unavailable')
      appendDelegatedPolicyOverrides(worker.session, policy)
      // Do not inherit an open-ended preset tool surface. Explicit local tools
      // are registered after composition, in the child's own unpublished scope.
      applyChildComposition(ctx, request.parent, { toolFilter: { allow: [] } })
      ctx.tools.presentAs('native')
      for (const definition of tools) ctx.tools.register(definition)
      await request.installWorkerTools(ctx, worker)
      let recorded = false
      ctx.on('agent/pre-step', async (execution, next) => {
        const decision = await next()
        if (descriptor !== undefined && execution.agent === worker && !recorded && decision.kind === 'enter') {
          recorded = true
          worker.session.append('subagent/descriptor', descriptor)
        }
        return decision
      })
    },
  })
  const worker = handle.agent
  const boundary = designSessionEvents(worker.session).length
  let cancelled = false
  const abort = () => { cancelled = true; worker.cancel({ kind: 'parent' }) }
  request.signal.addEventListener('abort', abort, { once: true })
  if (request.signal.aborted) abort()
  const result: Promise<SubagentResult> = (async () => {
    try {
      if (!cancelled) {
        worker.followup(createYugooDesignMessage({ content: request.prompt }))
        await worker.whenIdle()
      }
      const events = designSessionEvents(worker.session).slice(boundary)
      const reason = foldConsumedWork(events).end?.data.reason?.kind
      let stopReason: SubagentStopReason = 'error'
      if (reason === 'completed') stopReason = 'completed'
      else if (reason === 'max-tokens') stopReason = 'max-tokens'
      else if (reason === 'blocked') stopReason = 'refusal'
      else if (reason === 'aborted') stopReason = 'aborted'
      if (cancelled && stopReason !== 'completed') stopReason = 'aborted'
      return { output: finalAssistantOutput(events) ?? [], stopReason }
    } finally { request.signal.removeEventListener('abort', abort) }
  })()
  let disposal: Promise<void> | undefined
  return {
    id, localAgent: worker, result,
    dispose() {
      return disposal ??= (async () => {
        request.signal.removeEventListener('abort', abort)
        cancelled = true
        const settled = await Promise.allSettled([handle.dispose(), result])
        if (settled[0].status === 'rejected') throw settled[0].reason
      })()
    },
  }
}
