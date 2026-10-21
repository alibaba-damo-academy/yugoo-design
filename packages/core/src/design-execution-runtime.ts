/** Host-neutral controller for the complete Design Producer lifecycle. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import { DesignProjectId, type DesignProjectId as DesignProjectIdType } from './design-project.ts'
import type {
  DesignBundleVersion,
  DesignKit,
  DesignKitVersion,
  DesignResumeAction,
  DesignResumeActionId,
  DesignSkill,
} from './types.ts'

/** Opaque causal identity of one primary-Agent Bundle engagement. */
export type DesignExecutionInvocationId = Branded<'DesignExecutionInvocationId'>

/**
 * Validate and brand an execution invocation identity minted by a trusted caller.
 * @param value - portable caller-issued identity.
 * @returns the branded identity.
 */
export function DesignExecutionInvocationId(value: string): DesignExecutionInvocationId {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(value)) {
    throw new Error(`invalid Design execution invocation id ${JSON.stringify(value)}`)
  }
  return value as DesignExecutionInvocationId
}

/** Exact selected Kit and Bundle versions plus Design Files revision used by one transition. */
export interface DesignExecutionPin {
  readonly invocationId: DesignExecutionInvocationId
  readonly projectId: DesignProjectIdType
  readonly kitName: string
  readonly kitVersion: DesignKitVersion
  readonly skillName: string
  readonly bundleVersion: DesignBundleVersion
  readonly stateRevision: string
}

/** Selection resolved from one immutable Kit version and an exact state pin. */
export interface DesignExecutionSelection {
  /** Caller-minted causal identity; the execution controller never generates one. */
  readonly invocationId: DesignExecutionInvocationId
  readonly projectId: DesignProjectIdType
  readonly kit: DesignKit
  readonly kitVersion: DesignKitVersion
  readonly skillName: string
  readonly bundleVersion: DesignBundleVersion
  readonly stateRevision: string
}

/** Focused user context supplied only for a new Bundle engagement. */
export interface DesignExecutionProducerInput {
  readonly brief: string
  readonly currentDesignState: string
  readonly userContext: string
  /** Source-evidence reconstruction strategy for this engagement only. */
  readonly reconstruct?: true
  /** Canonical absolute Git working tree used as read-only source evidence. */
  readonly reconstructionSourceRoot?: string
}

/** Reconstruction authority explicitly repeated when a user-continue run resumes. */
export interface DesignExecutionProducerResumeInput {
  readonly reconstruct: true
  readonly reconstructionSourceRoot: string
}

/** Reason the complete Producer lifecycle is running. */
export type DesignExecutionProducerRunMode = 'engage' | 'resume'

/** Content publication and its follow-up maintenance remain separate facts. */
export type DesignPublicationFollowUp = Pick<import('./design-files.ts').DesignWriteResult, 'indexMaintenance' | 'recovery'>

/** Exact input to one complete Producer run. */
export type DesignExecutionProducerRequest = {
  readonly pin: DesignExecutionPin
  readonly skill: DesignSkill
  readonly signal: AbortSignal
} & (
  | { readonly mode: 'engage'; readonly input: DesignExecutionProducerInput }
  | { readonly mode: 'resume'; readonly input?: DesignExecutionProducerResumeInput }
)

/** Authoritative settlement returned after the Producer lifecycle has stopped. */
export type DesignExecutionProducerSettlement =
  | {
      readonly kind: 'committed'
      readonly stateRevision: string
      readonly stateStatus: 'pending' | 'complete'
    } & DesignPublicationFollowUp
  | {
      readonly kind: 'needs_input'
      readonly stateRevision: string
      readonly instruction: string
    }
  | {
      readonly kind: 'failed' | 'cancelled'
      readonly stateRevision: string
      readonly diagnostics: readonly string[]
    }

/** Adapter from the controller to one complete Design Producer lifecycle. */
export interface DesignExecutionProducerPort {
  /**
   * Run until the Producer reaches an authoritative settlement.
   * @param request - exact Bundle pin, run reason, optional engagement input, and cancellation.
   * @returns the settlement after all owned production and optional delegation has stopped.
   */
  run(request: DesignExecutionProducerRequest): Promise<DesignExecutionProducerSettlement>
}

