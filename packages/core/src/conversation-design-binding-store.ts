/** Durable host-neutral association between one host conversation and one Design Project. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { DesignProjectId, type DesignProjectId as DesignProjectIdType } from './design-project.ts'

/** Current persisted conversation-binding format. */
export const CONVERSATION_DESIGN_BINDING_SCHEMA_VERSION = 1 as const

/** Opaque identity of a host family, such as a CLI or web agent host. */
export type DesignHostKind = Branded<'DesignHostKind'>

/** Opaque identity of one installation or deployment of a host family. */
export type DesignHostInstanceId = Branded<'DesignHostInstanceId'>

/** Opaque host-owned conversation identity. */
export type DesignConversationId = Branded<'DesignConversationId'>

/** Complete host identity for one conversation. */
export interface ConversationDesignBindingKey {
  readonly hostKind: DesignHostKind
  readonly hostInstanceId: DesignHostInstanceId
  readonly conversationId: DesignConversationId
}

/** Current binding, including an unbound tombstone used to preserve CAS history. */
export interface ConversationDesignBinding {
  readonly schemaVersion: typeof CONVERSATION_DESIGN_BINDING_SCHEMA_VERSION
  readonly key: ConversationDesignBindingKey
  readonly revision: number
  readonly projectId: DesignProjectIdType | null
}

/** Store configuration rooted in plugin-owned durable state. */
export interface ConversationDesignBindingStoreOptions {
  readonly root: string
}

interface PersistedConversationDesignBinding extends ConversationDesignBinding {
  readonly revision: number
}

const HOST_KIND_MAX_BYTES = 128
const HOST_INSTANCE_MAX_BYTES = 512
const CONVERSATION_MAX_BYTES = 1_024

/** Failed compare-and-set caused by a caller observing an older revision. */
export class ConversationDesignBindingRevisionMismatchError extends Error {
  readonly expected: number
  readonly actual: number

  /**
   * Describe one rejected compare-and-set.
   * @param expected - revision supplied by the caller.
   * @param actual - revision currently persisted for the conversation.
   */
  constructor(expected: number, actual: number) {
    super(`conversation design binding store: expected revision ${expected}, actual revision ${actual}`)
    this.name = 'ConversationDesignBindingRevisionMismatchError'
    this.expected = expected
    this.actual = actual
  }
}

function opaqueId(value: string, name: string, maxBytes: number): string {
  if (value === '' || Buffer.byteLength(value, 'utf8') > maxBytes || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`conversation design binding store: ${name} must be bounded non-empty text without control characters`)
  }
  return value
}

/**
 * Validate and brand a host-family identity.
 * @param value - opaque host-family text.
 * @returns the validated identity.
 */
export function DesignHostKind(value: string): DesignHostKind {
  return opaqueId(value, 'hostKind', HOST_KIND_MAX_BYTES) as DesignHostKind
}

/**
 * Validate and brand one host-installation identity.
 * @param value - opaque installation or deployment text.
 * @returns the validated identity.
 */
export function DesignHostInstanceId(value: string): DesignHostInstanceId {
  return opaqueId(value, 'hostInstanceId', HOST_INSTANCE_MAX_BYTES) as DesignHostInstanceId
}

/**
 * Validate and brand one host-owned conversation identity.
 * @param value - opaque conversation text.
 * @returns the validated identity.
 */
export function DesignConversationId(value: string): DesignConversationId {
  return opaqueId(value, 'conversationId', CONVERSATION_MAX_BYTES) as DesignConversationId
}

/**
 * Construct one validated host-neutral conversation key.
 * @param input - opaque host and conversation identities.
 * @returns an immutable validated key.
 */
export function conversationDesignBindingKey(input: {
  readonly hostKind: string
  readonly hostInstanceId: string
  readonly conversationId: string
}): ConversationDesignBindingKey {
  return Object.freeze({
    hostKind: DesignHostKind(input.hostKind),
    hostInstanceId: DesignHostInstanceId(input.hostInstanceId),
    conversationId: DesignConversationId(input.conversationId),
  })
}

function plainRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path}: expected an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
  const missing = expected.filter(key => !Object.hasOwn(value, key))
  const extra = Object.keys(value).filter(key => !expected.includes(key))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`${path}: invalid fields (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`)
  }
}

function parseRevision(value: unknown, path: string, allowZero: boolean): number {
  const minimum = allowZero ? 0 : 1
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${path}: expected a safe integer greater than or equal to ${minimum}`)
  }
  return value as number
}

function sameKey(left: ConversationDesignBindingKey, right: ConversationDesignBindingKey): boolean {
  return left.hostKind === right.hostKind
    && left.hostInstanceId === right.hostInstanceId
    && left.conversationId === right.conversationId
}

function parsePersistedBinding(value: unknown, expectedKey: ConversationDesignBindingKey): PersistedConversationDesignBinding {
  const document = plainRecord(value, 'conversation design binding')
  exactKeys(document, ['schemaVersion', 'key', 'revision', 'projectId'], 'conversation design binding')
  if (document.schemaVersion !== CONVERSATION_DESIGN_BINDING_SCHEMA_VERSION) {
    throw new Error(`conversation design binding: unsupported schema ${JSON.stringify(document.schemaVersion)}`)
  }
  const rawKey = plainRecord(document.key, 'conversation design binding.key')
  exactKeys(rawKey, ['hostKind', 'hostInstanceId', 'conversationId'], 'conversation design binding.key')
  if (typeof rawKey.hostKind !== 'string'
    || typeof rawKey.hostInstanceId !== 'string'
    || typeof rawKey.conversationId !== 'string') {
    throw new Error('conversation design binding.key: identities must be strings')
  }
  const key = conversationDesignBindingKey({
    hostKind: rawKey.hostKind,
    hostInstanceId: rawKey.hostInstanceId,
    conversationId: rawKey.conversationId,
  })
  if (!sameKey(key, expectedKey)) throw new Error('conversation design binding: persisted key does not match its storage identity')
  let projectId: DesignProjectIdType | null
  if (document.projectId === null) projectId = null
  else if (typeof document.projectId === 'string') projectId = DesignProjectId(document.projectId)
  else throw new Error('conversation design binding.projectId: expected a Design Project id or null')
  return Object.freeze({
    schemaVersion: CONVERSATION_DESIGN_BINDING_SCHEMA_VERSION,
    key,
    revision: parseRevision(document.revision, 'conversation design binding.revision', false),
    projectId,
  })
}

function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${path}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function keyIdentity(key: ConversationDesignBindingKey): string {
  return JSON.stringify([key.hostKind, key.hostInstanceId, key.conversationId])
}

function bindingText(binding: ConversationDesignBinding): string {
  return `${JSON.stringify(binding, null, 2)}\n`
}

/**
 * Plugin-owned durable association store independent of any host session-log format.
 *
 * Reads and compare-and-set writes are serialized per conversation within one
 * store instance. Separate processes require an external single-writer owner.
 * Unbinding persists a tombstone so a later bind cannot reuse an earlier
 * revision. The root must be plugin state, never a path inferred from a host's
 * current working directory.
 */
export class ConversationDesignBindingStore {
  readonly root: string
  private readonly queues = new Map<string, Promise<void>>()

  /**
   * Bind storage to an explicit absolute plugin-state root.
   * @param options - durable plugin-owned storage location.
   */
  constructor(options: ConversationDesignBindingStoreOptions) {
    if (options.root === '' || !isAbsolute(options.root)) {
      throw new Error(`conversation design binding store: root must be an absolute path: ${JSON.stringify(options.root)}`)
    }
    this.root = resolve(options.root)
  }

  /**
   * Read the exact current binding revision.
   * @param key - validated host-neutral conversation identity.
   * @returns revision zero and null before the first bind.
   */
  async read(key: ConversationDesignBindingKey): Promise<ConversationDesignBinding> {
    const validated = conversationDesignBindingKey(key)
    const identity = keyIdentity(validated)
    return this.enqueue(identity, () => this.readCurrent(validated, identity))
  }

  /**
   * Bind a newly created or opened Design Project using compare-and-set.
   * @param key - validated host-neutral conversation identity.
   * @param projectId - exact Design Project selected by the caller.
   * @param expectedRevision - revision returned by the caller's latest read.
   * @returns the persisted next revision.
   */
  async bind(
    key: ConversationDesignBindingKey,
    projectId: DesignProjectIdType,
    expectedRevision: number,
  ): Promise<ConversationDesignBinding> {
    const validatedKey = conversationDesignBindingKey(key)
    const validatedProjectId = DesignProjectId(projectId)
    const validatedRevision = parseRevision(expectedRevision, 'conversation design binding expectedRevision', true)
    const identity = keyIdentity(validatedKey)
    return this.enqueue(identity, async () => {
      const current = await this.readCurrent(validatedKey, identity)
      this.requireRevision(validatedRevision, current.revision)
      return this.writeNext(validatedKey, identity, current.revision + 1, validatedProjectId)
    })
  }

  /**
   * Close the active Design Project association using compare-and-set.
   * @param key - validated host-neutral conversation identity.
   * @param expectedRevision - revision returned by the caller's latest read.
   * @returns the persisted unbound tombstone revision.
   */
  async unbind(key: ConversationDesignBindingKey, expectedRevision: number): Promise<ConversationDesignBinding> {
    const validatedKey = conversationDesignBindingKey(key)
    const validatedRevision = parseRevision(expectedRevision, 'conversation design binding expectedRevision', true)
    const identity = keyIdentity(validatedKey)
    return this.enqueue(identity, async () => {
      const current = await this.readCurrent(validatedKey, identity)
      this.requireRevision(validatedRevision, current.revision)
      return this.writeNext(validatedKey, identity, current.revision + 1, null)
    })
  }

  private requireRevision(expected: number, actual: number): void {
    if (expected !== actual) throw new ConversationDesignBindingRevisionMismatchError(expected, actual)
  }

  private fileFor(identity: string): string {
    return join(this.root, `${createHash('sha256').update(identity).digest('hex')}.json`)
  }

  private async readCurrent(key: ConversationDesignBindingKey, identity: string): Promise<ConversationDesignBinding> {
    const path = this.fileFor(identity)
    try {
      return parsePersistedBinding(parseJson(await readFile(path, 'utf8'), path), key)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return Object.freeze({
        schemaVersion: CONVERSATION_DESIGN_BINDING_SCHEMA_VERSION,
        key,
        revision: 0,
        projectId: null,
      })
    }
  }

  private async writeNext(
    key: ConversationDesignBindingKey,
    identity: string,
    revision: number,
    projectId: DesignProjectIdType | null,
  ): Promise<ConversationDesignBinding> {
    const binding = Object.freeze({
      schemaVersion: CONVERSATION_DESIGN_BINDING_SCHEMA_VERSION,
      key,
      revision,
      projectId,
    })
    await mkdir(this.root, { recursive: true })
    const target = this.fileFor(identity)
    const temp = join(this.root, `.conversation-design-binding-${randomUUID()}.tmp`)
    try {
      await writeFile(temp, bindingText(binding), { encoding: 'utf8', flag: 'wx' })
      await rename(temp, target)
    } finally {
      await rm(temp, { force: true })
    }
    return binding
  }

  private enqueue<T>(identity: string, operation: () => Promise<T>): Promise<T> {
    const preceding = this.queues.get(identity) ?? Promise.resolve()
    const result = preceding.then(operation, operation)
    const tail = result.then(() => undefined, () => undefined)
    this.queues.set(identity, tail)
    void tail.then(() => {
      if (this.queues.get(identity) === tail) this.queues.delete(identity)
    })
    return result
  }
}
