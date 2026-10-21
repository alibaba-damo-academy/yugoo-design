/** Payload parsing and value types owned by the plugin DesignJournal. */
import {
  DesignKitVersion,
  type DesignChangedPayload,
  type DesignKitSelectedPayload,
} from './types.ts'

/** Latest `design/kit-selected` audit fact folded from the DesignJournal; selection authority stays in the committed project pin. */
export interface DesignKitPin {
  readonly kit: string
  readonly version: DesignKitVersion
}

/** One changed Design File value folded from the DesignJournal. */
export interface DesignJournalValue {
  readonly state: unknown
  readonly panelYaml?: string
  readonly skillManifest?: Record<string, unknown>
  readonly origin: 'agent' | 'panel'
}

function record(value: unknown, factType: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`design: ${factType} fact data must be an object`)
  }
  return value as Record<string, unknown>
}

/**
 * Parse one durable Kit selection payload at the DesignJournal boundary.
 * @param value - untrusted fact data from a live or reconstructed journal.
 * @returns the validated selection payload.
 */
export function parseKitSelection(value: unknown): DesignKitSelectedPayload {
  const data = record(value, 'design/kit-selected')
  if (typeof data.kit !== 'string' || data.kit === '' || typeof data.version !== 'string'
    || (data.operation !== 'activate' && data.operation !== 'upgrade')) {
    throw new Error('design: design/kit-selected fact requires kit, version, and a supported operation')
  }
  let adoption: DesignKitSelectedPayload['adoption']
  if (data.adoption !== undefined) {
    const receipt = record(data.adoption, 'design/kit-selected.adoption')
    const keys = ['operationId', 'projectId', 'sourceCheckpoint', 'checkpoint', 'contentHash']
    if (data.operation !== 'upgrade' || Object.keys(receipt).some(key => !keys.includes(key))
      || keys.some(key => typeof receipt[key] !== 'string')
      || !/^[a-f0-9-]{36}$/u.test(receipt.operationId as string)
      || !/^[a-f0-9-]{36}$/u.test(receipt.projectId as string)
      || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(receipt.sourceCheckpoint as string)
      || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(receipt.checkpoint as string)
      || !/^[a-f0-9]{64}$/u.test(receipt.contentHash as string)) throw new Error('design: invalid Kit adoption receipt')
    adoption = Object.freeze({ operationId: receipt.operationId as string, projectId: receipt.projectId as string,
      sourceCheckpoint: receipt.sourceCheckpoint as string, checkpoint: receipt.checkpoint as string, contentHash: receipt.contentHash as string })
  }
  return { kit: data.kit, version: DesignKitVersion(data.version), operation: data.operation,
    ...(adoption === undefined ? {} : { adoption }) }
}

/**
 * Parse one durable Design File change payload at the DesignJournal boundary.
 * @param value - untrusted fact data from a live or reconstructed journal.
 * @returns the validated whole-value change payload.
 */
export function parseDesignChange(value: unknown): DesignChangedPayload {
  const data = record(value, 'design/changed')
  if (typeof data.kit !== 'string' || data.kit === '' || typeof data.version !== 'string'
    || typeof data.skill !== 'string' || data.skill === '' || (data.origin !== 'agent' && data.origin !== 'panel')) {
    throw new Error('design: design/changed fact requires kit, version, skill, and a supported origin')
  }
  if (!Object.hasOwn(data, 'state')) {
    throw new Error('design: design/changed fact requires the complete post-change state')
  }
  if (data.panelYaml !== undefined && typeof data.panelYaml !== 'string') {
    throw new Error('design: design/changed panelYaml must be a string when present')
  }
  if (data.skillManifest !== undefined
    && (typeof data.skillManifest !== 'object' || data.skillManifest === null || Array.isArray(data.skillManifest))) {
    throw new Error('design: design/changed skillManifest must be an object when present')
  }
  if (data.commit !== undefined && typeof data.commit !== 'string') {
    throw new Error('design: design/changed commit must be a string when present')
  }
  if (data.execution !== undefined) {
    const execution = record(data.execution, 'design/changed execution')
    if (Object.keys(execution).some(key => !['invocationId', 'stateStatus', 'handoff'].includes(key))) {
      throw new Error('design: design/changed execution contains unsupported fields')
    }
    if (data.origin !== 'agent'
      || typeof execution.invocationId !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(execution.invocationId)
      || (execution.stateStatus !== 'pending' && execution.stateStatus !== 'complete')
      || (execution.handoff !== 'none' && execution.handoff !== 'must_edit' && execution.handoff !== 'user_continue')) {
      throw new Error('design: design/changed execution requires agent origin, invocationId, stateStatus, and handoff')
    }
  }
  return {
    kit: data.kit,
    version: DesignKitVersion(data.version),
    skill: data.skill,
    state: data.state,
    origin: data.origin,
    ...(data.commit === undefined ? {} : { commit: data.commit }),
    ...(data.execution === undefined ? {} : { execution: data.execution as NonNullable<DesignChangedPayload['execution']> }),
    ...(data.panelYaml === undefined ? {} : { panelYaml: data.panelYaml }),
    ...(data.skillManifest === undefined ? {} : { skillManifest: data.skillManifest as Record<string, unknown> }),
  }
}