/** Runtime operations injected by DSH, Codex, Claude Code, or another Agent Host. */
export interface DesignExecutionRuntimePorts {
  readonly producer: DesignExecutionProducerPort
}

/** One resumable pause derived solely from the compiled execution policy. */
export type DesignExecutionGate =
  | {
      readonly kind: 'must_edit'
      readonly invocationId: DesignExecutionInvocationId
      readonly pin: DesignExecutionPin
    }
  | {
      readonly kind: 'user_continue'
      readonly invocationId: DesignExecutionInvocationId
      readonly pin: DesignExecutionPin
      readonly action: DesignResumeAction
    }

/** Observable result of engaging or continuing one Bundle policy. */
export type DesignExecutionTransition =
  | ({ readonly kind: 'complete'; readonly pin: DesignExecutionPin } & DesignPublicationFollowUp)
  | ({ readonly kind: 'await_user'; readonly gate: DesignExecutionGate } & DesignPublicationFollowUp)
  | { readonly kind: 'await_execution_input'; readonly pin: DesignExecutionPin; readonly instruction: string }
  | { readonly kind: 'failed'; readonly pin: DesignExecutionPin; readonly diagnostics: readonly string[] }
  | { readonly kind: 'cancelled'; readonly pin: DesignExecutionPin; readonly diagnostics: readonly string[] }

/** Explicit server command produced by a current resume button or exact chat control. */
export interface ResumeDesignExecutionCommand {
  readonly kind: 'resume_execution'
  readonly invocationId: DesignExecutionInvocationId
  readonly gate: Extract<DesignExecutionGate, { readonly kind: 'user_continue' }>
  readonly routeId: DesignResumeActionId
}

/** Result of interpreting user input while a `user_continue` gate is current. */
export type DesignExecutionInputResolution =
  | { readonly kind: 'command'; readonly command: ResumeDesignExecutionCommand }
  | { readonly kind: 'ordinary_input'; readonly text: string }

