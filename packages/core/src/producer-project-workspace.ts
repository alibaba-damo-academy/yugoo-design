/** Project-wide committed reads and an invocation-local Bundle workspace for a Producer. */
import type {
  DesignDriverId,
  DesignProducerPublicationSnapshot,
  DesignValidationDriver,
  PreparedDesignProducerPublication,
  PreparedDesignWrite,
} from './runtime-drivers.ts'
import {
  DESIGN_FILES_UNBORN_REVISION,
  DesignWriteSettlementError,
  requireDesignFileRelativePath,
  type DesignWriteEvent,
  type DesignWriteOptions,
  type DesignWriteResult,
} from './design-files.ts'
import type { GitHistoryEntry } from './git.ts'
import { validatorFromSchemaYaml } from './schema.ts'
import type { DesignSkill } from './types.ts'
import { validateSkillDesign, type ValidationIssue } from './validate-design.ts'

/** Validation intent of one explicit producer publication. */
export type ProducerPublicationMode = 'in_progress' | 'complete'

/** Lifecycle meaning recorded for one validated producer publication. */
export type ProducerPublicationPurpose = 'handoff' | 'complete'

/** Store surface needed by a project-wide producer workspace. */
export interface ProducerProjectWorkspaceStore {
  /** Atomically validate and commit one canonical state write. */
  write(skill: string, state: unknown, options: DesignWriteOptions): Promise<DesignWriteResult>
  /** Latest committed Design Files revision, or undefined for an empty repository. */
  head(signal?: AbortSignal): Promise<string | undefined>
  /** Auxiliary project records may advance HEAD without changing Design evidence. */
  sameDesignEvidenceAt?(left: string, right: string, signal?: AbortSignal): Promise<boolean>
  /** Verify that an exact revision is reachable from another exact revision. */
  isAncestor?(ancestor: string, descendant: string, signal?: AbortSignal): Promise<boolean>
  /** Read one file at an exact committed revision; undefined when absent there. */
  readTextAt(commit: string, relativePath: string, signal?: AbortSignal): Promise<string | undefined>
  /** List every file path at an exact committed revision. */
  listPathsAt(commit: string, signal?: AbortSignal): Promise<readonly string[]>
  /** List files present in the filesystem worktree. */
  listWorktreePaths?(signal?: AbortSignal): Promise<readonly string[]>
  /** Read UTF-8 content from the filesystem worktree. */
  readWorktreeText?(relativePath: string): Promise<string | undefined>
  /** Read byte-exact content from the filesystem worktree. */
  readWorktreeBytes?(relativePath: string): Promise<Uint8Array | undefined>
  /** Persist UTF-8 content in the filesystem worktree. */
  writeWorktreeText?(relativePath: string, content: string): Promise<void>
  /** Persist byte-exact content in the filesystem worktree. */
  writeWorktreeBytes?(relativePath: string, content: Uint8Array): Promise<void>
  /** Remove one file from the filesystem worktree. */
  removeWorktreeFile?(relativePath: string): Promise<void>
  /** Read one byte-exact file when the named revision is still current and clean. */
  readCurrentBytes(commit: string, relativePath: string, signal?: AbortSignal): Promise<Uint8Array | undefined>
  /** Compare candidate bytes with an exact committed blob. */
  matchesBytesAt?(commit: string, relativePath: string, content: Uint8Array, signal?: AbortSignal): Promise<boolean>
  /** Read a bounded newest-first history. */
  history(limit: number, path?: string, signal?: AbortSignal): Promise<readonly GitHistoryEntry[]>
  /** Read one exact committed diff. */
  diffBetween(from: string, to: string, path?: string, signal?: AbortSignal): Promise<string>
}

/** Dependencies bound to one producer invocation and selected Design Project. */
export interface ProducerProjectWorkspaceOptions {
  readonly store: ProducerProjectWorkspaceStore
  readonly signal: AbortSignal
  /** Bundle whose files this producer invocation may mutate. */
  readonly invocationSkill: DesignSkill
  readonly resolveSkill: (skillName: string) => DesignSkill | undefined
  readonly resolveValidationDriver?: (skill: DesignSkill, id: DesignDriverId) => DesignValidationDriver
  /** Mutation-time ownership policy contributed by the invocation Bundle. */
  readonly ownsPath: (path: string) => boolean
  /** Invocation identity stored with every terminal Producer publication commit. */
  readonly publicationInvocationId?: string
  /** Candidate-level validation applied before trusted publication preparation. */
  readonly validatePublication?: (input: DesignProducerPublicationSnapshot) => Promise<readonly string[]>
  /** Trusted Bundle-owned normalization and derived-artifact preparation before validation. */
  readonly preparePublication?: (input: DesignProducerPublicationSnapshot) => Promise<PreparedDesignProducerPublication>
  readonly settleEvent: (
    skillName: string,
    event: DesignWriteEvent,
    publication: Readonly<{
      readonly mode: ProducerPublicationMode
      readonly purpose: ProducerPublicationPurpose
    }>,
  ) => Promise<void>
  readonly withMutation: <T>(operation: () => Promise<T>) => Promise<T>
}

