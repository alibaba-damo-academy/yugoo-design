/** Canonical DSH tool entry for one host-owned Design Bundle invocation. */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { designSessionEvents } from './dsh-session-events.ts'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  DESIGN_EXECUTION_PROVENANCE_SCHEMA,
  renderDesignExecutionProvenance,
  type DesignExecutionProvenance,
} from './dsh-execution-provenance.ts'
import {
  DesignExecutionInvocationId,
  type DesignExecutionGate,
  type DesignPublicationFollowUp,
} from './design-execution-runtime.ts'

/** One resolved Design Bundle invocation returned by the host controller. */
export type RunDesignSkillResult = (
  | { readonly kind: 'in_progress'; readonly summary: string }
  | {
      readonly kind: 'completed'
      readonly summary: string
      /** Disclosed Design Project root holding the committed Design Files. */
      readonly projectRoot: string
      /** Committed Design Files revision the result settles. */
      readonly stateRevision: string
      readonly clarity: RunDesignSkillClarity
    } & DesignPublicationFollowUp
  | {
      readonly kind: 'await_user'
      readonly summary: string
      readonly gate?: DesignExecutionGate
      /** Coordinator-supplied input request when no manifest gate applies. */
      readonly instruction?: string
    } & DesignPublicationFollowUp
  | {
      readonly kind: 'failed' | 'cancelled'
      readonly summary: string
      readonly diagnostics: readonly string[]
    }
  | {
      readonly kind: 'invalid'
      /** Includes the active Kit's exact, case-sensitive skill names. */
      readonly summary: string
    }
) & { readonly execution?: DesignExecutionProvenance }

export type RunDesignSkillClarity =
  | {
      readonly status: 'updated' | 'unchanged'
      readonly summary: string
      readonly u: Readonly<{ readonly score: number; readonly evidence: string }>
      readonly s: Readonly<{ readonly score: number; readonly evidence: string }>
      readonly t: Readonly<{ readonly score: number; readonly evidence: string }>
      readonly nextGap?: string
    }
  | { readonly status: 'failed' | 'pending'; readonly summary: string }

/** High-level controller operation injected into the canonical DSH tool. */
export interface RunDesignSkillPort {
  /** Main execution returns its instructions now; settlement still uses the same controller. */
  onMainSettlement?(agent: Agent, callback: (result: RunDesignSkillResult) => Promise<void>): void
  /** Resolve and atomically claim one exact advisory action before reading project state. */
  claimAdvisoryActionExecution?(request: {
    readonly agent: Agent
    readonly receiptId: string
    readonly proposedInvocationId: DesignExecutionInvocationId
    readonly name: string
    readonly signal: AbortSignal
  }): Promise<
    | { readonly kind: 'invalid'; readonly summary: string }
    | {
        readonly kind: 'action'
        readonly claimed: boolean
        readonly attemptId: string
        readonly effectiveInvocationId: DesignExecutionInvocationId
        readonly state: 'ready' | 'running' | 'failed' | 'needs-user-input' | 'completed'
      }
  >
  /** Persist the claimed action attempt's execution outcome. */
  settleAdvisoryActionExecution?(request: {
    readonly agent: Agent
    readonly receiptId: string
    readonly attemptId: string
    readonly state: 'failed' | 'needs-user-input' | 'completed'
  }): Promise<void>
  /**
   * Resolve the exact skill name and own its complete production/execution lifecycle.
   * @param request - host-derived invocation identity, model intent, and cancellation.
   * @returns the controller's structured engagement result.
   */
  run(request: {
    readonly invocationId: DesignExecutionInvocationId
    readonly rootCallId: string
    readonly agent: Agent
    readonly name: string
    readonly brief?: string
    /** Reconstruct this Bundle's product/Design meaning from existing source evidence. */
    readonly reconstruct?: boolean
    /** Exact read-only Git working tree authorized as reconstruction evidence. */
    readonly reconstructionSourceRoot?: string
    /** Exact server-owned route returned by the current `user_continue` gate. */
    readonly action?: Readonly<{ readonly routeId: string }>
    /** Plugin-owned claimed human control; never exposed as a model tool argument. */
    readonly resumeControl?: Readonly<{ readonly text: string; readonly turn: number }>
    readonly signal: AbortSignal
  }): Promise<RunDesignSkillResult>
}

