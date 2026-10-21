/** Git versioning for one project repository or a confined directory within it. */
import { createHash } from 'node:crypto'
import { lstat, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { NativeGitOperation, NativeGitResult, NativeGitFile, NativeGitInspection } from './git-native-contract.ts'
import { isDesignProjectAuxiliaryPath } from './design-project-record-paths.ts'

export interface NativeGitRequest {
  readonly cwd: string
  readonly operation: NativeGitOperation
  readonly signal?: AbortSignal
}

export function gitBackendSetting(value = process.env.YUGOO_GIT_BACKEND): 'cli' | 'native' {
  if (value === undefined || value === 'native') return 'native'
  if (value === 'cli') return 'cli'
  throw new Error('design git: YUGOO_GIT_BACKEND must be cli or native')
}

// Only display polling uses this bounded shared probe. Actions always use head().
const polledHeads = new Map<string, { identity: string; until: number; pending: Promise<string | undefined> }>()

/** Minimal spawn contract adapted from `ctx.subprocess.spawn`. */
export type SpawnFn = ((request: {
  argv: readonly string[]
  cwd: string
  signal?: AbortSignal
  env?: Readonly<Record<string, string>>
  /** Exact raw stdout, bounded before decoding; text-only adapters must reject it. */
  binaryStdout?: { readonly maxBytes: number }
}) => Promise<{ exitCode: number | null; stdout: string; stderr: string; stdoutBytes?: Uint8Array }>) & {
  readonly native?: (request: NativeGitRequest) => Promise<NativeGitResult>
}

/** A caller's byte cap rejected blob metadata before any body was captured. */
export class GitBlobSizeLimitError extends Error {
  constructor(readonly path: string, readonly size: number, readonly maxBytes: number) {
    super(`design git: committed artifact ${JSON.stringify(path)} exceeds ${maxBytes} bytes`)
    this.name = 'GitBlobSizeLimitError'
  }
}

/** Shared raw-stream capture for the Node and native Host subprocess adapters. */
export async function collectGitStdout(
  stream: AsyncIterable<Uint8Array>,
  binary?: { readonly maxBytes: number },
): Promise<{ stdout: string; stdoutBytes?: Uint8Array }> {
  if (binary !== undefined && (!Number.isSafeInteger(binary.maxBytes) || binary.maxBytes < 0)) {
    throw new Error('design git: invalid binary stdout limit')
  }
  const chunks: Buffer[] = []
  let size = 0, overflow = false
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (binary !== undefined && size > binary.maxBytes) overflow = true
    if (!overflow) chunks.push(bytes)
  }
  if (overflow) throw new Error('design git: binary stdout exceeded its declared blob size')
  const bytes = Buffer.concat(chunks)
  return binary === undefined ? { stdout: bytes.toString('utf8') } : { stdout: '', stdoutBytes: bytes }
}

/** Content publication and non-authoritative ordinary-index maintenance are separate facts. */
export interface GitCommitReceipt {
  readonly commit?: string
  readonly change?: 'changed' | 'unchanged'
  readonly indexMaintenance?: {
    readonly state: 'deferred'
    readonly message: string
  }
}

function diagnostic(argv: readonly string[], result: { exitCode: number | null; stderr: string }): Error {
  return new Error(`design git: ${argv.join(' ')} exited ${String(result.exitCode)}: ${result.stderr.trim() || '<no stderr>'}`)
}

function requireFullCommit(commit: string): void {
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(commit)) {
    throw new Error(`design git: commit must be a full lowercase object id: ${JSON.stringify(commit)}`)
  }
}

/** One bounded committed-history entry. */
export interface GitHistoryEntry {
  readonly commit: string
  readonly committedAt: string
  readonly subject: string
}

function historyEntries(stdout: string): readonly GitHistoryEntry[] {
  if (stdout === '') return Object.freeze([])
  const entries = stdout.trimEnd().split('\n').map((line): GitHistoryEntry => {
    const first = line.indexOf('\t')
    const second = first < 0 ? -1 : line.indexOf('\t', first + 1)
    if (first < 0 || second < 0) throw new Error('design git: log returned a malformed history entry')
    const commit = line.slice(0, first)
    requireFullCommit(commit)
    const committedAt = line.slice(first + 1, second)
    if (committedAt === '' || !Number.isFinite(new Date(committedAt).valueOf())) {
      throw new Error('design git: log returned an invalid commit timestamp')
    }
    return Object.freeze({ commit, committedAt, subject: line.slice(second + 1) })
  })
  return Object.freeze(entries)
}

export interface GitTreeEntry {
  readonly path: string
  readonly mode: number
  readonly oid: string
  readonly type: 'blob' | 'commit'
}

/** Cheap worktree identity used to decide whether file bytes need rereading. */
export interface GitWorkingFile {
  readonly path: string
  readonly size: number
  readonly mtimeMs: number
  readonly ctimeMs: number
  readonly ino: number
}

function requireListedPath(path: string): void {
  if (path === '' || path.startsWith('/') || path.endsWith('/') || path.includes('\\')
    || /[\u0000-\u001f\u007f]/u.test(path)
    || path.split('/').some((part) => part === '' || part === '.' || part === '..' || part === '.git')) {
    throw new Error(`design git: unsafe path at pinned revision: ${JSON.stringify(path)}`)
  }
}

/** Manages a project Git repository, optionally scoped to one project directory. */
export class GitVersioning {
  private readonly evidenceRevisions = new Map<string, string>()
  private readonly pinnedReads = new Map<string, { value: unknown; bytes: number }>()
  private pinnedReadBytes = 0
  constructor(
    private readonly spawn: SpawnFn,
    private readonly repoRoot: string,
    private readonly pathPrefix?: string,
    private readonly cachePinnedReads = false,
    private readonly backend: 'cli' | 'native' = gitBackendSetting(),
  ) {
    if (pathPrefix !== undefined) requireListedPath(pathPrefix)
  }

  private get nativeEnabled(): boolean { return this.backend === 'native' }

  private async nativeResult(operation: NativeGitOperation, signal?: AbortSignal): Promise<NativeGitResult> {
    signal?.throwIfAborted()
    const request = { cwd: this.repoRoot, operation, signal }
    if (this.spawn.native !== undefined) return this.spawn.native(request)
    const { executeNativeGitRequest } = await import('./git-native-executor.ts')
    return executeNativeGitRequest(request)
  }

  private async nativeValue<T>(operation: NativeGitOperation, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    const result = await this.nativeResult(operation, signal)
    return result.value as T
  }

