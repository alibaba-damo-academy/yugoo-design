/**
 * Host-neutral design advice produced by background analysis.
 *
 * Grounding, reflection, and alignment produce reviewable advice only. Host
 * adapters decide how to place it in the main Agent's next natural context
 * boundary and how to show an optional human-review notification. Neither
 * operation grants authority to mutate Design Files.
 */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity of one background design advisory. */
export type DesignAdvisoryId = Branded<'DesignAdvisoryId'>

/** Versioned identity of the analysis profile that produced an advisory. */
export type DesignAdvisoryProfileId = Branded<'DesignAdvisoryProfileId'>

/** Exact authoritative input revision read by an analysis run. */
export interface DesignAdvisoryInputPin {
  readonly source: string
  readonly revision: string
}

/** One bounded recommendation included in an advisory. */
export interface DesignAdvisoryItem {
  readonly id: string
  readonly title: string
  readonly detail: string
  readonly rationale?: string
  readonly references: readonly string[]
}

/** One projector-owned Bundle revision target. It carries scope, not authority. */
export interface DesignAdvisoryBundleActionTarget {
  readonly skillName: string
  readonly entityRefs: readonly string[]
}

/**
 * Typed next action projected by the trusted advisory profile.
 *
 * This is deliberately separate from the human-readable acceptance text.
 * Acceptance of fixed v2 actions may resolve exact receipts. A review-choice
 * instead records acceptance first; a later explicit Bundle selection resolves
 * one exact receipt, while host follow-ups mint none.
 */
export type DesignAdvisoryActionSpec =
  | { readonly kind: 'none' }
  | { readonly kind: 'bundle-revisions'; readonly targets: readonly DesignAdvisoryBundleActionTarget[] }
  | { readonly kind: 'semantic-capability'; readonly capability: string; readonly entityRefs: readonly string[] }
  | { readonly kind: 'review-choice'; readonly profile: 'alignment' | 'reflection'; readonly entityRefs: readonly string[] }

/**
 * Complete trusted projection of one background analysis result.
 *
 * `attention: human-review` asks a host to display an actionable notice. The
 * acceptance instruction is still only a proposed next action: a host may
 * submit it to the main Agent only after an authenticated human action.
 */
export interface DesignAdvisoryV1 {
  readonly schemaVersion: 1
  readonly id: DesignAdvisoryId
  readonly profile: DesignAdvisoryProfileId
  readonly resultRef: string
  readonly inputs: readonly DesignAdvisoryInputPin[]
  readonly kind: 'reminder' | 'suggestion'
  readonly attention: 'next-boundary' | 'human-review'
  readonly summary: string
  readonly items: readonly DesignAdvisoryItem[]
  readonly acceptanceInstruction?: string
  readonly blocksConversation: false
  readonly authorizesDesignWrite: false
}

/** Current advisory schema with a trusted, non-executable action description. */
export interface DesignAdvisoryV2 extends Omit<DesignAdvisoryV1, 'schemaVersion'> {
  readonly schemaVersion: 2
  readonly actionSpec: DesignAdvisoryActionSpec
}

/** Every durable advisory revision understood by the current reader. */
export type DesignAdvisory = DesignAdvisoryV1 | DesignAdvisoryV2

/** Human disposition of an actionable advisory. */
export type DesignAdvisoryDecision = 'accepted' | 'rejected' | 'deferred'

/** Host capability that adds advice to the main Agent without waking it. */
export interface AdvisoryDeliveryPort<TConversation> {
  /**
   * Deliver advice at the next natural model-context boundary.
   * @param conversation - host-owned main-conversation handle.
   * @param advisory - trusted bounded advice.
   */
  injectNextBoundary(conversation: TConversation, advisory: DesignAdvisory): void | Promise<void>
}

/** Host capability that displays an actionable human-review notification. */
export interface HumanAttentionPort<TConversation> {
  /**
   * Publish a review request without authorizing or applying its suggestion.
   * @param conversation - host-owned main-conversation handle.
   * @param advisory - advice whose `attention` is `human-review`.
   */
  requestReview(conversation: TConversation, advisory: DesignAdvisory): void | Promise<void>
}

/**
 * Deliver one advisory through the two independent host surfaces.
 *
 * The main Agent always receives non-waking context. A human-facing review is
 * additionally published only when the trusted advisory projector selected
 * `human-review`; neither delivery applies the recommendation.
 * @param conversation - host-owned main-conversation handle.
 * @param advisory - validated advisory.
 * @param delivery - non-waking model-context adapter.
 * @param attention - optional human-review adapter.
 */
export async function deliverDesignAdvisory<TConversation>(
  conversation: TConversation,
  advisory: DesignAdvisory,
  delivery: AdvisoryDeliveryPort<TConversation>,
  attention?: HumanAttentionPort<TConversation>,
): Promise<void> {
  await delivery.injectNextBoundary(conversation, advisory)
  if (advisory.attention !== 'human-review') return
  if (attention === undefined) throw new Error('design advisory: human-review delivery requires a HumanAttentionPort')
  await attention.requestReview(conversation, advisory)
}

const PORTABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/
const MAX_INPUTS = 512
const MAX_ITEMS = 128
const MAX_TEXT = 8_192
const MAX_REFERENCES = 128

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error(`${path}: expected a plain object`)
  }
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, fields: readonly string[], path: string): void {
  const missing = fields.filter((field) => !Object.hasOwn(value, field))
  const extra = Object.keys(value).filter((field) => !fields.includes(field))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`${path}: invalid fields (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`)
  }
}

function text(value: unknown, path: string, maximum = MAX_TEXT): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path}: expected non-empty text`)
  if (value.length > maximum) throw new Error(`${path}: exceeds ${maximum} characters`)
  return value
}

function portable(value: unknown, path: string): string {
  const parsed = text(value, path, 256)
  if (!PORTABLE_ID.test(parsed)) throw new Error(`${path}: expected a portable identifier`)
  return parsed
}

function stringList(value: unknown, path: string, maximum: number): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${path}: expected at most ${maximum} strings`)
  const parsed = value.map((entry, index) => text(entry, `${path}[${index}]`, 512))
  if (new Set(parsed).size !== parsed.length) throw new Error(`${path}: duplicate values are not allowed`)
  return Object.freeze(parsed)
}

function parseActionSpec(value: unknown): DesignAdvisoryActionSpec {
  const action = record(value, '$.actionSpec')
  if (action.kind === 'none') {
    exact(action, ['kind'], '$.actionSpec')
    return Object.freeze({ kind: 'none' as const })
  }
  if (action.kind === 'bundle-revisions') {
    exact(action, ['kind', 'targets'], '$.actionSpec')
    if (!Array.isArray(action.targets) || action.targets.length > MAX_ITEMS) {
      throw new Error(`$.actionSpec.targets: expected at most ${MAX_ITEMS} targets`)
    }
    const targets = action.targets.map((candidate, index) => {
      const target = record(candidate, `$.actionSpec.targets[${index}]`)
      exact(target, ['skillName', 'entityRefs'], `$.actionSpec.targets[${index}]`)
      return Object.freeze({
        skillName: portable(target.skillName, `$.actionSpec.targets[${index}].skillName`),
        entityRefs: stringList(target.entityRefs, `$.actionSpec.targets[${index}].entityRefs`, MAX_REFERENCES),
      })
    })
    if (new Set(targets.map(target => target.skillName)).size !== targets.length) {
      throw new Error('$.actionSpec.targets: duplicate skillName values are not allowed')
    }
    return Object.freeze({ kind: 'bundle-revisions' as const, targets: Object.freeze(targets) })
  }
  if (action.kind === 'semantic-capability') {
    exact(action, ['kind', 'capability', 'entityRefs'], '$.actionSpec')
    const capability = text(action.capability, '$.actionSpec.capability', 256)
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*(?:\/v[1-9][0-9]*)$/.test(capability)) {
      throw new Error('$.actionSpec.capability: expected a versioned capability id')
    }
    return Object.freeze({
      kind: 'semantic-capability' as const,
      capability,
      entityRefs: stringList(action.entityRefs, '$.actionSpec.entityRefs', MAX_REFERENCES),
    })
  }
  if (action.kind === 'review-choice') {
    exact(action, ['kind', 'profile', 'entityRefs'], '$.actionSpec')
    if (action.profile !== 'alignment' && action.profile !== 'reflection') {
      throw new Error('$.actionSpec.profile: expected alignment or reflection')
    }
    return Object.freeze({
      kind: 'review-choice' as const,
      profile: action.profile,
      entityRefs: stringList(action.entityRefs, '$.actionSpec.entityRefs', MAX_REFERENCES),
    })
  }
  throw new Error('$.actionSpec.kind: expected none, bundle-revisions, semantic-capability, or review-choice')
}

/** Validate and brand an advisory identity. */
export function DesignAdvisoryId(value: string): DesignAdvisoryId {
  return portable(value, 'design advisory id') as DesignAdvisoryId
}

/** Validate and brand a versioned advisory profile identity. */
export function DesignAdvisoryProfileId(value: string): DesignAdvisoryProfileId {
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*(?:\/v[1-9][0-9]*)$/.test(value)) {
    throw new Error(`design advisory profile: invalid versioned id ${JSON.stringify(value)}`)
  }
  return value as DesignAdvisoryProfileId
}

/**
 * Strictly parse an advisory at a model, worker, durable, or wire boundary.
 * @param value - untrusted advisory value.
 * @returns a frozen validated advisory.
 */