const PIN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    invocationId: { type: 'string', required: true },
    projectId: { type: 'string', required: true },
    kitName: { type: 'string', required: true },
    kitVersion: { type: 'string', required: true },
    skillName: { type: 'string', required: true },
    bundleVersion: { type: 'string', required: true },
    stateRevision: { type: 'string', required: true },
  },
} as const

const GATE_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'must_edit', required: true },
        invocationId: { type: 'string', required: true },
        pin: { ...PIN_SCHEMA, required: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'user_continue', required: true },
        invocationId: { type: 'string', required: true },
        pin: { ...PIN_SCHEMA, required: true },
        action: {
          type: 'object',
          additionalProperties: false,
          required: true,
          properties: {
            routeId: { type: 'string', required: true },
            label: {
              type: 'object',
              additionalProperties: false,
              required: true,
              properties: {
                zh: { type: 'string', required: true },
                en: { type: 'string', required: true },
              },
            },
            aliases: {
              type: 'object',
              additionalProperties: false,
              properties: {
                zh: { type: 'array', items: { type: 'string' }, required: true },
                en: { type: 'array', items: { type: 'string' }, required: true },
              },
            },
          },
        },
      },
    },
  ],
} as const

const DIMENSION_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    score: { type: 'integer', required: true },
    evidence: { type: 'string', required: true },
  },
} as const

const FOLLOW_UP_PROPERTIES = {
  indexMaintenance: { type: 'object', additionalProperties: false, properties: {
    state: { type: 'string', required: true, const: 'deferred' },
    message: { type: 'string', required: true },
  } },
  recovery: { type: 'object', additionalProperties: false, properties: {
    stage: { type: 'string', required: true, enum: ['journal', 'diff'] },
    state: { type: 'string', required: true, const: 'pending' },
    message: { type: 'string', required: true },
  } },
} as const

const RESULT_SCHEMA = {
  oneOf: [
    {
      type: 'object', additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'in_progress', required: true },
        summary: { type: 'string', required: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'completed', required: true },
        ...FOLLOW_UP_PROPERTIES,
        summary: { type: 'string', required: true },
        projectRoot: { type: 'string', required: true },
        stateRevision: { type: 'string', required: true },
        execution: DESIGN_EXECUTION_PROVENANCE_SCHEMA,
        clarity: {
          type: 'object',
          additionalProperties: false,
          required: true,
          properties: {
            status: { type: 'string', enum: ['updated', 'unchanged', 'failed', 'pending'], required: true },
            summary: { type: 'string', required: true },
            u: DIMENSION_RESULT_SCHEMA,
            s: DIMENSION_RESULT_SCHEMA,
            t: DIMENSION_RESULT_SCHEMA,
            nextGap: { type: 'string' },
          },
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'await_user', required: true },
        ...FOLLOW_UP_PROPERTIES,
        summary: { type: 'string', required: true },
        gate: GATE_SCHEMA,
        instruction: { type: 'string' },
        execution: DESIGN_EXECUTION_PROVENANCE_SCHEMA,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'failed', required: true },
        summary: { type: 'string', required: true },
        diagnostics: { type: 'array', items: { type: 'string' }, required: true },
        execution: DESIGN_EXECUTION_PROVENANCE_SCHEMA,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'cancelled', required: true },
        summary: { type: 'string', required: true },
        diagnostics: { type: 'array', items: { type: 'string' }, required: true },
        execution: DESIGN_EXECUTION_PROVENANCE_SCHEMA,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'invalid', required: true },
        summary: { type: 'string', required: true },
      },
    },
  ],
} as const

