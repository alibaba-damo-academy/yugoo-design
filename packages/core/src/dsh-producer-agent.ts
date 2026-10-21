/**
 * DSH adapter for one foreground-attached Design Producer engagement. Each run
 * owns a fresh Agent until complete publication, pending-state pause, or cancel.
 */
import { randomUUID } from 'node:crypto'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { createYugooDesignMessage } from './dsh-message-source.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import { designSessionEvents } from './dsh-session-events.ts'
import { designUnseededChildSessionMeta } from './dsh-child-session-meta.ts'
import {
  appendDelegatedPolicyOverrides,
  applyChildComposition,
  captureDelegatedPolicyOverrides,
  resolveChildAgentOptions,
  resolveChildDepth,
  snapshotSubagentDescriptor,
} from '@deepseek-ai/dsh-subagent'
import {
  assertSafeDesignProducerInheritedTools,
  registerDshProducerDesignTools,
  type DesignProducerPauseHandoff,
  type DesignProducerFinishReceipt,
  type DesignProducerPublishAction,
  type DesignProducerArtifactActivityPort,
  type DesignProducerSkillResourcePort,
  type DesignProducerSkillScriptPort,
  type ProducerProjectWorkspacePort,
} from './dsh-producer-design-tools.ts'
import type { DshProducerDesignDelegation } from './dsh-producer-delegation.ts'
import type { DesignExecutionAttemptPayload } from './types.ts'

/** Inputs for one attached Producer Agent engagement. */
export interface DshProducerAgentRequest {
  /** Engagement intent; resume still creates a fresh Agent over the pinned committed state. */
  readonly mode: 'engage' | 'resume'
  /** Calling Agent that owns this Producer lifecycle. */
  readonly parent: Agent
  /** Durable label shown for this Producer in the Host child-session catalog. */
  readonly label: string
  /** Absolute Design Files root used as the Producer session workspace. */
  readonly designFilesRoot: string
  /** Already-authorized Project Workspace capability captured by the host. */
  readonly workspace: ProducerProjectWorkspacePort
  /** Host-validated read-only reconstruction input; never supplied by copy arguments. */
  readonly reconstructionSourceRoot?: string
  /** Immutable resources confined to the invocation Bundle. */
  readonly resources: DesignProducerSkillResourcePort
  /** Optional Host-confined execution of ordinary scripts shipped by this Skill. */
  readonly scripts?: DesignProducerSkillScriptPort
  /** Ephemeral Host projection for direct serial artifact work. */
  readonly activity: DesignProducerArtifactActivityPort
  /** Host-resolved non-authority tools retained for serial Producer work. */
  readonly allowedInheritedTools: readonly string[]
  /** Complete Producer-specific system instructions. */
  readonly systemPrompt: string
  /** One model-visible engagement brief. */
  readonly prompt: string
  /** Manifest handoff allowed after an authoritative pending publication. */
  readonly handoff: 'none' | DesignProducerPauseHandoff
  /** Cancellation owned by the attached host tool call. */
  readonly signal: AbortSignal
  /** Optional Producer output-token ceiling over the inherited model route. */
  readonly maxTokens?: number
  /** Optional absolute cap for the Producer's own delegation depth. */
  readonly maxDepth?: number
  /** Optional nested-worker acceleration; Producer execution never depends on it. */
  readonly delegation?: DshProducerDesignDelegation
  /** Host-owned lifecycle recorder; the Producer model never authors these facts. */
  readonly execution?: Readonly<{
    readonly artifactId: string
    readonly attemptId: string
    record(event: Omit<DesignExecutionAttemptPayload, 'projectId' | 'invocationId' | 'skill'>): void
  }>
}

/** Settlement receipt proving that the Producer itself published its working copy. */
export type DshProducerAgentReceipt = DesignProducerFinishReceipt & { readonly producerSessionId: SessionId }

const DESIGN_PRODUCER_SESSION_PROVIDER = 'dsh-design-skill-agent'

/**
 * Required runtime for attached Producer execution. A paused run ends after
 * pending-state publication; its next resume request creates a fresh Agent.
 */
export interface DshProducerSkillAgentRuntime {
  /** Run until publication, bounded correction failure, or cancellation; always dispose the owned Agent. */
  run(request: DshProducerAgentRequest): Promise<DesignProducerFinishReceipt>
}

/**
 * Create the required Producer runtime independently of optional delegation.
 * @returns an attached, cancellation-aware Producer runtime.
 */
export function createDshProducerSkillAgentRuntime(): DshProducerSkillAgentRuntime {
  return Object.freeze({ run: runDshProducerAgent })
}