/** Result of one authoritative producer publication. */
export interface ProducerPublicationReceipt {
  readonly skill: string
  readonly mode: ProducerPublicationMode
  readonly stateRevision: string
  readonly state: Readonly<Record<string, unknown>>
  readonly indexMaintenance?: DesignWriteResult['indexMaintenance']
  readonly recovery?: DesignWriteResult['recovery']
}

/** Fresh comparison of WorkingCopy canonical state with its Published base. */
export type ProducerCanonicalPublishedMatch =
  | { readonly kind: 'equal' }
  | { readonly kind: 'different' }
  | { readonly kind: 'invalid'; readonly diagnostic: string }

/** Repairable validation failure that leaves the working copy open. */
export class ProducerWorkingCopyValidationError extends Error {
  readonly diagnostics: readonly ValidationIssue[]

  /**
   * Preserve model-readable diagnostics for the same producer loop.
   * @param diagnostics - issues the Producer can repair in its existing working copy.
   */
  constructor(diagnostics: readonly ValidationIssue[]) {
    super(`producer project workspace: working-copy validation failed: ${diagnostics.map(issue => issue.message).join('; ')}`)
    this.name = 'ProducerWorkingCopyValidationError'
    this.diagnostics = Object.freeze(diagnostics.map(issue => Object.freeze({ ...issue })))
  }
}

/** Optimistic publication/snapshot conflict against a newer project HEAD. */
export class ProducerWorkingCopyConflictError extends Error {
  readonly expectedHead: string
  readonly currentHead: string

  constructor(expectedHead: string, currentHead: string) {
    super(`producer project workspace: revision is stale: expected ${JSON.stringify(expectedHead)}, latest is ${JSON.stringify(currentHead)}`)
    this.name = 'ProducerWorkingCopyConflictError'
    this.expectedHead = expectedHead
    this.currentHead = currentHead
  }
}

/** Invocation-local mutable view of one Bundle over an exact committed revision. */
export interface ProducerBundleWorkingCopy {
  readonly skill: string
  readonly baseRevision: string
  /** List the working copy's final paths after applying its overlay. */
  list(): Promise<readonly string[]>
  /** Read working-copy text, preferring the overlay over the base revision. */
  readText(path: string): Promise<string | undefined>
  /** Read working-copy bytes, preferring the overlay over the base revision. */
  readBytes(path: string): Promise<Uint8Array | undefined>
  /** Compare the currently-read canonical JSON value with the Published base. */
  canonicalMatchesBase(): Promise<ProducerCanonicalPublishedMatch>
  /** Compare canonical bytes captured from this WorkingCopy with its Published base. */
  canonicalContentMatchesBase(content: Uint8Array | undefined): Promise<ProducerCanonicalPublishedMatch>
  /** Compare one currently-read path with the Published base using path identity rules. */
  pathMatchesBase(path: string): Promise<boolean>
  /** Replace one working-copy file with UTF-8 text. */
  writeText(path: string, content: string): Promise<void>
  /** Replace one working-copy file with byte-exact content. */
  writeBytes(path: string, content: Uint8Array): Promise<void>
  /** Remove one file from the working copy's final path set. */
  remove(path: string): Promise<void>
  /** Move one existing file inside the filesystem worktree. */
  move(from: string, to: string): Promise<void>
  /** Replace the complete Bundle-owned WorkingCopy snapshot after preflighting ownership. */
  replaceSnapshot(snapshot: ReadonlyMap<string, Uint8Array>): Promise<void>
  /** Validate the current working copy without writing Git or settling an event. */
  validate(mode: ProducerPublicationMode): Promise<readonly ValidationIssue[]>
  /** Validate and publish the Bundle state for one explicit lifecycle purpose. */
  publish(mode: ProducerPublicationMode, purpose: ProducerPublicationPurpose): Promise<ProducerPublicationReceipt>
  /** Retry only committed follow-up facts; never reopen content mutation authority. */
  recoverPublication(mode: ProducerPublicationMode, purpose: ProducerPublicationPurpose): Promise<ProducerPublicationReceipt>
  /** Close and forget this invocation-local working copy. */
  discard(): void
}

type WorkingCopyContent = string | Uint8Array

interface ProducerWorkingCopyHost {
  readonly store: ProducerProjectWorkspaceStore
  readonly signal: AbortSignal
  readonly resolveSkill: ProducerProjectWorkspaceOptions['resolveSkill']
  readonly resolveValidationDriver: ProducerProjectWorkspaceOptions['resolveValidationDriver']
  readonly ownsPath: ProducerProjectWorkspaceOptions['ownsPath']
  readonly publicationInvocationId: ProducerProjectWorkspaceOptions['publicationInvocationId']
  readonly validatePublication: ProducerProjectWorkspaceOptions['validatePublication']
  readonly preparePublication: ProducerProjectWorkspaceOptions['preparePublication']
  readonly settleEvent: ProducerProjectWorkspaceOptions['settleEvent']
  readonly withMutation: ProducerProjectWorkspaceOptions['withMutation']
  readonly acceptRevision: (revision: string) => void
}

function requirePlainState(value: unknown, skill: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error(`producer project workspace: ${skill} canonical state must be a JSON object`)
  }
  return value as Record<string, unknown>
}

function canonicalJsonValue(value: unknown, path: string): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path}: numbers must be finite`)
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error(`${path}: integers must be within the safe integer range`)
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }
  if (Array.isArray(value)) return `[${value.map((item, index) => canonicalJsonValue(item, `${path}[${index}]`)).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const record = value as Readonly<Record<string, unknown>>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJsonValue(record[key], `${path}.${key}`)}`).join(',')}}`
  }
  throw new Error(`${path}: value is not JSON`)
}