function invocationId(rootCallId: string): DesignExecutionInvocationId {
  const digest = createHash('sha256')
    .update('run_design_skill\0', 'utf8')
    .update(rootCallId, 'utf8')
    .digest('hex')
  return DesignExecutionInvocationId(`design-${digest}`)
}

/**
 * Check that the model made the selected Design action visible before its tool call.
 * Direct controller tests and non-session hosts do not expose a durable event log, so
 * the Host adapter remains responsible for the same interaction requirement there.
 * @param agent - Agent requesting the Design engagement.
 * @param rootCallId - root tool call recorded in the current model step.
 * @returns the owning Host turn and whether its current assistant step has visible text.
 */
function invocationAcknowledgement(agent: Agent, rootCallId: string): { readonly turn?: number; readonly present: boolean } {
  const session = agent.session as { snapshotEvents?: () => readonly import('@deepseek-ai/dsh-session').SessionEvent[]; readonly events?: readonly import('@deepseek-ai/dsh-session').SessionEvent[] }
  if (typeof session.snapshotEvents !== 'function' && !Array.isArray(session.events)) return { present: true }
  const events = designSessionEvents(session)
  const callIndex = events.findLastIndex((event) => {
    if (event === null || typeof event !== 'object') return false
    const record = event as { readonly type?: unknown; readonly data?: { readonly callId?: unknown; readonly name?: unknown } }
    return record.type === 'tool/call'
      && record.data?.callId === rootCallId
      && record.data.name === 'run_design_skill'
  })
  if (callIndex < 0) return { present: true }
  const call = events[callIndex] as { readonly data: { readonly turn: number; readonly step: number } }
  for (let index = callIndex - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === null || typeof event !== 'object') continue
    const record = event as {
      readonly type?: unknown
      readonly data?: {
        readonly turn?: unknown
        readonly step?: unknown
        readonly message?: { readonly content?: readonly unknown[] }
      }
    }
    if (record.type !== 'assistant/message'
      || record.data?.turn !== call.data.turn
      || record.data.step !== call.data.step) continue
    return { turn: call.data.turn, present: record.data.message?.content?.some((block) => {
      if (block === null || typeof block !== 'object') return false
      const candidate = block as { readonly type?: unknown; readonly text?: unknown }
      return candidate.type === 'text' && typeof candidate.text === 'string' && candidate.text.trim() !== ''
    }) === true }
  }
  return { turn: call.data.turn, present: false }
}

type RenderableRunDesignSkillResult = (
  | { readonly kind: 'in_progress'; readonly summary: string }
  | ({ readonly kind: 'completed'; readonly summary: string; readonly projectRoot: string; readonly stateRevision: string; readonly clarity: RunDesignSkillClarity } & DesignPublicationFollowUp)
  | {
      readonly kind: 'await_user'
      readonly summary: string
      readonly gate?:
        | { readonly kind: 'must_edit'; readonly pin?: { readonly stateRevision: string } }
        | {
            readonly kind: 'user_continue'
            readonly pin?: { readonly stateRevision: string }
            readonly action: {
              readonly routeId: string
              readonly label: Readonly<{ readonly zh: string; readonly en: string }>
            }
          }
      readonly instruction?: string
    } & DesignPublicationFollowUp
  | {
      readonly kind: 'failed' | 'cancelled'
      readonly summary: string
      readonly diagnostics: readonly string[]
    }
  | { readonly kind: 'invalid'; readonly summary: string }
) & { readonly execution?: DesignExecutionProvenance }

