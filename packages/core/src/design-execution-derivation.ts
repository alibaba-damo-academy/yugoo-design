/** Deterministic reconstruction of the current execution gate from durable authorities. */
import { isDeepStrictEqual } from 'node:util'
import {
  DesignExecutionInvocationId,
  type DesignExecutionGate,
  type DesignExecutionPin,
} from './design-execution-runtime.ts'
import type { DesignFilesStore } from './design-files.ts'
import type { DesignJournalRecord } from './design-journal.ts'
import type { DesignBundleVersion, DesignKitVersion, DesignSkill } from './types.ts'
import type { DesignKit } from './types.ts'
import { DesignProjectId, type DesignProjectId as DesignProjectIdType } from './design-project.ts'

/** Exact current Kit, Bundle, and Design Files revision, without a transient invocation id. */
export interface DesignExecutionStatePin {
  readonly projectId: DesignProjectIdType
  readonly kitName: string
  readonly kitVersion: DesignKitVersion
  readonly skillName: string
  readonly bundleVersion: DesignBundleVersion
  readonly stateRevision: string
}

/** Latest existing authoritative Design change for the pinned Bundle state. */
export interface DesignExecutionAuthorityRecord extends DesignExecutionStatePin {
  /** Stable trusted record identity, such as a host event or journal record identity. */
  readonly recordId: string
  readonly origin: 'agent' | 'panel'
}

/** Complete authoritative input required to reconstruct one current execution gate. */
export interface DesignExecutionDerivationInput {
  readonly skill: DesignSkill
  readonly pin: DesignExecutionStatePin
  /** Authoritative lifecycle status stored with the pinned Bundle state. */
  readonly stateStatus: 'pending' | 'complete'
  readonly change: DesignExecutionAuthorityRecord
  /** Invocation currently running its Producer, when the host has one for this Bundle. */
  readonly runningInvocationId?: DesignExecutionInvocationId
}

function nonEmpty(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be non-empty text`)
}

function assertExactAuthority(pin: DesignExecutionStatePin, change: DesignExecutionAuthorityRecord): void {
  if (change.projectId !== pin.projectId || change.kitName !== pin.kitName || change.kitVersion !== pin.kitVersion
    || change.skillName !== pin.skillName || change.bundleVersion !== pin.bundleVersion
    || change.stateRevision !== pin.stateRevision) {
    throw new Error('design execution derivation: latest Design change does not match the exact authoritative pin')
  }
}

function executionPin(
  pin: DesignExecutionStatePin,
  invocationId: DesignExecutionInvocationId,
): DesignExecutionPin {
  return Object.freeze({ invocationId, ...pin })
}

/**
 * Reconstruct the current handoff gate without adding an execution event or journal fact.
 * @param input - exact compiled policy, authoritative lifecycle status, pin, and change authority.
 * @returns the current frozen gate, or undefined when no handoff is currently open.
 */
export function deriveDesignExecutionGate(
  input: DesignExecutionDerivationInput,
): DesignExecutionGate | undefined {
  const { skill, pin, change } = input
  DesignProjectId(pin.projectId)
  nonEmpty(pin.kitName, 'design execution derivation pin kitName')
  nonEmpty(pin.skillName, 'design execution derivation pin skillName')
  nonEmpty(pin.stateRevision, 'design execution derivation pin stateRevision')
  if (input.stateStatus !== 'pending' && input.stateStatus !== 'complete') {
    throw new Error('design execution derivation: stateStatus must be pending or complete')
  }
  if (skill.name !== pin.skillName || skill.version !== pin.bundleVersion) {
    throw new Error('design execution derivation: compiled Bundle does not match the exact authoritative pin')
  }
  assertExactAuthority(pin, change)
  const invocationId = DesignExecutionInvocationId(change.recordId)
  const policy = skill.execution
  if (policy.handoff === 'none' || input.stateStatus === 'complete' || change.origin === 'panel'
    || input.runningInvocationId === invocationId) return undefined
  const exactPin = executionPin(pin, invocationId)
  if (policy.handoff === 'user_continue') {
    return Object.freeze({ kind: 'user_continue', invocationId, pin: exactPin, action: policy.resumeAction })
  }
  return Object.freeze({ kind: 'must_edit', invocationId, pin: exactPin })
}

function latestRelevantChange(
  records: readonly DesignJournalRecord[],
  kit: DesignKit,
  skill: DesignSkill,
): Extract<DesignJournalRecord, { readonly type: 'design/changed' }> | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]
    if (record?.type !== 'design/changed') continue
    if (record.data.kit === kit.name && record.data.version === kit.version && record.data.skill === skill.name) {
      return record
    }
  }
  return undefined
}

/**
 * Reconstruct the one real current handoff gate for a published Bundle.
 * Git publication metadata is primary; DesignJournal is a legacy fallback.
 * Business fields inside the Bundle JSON never imply lifecycle state.
 */
export async function deriveCurrentDesignExecutionGate(input: {
  readonly projectId: DesignProjectIdType
  readonly records: readonly DesignJournalRecord[]
  readonly kit: DesignKit
  readonly skill: DesignSkill
  readonly stateRevision: string
  readonly state: Readonly<Record<string, unknown>> | undefined
  readonly store: Pick<DesignFilesStore, 'readLatestPublishedExecutionForSkillAt' | 'samePublishedFileAt'>
  readonly signal: AbortSignal
}): Promise<DesignExecutionGate | undefined> {
  if (input.skill.execution.handoff === 'none' || input.state === undefined || Object.keys(input.state).length === 0) {
    return undefined
  }
  const published = await input.store.readLatestPublishedExecutionForSkillAt(
    input.stateRevision,
    input.skill.name,
    input.signal,
  )
  let change: DesignExecutionAuthorityRecord | undefined
  if (published !== undefined) {
    const execution = published.execution
    if (execution.bundleVersion !== input.skill.version
      || execution.stateStatus !== 'pending'
      || execution.handoff !== input.skill.execution.handoff) return undefined
    change = Object.freeze({
      recordId: execution.invocationId,
      projectId: input.projectId,
      kitName: input.kit.name,
      kitVersion: input.kit.version,
      skillName: input.skill.name,
      bundleVersion: input.skill.version,
      stateRevision: input.stateRevision,
      origin: 'agent',
    })
  } else {
    const latest = latestRelevantChange(input.records, input.kit, input.skill)
    if (latest === undefined
      || latest.data.origin !== 'agent'
      || !isDeepStrictEqual(latest.data.state, input.state)
      || latest.data.commit === undefined
      || latest.data.execution?.stateStatus !== 'pending'
      || latest.data.execution.handoff !== input.skill.execution.handoff
      || !await input.store.samePublishedFileAt(
        latest.data.commit,
        input.stateRevision,
        `${input.skill.name}/${input.skill.name}.json`,
        input.signal,
      )) return undefined
    change = Object.freeze({
      recordId: latest.data.execution.invocationId,
      projectId: input.projectId,
      kitName: input.kit.name,
      kitVersion: input.kit.version,
      skillName: input.skill.name,
      bundleVersion: input.skill.version,
      stateRevision: input.stateRevision,
      origin: 'agent',
    })
  }
  return deriveDesignExecutionGate({
    skill: input.skill,
    pin: {
      projectId: input.projectId,
      kitName: input.kit.name,
      kitVersion: input.kit.version,
      skillName: input.skill.name,
      bundleVersion: input.skill.version,
      stateRevision: input.stateRevision,
    },
    stateStatus: 'pending',
    change,
  })
}