/**
 * Run one attached Design Producer Agent until explicit or Host-default
 * settlement publishes a complete/pending state, correction fails, or cancellation wins.
 * @param request - parent ownership, bound Project Workspace, prompt, and limits.
 * @returns the exact publication receipt captured by the shared scoped publication path.
 */
export async function runDshProducerAgent(request: DshProducerAgentRequest): Promise<DshProducerAgentReceipt> {
  if (request.signal.aborted) throw new Error('design producer: cancelled before start')
  if (request.label.trim() === '') throw new Error('design producer: label must be non-empty')
  if (request.designFilesRoot.trim() === '') throw new Error('design producer: designFilesRoot must be non-empty')
  if (request.systemPrompt.trim() === '') throw new Error('design producer: systemPrompt must be non-empty')
  if (request.prompt.trim() === '') throw new Error('design producer: prompt must be non-empty')
  assertSafeDesignProducerInheritedTools(request.allowedInheritedTools, 'design producer allowedInheritedTools')
  // RC2 child scopes are independent. Capture the exact authorized parent
  // definitions before creation; a global allowlist cannot name parent-local
  // tools, and joining a preset does not copy every parent-local capability.
  const evidenceTools = [...new Set(request.allowedInheritedTools)].map(name => {
    const definition = request.parent.ctx.tools.get(name, request.parent)
    if (definition === undefined) throw new Error(`design producer: parent evidence tool is unavailable: ${name}`)
    return definition
  })

  const childDepth = resolveChildDepth(request.parent, request.maxDepth)
  const inheritedPolicy = captureDelegatedPolicyOverrides(request.parent)
  const descriptor = snapshotSubagentDescriptor({
    mode: 'one-shot',
    provider: DESIGN_PRODUCER_SESSION_PROVIDER,
    label: request.label,
  })
  const producerSessionId = SessionId(randomUUID())
  let tools: ReturnType<typeof registerDshProducerDesignTools> | undefined
  let handle: AgentHandle | undefined
  let primaryError: unknown
  let onAbort: (() => void) | undefined

  request.execution?.record({
    artifactId: request.execution.artifactId,
    attemptId: request.execution.attemptId,
    runId: String(producerSessionId),
    parentRunId: String(request.parent.session.id),
    role: 'producer',
    phase: 'queued',
  })

  try {
    handle = await request.parent.ctx.agents.create({
      sessionId: producerSessionId,
      meta: {
        ...designUnseededChildSessionMeta(request.parent, childDepth),
        cwd: request.designFilesRoot,
      },
      agentOptions: resolveChildAgentOptions(
        request.parent,
        request.maxTokens === undefined ? undefined : { maxTokens: request.maxTokens },
        childDepth,
      ),
      signal: request.signal,
      async setup(producerCtx, producer) {
        if (producer === undefined) throw new Error('design producer: unpublished Agent is missing')
        let descriptorAppended = false
        producerCtx.on('agent/pre-step', async (execution, next) => {
          const decision = await next()
          if (execution.agent === producer && !descriptorAppended && decision.kind === 'enter') {
            descriptorAppended = true
            producer.session.append('subagent/descriptor', descriptor)
          }
          return decision
        })
        appendDelegatedPolicyOverrides(producer.session, inheritedPolicy)
        applyChildComposition(producerCtx, request.parent, {
          toolFilter: { allow: [] },
        })
        for (const definition of evidenceTools) producerCtx.tools.register(definition)
        tools = registerDshProducerDesignTools(
          producerCtx,
          request.workspace,
          request.resources,
          request.handoff,
          request.activity,
          request.delegation?.settlementDiagnostics,
          request.scripts,
          request.allowedInheritedTools,
          request.reconstructionSourceRoot,
        )
        producerCtx.on('tools/post-execute', async (exec, result, next) => {
          const decision = await next()
          if (exec.agent === producer) {
            const blocked = decision.kind === 'block'
            const replacedValue = decision.kind === 'accept' && Object.hasOwn(decision, 'value')
              ? decision.value
              : result.isError ? undefined : result.value
            await request.activity.observeTool({
              name: exec.name,
              arguments: exec.arguments,
              isError: result.isError || blocked,
              ...(result.isError || blocked || replacedValue === undefined ? {} : { value: replacedValue }),
              ...(result.isError || blocked || result.meta === undefined || replacedValue !== result.value
                ? {}
                : { meta: result.meta }),
            })
          }
          return decision
        })
        producerCtx.systemPrompt.section({
          name: 'design:producer',
          order: 550,
          text: request.systemPrompt,
        })
        if (request.delegation !== undefined) {
          request.delegation.install(producerCtx)
        }
      },
    })

    const producer = handle.agent
    // Idle is scheduling state, not successful completion. Inspect only the
    // native terminal events belonging to the followup we are settling.
    let turnBoundary = designSessionEvents(producer.session).length
    const requireNormalEnd = () => {
      const ends = designSessionEvents(producer.session).slice(turnBoundary).filter(event => event.type === 'turn/end')
      const abnormal = ends.find(event => event.data.reason?.kind !== 'completed')
      if (abnormal !== undefined || ends.length === 0) {
        const reason = abnormal?.data.reason
        throw new Error(`design producer: turn did not complete normally (${reason === undefined ? 'missing turn/end' : JSON.stringify(reason)}); automatic publication skipped. Working files are preserved; resume the invocation from the preserved working files.`)
      }
    }
    request.execution?.record({
      artifactId: request.execution.artifactId,
      attemptId: request.execution.attemptId,
      runId: String(producerSessionId),
      parentRunId: String(request.parent.session.id),
      role: 'producer',
      phase: 'working',
    })
    let cancelled = false
    onAbort = () => {
      cancelled = true
      producer.cancel({ kind: 'parent' })
    }
    request.signal.addEventListener('abort', onAbort, { once: true })
    // Agent creation detaches its creation-only signal before returning. This
    // closes the handoff window for an abort between publication and listener.
    if (request.signal.aborted) onAbort()
    if (!cancelled) {
      producer.followup(createYugooDesignMessage({
        content: [{ type: 'text', text: request.prompt }],
      }))
      await producer.whenIdle()
    }
    if (tools === undefined) throw new Error('design producer: scoped Design tools were not installed')
    let receipt = tools.finished()
    if (receipt === undefined && (cancelled || request.signal.aborted)) throw new Error('design producer: cancelled')
    if (receipt === undefined) {
      requireNormalEnd()
      const defaultAction: DesignProducerPublishAction = request.mode === 'resume' || request.handoff === 'none'
        ? 'complete'
        : 'handoff'
      const action = tools.requestedAction() ?? defaultAction
      const firstSettlement = await tools.settle(action, request.signal)
      if (firstSettlement.kind === 'conflict') {
        throw new Error(`design producer: publication conflict: ${firstSettlement.diagnostics.join('; ')}`)
      }
      if (firstSettlement.kind === 'invalid') {
        turnBoundary = designSessionEvents(producer.session).length
        producer.followup(createYugooDesignMessage({
          content: [{
            type: 'text',
            text: [
              `The Host could not publish this Design invocation as ${action}.`,
              'Repair the current filesystem working copy using these exact diagnostics:',
              ...firstSettlement.diagnostics.map(diagnostic => `- ${diagnostic}`),
              'Then either call design_publish explicitly or finish your corrective turn; the Host will retry this same publication once.',
            ].join('\n'),
          }],
        }))
        await producer.whenIdle()
        receipt = tools.finished()
        if (receipt === undefined && (cancelled || request.signal.aborted)) throw new Error('design producer: cancelled')
        if (receipt === undefined) {
          requireNormalEnd()
          const retryAction = tools.requestedAction() ?? action
          const retrySettlement = await tools.settle(retryAction, request.signal)
          if (retrySettlement.kind === 'invalid' || retrySettlement.kind === 'conflict') {
            throw new Error(
              `design producer: publication ${retrySettlement.kind}: ${retrySettlement.diagnostics.join('; ')}`,
            )
          }
          receipt = tools.finished()
        }
      } else {
        receipt = tools.finished()
      }
    }
    if (receipt === undefined) throw new Error('design producer: publication completed without a finish receipt')
    request.execution?.record({
      artifactId: request.execution.artifactId,
      attemptId: request.execution.attemptId,
      runId: String(producerSessionId),
      parentRunId: String(request.parent.session.id),
      role: 'producer',
      phase: 'completed',
    })
    return Object.freeze({ producerSessionId, ...receipt })
  } catch (error) {
    primaryError = error
    request.execution?.record({
      artifactId: request.execution.artifactId,
      attemptId: request.execution.attemptId,
      runId: String(producerSessionId),
      parentRunId: String(request.parent.session.id),
      role: 'producer',
      phase: request.signal.aborted ? 'cancelled' : 'failed',
      diagnostics: [error instanceof Error ? error.message : String(error)],
    })
    throw error
  } finally {
    if (onAbort !== undefined) request.signal.removeEventListener('abort', onAbort)
    if (handle !== undefined) {
      try {
        await handle.dispose()
      } catch (disposalFailure) {
        if (primaryError === undefined) throw disposalFailure
        // Swallows only teardown failure so the Producer's primary error keeps precedence.
      }
    }
  }
}