  /** Only full-OID reads enter this bounded cache; HEAD and worktree reads never do. */
  private async pinnedRead<T>(key: string, read: () => Promise<T>, signal?: AbortSignal, cacheMissing = false): Promise<T> {
    signal?.throwIfAborted()
    if (!this.cachePinnedReads) return read()
    const cached = this.pinnedReads.get(key)
    if (cached !== undefined) {
      this.pinnedReads.delete(key)
      this.pinnedReads.set(key, cached)
      return cached.value as T
    }
    const value = await read()
    signal?.throwIfAborted()
    if (value === undefined && !cacheMissing) return value
    const bytes = Buffer.byteLength(JSON.stringify(value) ?? 'null') + Buffer.byteLength(key)
    if (bytes > 1024 * 1024) return value
    const previous = this.pinnedReads.get(key)
    if (previous !== undefined) this.pinnedReadBytes -= previous.bytes
    this.pinnedReads.set(key, { value, bytes })
    this.pinnedReadBytes += bytes
    while (this.pinnedReads.size > 256 || this.pinnedReadBytes > 4 * 1024 * 1024) {
      const oldest = this.pinnedReads.keys().next().value!
      this.pinnedReadBytes -= this.pinnedReads.get(oldest)!.bytes
      this.pinnedReads.delete(oldest)
    }
    return value
  }

  /** Map a consumer-relative path into the repository path namespace. */
  private repositoryPath(path: string): string {
    requireListedPath(path)
    return this.pathPrefix === undefined ? path : `${this.pathPrefix}/${path}`
  }

  /** Pathspec confining an operation to this instance and optional child path. */
  private pathspec(path?: string): readonly string[] {
    if (path !== undefined) return ['--', this.repositoryPath(path)]
    return this.pathPrefix === undefined ? [] : ['--', this.pathPrefix]
  }

  private async run(
    argv: readonly string[],
    signal?: AbortSignal,
    env?: Readonly<Record<string, string>>,
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    if (this.nativeEnabled) throw new Error('design git: external Git is disabled for the native backend')
    return this.spawn({ argv, cwd: this.repoRoot, signal, ...(env === undefined ? {} : { env }) })
  }

  private async requireSuccess(
    argv: readonly string[],
    signal?: AbortSignal,
    env?: Readonly<Record<string, string>>,
  ): Promise<{ stdout: string; stderr: string }> {
    const result = await this.run(argv, signal, env)
    if (result.exitCode !== 0) throw diagnostic(argv, result)
    return result
  }

  /** Resolve the repository object hash algorithm. */
  async objectFormat(signal?: AbortSignal): Promise<'sha1' | 'sha256'> {
    if (this.nativeEnabled) return (await this.nativeValue<NativeGitInspection>({ kind: 'inspect' }, signal)).format
    const format = (await this.requireSuccess(['git', 'rev-parse', '--show-object-format'], signal)).stdout.trim()
    if (format !== 'sha1' && format !== 'sha256') {
      throw new Error(`design git: unsupported object format ${JSON.stringify(format)}`)
    }
    return format
  }

  /** Read explicit storage format and this publication's live HEAD in one probe. */
  private async publicationBasis(signal?: AbortSignal): Promise<{
    format: 'sha1' | 'sha256'
    head: string | undefined
  }> {
    signal?.throwIfAborted()
    if (this.nativeEnabled) {
      const facts = await this.nativeValue<NativeGitInspection>({ kind: 'inspect' }, signal)
      return { format: facts.format, head: facts.head }
    }
    const argv = ['git', 'rev-parse', '--show-object-format', '--verify', '--quiet', 'HEAD']
    const result = await this.run(argv, signal)
    signal?.throwIfAborted()
    if (result.exitCode !== 0 && result.exitCode !== 1) throw diagnostic(argv, result)
    const lines = result.stdout.split(/\r?\n/u)
    if (lines.at(-1) === '') lines.pop()
    const format = lines[0]
    if (format !== 'sha1' && format !== 'sha256') {
      throw new Error(`design git: unsupported object format ${JSON.stringify(format)}`)
    }
    if (lines.length !== (result.exitCode === 0 ? 2 : 1)) {
      throw new Error('design git: invalid publication format/HEAD response')
    }
    const head = result.exitCode === 1 ? undefined : lines[1]!
    if (head !== undefined) requireFullCommit(head)
    return { format, head }
  }

  /** Resolve one blob object id at an exact revision, or undefined when absent. */
  async blobOidAt(commit: string, path: string, signal?: AbortSignal): Promise<string | undefined> {
    requireFullCommit(commit)
    const repositoryPath = this.repositoryPath(path)
    const object = `${commit}:${repositoryPath}`
    return this.pinnedRead(`blob:${object}`, async () => {
      if (this.nativeEnabled) {
        const value = await this.nativeValue<{ commitFound: boolean; entry?: { oid: string } }>({ kind: 'entry', commit, path: repositoryPath }, signal)
        return value.commitFound ? value.entry?.oid : undefined
      }
      const result = await this.run(['git', 'rev-parse', '--verify', object], signal)
      if (result.exitCode === 128) return undefined
      if (result.exitCode !== 0) throw diagnostic(['git', 'rev-parse', '--verify', object], result)
      return result.stdout.trim()
    }, signal)
  }

