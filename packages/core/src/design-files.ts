/** Atomic persistence for the session-owned Design Files repository. */
import { snapshotJsonValue } from './json-value.ts'
import { createHash } from 'node:crypto'
import { listDisplayFiles } from './display-files.ts'
import { requireDesignFileRelativePath } from './design-file-path.ts'
export { requireDesignFileRelativePath } from './design-file-path.ts'
import type { GitCommitReceipt, GitHistoryEntry, GitVersioning, GitWorkingFile } from './git.ts'
import {
  readConfinedBytes,
  readConfinedText,
  removeConfinedFile,
  writeConfinedBytes,
  writeConfinedText,
  type ConfinedTextFs,
} from './confined-fs.ts'

/** Minimal filesystem contract adapted from `ctx.fs`. */
export interface FsLike extends ConfinedTextFs {}

/** State revision used before a Design Files repository has its first commit. */
export const DESIGN_FILES_UNBORN_REVISION = 'unborn'

/** Project authority applied around every Design Files operation. */
export interface DesignFilesAccess {
  /** Revalidate one read against the currently selected, usable project. */
  read<T>(operation: () => Promise<T>): Promise<T>
  /** Serialize and revalidate one complete write, including Journal settlement. */
  mutate<T>(operation: () => Promise<T>): Promise<T>
}

const UNRESTRICTED_DESIGN_FILES_ACCESS: DesignFilesAccess = {
  read: operation => operation(),
  mutate: operation => operation(),
}

/** Write-time schema validation result. */
export type SchemaValidation = { ok: true } | { ok: false; error: string }

/** Validates a candidate before it is persisted. */
export type SchemaValidator = (state: unknown) => SchemaValidation

/** One committed write presented for plugin-owned Journal settlement. */
export interface DesignWriteEvent {
  readonly state: Record<string, unknown>
  readonly commit?: string
}

/** Atomic write inputs. */
export interface DesignWriteOptions {
  readonly origin: 'agent' | 'panel'
  readonly validate?: SchemaValidator
  readonly signal?: AbortSignal
  /** Artifact paths relative to the Design Files root. */
  readonly artifacts?: Readonly<Record<string, string | Uint8Array>>
  /** Complete artifact set owned by this Bundle after the write. */
  readonly ownedArtifacts?: readonly string[]
  /** Write the exact prepared publication bytes into the filesystem worktree before commit. */
  readonly syncPreparedBytesToWorktree?: boolean
  /** Exact Published base the prepared write was validated against. */
  readonly expectedHead?: string
  /** Minimal execution authority stored in the Published Git commit itself. */
  readonly publication?: DesignPublishedExecution
  /** Non-execution event recorded once even when its file tree is unchanged. */
  readonly audit?: Readonly<{
    eventId: string
    kind: 'panel-save'
  }>
  /**
   * Awaited plugin Journal settlement after the file commit. A rejection is
   * surfaced as `DesignWriteSettlementError`; the committed files remain.
   */
  readonly settleEvent: (event: DesignWriteEvent) => Promise<void>
}

/** One terminal invocation audit, independent of Design validity or progress. */
export interface DesignInvocationAudit {
  readonly eventId: string
  readonly outcome: 'failed' | 'cancelled' | 'no-progress'
}

/** Result of recording the exact current Bundle filesystem fact. */
export interface DesignInvocationAuditResult {
  readonly commit: string
  readonly change: 'changed' | 'unchanged'
  readonly indexMaintenance?: GitCommitReceipt['indexMaintenance']
}

/** Restart-safe Producer execution authority carried by a Published commit. */
export interface DesignPublishedExecution {
  readonly skill: string
  readonly bundleVersion: string
  readonly invocationId: string
  readonly stateStatus: 'pending' | 'complete'
  readonly handoff: 'none' | 'must_edit' | 'user_continue'
  /** Invocation outcome is audit metadata and never controls Git cadence. */
  readonly outcome?: 'complete' | 'pause' | 'failed' | 'cancelled' | 'no-progress'
  /** Whether this audit commit changes the Design Files tree. */
  readonly change?: 'changed' | 'unchanged'
}

const EXECUTION_TRAILER = 'DSH-Design-Execution: '
const SKILL_TRAILER = 'DSH-Design-Skill: '
const EVENT_TRAILER = 'DSH-Design-Event: '