function renderResultBody(result: RenderableRunDesignSkillResult): string {
  if ((result.kind === 'completed' || result.kind === 'await_user') && result.recovery !== undefined) {
    return `${result.summary}\nCommitted Design revision: ${result.kind === 'completed' ? result.stateRevision : result.gate?.pin?.stateRevision ?? 'recorded in the publication receipt'}.\nContent is persisted; ${result.recovery.stage} recovery remains pending: ${result.recovery.message}. Do not regenerate content, rerun the Bundle, remove Git locks or change Git settings to repair this follow-up.`
  }
  if ((result.kind === 'completed' || result.kind === 'await_user') && result.indexMaintenance !== undefined) {
    return `${renderResultBody({ ...result, indexMaintenance: undefined })}\nOrdinary Git index maintenance is deferred: ${result.indexMaintenance.message}. The Design content is committed; do not remove another operation's index lock.`
  }
  switch (result.kind) {
    case 'completed':
      if (!('u' in result.clarity)) {
        return `${result.summary}\nProject root: ${result.projectRoot}\nState revision: ${result.stateRevision}\nThe Design result is persisted. ${result.clarity.summary}\nUse saved Design evidence and current user intent. Report clarity in the main conversation when useful; an absent or failed score does not block authorized work, and old scores are not new evidence.`
      }
      return `${result.summary}\nProject root: ${result.projectRoot}\nState revision: ${result.stateRevision}\nDerived design assessment (not execution evidence):\nDesign clarity ${result.clarity.status}: U=${result.clarity.u.score}, S=${result.clarity.s.score}, T=${result.clarity.t.score}. Assessment text: ${JSON.stringify(result.clarity.summary)}${result.clarity.nextGap === undefined ? '' : ` Next design gap: ${JSON.stringify(result.clarity.nextGap)}`}\nThe result and its clarity assessment are persisted. Continue the current Agent turn only when more explicitly requested Design work remains; otherwise close with the result and, when the user's next design move is open, recommend one to three relevant skills through the host-native question mechanism using their catalog titles.`
    case 'await_user':
      if (result.gate === undefined) {
        return `${result.summary}\nWaiting for current user input before this Design skill can continue.`
      }
      if (result.gate.kind === 'must_edit') {
        return `${result.summary}\nWaiting for an authoritative Design Panel save. The save completes this handoff without rerunning the Producer.`
      }
      return `${result.summary}\nContinue with ${result.gate.action.label.en} / ${result.gate.action.label.zh} (${result.gate.action.routeId}).\nPresent this action to the user and close the response. Do not call run_design_skill again in this user turn.`
    case 'failed':
    case 'cancelled':
      return [
        result.summary,
        ...result.diagnostics.map(diagnostic => `- ${diagnostic}`),
        'The Design skill is not complete. Report this terminal result and do not count missing evidence as complete.',
      ].join('\n')
    case 'in_progress':
    case 'invalid':
      return result.summary
  }
}

/** Model-facing design assessment and Host execution evidence retain separate authority. */
export function renderResult(result: RenderableRunDesignSkillResult): string {
  const body = renderResultBody(result)
  return result.kind === 'completed' || result.kind === 'await_user' || result.kind === 'failed' || result.kind === 'cancelled'
    ? `${body}\n${renderDesignExecutionProvenance(result.execution)}`
    : body
}