function canonicalStateFromText(text: string, label: string):
  | { readonly ok: true; readonly key: string }
  | { readonly ok: false; readonly diagnostic: string } {
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch (error) {
    return { ok: false, diagnostic: `${label}: invalid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, diagnostic: `${label}: canonical state must be a JSON object` }
  }
  try {
    return { ok: true, key: canonicalJsonValue(value, label) }
  } catch (error) {
    return { ok: false, diagnostic: error instanceof Error ? error.message : String(error) }
  }
}

function canonicalStateFromBytes(content: Uint8Array | undefined, label: string):
  | { readonly ok: true; readonly key: string }
  | { readonly ok: false; readonly diagnostic: string } {
  if (content === undefined) return { ok: false, diagnostic: `${label}: canonical state is absent` }
  try {
    return canonicalStateFromText(new TextDecoder('utf-8', { fatal: true }).decode(content), label)
  } catch (error) {
    return { ok: false, diagnostic: `${label}: invalid UTF-8: ${error instanceof Error ? error.message : String(error)}` }
  }
}

function requireBundlePath(skill: string, path: string): void {
  requireDesignFileRelativePath(path)
  if (!path.startsWith(`${skill}/`)) {
    throw new Error(`producer project workspace: path ${JSON.stringify(path)} is outside Bundle ${JSON.stringify(skill)}`)
  }
}

function cloneContent(content: WorkingCopyContent): WorkingCopyContent {
  return typeof content === 'string' ? content : Uint8Array.from(content)
}

function decodeWorkingCopyContent(content: Uint8Array): WorkingCopyContent {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content)
  } catch {
    return Uint8Array.from(content)
  }
}

class BundleWorkingCopy implements ProducerBundleWorkingCopy {
  readonly skill: string
  readonly baseRevision: string
  private readonly host: ProducerWorkingCopyHost
  private readonly definition: DesignSkill
  private readonly persistWorktree: boolean
  private readonly overlay = new Map<string, WorkingCopyContent | undefined>()
  private open = true
  private committedPublication?: {
    mode: ProducerPublicationMode
    purpose: ProducerPublicationPurpose
    result: DesignWriteResult
  }
  private replayPublication?: () => Promise<DesignWriteResult>

  constructor(host: ProducerWorkingCopyHost, definition: DesignSkill, baseRevision: string, persistWorktree = true) {
    this.host = host
    this.definition = definition
    this.skill = definition.name
    this.baseRevision = baseRevision
    this.persistWorktree = persistWorktree
  }

  private requireOpen(): void {
    if (!this.open) throw new Error('producer project workspace: working copy is closed')
    this.host.signal.throwIfAborted()
  }

  private canonicalPath(): string {
    return `${this.skill}/${this.skill}.json`
  }

  /** Real DSH workspaces persist every file mutation immediately. */
  private usesFilesystemWorktree(): boolean {
    return this.persistWorktree
      && this.host.store.listWorktreePaths !== undefined
      && this.host.store.readWorktreeText !== undefined
      && this.host.store.readWorktreeBytes !== undefined
      && this.host.store.writeWorktreeText !== undefined
      && this.host.store.writeWorktreeBytes !== undefined
      && this.host.store.removeWorktreeFile !== undefined
  }

  private requireOwnedPath(path: string): void {
    requireBundlePath(this.skill, path)
    if (!this.host.ownsPath(path)) {
      throw new Error(`producer project workspace: path ${JSON.stringify(path)} is not owned by Bundle ${JSON.stringify(this.skill)}`)
    }
  }

  async list(): Promise<readonly string[]> {
    this.requireOpen()
    if (this.usesFilesystemWorktree()) {
      return Object.freeze((await this.host.store.listWorktreePaths!(this.host.signal))
        .filter(path => path.startsWith(`${this.skill}/`))
        .sort())
    }
    const paths = new Set((await (this.host.store.listWorktreePaths?.(this.host.signal)
      ?? this.host.store.listPathsAt(this.baseRevision, this.host.signal)))
      .filter(path => path.startsWith(`${this.skill}/`)))
    for (const [path, content] of this.overlay) {
      if (content === undefined) paths.delete(path)
      else paths.add(path)
    }
    return Object.freeze([...paths].sort())
  }

  async readText(path: string): Promise<string | undefined> {
    this.requireOpen()
    requireBundlePath(this.skill, path)
    if (this.usesFilesystemWorktree()) return this.host.store.readWorktreeText!(path)
    if (this.overlay.has(path)) {
      const content = this.overlay.get(path)
      if (content === undefined) return undefined
      return typeof content === 'string' ? content : Buffer.from(content).toString('utf8')
    }
    return this.host.store.readWorktreeText?.(path)
      ?? this.host.store.readTextAt(this.baseRevision, path, this.host.signal)
  }

  async readBytes(path: string): Promise<Uint8Array | undefined> {
    this.requireOpen()
    requireBundlePath(this.skill, path)
    if (this.usesFilesystemWorktree()) return this.host.store.readWorktreeBytes!(path)
    if (this.overlay.has(path)) {
      const content = this.overlay.get(path)
      if (content === undefined) return undefined
      return typeof content === 'string' ? Buffer.from(content, 'utf8') : Uint8Array.from(content)
    }
    return this.host.store.readWorktreeBytes?.(path)
      ?? this.host.store.readCurrentBytes(this.baseRevision, path, this.host.signal)
  }

  async canonicalMatchesBase(): Promise<ProducerCanonicalPublishedMatch> {
    this.requireOpen()
    const path = this.canonicalPath()
    const candidate = await this.readBytes(path)
    if (candidate === undefined) return { kind: 'invalid', diagnostic: `Worktree ${path}: canonical state is absent` }
    return this.canonicalContentMatchesBase(candidate)
  }

  async canonicalContentMatchesBase(content: Uint8Array | undefined): Promise<ProducerCanonicalPublishedMatch> {
    this.requireOpen()
    const path = this.canonicalPath()
    const published = await this.host.store.readCurrentBytes(this.baseRevision, path, this.host.signal)
    const candidateState = canonicalStateFromBytes(content, `Worktree ${path}`)
    if (!candidateState.ok) return { kind: 'invalid', diagnostic: candidateState.diagnostic }
    const publishedState = canonicalStateFromBytes(published, `Published ${path}`)
    if (!publishedState.ok) return { kind: 'invalid', diagnostic: publishedState.diagnostic }
    return candidateState.key === publishedState.key ? { kind: 'equal' } : { kind: 'different' }
  }

  async pathMatchesBase(path: string): Promise<boolean> {
    this.requireOpen()
    requireBundlePath(this.skill, path)
    if (path === this.canonicalPath()) return (await this.canonicalMatchesBase()).kind === 'equal'
    const candidate = await this.readBytes(path)
    if (candidate === undefined) return false
    if (this.host.store.matchesBytesAt !== undefined) {
      return this.host.store.matchesBytesAt(this.baseRevision, path, candidate, this.host.signal)
    }
    const published = await this.host.store.readCurrentBytes(this.baseRevision, path, this.host.signal)
    return published !== undefined && Buffer.from(published).equals(Buffer.from(candidate))
  }

  async writeText(path: string, content: string): Promise<void> {
    this.requireOpen()
    this.requireOwnedPath(path)
    if (typeof content !== 'string') throw new Error('producer project workspace: text content must be a string')
    if (this.persistWorktree) await this.host.store.writeWorktreeText?.(path, content)
    this.overlay.set(path, content)
  }

  async writeBytes(path: string, content: Uint8Array): Promise<void> {
    this.requireOpen()
    this.requireOwnedPath(path)
    if (!(content instanceof Uint8Array)) throw new Error('producer project workspace: binary content must be bytes')
    if (this.persistWorktree) await this.host.store.writeWorktreeBytes?.(path, content)
    this.overlay.set(path, Uint8Array.from(content))
  }

  async remove(path: string): Promise<void> {
    this.requireOpen()
    this.requireOwnedPath(path)
    if (this.persistWorktree) await this.host.store.removeWorktreeFile?.(path)
    this.overlay.set(path, undefined)
  }

  async move(from: string, to: string): Promise<void> {
    this.requireOpen()
    this.requireOwnedPath(from)
    this.requireOwnedPath(to)
    if (from === to) return
    let content: WorkingCopyContent | undefined
    await this.host.withMutation(async () => {
      if (this.usesFilesystemWorktree()) {
        const current = await this.host.store.readWorktreeBytes!(from)
        content = current === undefined ? undefined : decodeWorkingCopyContent(current)
      } else if (this.overlay.has(from)) {
        const current = this.overlay.get(from)
        content = current === undefined ? undefined : cloneContent(current)
      } else {
        content = await this.readBytes(from)
      }
      if (content === undefined) throw new Error(`producer project workspace: move source is absent: ${from}`)
      if (this.persistWorktree) {
        if (typeof content === 'string') await this.host.store.writeWorktreeText?.(to, content)
        else await this.host.store.writeWorktreeBytes?.(to, content)
        await this.host.store.removeWorktreeFile?.(from)
      }
    })
    this.overlay.set(to, content)
    this.overlay.set(from, undefined)
  }

  async replaceSnapshot(snapshot: ReadonlyMap<string, Uint8Array>): Promise<void> {
    this.requireOpen()
    const desired = new Map<string, Uint8Array>()
    for (const [path, content] of snapshot) {
      this.requireOwnedPath(path)
      desired.set(path, Uint8Array.from(content))
    }
    const current = await this.list()
    for (const path of current) this.requireOwnedPath(path)
    for (const path of current) {
      if (!desired.has(path)) await this.remove(path)
    }
    for (const [path, content] of desired) await this.writeBytes(path, content)
  }

  private async changedPaths(): Promise<readonly string[]> {
    if (!this.usesFilesystemWorktree()) return Object.freeze([...this.overlay.keys()].sort())
    const prefix = `${this.skill}/`
    const basePaths = (await this.host.store.listPathsAt(this.baseRevision, this.host.signal))
      .filter(path => path.startsWith(prefix))
    const currentPaths = (await this.host.store.listWorktreePaths!(this.host.signal))
      .filter(path => path.startsWith(prefix))
    const changed: string[] = []
    for (const path of [...new Set([...basePaths, ...currentPaths])].sort()) {
      const before = await this.host.store.readCurrentBytes(this.baseRevision, path, this.host.signal)
      const after = await this.host.store.readWorktreeBytes!(path)
      const equal = before === undefined || after === undefined
        ? before === after
        : Buffer.from(before).equals(Buffer.from(after))
      if (!equal) changed.push(path)
    }
    return Object.freeze(changed)
  }

  private async stateResult(): Promise<
    { readonly ok: true; readonly state: Record<string, unknown> }
    | { readonly ok: false; readonly diagnostic: ValidationIssue }
  > {
    const text = await this.readText(this.canonicalPath())
    if (text === undefined) {
      return {
        ok: false,
        diagnostic: {
          code: 'canonical_state_missing',
          message: `Working copy must retain canonical state ${this.canonicalPath()}.`,
          repair_hint: 'Restore the invocation Bundle canonical JSON before validation or publication.',
        },
      }
    }
    let value: unknown
    try {
      value = JSON.parse(text) as unknown
    } catch (error) {
      return {
        ok: false,
        diagnostic: {
          code: 'canonical_json_invalid',
          message: `Invalid JSON in ${this.canonicalPath()}: ${error instanceof Error ? error.message : String(error)}`,
          repair_hint: 'Repair the canonical JSON syntax and validate the same working copy again.',
        },
      }
    }
    try {
      const state = requirePlainState(value, this.skill)
      canonicalJsonValue(state, this.canonicalPath())
      return { ok: true, state }
    } catch (error) {
      return {
        ok: false,
        diagnostic: {
          code: 'canonical_state_invalid',
          message: error instanceof Error ? error.message : String(error),
          repair_hint: 'Replace the canonical JSON root with an object and validate the same working copy again.',
        },
      }
    }
  }

  private async state(): Promise<Record<string, unknown>> {
    const result = await this.stateResult()
    if (!result.ok) throw new ProducerWorkingCopyValidationError([result.diagnostic])
    return result.state
  }

  private async artifactText(path: string): Promise<string | undefined> {
    requireDesignFileRelativePath(path)
    if (this.overlay.has(path)) {
      const content = this.overlay.get(path)
      if (content === undefined) return undefined
      return typeof content === 'string' ? content : content.byteLength === 0 ? '' : '<binary artifact>'
    }
    const bytes = await this.host.store.readCurrentBytes(this.baseRevision, path, this.host.signal)
    if (bytes === undefined) return undefined
    const content = decodeWorkingCopyContent(bytes)
    return typeof content === 'string' ? content : content.byteLength === 0 ? '' : '<binary artifact>'
  }

  private async prepared(mode: ProducerPublicationMode): Promise<PreparedDesignProducerPublication> {
    const state = await this.state()
    const canonicalPath = this.canonicalPath()
    const ownedArtifacts = (await this.list()).filter(path => path !== canonicalPath)
    const artifacts: Record<string, string | Uint8Array> = Object.create(null) as Record<string, string | Uint8Array>
    for (const path of ownedArtifacts) {
      const content = await this.readBytes(path)
      if (content === undefined) throw new Error(`producer project workspace: listed working-copy artifact is absent: ${path}`)
      artifacts[path] = decodeWorkingCopyContent(content)
    }
    const snapshot = Object.freeze({
      state,
      artifacts: Object.freeze(artifacts),
      ownedArtifacts,
      mode,
      baseRevision: this.baseRevision,
      changedPaths: await this.changedPaths(),
    })
    const integrationDiagnostics = await this.host.validatePublication?.(snapshot) ?? []
    if (integrationDiagnostics.length > 0) {
      throw new ProducerWorkingCopyValidationError(integrationDiagnostics.map(message => ({
        code: 'producer_candidate_invalid',
        message,
        repair_hint: 'Repair the canonical state or artifact in this same Producer working copy, then validate again.',
      })))
    }
    const prepared = this.host.preparePublication === undefined ? { write: snapshot } : await this.host.preparePublication(snapshot)
    const finalPaths = new Set([
      this.canonicalPath(),
      ...(prepared.write.ownedArtifacts ?? []),
      ...Object.keys(prepared.write.artifacts ?? {}),
    ])
    const unowned = [...finalPaths].filter(path => !this.host.ownsPath(path))
    if (unowned.length > 0) {
      throw new Error(`producer project workspace: prepared publication contains unowned paths: ${unowned.join(', ')}`)
    }
    return prepared
  }

  private async validatePrepared(
    mode: ProducerPublicationMode,
    write: PreparedDesignWrite,
    readCommittedArtifact: (path: string) => Promise<string | undefined> = path => this.artifactText(path),
  ): Promise<readonly ValidationIssue[]> {
    const resolveValidationDriver = this.host.resolveValidationDriver
    return Object.freeze(await validateSkillDesign(this.definition, write.state, {
      scopes: mode === 'complete' ? ['state', 'completion'] : ['state'],
      artifactText: path => {
        if (write.artifacts !== undefined && Object.hasOwn(write.artifacts, path)) {
          const content = write.artifacts[path]
          return Promise.resolve(typeof content === 'string' ? content : content.byteLength === 0 ? '' : '<binary artifact>')
        }
        if (write.ownedArtifacts !== undefined
          && path.startsWith(`${this.skill}/`)
          && path !== this.canonicalPath()
          && !write.ownedArtifacts.includes(path)) return Promise.resolve(undefined)
        return readCommittedArtifact(path)
      },
      ...(resolveValidationDriver === undefined ? {} : {
        resolveValidationDriver: id => resolveValidationDriver(this.definition, id),
      }),
    }))
  }

  async validate(mode: ProducerPublicationMode): Promise<readonly ValidationIssue[]> {
    this.requireOpen()
    const stateResult = await this.stateResult()
    if (!stateResult.ok) return Object.freeze([Object.freeze({ ...stateResult.diagnostic })])
    try {
      return this.validatePrepared(mode, (await this.prepared(mode)).write)
    } catch (error) {
      if (error instanceof ProducerWorkingCopyValidationError) return error.diagnostics
      throw error
    }
  }

  async publish(mode: ProducerPublicationMode, purpose: ProducerPublicationPurpose): Promise<ProducerPublicationReceipt> {
    this.requireOpen()
    if ((mode === 'complete') !== (purpose === 'complete')) {
      throw new Error(`producer project workspace: publication mode ${JSON.stringify(mode)} does not match purpose ${JSON.stringify(purpose)}`)
    }
    let result: DesignWriteResult
    try {
      result = await this.host.withMutation(async () => {
        const loaded = this.host.resolveSkill(this.skill)
        if (loaded === undefined || loaded.version !== this.definition.version) {
          throw new Error(
            `producer project workspace: Bundle ${JSON.stringify(this.skill)} version ${JSON.stringify(this.definition.version)} is no longer loaded`,
          )
        }
        const requireBaseRevision = async (): Promise<void> => {
          const head = (await this.host.store.head(this.host.signal)) ?? DESIGN_FILES_UNBORN_REVISION
          if (head !== this.baseRevision && !await this.host.store.sameDesignEvidenceAt?.(this.baseRevision, head, this.host.signal)) {
            throw new ProducerWorkingCopyConflictError(this.baseRevision, head)
          }
        }
        await requireBaseRevision()
        // Capture, prepare, validate, and publish under one project mutation
        // boundary. No later DSH file write can be silently overwritten while
        // preparation is still running.
        const prepared = await this.prepared(mode)
        const diagnostics = await this.validatePrepared(mode, prepared.write)
        if (diagnostics.length > 0) throw new ProducerWorkingCopyValidationError(diagnostics)
        const changed = await this.hasChanges(prepared.write)
        const sourceDiagnostics = await this.validatePrepared(
          mode,
          prepared.write,
          path => this.host.store.readTextAt(this.baseRevision, path, this.host.signal),
        )
        if (sourceDiagnostics.length > 0) throw new ProducerWorkingCopyValidationError(sourceDiagnostics)
        await prepared.revalidate?.()
        await requireBaseRevision()
        if (!changed && this.host.publicationInvocationId === undefined) {
          await this.host.settleEvent(this.skill, { state: prepared.write.state, commit: this.baseRevision }, { mode, purpose })
          return { state: prepared.write.state, commit: this.baseRevision, diff: '' }
        }
        const schemaYaml = this.definition.metadata?.schemaYaml
        const validate = typeof schemaYaml === 'string' ? validatorFromSchemaYaml(schemaYaml) : undefined
        // Retain immutable accepted inputs, not a later read of the working
        // tree, for a post-commit follow-up retry in this same invocation.
        const state = structuredClone(prepared.write.state)
        const options: DesignWriteOptions = {
          origin: 'agent',
          signal: this.host.signal,
          // A normal Producer works directly in the filesystem worktree. The
          // trusted preparation step may normalize canonical JSON or derive
          // artifacts, so publication writes those exact prepared bytes back
          // to that same worktree before committing them.
          syncPreparedBytesToWorktree: this.persistWorktree,
          expectedHead: this.baseRevision,
          ...(this.host.publicationInvocationId === undefined ? {} : {
            publication: {
              skill: this.skill,
              bundleVersion: this.definition.version,
              invocationId: this.host.publicationInvocationId,
              stateStatus: mode === 'complete' ? 'complete' : 'pending',
              handoff: purpose === 'handoff' ? this.definition.execution.handoff : 'none',
              ...(purpose === 'complete' ? { outcome: 'complete' as const }
                : purpose === 'handoff' ? { outcome: 'pause' as const }
                  : {}),
              change: changed ? 'changed' as const : 'unchanged' as const,
            },
          }),
          ...(validate === undefined ? {} : { validate }),
          ...(prepared.write.artifacts === undefined ? {} : { artifacts: Object.fromEntries(
            Object.entries(prepared.write.artifacts).map(([path, content]) => [path,
              typeof content === 'string' ? content : new Uint8Array(content)]),
          ) }),
          ...(prepared.write.ownedArtifacts === undefined ? {} : { ownedArtifacts: [...prepared.write.ownedArtifacts] }),
          settleEvent: event => this.host.settleEvent(this.skill, event, { mode, purpose }),
        }
        this.replayPublication = this.host.publicationInvocationId === undefined ? undefined
          : () => this.host.store.write(this.skill, state, { ...options, syncPreparedBytesToWorktree: false })
        return this.host.store.write(this.skill, state, options)
      })
    } catch (error) {
      if (!(error instanceof DesignWriteSettlementError) || error.result.commit === undefined) throw error
      // Git Published is the durable authority. A Journal/projection failure
      // cannot revoke that commit or make the Producer report a false failure.
      result = error.result
    }
    this.open = false
    const stateRevision = result.commit ?? this.baseRevision
    this.host.acceptRevision(stateRevision)
    this.committedPublication = { mode, purpose, result }
    return this.publicationReceipt(mode, result)
  }

  private publicationReceipt(mode: ProducerPublicationMode, result: DesignWriteResult): ProducerPublicationReceipt {
    return Object.freeze({
      skill: this.skill,
      mode,
      stateRevision: result.commit ?? this.baseRevision,
      state: structuredClone(result.state),
      ...(result.indexMaintenance === undefined ? {} : { indexMaintenance: result.indexMaintenance }),
      ...(result.recovery === undefined ? {} : { recovery: result.recovery }),
    })
  }

  async recoverPublication(mode: ProducerPublicationMode, purpose: ProducerPublicationPurpose): Promise<ProducerPublicationReceipt> {
    const published = this.committedPublication
    if (published === undefined) throw new Error('producer project workspace: no committed publication to recover')
    if (mode !== published.mode || purpose !== published.purpose) {
      throw new Error('producer project workspace: committed publication cannot change its outcome')
    }
    const recovery = published.result.recovery
    if (recovery === undefined) return this.publicationReceipt(mode, published.result)
    try {
      const result = await this.host.withMutation(async () => {
        this.host.signal.throwIfAborted()
        const loaded = this.host.resolveSkill(this.skill)
        if (loaded?.version !== this.definition.version) throw new Error('committed publication Bundle version is no longer loaded')
        const head = await this.host.store.head(this.host.signal)
        if (head !== published.result.commit && (!head || !published.result.commit
          || !await this.host.store.sameDesignEvidenceAt?.(published.result.commit, head, this.host.signal)))
          throw new Error('committed publication recovery is stale; newer project state is preserved')
        if (this.replayPublication === undefined) throw new Error('committed publication has no replay identity')
        return this.replayPublication()
      })
      published.result = { ...result,
        ...(published.result.indexMaintenance === undefined ? {} : { indexMaintenance: published.result.indexMaintenance }),
      }
    } catch (error) {
      // Follow-up failure is still a committed result, never a new write or
      // failed-content audit. Leave the exact receipt available for recovery.
      const pending = error instanceof DesignWriteSettlementError ? error.result : {
        ...published.result,
        recovery: { ...recovery, message: (error instanceof Error ? error.message : String(error)).slice(0, 2048) },
      }
      published.result = { ...pending,
        ...(published.result.indexMaintenance === undefined ? {} : { indexMaintenance: published.result.indexMaintenance }),
      }
    }
    return this.publicationReceipt(mode, published.result)
  }

  private async hasChanges(write: PreparedDesignWrite): Promise<boolean> {
    const canonicalPath = this.canonicalPath()
    const committedCanonical = await this.host.store.readTextAt(this.baseRevision, canonicalPath, this.host.signal)
    const preparedState = canonicalStateFromText(JSON.stringify(write.state), `Prepared ${canonicalPath}`)
    const publishedState = committedCanonical === undefined
      ? { ok: false as const, diagnostic: `Published ${canonicalPath}: canonical state is absent` }
      : canonicalStateFromText(committedCanonical, `Published ${canonicalPath}`)
    if (!preparedState.ok || !publishedState.ok || preparedState.key !== publishedState.key) return true
    const owned = write.ownedArtifacts ?? []
    const committedOwned = (await this.host.store.listPathsAt(this.baseRevision, this.host.signal))
      .filter(path => path.startsWith(`${this.skill}/`) && path !== canonicalPath)
    if (JSON.stringify([...owned].sort()) !== JSON.stringify(committedOwned.sort())) return true
    for (const [path, content] of Object.entries(write.artifacts ?? {})) {
      const candidate = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
      if (this.host.store.matchesBytesAt !== undefined) {
        if (!await this.host.store.matchesBytesAt(this.baseRevision, path, candidate, this.host.signal)) return true
      } else {
        const committed = await this.host.store.readCurrentBytes(this.baseRevision, path, this.host.signal)
        if (committed === undefined || !Buffer.from(committed).equals(Buffer.from(candidate))) return true
      }
    }
    return false
  }

  discard(): void {
    this.open = false
    this.overlay.clear()
    this.committedPublication = undefined
    this.replayPublication = undefined
  }
}

/** Selected-project workspace shared by one long-lived producer invocation. */
export class ProducerProjectWorkspace {
  private readonly store: ProducerProjectWorkspaceStore
  private readonly signal: AbortSignal
  private readonly invocationSkill: DesignSkill
  private readonly workingCopyHost: ProducerWorkingCopyHost
  private currentRevision: string

  constructor(options: ProducerProjectWorkspaceOptions, revision: string) {
    this.store = options.store
    this.signal = options.signal
    this.invocationSkill = options.invocationSkill
    this.currentRevision = revision
    this.workingCopyHost = {
      store: options.store,
      signal: options.signal,
      resolveSkill: options.resolveSkill,
      resolveValidationDriver: options.resolveValidationDriver,
      ownsPath: options.ownsPath,
      publicationInvocationId: options.publicationInvocationId,
      validatePublication: options.validatePublication,
      preparePublication: options.preparePublication,
      settleEvent: options.settleEvent,
      withMutation: options.withMutation,
      acceptRevision: accepted => { this.currentRevision = accepted },
    }
  }

  /** Latest revision observed or published through this workspace. */
  get revision(): string {
    return this.currentRevision
  }

  /** List every Design File at the workspace's latest observed revision. */
  list(): Promise<readonly string[]> {
    this.signal.throwIfAborted()
    return this.store.listPathsAt(this.currentRevision, this.signal)
  }

  /** Read project-wide text at the workspace's latest observed revision. */
  readText(path: string): Promise<string | undefined> {
    this.signal.throwIfAborted()
    requireDesignFileRelativePath(path)
    return this.store.readTextAt(this.currentRevision, path, this.signal)
  }

  /** Read project-wide bytes while the workspace revision remains current and clean. */
  readBytes(path: string): Promise<Uint8Array | undefined> {
    this.signal.throwIfAborted()
    requireDesignFileRelativePath(path)
    return this.store.readCurrentBytes(this.currentRevision, path, this.signal)
  }

  /** Read bounded newest-first project history, optionally for one file. */
  history(input: { readonly limit: number; readonly path?: string }): Promise<readonly GitHistoryEntry[]> {
    this.signal.throwIfAborted()
    return this.store.history(input.limit, input.path, this.signal)
  }

  /** Read a diff between two exact committed revisions. */
  diff(input: { readonly from: string; readonly to: string; readonly path?: string }): Promise<string> {
    this.signal.throwIfAborted()
    return this.store.diffBetween(input.from, input.to, input.path, this.signal)
  }

  /** Require a recovery source to be an exact ancestor of the pinned project revision. */
  async requirePublishedAncestor(revision: string, descendant = this.currentRevision): Promise<void> {
    this.signal.throwIfAborted()
    if (this.store.isAncestor === undefined) {
      throw new Error('producer project workspace: restore ancestry verification is unavailable')
    }
    if (!await this.store.isAncestor(revision, descendant, this.signal)) {
      throw new Error(`producer project workspace: restore revision ${JSON.stringify(revision)} is not an ancestor of current Published revision ${JSON.stringify(descendant)}`)
    }
  }

  /** List the exact files at one validated Published revision. */
  listAt(revision: string): Promise<readonly string[]> {
    this.signal.throwIfAborted()
    return this.store.listPathsAt(revision, this.signal)
  }

  /** Read byte-exact content at one validated Published revision. */
  readBytesAt(revision: string, path: string): Promise<Uint8Array | undefined> {
    this.signal.throwIfAborted()
    requireDesignFileRelativePath(path)
    return this.store.readCurrentBytes(revision, path, this.signal)
  }

  /** Open at the latest commit, preserving any supplied invocation's Design evidence pin. */
  async openWorkingCopy(expectedRevision?: string): Promise<ProducerBundleWorkingCopy> {
    this.signal.throwIfAborted()
    const revision = await this.store.head(this.signal)
    if (revision === undefined) throw new Error('producer project workspace: selected Design Project has no committed revision')
    // Scores, Journal and derived records share the repository but do not
    // change the invocation's Design inputs. Adopt their latest commit as the
    // publication baseline only after the existing evidence guard proves it.
    if (expectedRevision !== undefined && revision !== expectedRevision
      && !await this.store.sameDesignEvidenceAt?.(expectedRevision, revision, this.signal)) {
      throw new ProducerWorkingCopyConflictError(expectedRevision, revision)
    }
    this.signal.throwIfAborted()
    this.currentRevision = revision
    return new BundleWorkingCopy(this.workingCopyHost, this.invocationSkill, revision)
  }

  /** Run a snapshot operation only while this workspace revision is current. */
  withCurrentRevision<T>(expectedRevision: string, operation: () => Promise<T>): Promise<T> {
    this.signal.throwIfAborted()
    return this.workingCopyHost.withMutation(async () => {
      const requireCurrent = async (): Promise<void> => {
        const current = (await this.store.head(this.signal)) ?? DESIGN_FILES_UNBORN_REVISION
        if (current === expectedRevision) return
        throw new ProducerWorkingCopyConflictError(expectedRevision, current)
      }
      await requireCurrent()
      const result = await operation()
      await requireCurrent()
      return result
    })
  }

}

/** Open one producer workspace at the selected project's current committed revision. */
export async function createProducerProjectWorkspace(
  options: ProducerProjectWorkspaceOptions,
): Promise<ProducerProjectWorkspace> {
  options.signal.throwIfAborted()
  const loaded = options.resolveSkill(options.invocationSkill.name)
  if (loaded === undefined) {
    throw new Error(`producer project workspace: invocation Bundle ${JSON.stringify(options.invocationSkill.name)} is not loaded`)
  }
  if (loaded.version !== options.invocationSkill.version) {
    throw new Error(
      `producer project workspace: invocation Bundle ${JSON.stringify(options.invocationSkill.name)} version is stale: pinned ${JSON.stringify(options.invocationSkill.version)}, loaded ${JSON.stringify(loaded.version)}`,
    )
  }
  const revision = await options.store.head(options.signal)
  if (revision === undefined) throw new Error('producer project workspace: selected Design Project has no committed revision')
  return new ProducerProjectWorkspace(options, revision)
}