function publishedSkillMarker(skill: string): string {
  return `${SKILL_TRAILER}${JSON.stringify(skill)}`
}

function parsePublishedExecution(value: unknown): DesignPublishedExecution | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => !['skill', 'bundleVersion', 'invocationId', 'stateStatus', 'handoff', 'outcome', 'change'].includes(key))
    || typeof record.skill !== 'string' || record.skill === ''
    || typeof record.bundleVersion !== 'string' || record.bundleVersion === ''
    || typeof record.invocationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u.test(record.invocationId)
    || (record.stateStatus !== 'pending' && record.stateStatus !== 'complete')
    || (record.handoff !== 'none' && record.handoff !== 'must_edit' && record.handoff !== 'user_continue')
    || (record.outcome !== undefined && !['complete', 'pause', 'failed', 'cancelled', 'no-progress'].includes(String(record.outcome)))
    || (record.change !== undefined && record.change !== 'changed' && record.change !== 'unchanged')) return undefined
  return Object.freeze({
    skill: record.skill,
    bundleVersion: record.bundleVersion,
    invocationId: record.invocationId,
    stateStatus: record.stateStatus,
    handoff: record.handoff,
    ...(record.outcome === undefined ? {} : { outcome: record.outcome as NonNullable<DesignPublishedExecution['outcome']> }),
    ...(record.change === undefined ? {} : { change: record.change as NonNullable<DesignPublishedExecution['change']> }),
  })
}

/** Atomic write outcome. */
export interface DesignWriteResult extends DesignWriteEvent {
  readonly diff: string
  readonly indexMaintenance?: GitCommitReceipt['indexMaintenance']
  readonly recovery?: {
    readonly stage: 'journal' | 'diff'
    readonly state: 'pending'
    readonly message: string
  }
}

/** A Journal settlement or diff projection failed after its Design Files commit landed. */
export class DesignWriteSettlementError extends Error {
  readonly result: DesignWriteResult

  /**
   * Preserve the committed write receipt for explicit recovery.
   * @param result - committed state and checkpoint; diff may still be unavailable.
   * @param cause - post-commit follow-up failure.
   * @param stage - the follow-up that needs exact-event recovery.
   */
  constructor(result: DesignWriteResult, cause: unknown, stage: 'journal' | 'diff' = 'journal') {
    super(`design write committed, but ${stage === 'journal' ? 'plugin Journal settlement' : 'committed diff projection'} failed; retry the same event without changing files or Git configuration`, { cause })
    this.name = 'DesignWriteSettlementError'
    this.result = { ...result, recovery: { stage, state: 'pending', message: String(cause instanceof Error ? cause.message : cause).slice(0, 2048) } }
  }
}

function requireSkillName(skill: string): void {
  if (skill === '' || skill === '.' || skill === '..' || skill === '.git' || skill === '_experiences' || skill.includes('/') || skill.includes('\\') || skill.includes('\0')) {
    throw new Error(`invalid Design File skill ${JSON.stringify(skill)}`)
  }
}

/** Reads and atomically writes per-Bundle Design Files. */
export class DesignFilesStore {
  private readonly fs: FsLike
  private readonly git: GitVersioning
  private readonly rootDir: string
  private readonly access: DesignFilesAccess

  constructor(
    fs: FsLike,
    git: GitVersioning,
    rootDir: string,
    access: DesignFilesAccess = UNRESTRICTED_DESIGN_FILES_ACCESS,
  ) {
    this.fs = fs
    this.git = git
    this.rootDir = rootDir
    this.access = {
      read: operation => access.read(operation),
      mutate: operation => access.mutate(async () => {
        try { return await operation() }
        finally { git.invalidatePolledHead() }
      }),
    }
  }

  /** Absolute canonical JSON path for one Bundle. */
  pathFor(skill: string): string {
    return `${this.folderFor(skill)}/${skill}.json`
  }

  /** Absolute owning folder for one Bundle. */
  folderFor(skill: string): string {
    requireSkillName(skill)
    return `${this.rootDir}/${skill}`
  }

  /** Read the committed changes since a baseline. */
  diffSince(baseline?: string): Promise<string> {
    return this.access.read(() => this.git.diffSince(baseline))
  }

  /** Read one exact transaction's Design Files diff, including empty audit commits. */
  diffCommit(commit: string, signal?: AbortSignal): Promise<string> {
    return this.access.read(() => this.git.diffCommit(commit, signal))
  }