function snapshotResult(result: RunDesignSkillResult) {
  const execution = result.execution === undefined ? {} : { execution: {
    ...result.execution,
    producerRunIds: [...result.execution.producerRunIds],
    workerAttempts: result.execution.workerAttempts.map(row => ({ ...row })),
    integratedWorkerReceipts: result.execution.integratedWorkerReceipts.map(row => ({ ...row })),
    diagnostics: [...result.execution.diagnostics],
  } }
  switch (result.kind) {
    case 'completed':
      return {
        kind: result.kind,
        summary: result.summary,
        projectRoot: result.projectRoot,
        stateRevision: result.stateRevision,
        ...execution,
        ...(result.indexMaintenance === undefined ? {} : { indexMaintenance: { ...result.indexMaintenance } }),
        ...(result.recovery === undefined ? {} : { recovery: { ...result.recovery } }),
        clarity: !('u' in result.clarity)
          ? { ...result.clarity }
          : {
              ...result.clarity,
              u: { ...result.clarity.u },
              s: { ...result.clarity.s },
              t: { ...result.clarity.t },
            },
      }
    case 'await_user': {
      if (result.gate === undefined) {
        return {
          kind: result.kind,
          summary: result.summary,
          ...execution,
          ...(result.instruction === undefined ? {} : { instruction: result.instruction }),
          ...(result.indexMaintenance === undefined ? {} : { indexMaintenance: { ...result.indexMaintenance } }),
          ...(result.recovery === undefined ? {} : { recovery: { ...result.recovery } }),
        }
      }
      const pin = {
        invocationId: String(result.gate.pin.invocationId),
        projectId: String(result.gate.pin.projectId),
        kitName: result.gate.pin.kitName,
        kitVersion: String(result.gate.pin.kitVersion),
        skillName: result.gate.pin.skillName,
        bundleVersion: String(result.gate.pin.bundleVersion),
        stateRevision: result.gate.pin.stateRevision,
      }
      const gate = result.gate.kind === 'must_edit'
        ? {
            kind: result.gate.kind,
            invocationId: String(result.gate.invocationId),
            pin,
          }
        : {
            kind: result.gate.kind,
            invocationId: String(result.gate.invocationId),
            pin,
            action: {
              routeId: String(result.gate.action.routeId),
              label: { ...result.gate.action.label },
              ...(result.gate.action.aliases === undefined ? {} : {
                aliases: {
                  zh: [...result.gate.action.aliases.zh],
                  en: [...result.gate.action.aliases.en],
                },
              }),
            },
          }
      return { kind: result.kind, summary: result.summary, gate, ...execution,
        ...(result.indexMaintenance === undefined ? {} : { indexMaintenance: { ...result.indexMaintenance } }),
        ...(result.recovery === undefined ? {} : { recovery: { ...result.recovery } }),
      }
    }
    case 'failed':
    case 'cancelled':
      return { kind: result.kind, summary: result.summary, diagnostics: [...result.diagnostics], ...execution }
    case 'in_progress':
    case 'invalid':
      return { kind: result.kind, summary: result.summary }
  }
}

/** Required DSH capability. */
export const inject = ['tools']

/**
 * Register the canonical attached `run_design_skill` tool.
 * @param ctx - composing DSH context carrying the public Tool registry.
 * @param port - high-level Design skill controller.
 */