  /** Read the immutable blob, without checkout attributes, filters or newline conversion. */
  async readBytesAt(
    commit: string,
    path: string,
    signal?: AbortSignal,
    maxBytes?: number,
  ): Promise<Uint8Array | undefined> {
    requireFullCommit(commit)
    const repositoryPath = this.repositoryPath(path)
    signal?.throwIfAborted()
    if (this.nativeEnabled) {
      const value = await this.nativeValue<{ commitFound: boolean; entry?: { mode: number; oid: string } }>({ kind: 'entry', commit, path: repositoryPath }, signal)
      if (!value.commitFound || value.entry === undefined) return undefined
      const entry = value.entry
      if (entry.mode !== 0o100644 && entry.mode !== 0o100755) throw new Error(`design git: committed artifact ${JSON.stringify(path)} is not a regular file`)
      requireFullCommit(entry.oid)
      const header = await this.nativeValue<{ found: boolean; kind?: string; size?: number }>({ kind: 'blob-header', oid: entry.oid }, signal)
      if (!header.found || header.kind !== 'blob' || !Number.isSafeInteger(header.size) || header.size! < 0) throw new Error('design git: invalid committed blob header')
      const size = header.size!
      if (maxBytes !== undefined && size > maxBytes) throw new GitBlobSizeLimitError(path, size, maxBytes)
      const captured = await this.nativeResult({ kind: 'blob', oid: entry.oid, size }, signal)
      signal?.throwIfAborted()
      if (!(captured.bytes instanceof Uint8Array)) throw new Error('design git: native executor did not return exact blob bytes')
      const bytes = Buffer.from(captured.bytes)
      if (bytes.length !== size || createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== entry.oid) throw new Error('design git: native committed blob integrity mismatch')
      return Uint8Array.from(bytes)
    }
    // One immutable tree entry supplies mode, type, OID and size. Peeling to a
    // commit rejects tree/blob inputs; literal pathspecs and NUL framing avoid
    // interpreting file names as patterns or accepting another tree entry.
    const argv = [
      'git', 'ls-tree', '-l', '-z', `${commit}^{commit}`, '--', `:(literal)${repositoryPath}`,
    ]
    const listed = await this.run(argv, signal)
    signal?.throwIfAborted()
    // The previous blob lookup also returned absence for an unavailable full
    // revision. Preserve that contract without accepting non-commit evidence.
    if (listed.exitCode === 128) return undefined
    if (listed.exitCode !== 0) throw diagnostic(argv, listed)
    const entry = listed.stdout
    if (entry === '') return undefined
    const metadata = /^([0-7]{6}) (blob|tree|commit) ([a-f0-9]{40}(?:[a-f0-9]{24})?) +(-|[0-9]+)\t([^\0]+)\0$/u.exec(entry)
    if (metadata === null || metadata[0] !== entry || metadata[5] !== repositoryPath || metadata[3]!.length !== commit.length) {
      throw new Error(`design git: invalid committed tree entry for ${JSON.stringify(path)}`)
    }
    if ((metadata[1] !== '100644' && metadata[1] !== '100755') || metadata[2] !== 'blob') {
      throw new Error(`design git: committed artifact ${JSON.stringify(path)} is not a regular file`)
    }
    const oid = metadata[3]!
    const sizeText = metadata[4]!
    const size = Number(sizeText)
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`design git: invalid blob size ${JSON.stringify(sizeText)}`)
    if (maxBytes !== undefined && size > maxBytes) throw new GitBlobSizeLimitError(path, size, maxBytes)
    const result = await this.spawn({ argv: ['git', 'cat-file', 'blob', oid], cwd: this.repoRoot, signal, binaryStdout: { maxBytes: size } })
    signal?.throwIfAborted()
    if (result.exitCode !== 0) throw diagnostic(['git', 'cat-file', 'blob', oid], result)
    if (!(result.stdoutBytes instanceof Uint8Array)) throw new Error('design git: subprocess adapter does not support exact binary stdout')
    const bytes = Buffer.from(result.stdoutBytes)
    const format = oid.length === 64 ? 'sha256' : 'sha1'
    if (bytes.length !== size || createHash(format).update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== oid) {
      throw new Error(`design git: committed blob integrity mismatch for ${JSON.stringify(path)}`)
    }
    return Uint8Array.from(bytes)
  }

  /** Ensure the repository exists and reject failed initialization. */
  async ensureRepo(signal?: AbortSignal): Promise<void> {
    if (this.nativeEnabled) { await this.nativeValue({ kind: 'init' }, signal); return }
    const probe = await this.run(['git', 'rev-parse', '--absolute-git-dir'], signal)
    if (probe.exitCode === 0 && probe.stdout.trim() === `${this.repoRoot}/.git`) return
    await this.requireSuccess(['git', 'init', '--quiet'], signal)
  }

  /** Resolve HEAD, or return undefined for a repository without commits. */
  async head(signal?: AbortSignal): Promise<string | undefined> {
    if (this.nativeEnabled) {
      const value = await this.nativeValue<{ head?: string }>({ kind: 'head' }, signal)
      if (value.head !== undefined) requireFullCommit(value.head)
      return value.head
    }
    const argv = ['git', 'rev-parse', '--verify', '--quiet', 'HEAD']
    const result = await this.run(argv, signal)
    if (result.exitCode === 1) return undefined
    if (result.exitCode !== 0) throw diagnostic(argv, result)
    const head = result.stdout.trim()
    if (head === '') throw new Error('design git: rev-parse returned an empty HEAD')
    return head
  }

  /** At most one version probe per second per repository, shared by UI readers. */
  async pollHead(signal?: AbortSignal): Promise<string | undefined> {
    signal?.throwIfAborted()
    const identities = await Promise.all([this.repoRoot, join(this.repoRoot, '.git')].map(async path => {
      try { const info = await lstat(path); return [info.dev, info.ino, info.birthtimeMs] }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    }))
    const identity = JSON.stringify(identities)
    let entry = polledHeads.get(this.repoRoot)
    if (!entry || entry.identity !== identity || entry.until <= Date.now()) {
      // A caller cancelling its UI request must not cancel another window's probe.
      const pending = this.head(AbortSignal.timeout(5000))
      entry = { identity, until: Infinity, pending }
      polledHeads.delete(this.repoRoot)
      polledHeads.set(this.repoRoot, entry)
      const owned = entry
      void pending.then(() => { owned.until = Date.now() + 1000 }, () => {
        if (polledHeads.get(this.repoRoot) === owned) polledHeads.delete(this.repoRoot)
      })
      while (polledHeads.size > 64) polledHeads.delete(polledHeads.keys().next().value!)
    }
    const result = await entry.pending
    signal?.throwIfAborted()
    return result
  }

  /** Writes invalidate the display hint; it never replaces write-time authority. */
  invalidatePolledHead(): void { polledHeads.delete(this.repoRoot) }

  /** Verify that one exact revision is reachable from another without changing refs or files. */
  async isAncestor(ancestor: string, descendant: string, signal?: AbortSignal): Promise<boolean> {
    requireFullCommit(ancestor)
    requireFullCommit(descendant)
    if (this.nativeEnabled) return (await this.nativeValue<{ isAncestor: boolean }>({ kind: 'ancestor', ancestor, descendant }, signal)).isAncestor
    const argv = ['git', 'merge-base', '--is-ancestor', ancestor, descendant]
    const result = await this.run(argv, signal)
    if (result.exitCode === 0) return true
    if (result.exitCode === 1) return false
    throw diagnostic(argv, result)
  }

  /** Read one text blob at an exact full commit id, or undefined when the path is absent. */
  async readTextAt(commit: string, path: string, signal?: AbortSignal): Promise<string | undefined> {
    requireFullCommit(commit)
    const repositoryPath = this.repositoryPath(path)
    if (this.nativeEnabled) {
      const value = await this.nativeValue<{ commitFound: boolean; entry?: { mode: number; oid: string } }>({ kind: 'entry', commit, path: repositoryPath }, signal)
      if (!value.commitFound) throw new Error('design git: committed revision was not found')
      if (value.entry === undefined) return undefined
      const entry = value.entry
      if (![0o100644, 0o100755, 0o120000].includes(entry.mode)) throw new Error('design git: committed text path is not a blob')
      const header = await this.nativeValue<{ found: boolean; kind?: string; size?: number }>({ kind: 'blob-header', oid: entry.oid }, signal)
      if (!header.found) return undefined
      if (header.kind !== 'blob' || !Number.isSafeInteger(header.size) || header.size! < 0) throw new Error('design git: invalid committed text blob header')
      const result = await this.nativeResult({ kind: 'blob', oid: entry.oid, size: header.size! }, signal)
      signal?.throwIfAborted()
      if (!(result.bytes instanceof Uint8Array)) throw new Error('design git: native executor did not return exact text bytes')
      const bytes = Buffer.from(result.bytes)
      if (bytes.length !== header.size || createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== entry.oid) throw new Error('design git: native committed blob integrity mismatch')
      return bytes.toString('utf8')
    }
    const object = `${commit}:${repositoryPath}`
    const readWithoutMetadata = async (): Promise<string | undefined> => {
      const argv = ['git', 'cat-file', '-e', object]
      const exists = await this.run(argv, signal)
      if (exists.exitCode === 1 || exists.exitCode === 128) return undefined
      if (exists.exitCode !== 0) throw diagnostic(argv, exists)
      return (await this.requireSuccess(['git', 'cat-file', 'blob', object], signal)).stdout
    }
    signal?.throwIfAborted()
    // One literal tree entry validates the revision and locates the blob.
    // Keep repository-relative paths even when the adapter cwd is below its root.
    const argv = ['git', 'ls-tree', '--full-tree', '-l', '-z', `${commit}^{commit}`, '--', `:(literal)${repositoryPath}`]
    const listed = await this.run(argv, signal)
    signal?.throwIfAborted()
    if (listed.exitCode === 128) {
      // A missing revision is an error in the text API. A present commit with
      // unavailable tree/path objects retains the existing absence behavior.
      await this.requireSuccess(['git', 'cat-file', '-e', `${commit}^{commit}`], signal)
      return readWithoutMetadata()
    }
    if (listed.exitCode !== 0) throw diagnostic(argv, listed)
    if (listed.stdout === '') return undefined
    const metadata = /^([0-7]{6}) (blob|tree|commit) ([a-f0-9]{40}(?:[a-f0-9]{24})?) +(-|BAD|[0-9]+)\t([^\0]+)\0$/u.exec(listed.stdout)
    if (metadata === null || metadata[0] !== listed.stdout || metadata[5] !== repositoryPath) {
      throw new Error(`design git: invalid committed tree entry for ${JSON.stringify(path)}`)
    }
    // Unlike binary artifact reads, this API can read symlink blobs. Existing
    // nonblob entries reject, while absent referenced objects remain undefined.
    if (metadata[2] !== 'blob' || metadata[4] === 'BAD') return readWithoutMetadata()
    const size = Number(metadata[4])
    if (metadata[4] === '-' || !Number.isSafeInteger(size) || size < 0) {
      throw new Error(`design git: invalid blob size ${JSON.stringify(metadata[4])}`)
    }
    return (await this.requireSuccess(['git', 'cat-file', 'blob', metadata[3]!], signal)).stdout
  }

  /** Read the full commit message at one exact revision. */
  async commitMessageAt(commit: string, signal?: AbortSignal): Promise<string> {
    requireFullCommit(commit)
    if (this.nativeEnabled) return this.pinnedRead(`message:${commit}`, async () =>
      (await this.nativeValue<{ message: string }>({ kind: 'message', commit }, signal)).message, signal)
    return this.pinnedRead(`message:${commit}`, async () =>
      (await this.requireSuccess(['git', 'show', '-s', '--format=%B', commit], signal)).stdout, signal)
  }

  /** Find the newest reachable commit whose message contains one fixed marker. */
  async latestCommitWithMessage(
    from: string,
    marker: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    requireFullCommit(from)
    if (marker === '' || /[\r\n\0]/u.test(marker)) throw new Error('design git: commit-message marker must be one line')
    if (this.nativeEnabled) return this.pinnedRead(JSON.stringify(['latest', from, marker]), async () =>
      (await this.nativeValue<{ commit?: string }>({ kind: 'latest-marker', from, marker }, signal)).commit, signal, true)
    // Git's default merge traversal is not equivalent to a time-sorted revwalk.
    return this.pinnedRead(JSON.stringify(['latest', from, marker]), async () => {
      const result = await this.requireSuccess([
        'git', 'log', '-1', '--format=%H', '--fixed-strings', `--grep=${marker}`, from,
      ], signal)
      const commit = result.stdout.trim()
      if (commit === '') return undefined
      requireFullCommit(commit)
      return commit
    }, signal, true)
  }

  /** Compare committed product evidence, not scores, review records or derived views. */
  async designEvidenceRevisionAt(commit: string, signal?: AbortSignal): Promise<string> {
    requireFullCommit(commit)
    signal?.throwIfAborted()
    const cached = this.evidenceRevisions.get(commit)
    if (cached !== undefined) return cached
    // Keep path, type, mode and blob identity, including binary artifacts and
    // project metadata. Only the system-owned derived namespace is excluded.
    const prefix = this.repositoryPath('_experiences')
    const stdout = this.nativeEnabled
      ? (await this.nativeTreeRecords(commit, signal, { fullRepository: true })).map(record => `${record}\0`).join('')
      : (await this.requireSuccess(['git', 'ls-tree', '-r', '-z', commit], signal)).stdout
    const records = stdout.split('\0')
    if (records.pop() !== '') throw new Error('design git: unterminated evidence tree')
    const evidence = records.filter(record => {
      const tab = record.indexOf('\t')
      if (tab < 0) throw new Error('design git: invalid evidence tree entry')
      const path = record.slice(tab + 1)
      requireListedPath(path)
      return path !== prefix && !path.startsWith(`${prefix}/`) && !isDesignProjectAuxiliaryPath(path)
    }).sort()
    const revision = createHash('sha256').update(JSON.stringify(evidence)).digest('hex')
    this.evidenceRevisions.set(commit, revision)
    if (this.evidenceRevisions.size > 256) this.evidenceRevisions.delete(this.evidenceRevisions.keys().next().value!)
    return revision
  }


  /** List safe file paths at one exact full commit id. */
  async listPathsAt(commit: string, signal?: AbortSignal): Promise<readonly string[]> {
    requireFullCommit(commit)
    return this.pinnedRead(`paths:${commit}`, () => this.listUncachedPathsAt(commit, signal), signal)
  }

  private async listUncachedPathsAt(commit: string, signal?: AbortSignal): Promise<readonly string[]> {
    // Peeling requires a commit target without a separate subprocess.
    const result = this.nativeEnabled
      ? { stdout: (await this.nativeTreeRecords(commit, signal)).map(record => `${record.slice(record.indexOf('\t') + 1)}\0`).join('') }
      : await this.requireSuccess(['git', 'ls-tree', '-r', '-z', '--name-only', `${commit}^{commit}`], signal)
    const encoded = result.stdout.split('\0')
    if (encoded.at(-1) !== '') throw new Error('design git: ls-tree returned a non-terminated path list')
    encoded.pop()
    const paths = new Set<string>()
    for (const path of encoded) {
      requireListedPath(path)
      const relative = this.pathPrefix === undefined
        ? path
        : path.startsWith(`${this.pathPrefix}/`)
          ? path.slice(this.pathPrefix.length + 1)
          : undefined
      if (relative === undefined) continue
      requireListedPath(relative)
      if (paths.has(relative)) throw new Error(`design git: ls-tree repeated path ${JSON.stringify(relative)}`)
      paths.add(relative)
    }
    return Object.freeze([...paths].sort())
  }

  private async nativeTreeRecords(commit: string, signal?: AbortSignal, options: { maxBytes?: number; fullRepository?: boolean; path?: string } = {}): Promise<string[]> {
    const pathPrefix = options.fullRepository ? undefined : options.path === undefined ? this.pathPrefix : this.repositoryPath(options.path)
    const value = await this.nativeValue<{ entries: { path: string; mode: number; oid: string; type: string }[] }>({ kind: 'tree', commit,
      ...(pathPrefix === undefined ? {} : { pathPrefix }), ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }) }, signal)
    if (!Array.isArray(value.entries)) throw new Error('design git: invalid native tree')
    return value.entries.map(entry => {
      requireListedPath(entry.path); requireFullCommit(entry.oid)
      if (![0o100644, 0o100755, 0o120000, 0o160000].includes(entry.mode)
        || entry.type !== (entry.mode === 0o160000 ? 'commit' : 'blob')) throw new Error('design git: invalid native tree entry')
      return `${entry.mode.toString(8).padStart(6, '0')} ${entry.type} ${entry.oid}\t${entry.path}`
    })
  }

  /** Immutable metadata for an optional facade-relative subtree; returned paths retain this facade's base. */
  async listEntriesAt(commit: string, signal?: AbortSignal, maxBytes?: number, path?: string): Promise<readonly GitTreeEntry[]> {
    requireFullCommit(commit)
    if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) throw new Error('design git: invalid tree metadata limit')
    const selected = path === undefined ? this.pathPrefix : this.repositoryPath(path)
    const literalPathspec = selected === undefined ? [] : ['--', `:(literal)${selected}`]
    const records = this.nativeEnabled ? await this.nativeTreeRecords(commit, signal, { maxBytes, path })
      : (await this.requireSuccess(['git', 'ls-tree', '-r', '-z', commit, ...literalPathspec], signal)).stdout.split('\0').filter(Boolean)
    let bytes = 0
    const entries: GitTreeEntry[] = []
    for (const record of records) {
      bytes += Buffer.byteLength(record) + 1
      if (maxBytes !== undefined && bytes > maxBytes) throw new Error('design git: tree metadata exceeds its declared limit')
      const match = /^([0-7]{6}) (blob|commit) ([a-f0-9]{40}(?:[a-f0-9]{24})?)\t([^\0]+)$/u.exec(record)
      if (match === null) throw new Error('design git: invalid immutable tree metadata')
      const path = match[4]!
      requireListedPath(path)
      if (this.pathPrefix !== undefined && !path.startsWith(`${this.pathPrefix}/`)) continue
      entries.push(Object.freeze({ path: this.pathPrefix === undefined ? path : path.slice(this.pathPrefix.length + 1), mode: Number.parseInt(match[1]!, 8), oid: match[3]!, type: match[2] as 'blob' | 'commit' }))
    }
    return Object.freeze(entries)
  }

  /** List tracked and untracked files currently present in this instance's worktree scope. */
  async listWorkingPaths(signal?: AbortSignal): Promise<readonly string[]> {
    if (this.nativeEnabled) {
      const value = await this.nativeValue<{ paths: string[] }>({ kind: 'status', ...(this.pathPrefix === undefined ? {} : { pathPrefix: this.pathPrefix }) }, signal)
      return Object.freeze(value.paths.map(path => {
        requireListedPath(path)
        const relative = this.pathPrefix === undefined ? path : path.slice(this.pathPrefix.length + 1)
        requireListedPath(relative)
        return relative
      }).sort())
    }
    const result = await this.requireSuccess([
      'git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', ...this.pathspec(),
    ], signal)
    const encoded = result.stdout.split('\0')
    if (encoded.at(-1) !== '') throw new Error('design git: ls-files returned a non-terminated path list')
    encoded.pop()
    const paths = new Set<string>()
    for (const path of encoded) {
      requireListedPath(path)
      const relative = this.pathPrefix === undefined
        ? path
        : path.startsWith(`${this.pathPrefix}/`)
          ? path.slice(this.pathPrefix.length + 1)
          : undefined
      if (relative === undefined) continue
      requireListedPath(relative)
      paths.add(relative)
    }
    return Object.freeze([...paths].sort())
  }

  /**
   * List present tracked/untracked files with filesystem metadata. Metadata is
   * only a cache hint; consumers must still read/hash bytes after it changes.
   */
  async listWorkingFiles(signal?: AbortSignal): Promise<readonly GitWorkingFile[]> {
    const paths = await this.listWorkingPaths(signal)
    const files: GitWorkingFile[] = []
    for (const path of paths) {
      signal?.throwIfAborted()
      const absolutePath = join(this.repoRoot, ...this.repositoryPath(path).split('/'))
      try {
        const info = await lstat(absolutePath)
        if (!info.isFile()) throw new Error(`design git: worktree path ${JSON.stringify(path)} is not a regular file`)
        files.push(Object.freeze({
          path,
          size: info.size,
          mtimeMs: info.mtimeMs,
          ctimeMs: info.ctimeMs,
          ino: info.ino,
        }))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        // A file can disappear between ls-files and lstat; the next poll will
        // observe the stable path set rather than treating it as present.
      }
    }
    return Object.freeze(files)
  }

  /** Reject an index already owned by another writer. */
  async assertCleanIndex(signal?: AbortSignal): Promise<void> {
    if (this.nativeEnabled) {
      const value = await this.nativeValue<{ cleanIndex: boolean }>({ kind: 'status' }, signal)
      if (!value.cleanIndex) throw new Error('design git: index contains changes outside the current Design Files transaction')
      return
    }
    const argv = ['git', 'diff', '--cached', '--quiet']
    const result = await this.run(argv, signal)
    if (result.exitCode === 0) return
    if (result.exitCode === 1) throw new Error('design git: index contains changes outside the current Design Files transaction')
    throw diagnostic(argv, result)
  }

  /** Reject tracked, staged, or untracked changes inside this instance's directory. */
  async assertCleanWorktree(signal?: AbortSignal): Promise<void> {
    if (this.nativeEnabled) {
      const value = await this.nativeValue<{ cleanWorktree: boolean }>({ kind: 'status', ...(this.pathPrefix === undefined ? {} : { pathPrefix: this.pathPrefix }) }, signal)
      if (!value.cleanWorktree) throw new Error('design git: worktree contains changes inside the current Design Files transaction scope')
      return
    }
    const argv = ['git', 'status', '--porcelain=v1', '-z', '--untracked-files=all', ...this.pathspec()]
    const result = await this.requireSuccess(argv, signal)
    if (result.stdout !== '') {
      throw new Error('design git: worktree contains changes inside the current Design Files transaction scope')
    }
  }

  /** Stage only the transaction's explicit files and create at most one commit. */
  async commit(message: string, paths: readonly string[], signal?: AbortSignal): Promise<string | undefined> {
    if (paths.length === 0) throw new Error('design git: a commit requires at least one explicit path')
    const files = new Map<string, Uint8Array | undefined>()
    for (const path of paths) {
      const repositoryPath = this.repositoryPath(path)
      const absolutePath = join(this.repoRoot, ...repositoryPath.split('/'))
      try {
        const info = await lstat(absolutePath)
        if (!info.isFile()) throw new Error(`design git: transaction path ${JSON.stringify(path)} is not a regular file`)
        files.set(path, Uint8Array.from(await readFile(absolutePath)))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        files.set(path, undefined)
      }
    }
    const expectedHead = await this.head(signal)
    return this.commitExact(message, files, expectedHead, signal)
  }

  /**
   * Build and commit a temporary-index tree from frozen bytes, then CAS HEAD.
   * The ordinary index and later worktree changes stay outside the commit.
   */
  async commitExact(
    message: string,
    files: ReadonlyMap<string, string | Uint8Array | undefined>,
    expectedHead: string | undefined,
    signal?: AbortSignal,
    forceCommit = false,
  ): Promise<string | undefined> {
    // Checkpoint-only callers ask for content authority, not an index-maintenance receipt.
    return (await this.commitExactReceipt(message, files, expectedHead, signal, forceCommit)).commit
  }

  /** Publish once at HEAD CAS; index maintenance can never revoke that committed fact. */
  async commitExactReceipt(
    message: string,
    files: ReadonlyMap<string, string | Uint8Array | undefined>,
    expectedHead: string | undefined,
    signal?: AbortSignal,
    forceCommit = false,
  ): Promise<GitCommitReceipt> {
    if (this.backend === 'native') {
      return this.commitNativeReceipt(message, files, expectedHead, signal, forceCommit)
    }
    // A terminal invocation audit is itself a durable fact even when the
    // Agent failed before creating its first Design File. In that one forced
    // case, commit the unchanged tree with the audit trailer.
    if (files.size === 0 && !forceCommit) throw new Error('design git: an exact commit requires at least one explicit path')
    const entries = [...files].map(([path, content]) => [this.repositoryPath(path), content] as const)
    const { format, head } = await this.publicationBasis(signal)
    if (head !== expectedHead) {
      throw new Error(`design git: publication revision is stale: expected ${JSON.stringify(expectedHead)}, latest is ${JSON.stringify(head)}`)
    }
    // Snapshot only the ordinary-index entries for paths this transaction may
    // publish. After the HEAD CAS, reconcile a path only when its index entry
    // is still byte-for-byte unchanged. Unrelated or externally staged entries
    // are never touched.
    const ordinaryIndexBefore = new Map<string, string>()
    const modes = new Map<string, string>()
    const unverifiedTreePaths = new Set<string>()
    for (const [path] of entries) {
      // An explicit path can become a directory when another entry writes a
      // descendant. Its final tree entry is not proven by its own index update.
      for (let slash = path.indexOf('/'); slash !== -1; slash = path.indexOf('/', slash + 1)) {
        unverifiedTreePaths.add(path.slice(0, slash))
      }
    }
    for (const [path] of entries) {
      // These observations are independent. Drain both before releasing this
      // preparation scope, even if one fails or cancellation wins meanwhile.
      const [index, baseline] = await Promise.allSettled([
        this.requireSuccess(['git', 'ls-files', '--stage', '--', path], signal),
        head === undefined ? Promise.resolve({ stdout: '', stderr: '' })
          : this.requireSuccess(['git', 'ls-tree', head, '--', path], signal),
      ])
      if (index.status === 'rejected') throw index.reason
      if (baseline.status === 'rejected') throw baseline.reason
      signal?.throwIfAborted()
      const indexEntry = index.value.stdout
      const baseTreeEntry = baseline.value.stdout.trim()
      const baseMatch = /^(100644|100755) blob ([a-f0-9]+)\t/.exec(baseTreeEntry)
      const baseIndexEntry = baseMatch === null ? '' : `${baseMatch[1]} ${baseMatch[2]} 0\t${path}\n`
      modes.set(path, baseTreeEntry.startsWith('100755 ') ? '100755' : '100644')
      if (baseTreeEntry !== '' && baseMatch === null) unverifiedTreePaths.add(path)
      if (indexEntry === baseIndexEntry) ordinaryIndexBefore.set(path, indexEntry)
    }
    const temporary = await mkdtemp(join(tmpdir(), 'dsh-design-git-write-'))
    const env = { GIT_INDEX_FILE: join(temporary, 'index') }
    // Only this transaction owns these explicit regular-blob entries. Each
    // object id is checked against the frozen bytes, and update-index must
    // accept every entry before write-tree and HEAD CAS can succeed. Reuse
    // those immutable facts, not another query against the published tree.
    const publishedIndexEntries = new Map<string, string | undefined>()
    try {
      await this.requireSuccess(head === undefined ? ['git', 'read-tree', '--empty'] : ['git', 'read-tree', head], signal, env)
      for (const [index, [path, content]] of entries.entries()) {
        if (content === undefined) {
          await this.requireSuccess(['git', 'update-index', '--force-remove', '--', path], signal, env)
          if (!unverifiedTreePaths.has(path)) publishedIndexEntries.set(path, undefined)
          continue
        }
        const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content)
        const expected = createHash(format).update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
        const source = join(temporary, `blob-${index}`)
        await writeFile(source, bytes)
        const actual = (await this.requireSuccess(['git', 'hash-object', '-w', '--', source], signal)).stdout.trim()
        if (actual !== expected) throw new Error(`design git: frozen blob hash mismatch for ${JSON.stringify(path)}`)
        const entry = `${modes.get(path)!},${actual},${path}`
        await this.requireSuccess(['git', 'update-index', '--add', '--cacheinfo', entry], signal, env)
        if (!unverifiedTreePaths.has(path)) publishedIndexEntries.set(path, entry)
      }
      const tree = (await this.requireSuccess(['git', 'write-tree'], signal, env)).stdout.trim()
      let change: 'changed' | 'unchanged' = 'changed'
      if (head !== undefined) {
        const priorTree = (await this.requireSuccess(['git', 'rev-parse', `${head}^{tree}`], signal)).stdout.trim()
        if (tree === priorTree) change = 'unchanged'
        if (tree === priorTree && !forceCommit) {
          return {}
        }
      }
      const commit = (await this.requireSuccess([
        'git', '-c', 'user.name=dsh-design', '-c', 'user.email=dsh-design@local',
        'commit-tree', tree, ...(head === undefined ? [] : ['-p', head]), '-m', message,
      ], signal)).stdout.trim()
      const zero = '0'.repeat(format === 'sha1' ? 40 : 64)
      await this.requireSuccess(['git', 'update-ref', 'HEAD', commit, head ?? zero], signal)
      try {
        await this.reconcileIndex(commit, ordinaryIndexBefore, publishedIndexEntries, temporary, signal)
        return { commit, change }
      } catch (error) {
        return { commit, change, indexMaintenance: { state: 'deferred', message: String(error instanceof Error ? error.message : error).slice(0, 2048) } }
      }
    } finally {
      await rm(temporary, { recursive: true, force: true }).catch(() => {})
    }
  }

  /** Native objects/ref publication; the existing post-commit index owner is reused. */
  private async commitNativeReceipt(
    message: string,
    files: ReadonlyMap<string, string | Uint8Array | undefined>,
    expectedHead: string | undefined,
    signal?: AbortSignal,
    forceCommit = false,
  ): Promise<GitCommitReceipt> {
    if (files.size === 0 && !forceCommit) throw new Error('design git: an exact commit requires at least one explicit path')
    const entries = [...files].map(([path, content]) => [this.repositoryPath(path), content === undefined
      ? undefined : typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content)] as const)
    for (const [path, bytes] of entries) if (bytes !== undefined && entries.some(([child, content]) => content !== undefined && child.startsWith(`${path}/`))) {
      throw new Error('design git: conflicting regular parent and child publication paths')
    }
    const { format, head } = await this.publicationBasis(signal)
    if (format !== 'sha1') throw new Error('design git native: unsupported-object-format')
    if (head !== expectedHead) throw new Error('design git: publication revision is stale')
    const before = new Map<string, string>(), modes = new Map<string, number>()
    const indexSnapshot = await this.nativeValue<{ entries?: Readonly<Record<string, string>>; unavailable?: 'unsupported-index' }>({ kind: 'index-read', paths: entries.map(([path]) => path) }, signal)
    if (indexSnapshot.entries === undefined && indexSnapshot.unavailable !== 'unsupported-index') throw new Error('design git: invalid native index snapshot')
    const unverified = new Set<string>()
    for (const [path] of entries) for (let slash = path.indexOf('/'); slash !== -1; slash = path.indexOf('/', slash + 1)) unverified.add(path.slice(0, slash))
    for (const [path] of entries) {
      const baseline = head === undefined ? { commitFound: true, entry: undefined }
        : await this.nativeValue<{ commitFound: boolean; entry?: { oid: string; mode: number } }>({ kind: 'entry', commit: head, path }, signal)
      signal?.throwIfAborted()
      if (!baseline.commitFound) throw new Error('design git: native baseline commit disappeared')
      const old = baseline.entry
      if (old !== undefined) requireFullCommit(old.oid)
      const regular = old !== undefined && (old.mode === 0o100644 || old.mode === 0o100755)
      const prior = regular ? `${old.mode.toString(8)} ${old.oid} 0\t${path}\n` : ''
      if (indexSnapshot.entries?.[path] === prior) before.set(path, prior)
      modes.set(path, old?.mode === 0o100755 ? 0o100755 : 0o100644)
      if (old !== undefined && !regular) unverified.add(path)
    }
    const temporary = await mkdtemp(join(tmpdir(), 'dsh-design-git-write-'))
    const frozen: NativeGitFile[] = [], published = new Map<string, string | undefined>()
    try {
      for (const [i, [path, bytes]] of entries.entries()) {
        const mode = modes.get(path)!
        if (bytes === undefined) {
          frozen.push({ path, mode }); if (!unverified.has(path)) published.set(path, undefined)
        } else {
          const oid = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
          const source = join(temporary, `blob-${i}`)
          await writeFile(source, bytes)
          frozen.push({ path, mode, source, oid })
          if (!unverified.has(path)) published.set(path, `${mode.toString(8)},${oid},${path}`)
        }
      }
      signal?.throwIfAborted()
      const response = await this.nativeResult({
        kind: 'publish', expectedHead: head, message, stagingRoot: temporary, files: frozen, forceCommit,
      }, signal)
      const value = response.value as { commit?: string; change?: 'changed' | 'unchanged' }
      if (value.commit === undefined) return {}
      requireFullCommit(value.commit)
      if (value.change !== 'changed' && value.change !== 'unchanged') throw new Error('design git: invalid native publication receipt')
      if (response.publicationScopeInvalidated) return { commit: value.commit, change: value.change, indexMaintenance: {
        state: 'deferred', message: 'native publication committed before its save scope was invalidated',
      } }
      if (indexSnapshot.unavailable) return { commit: value.commit, change: value.change, indexMaintenance: {
        state: 'deferred', message: 'ordinary index representation is unsupported; its bytes were preserved without maintenance',
      } }
      try {
        await this.reconcileNativeIndex(value.commit, before, published, signal)
        return { commit: value.commit, change: value.change }
      } catch (error) {
        return { commit: value.commit, change: value.change, indexMaintenance: {
          state: 'deferred', message: String(error instanceof Error ? error.message : error).slice(0, 2048),
        } }
      }
    } finally { await rm(temporary, { recursive: true, force: true }).catch(() => {}) }
  }

  /** Preserve the existing owned-lock/index snapshot boundary using library bytes. */
  private async reconcileNativeIndex(
    commit: string, before: ReadonlyMap<string, string>, publishedEntries: ReadonlyMap<string, string | undefined>, signal?: AbortSignal,
  ): Promise<void> {
    if (before.size === 0) return
    const facts = await this.nativeValue<NativeGitInspection>({ kind: 'inspect' }, signal)
    const indexPath = facts.indexPath, lockPath = `${indexPath}.lock`
    const lock = await open(lockPath, 'wx')
    let ownsLock = true
    try {
      if (await this.head(signal) !== commit) throw new Error('design git: index maintenance deferred because HEAD advanced')
      let bytes: Buffer | undefined
      try { bytes = await readFile(indexPath) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const snapshot = await this.nativeValue<{ entries?: Readonly<Record<string, string>> }>({ kind: 'index-read', bytes: bytes?.toString('base64') ?? null, paths: [...before.keys()] }, signal)
      if (snapshot.entries === undefined) throw new Error('design git: ordinary index changed to an unsupported representation; maintenance deferred')
      const updates: { path: string; oid?: string; mode?: number }[] = []
      for (const [path, previous] of before) {
        if (snapshot.entries[path] !== previous) continue
        let published = publishedEntries.get(path)
        if (!publishedEntries.has(path)) {
          const value = await this.nativeValue<{ commitFound: boolean; entry?: { mode: number; oid: string } }>({ kind: 'entry', commit, path }, signal)
          if (!value.commitFound) throw new Error('design git: published commit disappeared during index maintenance')
          if (value.entry !== undefined) {
            if (value.entry.mode !== 0o100644 && value.entry.mode !== 0o100755) throw new Error('design git: invalid published tree entry during index maintenance')
            published = `${value.entry.mode.toString(8)},${value.entry.oid},${path}`
          }
        }
        if (published === undefined) updates.push({ path })
        else {
          const first = published.indexOf(','), second = published.indexOf(',', first + 1)
          updates.push({ path, mode: Number.parseInt(published.slice(0, first), 8), oid: published.slice(first + 1, second) })
        }
      }
      if (updates.length === 0) return
      const updated = await this.nativeValue<{ bytes: string }>({ kind: 'index-update', ...(bytes === undefined ? {} : { bytes: bytes.toString('base64') }), updates }, signal)
      if (await this.head(signal) !== commit) throw new Error('design git: index maintenance deferred because HEAD advanced')
      await lock.writeFile(Buffer.from(updated.bytes, 'base64'))
      await lock.close()
      signal?.throwIfAborted()
      await rename(lockPath, indexPath)
      ownsLock = false
    } finally {
      await lock.close().catch(() => {})
      if (ownsLock) await rm(lockPath, { force: true })
    }
  }

  /** Hold our own Git index lock while comparing and atomically replacing its snapshot. */
  private async reconcileIndex(
    commit: string,
    before: ReadonlyMap<string, string>,
    publishedEntries: ReadonlyMap<string, string | undefined>,
    temporary: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (before.size === 0) return
    const named = (await this.requireSuccess(['git', 'rev-parse', '--git-path', 'index'], signal)).stdout.trim()
    const indexPath = isAbsolute(named) ? named : resolve(this.repoRoot, named)
    const lockPath = `${indexPath}.lock`
    const lock = await open(lockPath, 'wx')
    let ownsLock = true
    try {
      if (await this.head(signal) !== commit) throw new Error('design git: index maintenance deferred because HEAD advanced')
      const maintenanceIndex = join(temporary, 'maintenance-index')
      let bytes: Buffer | undefined
      try { bytes = await readFile(indexPath) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const env = { GIT_INDEX_FILE: maintenanceIndex }
      if (bytes === undefined) await this.requireSuccess(['git', 'read-tree', '--empty'], signal, env)
      else await writeFile(maintenanceIndex, bytes)
      let changed = false
      for (const [path, snapshot] of before) {
        const current = (await this.requireSuccess(['git', 'ls-files', '--stage', '--', path], signal, env)).stdout
        if (current !== snapshot) continue
        let published = publishedEntries.get(path)
        if (!publishedEntries.has(path)) {
          // Structural replacements are not regular-blob facts. Retain the
          // published-tree check and its non-regular-entry guard for them.
          const entry = (await this.requireSuccess(['git', 'ls-tree', commit, '--', path], signal)).stdout.trim()
          if (entry !== '') {
            const match = /^(100644|100755) blob ([a-f0-9]+)\t/u.exec(entry)
            if (match === null) throw new Error(`design git: invalid published tree entry for ${JSON.stringify(path)}`)
            published = `${match[1]},${match[2]},${path}`
          }
        }
        if (published === undefined) await this.requireSuccess(['git', 'update-index', '--force-remove', '--', path], signal, env)
        else await this.requireSuccess(['git', 'update-index', '--add', '--cacheinfo', published], signal, env)
        changed = true
      }
      if (!changed) return
      if (await this.head(signal) !== commit) throw new Error('design git: index maintenance deferred because HEAD advanced')
      await lock.writeFile(await readFile(maintenanceIndex))
      await lock.close()
      await rename(lockPath, indexPath)
      ownsLock = false
    } finally {
      await lock.close().catch(() => {})
      if (ownsLock) await rm(lockPath, { force: true })
    }
  }

  /** Read one committed transaction diff. */
  async diffCommit(commit: string, signal?: AbortSignal): Promise<string> {
    requireFullCommit(commit)
    if (this.nativeEnabled) return (await this.nativeValue<{ diff: string }>({ kind: 'diff-commit', commit, ...(this.pathPrefix === undefined ? {} : { pathPrefix: this.pathPrefix }) }, signal)).diff
    const result = await this.requireSuccess([
      'git', 'show', '--format=', '--no-ext-diff', commit, ...this.pathspec(),
    ], signal)
    return result.stdout
  }

  /** Read the committed changes since a baseline. */
  async diffSince(baseline?: string, signal?: AbortSignal): Promise<string> {
    if (this.nativeEnabled) return (await this.nativeValue<{ diff: string }>({ kind: 'diff-since', ...(baseline === undefined ? {} : { baseline }), ...(this.pathPrefix === undefined ? {} : { pathPrefix: this.pathPrefix }) }, signal)).diff
    const result = await this.requireSuccess([
      'git', 'diff', baseline ?? 'HEAD~1', 'HEAD', ...this.pathspec(),
    ], signal)
    return result.stdout
  }

  /** Read a bounded newest-first history, optionally for one exact child path. */
  async history(limit: number, path?: string, signal?: AbortSignal): Promise<readonly GitHistoryEntry[]> {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('design git: history limit must be a positive safe integer')
    if (path !== undefined) requireListedPath(path)
    if (this.nativeEnabled) return Object.freeze((await this.nativeValue<{ entries: GitHistoryEntry[] }>({ kind: 'history', limit, ...(this.pathPrefix === undefined ? {} : { pathPrefix: this.pathPrefix }), ...(path === undefined ? {} : { path }) }, signal)).entries.map(entry => Object.freeze(entry)))
    const result = await this.requireSuccess([
      'git', 'log', `--max-count=${limit}`, '--format=%H%x09%cI%x09%s', ...this.pathspec(path),
    ], signal)
    return historyEntries(result.stdout)
  }

  /** Page a fixed checkpoint's newest-first history; later HEAD changes do not shift the page. */
  async historyAt(commit: string, limit: number, path?: string, signal?: AbortSignal, offset = 0): Promise<readonly GitHistoryEntry[]> {
    requireFullCommit(commit)
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('design git: history limit must be a positive safe integer')
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('design git: history offset must be a non-negative safe integer')
    if (path !== undefined) requireListedPath(path)
    signal?.throwIfAborted()
    if (this.nativeEnabled) {
      const result = await this.nativeValue<{ entries: GitHistoryEntry[] }>({ kind: 'history', from: commit, limit, offset,
        ...(this.pathPrefix === undefined ? {} : { pathPrefix: this.pathPrefix }), ...(path === undefined ? {} : { path }) }, signal)
      signal?.throwIfAborted()
      return Object.freeze(result.entries.map(entry => Object.freeze(entry)))
    }
    const selected = path === undefined ? this.pathPrefix : this.repositoryPath(path)
    const result = await this.requireSuccess([
      'git', 'log', `--max-count=${limit}`, `--skip=${offset}`, '--format=%H%x09%cI%x09%s', commit,
      ...(selected === undefined ? [] : ['--', `:(literal)${selected}`]),
    ], signal)
    signal?.throwIfAborted()
    return historyEntries(result.stdout)
  }

  /** Read the exact committed diff between two full object ids. */
  async diffBetween(from: string, to: string, path?: string, signal?: AbortSignal): Promise<string> {
    requireFullCommit(from)
    requireFullCommit(to)
    if (path !== undefined) requireListedPath(path)
    if (this.nativeEnabled) return (await this.nativeValue<{ diff: string }>({ kind: 'diff-between', from, to, ...(this.pathPrefix === undefined ? {} : { pathPrefix: this.pathPrefix }), ...(path === undefined ? {} : { path }) }, signal)).diff
    await this.requireSuccess(['git', 'cat-file', '-e', `${from}^{commit}`], signal)
    await this.requireSuccess(['git', 'cat-file', '-e', `${to}^{commit}`], signal)
    const result = await this.requireSuccess([
      'git', 'diff', '--no-ext-diff', from, to, ...this.pathspec(path),
    ], signal)
    return result.stdout
  }
}