export function parseDesignAdvisory(value: unknown): DesignAdvisory {
  const advisory = record(value, '$')
  const optional = advisory.acceptanceInstruction === undefined ? [] : ['acceptanceInstruction']
  const versionFields = advisory.schemaVersion === 2 ? ['actionSpec'] : []
  exact(advisory, [
    'schemaVersion', 'id', 'profile', 'resultRef', 'inputs', 'kind', 'attention', 'summary', 'items',
    ...optional, ...versionFields, 'blocksConversation', 'authorizesDesignWrite',
  ], '$')
  if (advisory.schemaVersion !== 1 && advisory.schemaVersion !== 2) throw new Error('$.schemaVersion: expected 1 or 2')
  if (advisory.kind !== 'reminder' && advisory.kind !== 'suggestion') throw new Error('$.kind: expected reminder or suggestion')
  if (advisory.attention !== 'next-boundary' && advisory.attention !== 'human-review') {
    throw new Error('$.attention: expected next-boundary or human-review')
  }
  if (advisory.blocksConversation !== false || advisory.authorizesDesignWrite !== false) {
    throw new Error('$: design advice must be non-blocking and must not authorize a Design write')
  }
  if (!Array.isArray(advisory.inputs) || advisory.inputs.length === 0 || advisory.inputs.length > MAX_INPUTS) {
    throw new Error(`$.inputs: expected 1 through ${MAX_INPUTS} pins`)
  }
  const inputs = advisory.inputs.map((candidate, index) => {
    const pin = record(candidate, `$.inputs[${index}]`)
    exact(pin, ['source', 'revision'], `$.inputs[${index}]`)
    return Object.freeze({
      source: portable(pin.source, `$.inputs[${index}].source`),
      revision: text(pin.revision, `$.inputs[${index}].revision`, 512),
    })
  }).sort((left, right) => left.source < right.source ? -1 : left.source > right.source ? 1 : 0)
  if (new Set(inputs.map((pin) => pin.source)).size !== inputs.length) throw new Error('$.inputs: duplicate sources are not allowed')
  if (!Array.isArray(advisory.items) || advisory.items.length > MAX_ITEMS) {
    throw new Error(`$.items: expected at most ${MAX_ITEMS} items`)
  }
  const items = advisory.items.map((candidate, index) => {
    const item = record(candidate, `$.items[${index}]`)
    const itemOptional = item.rationale === undefined ? [] : ['rationale']
    exact(item, ['id', 'title', 'detail', ...itemOptional, 'references'], `$.items[${index}]`)
    return Object.freeze({
      id: portable(item.id, `$.items[${index}].id`),
      title: text(item.title, `$.items[${index}].title`, 512),
      detail: text(item.detail, `$.items[${index}].detail`),
      ...(item.rationale === undefined ? {} : { rationale: text(item.rationale, `$.items[${index}].rationale`) }),
      references: stringList(item.references, `$.items[${index}].references`, MAX_REFERENCES),
    })
  })
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error('$.items: duplicate ids are not allowed')
  if (advisory.attention === 'human-review' && advisory.acceptanceInstruction === undefined) {
    throw new Error('$.acceptanceInstruction: required for human-review advice')
  }
  if (advisory.attention === 'next-boundary' && advisory.acceptanceInstruction !== undefined) {
    throw new Error('$.acceptanceInstruction: only human-review advice may carry an acceptance instruction')
  }
  return Object.freeze({
    schemaVersion: advisory.schemaVersion,
    id: DesignAdvisoryId(portable(advisory.id, '$.id')),
    profile: DesignAdvisoryProfileId(text(advisory.profile, '$.profile', 256)),
    resultRef: portable(advisory.resultRef, '$.resultRef'),
    inputs: Object.freeze(inputs),
    kind: advisory.kind,
    attention: advisory.attention,
    summary: text(advisory.summary, '$.summary'),
    items: Object.freeze(items),
    ...(advisory.acceptanceInstruction === undefined
      ? {}
      : { acceptanceInstruction: text(advisory.acceptanceInstruction, '$.acceptanceInstruction') }),
    ...(advisory.schemaVersion === 2 ? { actionSpec: parseActionSpec(advisory.actionSpec) } : {}),
    blocksConversation: false,
    authorizesDesignWrite: false,
  }) as DesignAdvisory
}

/**
 * Render the bounded model-facing reminder shared by host adapters.
 * @param advisory - validated advisory.
 * @returns plain text suitable for a source-attributed context message.
 */
export function renderDesignAdvisoryReminder(advisory: DesignAdvisory): string {
  const escape = (value: string): string => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
  const lines = [
    `<design-system-reminder profile="${advisory.profile}" advisory="${advisory.id}">`,
    escape(advisory.summary),
  ]
  for (const item of advisory.items) {
    lines.push(`- ${escape(item.title)}: ${escape(item.detail)}`)
  }
  if (advisory.attention === 'human-review') {
    lines.push('A human review request is available. Do not treat it as accepted until the user explicitly accepts it.')
  }
  lines.push('This is advice only. Do not treat it as authority to modify Design Files.', '</design-system-reminder>')
  return lines.join('\n')
}