export function apply(ctx: Context, port: RunDesignSkillPort): void {
  const awaitingUserContinue = new WeakSet<Agent>()
  // One correction belongs to the Host turn, never to a brief, call id or
  // concurrent sibling. Consume it synchronously before any engagement await.
  // Do not clear it at turn-stopping: RC2 may still drain queued steering in
  // that same turn. The next recorded turn naturally starts a fresh budget.
  const acknowledgementRecovery = new WeakMap<Agent, { readonly turn?: number; closed: boolean }>()

  ctx.on('agent/turn-stopping', ({ agent }) => {
    awaitingUserContinue.delete(agent)
  })

  ctx.tools.register(defineTool({
    name: 'run_design_skill',
    description: 'Run one exact, case-sensitive Design skill from the active Kit, or resume its current user-continue gate by exact action route. Before an ordinary engagement, write one concise visible assistant acknowledgement in the conversation language that names the exact localized skill title and intended persistent result; never move silently from a host-native answered question to this tool. State the requested generation, revision, or retry in the brief; the Bundle Skill Body decides which design artifacts need work. When this invocation executes an accepted Design advisory action, pass that exact action receipt as advisoryReceiptId; an advisory acceptance receipt is not tool authority. Never omit, invent, reuse for another Bundle, or infer an action receipt from advisory text. While a user-continue gate is pending, a non-empty brief for that same skill revises its pending plan instead of starting new work. The tool remains attached while its native Subagents run; a completed result identifies its saved Design revision; main-Agent clarity reporting is separate and never a completion prerequisite, and failure/cancellation/user-input waits return their own outcome. For a Bundle configured with execution.mode main, in_progress instead returns the installed method for you to execute here; use design_publish to receive its terminal handoff/clarity result.',
    parameters: {
      name: {
        type: 'string',
        required: true,
        description: 'Exact, case-sensitive skill name from the active Design Kit.',
      },
      brief: {
        type: 'string',
        description: 'Optional user intent or constraints for ordinary engagement. For reconstruction, supply a compact handoff: shared product purpose/users/scope, this Bundle’s assigned slice and outputs, focused source paths and facts, relevant saved IDs and material unknowns or contradictions. Do not rely on the Producer inheriting the main conversation or send only a task title. Under a pending user-continue gate of the same skill, a non-empty brief revises that pending plan instead of starting new work.',
      },
      reconstruct: {
        type: 'boolean',
        description: 'Extract and restore source facts from the exact read-only evidence file or directory carried in the brief into this Bundle’s existing schema and artifacts. Selects the reconstruction task and shared output contract instead of the forward-design Skill Body. No ordinary must_edit/user_continue pauses; real failures, unrepresentable facts and input obstacles remain.',
      },
      reconstruction_source_root: {
        type: 'string',
        description: 'Exact absolute local evidence file or directory supplied by /yugoo reconstruct; keep the source_root field name for compatibility. Required on every reconstruct=true call, including a legacy action resume, and invalid otherwise.',
      },
      action: {
        type: 'object',
        additionalProperties: false,
        description: 'Explicit current user-continue action. Omit for an ordinary skill engagement.',
        properties: {
          routeId: {
            type: 'string',
            required: true,
            description: 'Exact routeId returned by the current user-continue gate.',
          },
        },
      },
      advisoryReceiptId: {
        type: 'string',
        description: 'Optional durable acceptance receipt authorizing this advisory-triggered execution. Omit for ordinary or legacy invocations.',
      },
    },
    output: {
      schema: RESULT_SCHEMA,
      render: (_args, result) => [{ type: 'text', text: renderResult(result as RenderableRunDesignSkillResult) }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('run_design_skill requires a calling Agent')
      if (args.name.trim() === '') throw new Error('run_design_skill name must be non-empty text')
      if (args.action !== undefined && args.action.routeId.trim() === '') {
        throw new Error('run_design_skill action routeId must be non-empty text')
      }
      if (args.action !== undefined && args.brief !== undefined) {
        throw new Error('run_design_skill action cannot be combined with a new engagement brief')
      }
      if (args.reconstruct === true && (args.reconstruction_source_root === undefined || args.reconstruction_source_root.trim() === '')) {
        throw new Error('run_design_skill reconstruct=true requires reconstruction_source_root')
      }
      if (args.reconstruct !== true && args.reconstruction_source_root !== undefined) {
        throw new Error('run_design_skill reconstruction_source_root requires reconstruct=true')
      }
      if (args.advisoryReceiptId !== undefined && args.advisoryReceiptId.trim() === '') {
        throw new Error('run_design_skill advisoryReceiptId must be non-empty text')
      }
      if (awaitingUserContinue.has(exec.agent)) {
        throw new Error('run_design_skill is awaiting the current user-continue action and cannot run again in this user turn')
      }
      if (args.action === undefined) {
        const acknowledgement = invocationAcknowledgement(exec.agent, String(exec.rootCallId))
        const prior = acknowledgementRecovery.get(exec.agent)
        const recovery = prior?.turn === acknowledgement.turn ? prior : undefined
        if (recovery?.closed || !acknowledgement.present) {
          if (recovery !== undefined) {
            recovery.closed = true
            exec.concludeTurn()
            return snapshotResult({
              kind: 'invalid',
              summary: 'The Design skill did not start. The visible-acknowledgement correction limit for this turn has been reached. Do not retry again in this turn; report the obstacle and wait for a new user instruction.',
            })
          }
          acknowledgementRecovery.set(exec.agent, { turn: acknowledgement.turn, closed: false })
          return snapshotResult({
            kind: 'invalid',
            summary: 'The Design skill did not start because its visible acknowledgement is missing. State the exact localized Design skill title and intended persistent result in assistant text, then retry this Design action once in the current turn.',
          })
        }
      }

      const advisoryReceiptId = args.advisoryReceiptId?.trim()
      const proposedInvocationId = invocationId(String(exec.rootCallId))
      let advisoryAttempt: {
        readonly receiptId: string
        readonly attemptId: string
      } | undefined
      let effectiveInvocationId = proposedInvocationId
      if (advisoryReceiptId !== undefined) {
        if (port.claimAdvisoryActionExecution === undefined
          || port.settleAdvisoryActionExecution === undefined) {
          throw new Error('run_design_skill advisory execution is unavailable in this deployment')
        }
        const claim = await port.claimAdvisoryActionExecution({
          agent: exec.agent,
          receiptId: advisoryReceiptId,
          proposedInvocationId,
          name: args.name,
          signal: exec.signal,
        })
        if (claim.kind === 'invalid') return snapshotResult(claim)
        if (!claim.claimed) {
          const disposition = claim.state === 'completed' ? 'already completed' : 'currently running'
          return snapshotResult({
            kind: 'invalid',
            summary: `Advisory action receipt ${JSON.stringify(advisoryReceiptId)} is ${disposition}; no Design skill was started.`,
          })
        }
        advisoryAttempt = Object.freeze({ receiptId: advisoryReceiptId, attemptId: claim.attemptId })
        effectiveInvocationId = claim.effectiveInvocationId
      }

      let result: RunDesignSkillResult
      try {
        result = await port.run({
          invocationId: effectiveInvocationId,
          rootCallId: String(exec.rootCallId),
          agent: exec.agent,
          name: args.name,
          ...(args.brief === undefined ? {} : { brief: args.brief }),
          ...(args.reconstruct === true ? { reconstruct: true } : {}),
          ...(args.reconstruction_source_root === undefined
            ? {}
            : { reconstructionSourceRoot: args.reconstruction_source_root.trim() }),
          ...(args.action === undefined ? {} : { action: { routeId: args.action.routeId } }),
          signal: exec.signal,
        })
      } catch (error) {
        if (advisoryAttempt === undefined) throw error
        try {
          await port.settleAdvisoryActionExecution!({
            agent: exec.agent,
            receiptId: advisoryAttempt.receiptId,
            attemptId: advisoryAttempt.attemptId,
            state: 'failed',
          })
        } catch (settlementError) {
          throw new AggregateError(
            [error, settlementError],
            `run_design_skill failed and advisory action receipt ${JSON.stringify(advisoryAttempt.receiptId)} could not be settled`,
          )
        }
        throw error
      }
      const settlementAgent = exec.agent
      const settleResult = async (result: RunDesignSkillResult) => {
        if (advisoryAttempt !== undefined) {
          const state = result.kind === 'completed'
            ? 'completed'
            : result.kind === 'await_user'
              ? 'needs-user-input'
              : 'failed'
          await port.settleAdvisoryActionExecution!({
            agent: settlementAgent,
            receiptId: advisoryAttempt.receiptId,
            attemptId: advisoryAttempt.attemptId,
            state,
          })
        }
        if (result.kind === 'await_user' && result.gate?.kind === 'user_continue') {
          awaitingUserContinue.add(settlementAgent)
        }
      }
      if (result.kind === 'in_progress') {
        if (port.onMainSettlement === undefined) throw new Error('Main execution settlement is unavailable')
        port.onMainSettlement(exec.agent, settleResult)
      } else {
        await settleResult(result)
        if (result.kind === 'await_user' && result.gate?.kind !== 'user_continue') exec.concludeTurn()
      }
      return snapshotResult(result)
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: 'Running Design skill',
        kind: 'other',
        rawInput: args.action?.routeId ?? args.brief ?? args.name,
      }
    },
  }))
}