function nonEmpty(value: string, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be non-empty text`)
  return value
}

function freezePin(pin: DesignExecutionPin): DesignExecutionPin {
  DesignExecutionInvocationId(pin.invocationId)
  DesignProjectId(pin.projectId)
  nonEmpty(pin.kitName, 'execution pin kitName')
  nonEmpty(pin.skillName, 'execution pin skillName')
  nonEmpty(pin.stateRevision, 'execution pin stateRevision')
  return Object.freeze({ ...pin })
}

function sameIdentity(left: DesignExecutionPin, right: DesignExecutionPin): boolean {
  return left.invocationId === right.invocationId
    && left.projectId === right.projectId
    && left.kitName === right.kitName
    && left.kitVersion === right.kitVersion
    && left.skillName === right.skillName
    && left.bundleVersion === right.bundleVersion
}

function assertCurrentPin(expected: DesignExecutionPin, current: DesignExecutionPin): void {
  if (!sameIdentity(expected, current) || expected.stateRevision !== current.stateRevision) {
    throw new Error('design execution command is stale for the current project, invocation, Kit, Bundle, or state revision')
  }
}

function resolveSelection(selection: DesignExecutionSelection): { readonly skill: DesignSkill; readonly pin: DesignExecutionPin } {
  if (selection.kit.version !== selection.kitVersion) {
    throw new Error('design execution selection does not match the exact Kit version')
  }
  const skill = selection.kit.skills.find((candidate) => candidate.name === selection.skillName)
  if (skill === undefined || skill.version !== selection.bundleVersion) {
    throw new Error('design execution selection does not match a Bundle in the exact Kit version')
  }
  return {
    skill,
    pin: freezePin({
      invocationId: selection.invocationId,
      projectId: selection.projectId,
      kitName: selection.kit.name,
      kitVersion: selection.kitVersion,
      skillName: skill.name,
      bundleVersion: skill.version,
      stateRevision: selection.stateRevision,
    }),
  }
}

function committedPin(pin: DesignExecutionPin, stateRevision: string): DesignExecutionPin {
  nonEmpty(stateRevision, 'producer stateRevision')
  return freezePin({ ...pin, stateRevision })
}

function awaitHandoff(skill: DesignSkill, pin: DesignExecutionPin): DesignExecutionTransition {
  switch (skill.execution.handoff) {
    case 'must_edit':
      return Object.freeze({
        kind: 'await_user',
        gate: Object.freeze({ kind: 'must_edit', invocationId: pin.invocationId, pin }),
      })
    case 'user_continue':
      return Object.freeze({
        kind: 'await_user',
        gate: Object.freeze({ kind: 'user_continue', invocationId: pin.invocationId, pin, action: skill.execution.resumeAction }),
      })
    case 'none':
      throw new Error('Design Producer committed pending state without a handoff')
  }
}

function freezeDiagnostics(diagnostics: readonly string[]): readonly string[] {
  return Object.freeze([...diagnostics])
}

function transitionFromSettlement(
  skill: DesignSkill,
  pin: DesignExecutionPin,
  settlement: DesignExecutionProducerSettlement,
): DesignExecutionTransition {
  const settledPin = committedPin(pin, settlement.stateRevision)
  switch (settlement.kind) {
    case 'committed': {
      const transition = settlement.stateStatus === 'complete'
        ? Object.freeze({ kind: 'complete' as const, pin: settledPin })
        : awaitHandoff(skill, settledPin)
      return Object.freeze({ ...transition,
        ...(settlement.indexMaintenance === undefined ? {} : { indexMaintenance: settlement.indexMaintenance }),
        ...(settlement.recovery === undefined ? {} : { recovery: settlement.recovery }),
      })
    }
    case 'needs_input':
      nonEmpty(settlement.instruction, 'producer needs-input instruction')
      return Object.freeze({ kind: 'await_execution_input', pin: settledPin, instruction: settlement.instruction })
    case 'failed':
      return Object.freeze({ kind: 'failed', pin: settledPin, diagnostics: freezeDiagnostics(settlement.diagnostics) })
    case 'cancelled':
      return Object.freeze({ kind: 'cancelled', pin: settledPin, diagnostics: freezeDiagnostics(settlement.diagnostics) })
  }
}

async function runProducer(
  skill: DesignSkill,
  pin: DesignExecutionPin,
  signal: AbortSignal,
  producer: DesignExecutionProducerPort,
  request: Pick<Extract<DesignExecutionProducerRequest, { readonly mode: 'engage' }>, 'mode' | 'input'>
    | Pick<Extract<DesignExecutionProducerRequest, { readonly mode: 'resume' }>, 'mode' | 'input'>,
): Promise<DesignExecutionTransition> {
  signal.throwIfAborted()
  const effectiveSkill = request.input?.reconstruct === true
    // Reconstruction changes the terminal handoff only. Execution placement
    // was selected and frozen when this invocation began; dropping `mode`
    // here would make a main-mode invocation mount main-scoped tools while
    // the Producer adapter silently falls back to the subagent path.
    ? { ...skill, execution: { ...skill.execution, handoff: 'none' as const } }
    : skill
  const settlement = await producer.run({ skill: effectiveSkill, pin, signal, ...request })
  return transitionFromSettlement(effectiveSkill, pin, settlement)
}

/**
 * Run the complete Producer lifecycle when the primary Agent engages a Bundle.
 * @param selection - immutable Kit membership and current state revision.
 * @param input - focused context for the new engagement.
 * @param signal - caller cancellation.
 * @param ports - host adapter for the complete Producer lifecycle.
 * @returns the next explicit gate or Producer settlement.
 */
export async function engageDesignExecution(
  selection: DesignExecutionSelection,
  input: DesignExecutionProducerInput,
  signal: AbortSignal,
  ports: DesignExecutionRuntimePorts,
): Promise<DesignExecutionTransition> {
  const { skill, pin } = resolveSelection(selection)
  return runProducer(skill, pin, signal, ports.producer, { mode: 'engage', input })
}

function normalizeControl(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/[。.!！]+$/u, '').trim()
}

/** Shared exact-control matching; scope-changing prose never matches a label. */
export function matchesDesignResumeAction(
  action: Extract<DesignExecutionGate, { kind: 'user_continue' }>['action'], text: string,
): boolean {
  const normalized = normalizeControl(text)
  return normalized !== '' && [action.label.zh, action.label.en,
    ...(action.aliases?.zh ?? []), ...(action.aliases?.en ?? [])]
    .some(label => normalizeControl(label) === normalized)
}

/**
 * Resolve a server-owned resume button or exact manifest label/alias.
 * Non-matching chat remains ordinary primary-Agent input and does not resume.
 * @param gate - current revision-pinned user-continue gate.
 * @param input - UI route action or complete chat message.
 * @returns an explicit resume command or untouched ordinary input.
 */
export function resolveDesignExecutionInput(
  gate: Extract<DesignExecutionGate, { readonly kind: 'user_continue' }>,
  input: { readonly kind: 'action'; readonly routeId: string } | { readonly kind: 'chat'; readonly text: string },
): DesignExecutionInputResolution {
  if (input.kind === 'action') {
    if (input.routeId !== gate.action.routeId) throw new Error('resume action does not match the current Design gate')
    return Object.freeze({
      kind: 'command',
      command: Object.freeze({
        kind: 'resume_execution',
        invocationId: gate.invocationId,
        gate,
        routeId: gate.action.routeId,
      }),
    })
  }
  if (matchesDesignResumeAction(gate.action, input.text)) {
    return Object.freeze({
      kind: 'command',
      command: Object.freeze({
        kind: 'resume_execution',
        invocationId: gate.invocationId,
        gate,
        routeId: gate.action.routeId,
      }),
    })
  }
  return Object.freeze({ kind: 'ordinary_input', text: input.text })
}

/**
 * Resume the complete Producer lifecycle after rechecking the current gate pin.
 * @param command - server-created command from the current gate.
 * @param selection - current authoritative Kit, Bundle, and state selection.
 * @param signal - caller cancellation.
 * @param producer - host adapter for the complete Producer lifecycle.
 * @returns the next explicit gate or Producer settlement.
 */
export async function resumeDesignExecution(
  command: ResumeDesignExecutionCommand,
  selection: DesignExecutionSelection,
  signal: AbortSignal,
  producer: DesignExecutionProducerPort,
  input?: DesignExecutionProducerResumeInput,
): Promise<DesignExecutionTransition> {
  const { skill, pin } = resolveSelection(selection)
  assertCurrentPin(command.gate.pin, pin)
  if (command.invocationId !== command.gate.invocationId) throw new Error('resume command invocation is not current')
  if (command.routeId !== command.gate.action.routeId) throw new Error('resume command route is not current')
  return runProducer(skill, pin, signal, producer, { mode: 'resume', ...(input === undefined ? {} : { input }) })
}

/**
 * Consume a `must_edit` gate after an authoritative panel save changed the state revision.
 * @param gate - current revision-pinned panel-edit gate.
 * @param selection - post-save authoritative selection.
 * @returns completion pinned to the committed panel revision.
 */
export async function continueAfterDesignPanelEdit(
  gate: Extract<DesignExecutionGate, { readonly kind: 'must_edit' }>,
  selection: DesignExecutionSelection,
): Promise<DesignExecutionTransition> {
  const { pin } = resolveSelection(selection)
  if (gate.invocationId !== gate.pin.invocationId) throw new Error('must_edit gate invocation is inconsistent')
  if (!sameIdentity(gate.pin, pin)) throw new Error('panel edit does not match the current Design gate identity')
  if (gate.pin.stateRevision === pin.stateRevision) throw new Error('must_edit requires an authoritative state revision change')
  return Object.freeze({ kind: 'complete', pin })
}