  /** Prior successful audit permits retry lookup; write() still verifies exact bytes. */
  hasPanelSaveAudit(skill: string, eventId: string, signal?: AbortSignal): Promise<boolean> {
    requireSkillName(skill)
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u.test(eventId)) {
      throw new Error('design panel save: invalid audit event ID')
    }
    return this.access.read(async () => {
      const head = await this.git.head(signal)
      if (head === undefined) return false
      const marker = `${EVENT_TRAILER}${Buffer.from(JSON.stringify({ eventId, kind: 'panel-save' }), 'utf8').toString('base64url')}`
      const commit = await this.git.latestCommitWithMessage(head, marker, signal)
      if (commit === undefined) return false
      const lines = (await this.git.commitMessageAt(commit, signal)).split(/\r?\n/u)
      return lines.includes(marker) && lines.includes(publishedSkillMarker(skill))
    })
  }

  /** Read the exact committed diff between two revisions, optionally for one path. */
  diffBetween(from: string, to: string, path?: string, signal?: AbortSignal): Promise<string> {
    if (path !== undefined) requireDesignFileRelativePath(path)
    return this.access.read(() => this.git.diffBetween(from, to, path, signal))
  }

  /** Read bounded newest-first Design Files history, optionally for one path. */
  history(limit: number, path?: string, signal?: AbortSignal): Promise<readonly GitHistoryEntry[]> {
    if (path !== undefined) requireDesignFileRelativePath(path)
    return this.access.read(() => this.git.history(limit, path, signal))
  }

  /** Resolve the latest committed Design Files revision, or undefined for an unborn repository. */
  head(signal?: AbortSignal): Promise<string | undefined> {
    return this.access.read(() => this.git.head(signal))
  }

  /** Verify that an exact revision belongs to the current Published ancestry. */
  isAncestor(ancestor: string, descendant: string, signal?: AbortSignal): Promise<boolean> {
    return this.access.read(() => this.git.isAncestor(ancestor, descendant, signal))
  }

  /** Read one file at an exact committed revision, or undefined when absent there. */
  readTextAt(commit: string, relativePath: string, signal?: AbortSignal): Promise<string | undefined> {
    requireDesignFileRelativePath(relativePath)
    return this.access.read(() => this.git.readTextAt(commit, relativePath, signal))
  }

  /** List every file path at one exact committed revision. */
  listPathsAt(commit: string, signal?: AbortSignal): Promise<readonly string[]> {
    return this.access.read(() => this.git.listPathsAt(commit, signal))
  }

  /** Product evidence identity; the actual commit remains the audit/snapshot pin. */
  designEvidenceRevisionAt(commit: string, signal?: AbortSignal): Promise<string> {
    return this.access.read(() => this.git.designEvidenceRevisionAt(commit, signal))
  }


  async sameDesignEvidenceAt(left: string, right: string, signal?: AbortSignal): Promise<boolean> {
    try {
      const [a, b] = await Promise.all([this.designEvidenceRevisionAt(left, signal), this.designEvidenceRevisionAt(right, signal)])
      return a === b
    } catch {
      signal?.throwIfAborted()
      // Missing historical objects cannot prove equivalence. Do not rebase an
      // old assessment or invent evidence to repair it.
      return false
    }
  }

  /** List files currently present in the filesystem worktree. */
  listWorktreePaths(signal?: AbortSignal): Promise<readonly string[]> {
    return this.access.read(async () => Object.freeze((await this.git.listWorkingFiles(signal)).map(file => file.path)))
  }

  /** Read cheap metadata for worktree cache invalidation without loading bytes. */
  listWorktreeFiles(signal?: AbortSignal): Promise<readonly GitWorkingFile[]> {
    return this.access.read(() => this.git.listWorkingFiles(signal))
  }

  /** Bounded filesystem inventory for display, independent of the Git index. */
  listDisplayFiles(bundles: readonly string[]): Promise<readonly GitWorkingFile[]> {
    return this.access.read(() => listDisplayFiles(this.rootDir, bundles))
  }

  /** Display hint only; saves and execution must continue to use head(). */
  pollHead(signal?: AbortSignal): Promise<string | undefined> {
    return this.access.read(() => this.git.pollHead(signal))
  }

  /** Read UTF-8 content from the filesystem worktree. */
  readWorktreeText(relativePath: string): Promise<string | undefined> {
    requireDesignFileRelativePath(relativePath)
    return this.access.read(() => readConfinedText(this.fs, this.rootDir, relativePath))
  }

  /** Read byte-exact content from the filesystem worktree. */
  readWorktreeBytes(relativePath: string): Promise<Uint8Array | undefined> {
    requireDesignFileRelativePath(relativePath)
    return this.access.read(async () => {
      if (this.fs.readBytes === undefined) throw new Error('binary Design File reads require readBytes')
      const content = await readConfinedBytes({ readBytes: this.fs.readBytes }, this.rootDir, relativePath)
      return content === undefined ? undefined : Uint8Array.from(content)
    })
  }

  /** Write one UTF-8 Producer mutation to the filesystem worktree. */
  writeWorktreeText(relativePath: string, content: string): Promise<void> {
    requireDesignFileRelativePath(relativePath)
    return this.access.mutate(() => writeConfinedText(this.fs, this.rootDir, relativePath, content))
  }

  /** Write one byte-exact Producer mutation to the filesystem worktree. */
  writeWorktreeBytes(relativePath: string, content: Uint8Array): Promise<void> {
    requireDesignFileRelativePath(relativePath)
    return this.access.mutate(async () => {
      if (this.fs.writeBytes === undefined) throw new Error('binary Design File writes require writeBytes')
      await writeConfinedBytes({ writeBytes: this.fs.writeBytes, ensureDir: this.fs.ensureDir }, this.rootDir, relativePath, content)
    })
  }

  /** Remove one Producer-owned file from the filesystem worktree. */
  removeWorktreeFile(relativePath: string): Promise<void> {
    requireDesignFileRelativePath(relativePath)
    return this.access.mutate(async () => {
      if (this.fs.removeFile === undefined) throw new Error('Design File worktree removal requires removeFile')
      const existing = this.fs.readBytes === undefined
        ? await readConfinedText(this.fs, this.rootDir, relativePath)
        : await readConfinedBytes({ readBytes: this.fs.readBytes }, this.rootDir, relativePath)
      if (existing === undefined) return
      await removeConfinedFile({ removeFile: this.fs.removeFile }, this.rootDir, relativePath)
    })
  }

  /** Read one byte-exact file from an exact published revision. */
  readCurrentBytes(commit: string, relativePath: string, signal?: AbortSignal): Promise<Uint8Array | undefined> {
    requireDesignFileRelativePath(relativePath)
    return this.access.read(() => this.git.readBytesAt(commit, relativePath, signal))
  }

  /** Read bounded byte-exact content from an exact published revision. */
  readBytesAt(commit: string, relativePath: string, signal?: AbortSignal, maxBytes?: number): Promise<Uint8Array | undefined> {
    requireDesignFileRelativePath(relativePath)
    return this.access.read(() => this.git.readBytesAt(commit, relativePath, signal, maxBytes))
  }

  /** Read restart-safe Producer execution authority from an exact Published commit. */
  async readPublishedExecutionAt(commit: string, signal?: AbortSignal): Promise<DesignPublishedExecution | undefined> {
    return this.access.read(async () => {
      const message = await this.git.commitMessageAt(commit, signal)
      const trailer = message.trimEnd().split('\n').reverse().find(line => line.startsWith(EXECUTION_TRAILER))
      if (trailer === undefined) return undefined
      try {
        return parsePublishedExecution(JSON.parse(Buffer.from(trailer.slice(EXECUTION_TRAILER.length), 'base64url').toString('utf8')))
      } catch {
        return undefined
      }
    })
  }

  /**
   * Resolve the newest reachable execution publication for one Bundle, but
   * only while that publication's canonical blob is still current at HEAD.
   */
  async readLatestPublishedExecutionForSkillAt(
    head: string,
    skill: string,
    signal?: AbortSignal,
  ): Promise<Readonly<{ readonly commit: string; readonly execution: DesignPublishedExecution }> | undefined> {
    requireSkillName(skill)
    return this.access.read(async () => {
      const commit = await this.git.latestCommitWithMessage(head, publishedSkillMarker(skill), signal)
      if (commit === undefined) return undefined
      const message = await this.git.commitMessageAt(commit, signal)
      const trailer = message.trimEnd().split('\n').reverse().find(line => line.startsWith(EXECUTION_TRAILER))
      if (trailer === undefined) return undefined
      let execution: DesignPublishedExecution | undefined
      try {
        execution = parsePublishedExecution(JSON.parse(Buffer.from(trailer.slice(EXECUTION_TRAILER.length), 'base64url').toString('utf8')))
      } catch {
        return undefined
      }
      if (execution === undefined || execution.skill !== skill) return undefined
      const canonicalPath = `${skill}/${skill}.json`
      const publishedBlob = await this.git.blobOidAt(commit, canonicalPath, signal)
      const currentBlob = await this.git.blobOidAt(head, canonicalPath, signal)
      if (publishedBlob === undefined || publishedBlob !== currentBlob) return undefined
      return Object.freeze({ commit, execution })
    })
  }

  /** Compare one committed file across two exact revisions. */
  async samePublishedFileAt(left: string, right: string, relativePath: string, signal?: AbortSignal): Promise<boolean> {
    requireDesignFileRelativePath(relativePath)
    return this.access.read(async () => {
      const leftBlob = await this.git.blobOidAt(left, relativePath, signal)
      const rightBlob = await this.git.blobOidAt(right, relativePath, signal)
      return leftBlob !== undefined && leftBlob === rightBlob
    })
  }

  /** Compare bytes with a committed blob without treating mutable worktree bytes as authority. */
  matchesBytesAt(commit: string, relativePath: string, content: Uint8Array, signal?: AbortSignal): Promise<boolean> {
    requireDesignFileRelativePath(relativePath)
    return this.access.read(async () => {
      const actual = await this.git.blobOidAt(commit, relativePath, signal)
      if (actual === undefined) return false
      const bytes = Buffer.from(content)
      const expected = createHash(await this.git.objectFormat(signal))
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest('hex')
      return actual === expected
    })
  }

  /** Reject non-transactional changes in the Design Files worktree. */
  assertCleanWorktree(signal?: AbortSignal): Promise<void> {
    return this.access.read(() => this.git.assertCleanWorktree(signal))
  }

  /** Read one Bundle's canonical JSON, or undefined when absent. */
  async read(skill: string): Promise<unknown | undefined> {
    requireSkillName(skill)
    return this.access.read(async () => {
      const text = await readConfinedText(this.fs, this.rootDir, `${skill}/${skill}.json`)
      if (text === undefined || text === '') return undefined
      return JSON.parse(text) as unknown
    })
  }

  /** Read one Bundle from the latest validated/published Git revision. */
  async readPublished(skill: string, signal?: AbortSignal): Promise<unknown | undefined> {
    return (await this.readPublishedSnapshot(skill, signal)).state
  }

  /** Read one canonical state and its exact checkpoint together, without caching HEAD. */
  async readPublishedSnapshot(skill: string, signal?: AbortSignal): Promise<Readonly<{
    checkpoint: string | undefined
    state: unknown | undefined
  }>> {
    requireSkillName(skill)
    return this.access.read(async () => {
      const checkpoint = await this.git.head(signal)
      const text = checkpoint === undefined ? undefined : await this.git.readTextAt(checkpoint, `${skill}/${skill}.json`, signal)
      return Object.freeze({ checkpoint, state: text === undefined || text === '' ? undefined : JSON.parse(text) as unknown })
    })
  }

  /**
   * Validate and snapshot all inputs, atomically commit canonical JSON and
   * explicit artifacts, then await plugin Journal settlement. File or Git
   * failures roll back. Journal failures remain visible without rolling back
   * the already committed Design Files checkpoint.
   */
  async write(skill: string, state: unknown, options: DesignWriteOptions): Promise<DesignWriteResult> {
    return this.access.mutate(() => this.writeAuthorized(skill, state, options))
  }

  /** Commit only system-derived experience files; no Bundle state or Journal event. */
  async commitExperienceFiles(id: string, files: Readonly<Record<string, string | Uint8Array>>, signal?: AbortSignal): Promise<string | undefined> {
    if (!/^[A-Za-z0-9_-]{1,80}$/u.test(id)) throw new Error('Invalid experience ID')
    const prefix = `_experiences/${id}/`
    const contents = new Map(Object.entries(files))
    if (!contents.has(`${prefix}view.json`)) throw new Error('Experience publication needs its view index')
    for (const [path, value] of contents) {
      requireDesignFileRelativePath(path)
      if (!path.startsWith(prefix) || (typeof value !== 'string' && !(value instanceof Uint8Array))) throw new Error('Experience publication cannot change other files')
    }
    return this.access.mutate(async () => {
      const head = await this.git.head(signal)
      if (!this.fs.readBytes || !this.fs.writeBytes) throw new Error('Experience publication needs binary file support')
      const byteFs = { readBytes: this.fs.readBytes, writeBytes: this.fs.writeBytes, ensureDir: this.fs.ensureDir }
      const before = new Map<string, Uint8Array | undefined>()
      for (const path of contents.keys()) before.set(path, await readConfinedBytes(byteFs, this.rootDir, path))
      try {
        for (const [path, content] of contents) await writeConfinedBytes(byteFs, this.rootDir, path, typeof content === 'string' ? Buffer.from(content) : content)
        return await this.git.commitExact(`experience(${id}): refresh derived view`, contents, head, signal)
      } catch (error) {
        for (const [path, content] of before) {
          if (content === undefined) {
            if (this.fs.removeFile) await removeConfinedFile({ removeFile: this.fs.removeFile }, this.rootDir, path)
          } else await writeConfinedBytes(byteFs, this.rootDir, path, content)
        }
        throw error
      }
    })
  }

  /**
   * Commit the exact current Bundle worktree after an invocation that could not
   * publish valid Design state. This deliberately performs no Design schema
   * validation: Git records the filesystem fact so a later Producer can inspect
   * and repair it. The stable event id makes a repeated terminal callback
   * idempotent.
   */
  async auditInvocation(
    skill: string,
    audit: DesignInvocationAudit,
    signal?: AbortSignal,
  ): Promise<DesignInvocationAuditResult> {
    requireSkillName(skill)
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u.test(audit.eventId)
      || !['failed', 'cancelled', 'no-progress'].includes(audit.outcome)) {
      throw new Error(`design invocation audit rejected for ${JSON.stringify(skill)}: invalid metadata`)
    }
    return this.access.mutate(async () => {
      const metadata = Object.freeze({ eventId: audit.eventId, kind: 'invocation', outcome: audit.outcome })
      const marker = `${EVENT_TRAILER}${Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64url')}`
      const head = await this.git.head(signal)
      if (head !== undefined) {
        const prior = await this.git.latestCommitWithMessage(head, marker, signal)
        if (prior !== undefined) {
          return Object.freeze({ commit: prior, change: 'unchanged' as const })
        }
      }
      const prefix = `${skill}/`
      const tracked = head === undefined ? [] : (await this.git.listPathsAt(head, signal)).filter(path => path.startsWith(prefix))
      const present = (await this.git.listWorkingPaths(signal)).filter(path => path.startsWith(prefix))
      const paths = [...new Set([...tracked, ...present])].sort()
      const frozen = new Map<string, string | Uint8Array | undefined>()
      for (const path of paths) {
        const content = this.fs.readBytes === undefined
          ? await readConfinedText(this.fs, this.rootDir, path)
          : await readConfinedBytes({ readBytes: this.fs.readBytes }, this.rootDir, path)
        frozen.set(path, content === undefined
          ? undefined
          : typeof content === 'string' ? content : Uint8Array.from(content))
      }
      const message = `design(${skill}): agent ${audit.outcome}\n\n${publishedSkillMarker(skill)}\n${marker}`
      const receipt = await this.git.commitExactReceipt(message, frozen, head, signal, true)
      const commit = receipt.commit
      if (commit === undefined) throw new Error('design invocation audit: forced commit returned no revision')
      return Object.freeze({ commit, change: receipt.change!, ...(receipt.indexMaintenance === undefined ? {} : { indexMaintenance: receipt.indexMaintenance }) })
    })
  }

  private async writeAuthorized(skill: string, state: unknown, options: DesignWriteOptions): Promise<DesignWriteResult> {
    requireSkillName(skill)
    const snapshot = snapshotJsonValue(state)
    if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
      throw new Error(`design write rejected for ${JSON.stringify(skill)}: state is not losslessly JSON-serializable as an object`)
    }
    if (options.validate !== undefined) {
      const validation = options.validate(snapshot)
      if (!validation.ok) throw new Error(`design write rejected for ${JSON.stringify(skill)}: ${validation.error}`)
    }

    const stateSnapshot = snapshot as Record<string, unknown>
    const canonicalPath = `${skill}/${skill}.json`
    const contents = new Map<string, string | Uint8Array>([[canonicalPath, `${JSON.stringify(stateSnapshot, null, 2)}\n`]])
    for (const [path, content] of Object.entries(options.artifacts ?? {})) {
      requireDesignFileRelativePath(path)
      if (!path.startsWith(`${skill}/`)) throw new Error(`artifact ${JSON.stringify(path)} is outside Bundle folder ${JSON.stringify(skill)}`)
      if (path === canonicalPath) throw new Error(`artifact path conflicts with canonical Design File: ${path}`)
      if (typeof content !== 'string' && !(content instanceof Uint8Array)) {
        throw new Error(`artifact ${JSON.stringify(path)} must contain text or bytes`)
      }
      contents.set(path, typeof content === 'string' ? content : Uint8Array.from(content))
    }

    const ownedArtifacts = options.ownedArtifacts === undefined
      ? undefined
      : new Set(options.ownedArtifacts)
    if (ownedArtifacts !== undefined) {
      if (ownedArtifacts.size !== options.ownedArtifacts?.length) {
        throw new Error(`design write rejected for ${JSON.stringify(skill)}: owned artifact paths must be unique`)
      }
      for (const path of ownedArtifacts) {
        requireDesignFileRelativePath(path)
        if (!path.startsWith(`${skill}/`)) throw new Error(`owned artifact ${JSON.stringify(path)} is outside Bundle folder ${JSON.stringify(skill)}`)
        if (path === canonicalPath) throw new Error(`owned artifact set must not include canonical Design File: ${path}`)
      }
      for (const path of Object.keys(options.artifacts ?? {})) {
        if (!ownedArtifacts.has(path)) {
          throw new Error(`artifact ${JSON.stringify(path)} is absent from the complete owned artifact set`)
        }
      }
    }

    const containsBytes = [...contents.values()].some((content) => content instanceof Uint8Array)
    const usesByteFs = this.fs.readBytes !== undefined && this.fs.writeBytes !== undefined
    if (containsBytes && !usesByteFs) {
      throw new Error('binary Design File artifacts require readBytes and writeBytes filesystem methods')
    }

    const head = await this.git.head(options.signal)
    const audit = options.audit
    const publication = options.publication === undefined ? undefined : parsePublishedExecution(options.publication)
    if (options.publication !== undefined && publication === undefined) {
      throw new Error(`design write rejected for ${JSON.stringify(skill)}: publication metadata is invalid`)
    }
    if (publication !== undefined && publication.skill !== skill) {
      throw new Error(`design write rejected for ${JSON.stringify(skill)}: publication skill does not match`)
    }
    if (audit !== undefined && (audit.kind !== 'panel-save' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u.test(audit.eventId))) {
      throw new Error(`design write rejected for ${JSON.stringify(skill)}: audit metadata is invalid`)
    }
    if (publication !== undefined && audit !== undefined) {
      throw new Error(`design write rejected for ${JSON.stringify(skill)}: publication and audit metadata are mutually exclusive`)
    }
    const priorEventCommit = async (marker: string, label: string): Promise<DesignWriteResult | undefined> => {
      if (head === undefined) return undefined
      const prior = await this.git.latestCommitWithMessage(head, marker, options.signal)
      if (prior === undefined) return undefined
      for (const [path, expected] of contents) {
        const actual = await this.git.readBytesAt(prior, path, options.signal)
        const bytes = typeof expected === 'string' ? Buffer.from(expected, 'utf8') : Buffer.from(expected)
        if (actual === undefined || !Buffer.from(actual).equals(bytes)) {
          throw new Error(`design write rejected for ${JSON.stringify(skill)}: ${label} id was reused with different bytes at ${JSON.stringify(path)}`)
        }
      }
      if (ownedArtifacts !== undefined) {
        const committedArtifacts = (await this.git.listPathsAt(prior, options.signal))
          .filter(path => path.startsWith(`${skill}/`) && path !== canonicalPath).sort()
        if (JSON.stringify(committedArtifacts) !== JSON.stringify([...ownedArtifacts].sort())) {
          throw new Error(`design write rejected for ${JSON.stringify(skill)}: ${label} id was reused with a different artifact set`)
        }
      }
      return this.settleCommitted({ state: stateSnapshot, commit: prior, diff: '' }, options)
    }
    if (audit !== undefined && head !== undefined) {
      const marker = `${EVENT_TRAILER}${Buffer.from(JSON.stringify(audit), 'utf8').toString('base64url')}`
      const prior = await priorEventCommit(marker, 'audit event')
      if (prior !== undefined) return prior
    }
    if (publication !== undefined && head !== undefined) {
      const marker = `${EXECUTION_TRAILER}${Buffer.from(JSON.stringify(publication), 'utf8').toString('base64url')}`
      const prior = await priorEventCommit(marker, 'publication invocation')
      if (prior !== undefined) return prior
    }
    // The original baseline fences a new publication. An exact replay instead
    // reconciles the already committed event above, without writing again.
    if (options.expectedHead !== undefined && head !== options.expectedHead
      && (!head || !await this.sameDesignEvidenceAt(options.expectedHead, head, options.signal))) {
      throw new Error(`design write rejected for ${JSON.stringify(skill)}: publication revision is stale; expected ${JSON.stringify(options.expectedHead)}, latest is ${JSON.stringify(head)}`)
    }
    const deletions = ownedArtifacts === undefined || head === undefined
      ? []
      : (await this.git.listPathsAt(head, options.signal)).filter(path => (
          path.startsWith(`${skill}/`)
          && path !== canonicalPath
          && !ownedArtifacts.has(path)
        ))
    if (deletions.length > 0 && this.fs.removeFile === undefined) {
      throw new Error('complete owned artifact writes require filesystem file removal')
    }
    const paths = [...new Set([...contents.keys(), ...deletions])].sort()
    if (options.syncPreparedBytesToWorktree !== false) {
      for (const path of deletions) {
        const present = usesByteFs
          ? await readConfinedBytes({ readBytes: this.fs.readBytes as NonNullable<FsLike['readBytes']> }, this.rootDir, path)
          : await readConfinedText(this.fs, this.rootDir, path)
        if (present !== undefined) {
          await removeConfinedFile(
            { removeFile: this.fs.removeFile as NonNullable<FsLike['removeFile']> },
            this.rootDir,
            path,
          )
        }
      }
      for (const path of paths) {
        if (!contents.has(path)) continue
        const content = contents.get(path) as string | Uint8Array
        if (typeof content === 'string') await writeConfinedText(this.fs, this.rootDir, path, content)
        else await writeConfinedBytes({
          writeBytes: this.fs.writeBytes as NonNullable<FsLike['writeBytes']>,
          ensureDir: this.fs.ensureDir,
        }, this.rootDir, path, content)
      }
    }
    const frozen = new Map<string, string | Uint8Array | undefined>()
    for (const path of paths) frozen.set(path, contents.get(path))
    const auditLabel = publication?.outcome ?? 'update'
    const noChange = publication?.change === 'unchanged' ? ' (no file changes)' : ''
    const message = audit !== undefined
      ? `design(${skill}): panel save\n\n${publishedSkillMarker(skill)}\n${EVENT_TRAILER}${Buffer.from(JSON.stringify(audit), 'utf8').toString('base64url')}`
      : publication === undefined
        ? `design(${skill}): ${options.origin} update`
      : `design(${skill}): ${options.origin} ${auditLabel}${noChange}\n\n${publishedSkillMarker(skill)}\n${EXECUTION_TRAILER}${Buffer.from(JSON.stringify(publication), 'utf8').toString('base64url')}`
    const receipt = await this.git.commitExactReceipt(message, frozen, head, options.signal, publication !== undefined || audit !== undefined)
    const commit = receipt.commit
    const event: DesignWriteEvent = commit === undefined ? { state: stateSnapshot } : { state: stateSnapshot, commit }
    return this.settleCommitted({ ...event, diff: '', ...(receipt.indexMaintenance === undefined ? {} : { indexMaintenance: receipt.indexMaintenance }) }, options)
  }

  /** Once committed, every fallible follow-up preserves the exact receipt for recovery. */
  private async settleCommitted(result: DesignWriteResult, options: DesignWriteOptions): Promise<DesignWriteResult> {
    try {
      await options.settleEvent(result)
    } catch (error) {
      throw new DesignWriteSettlementError(result, error)
    }
    try {
      return { ...result, diff: result.commit === undefined ? '' : await this.git.diffCommit(result.commit, options.signal) }
    } catch (error) {
      throw new DesignWriteSettlementError(result, error, 'diff')
    }
  }
}
