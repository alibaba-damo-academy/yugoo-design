/** Shared Agent-facing read projection over the existing Git authority. */
import type { GitVersioning } from './git.ts'

export const DESIGN_GIT_READ_ACTIONS = ['status', 'history', 'message', 'diff', 'list', 'read'] as const
export const DESIGN_GIT_READ_DESCRIPTION = 'Read the explicitly selected Design Project through library Git, without a system Git command. status observes the current worktree; history reads log entries; message reads a full commit message; diff shows one commit, or compares from to checkpoint; list enumerates committed paths; read reads an exact historical regular file. Paths are repository-relative, including design_files/. No root, argv, writes, checkout, rollback or publication. Omit checkpoint only on the first page to capture HEAD; retain the returned project/checkpoint, from and path on every nextOffset. Text offsets are UTF-16 code units; history/list offsets are entries. Follow nextOffset until complete, never treat a partial page as the full diff or file. Use from for a path-filtered diff. A historical file over 16 MiB or tree listing over 2 MiB is explicitly rejected, not truncated; narrow listings with path. Binary files report metadata, not invented text. Native child Agents must supply exact project and checkpoint pins from their delegated context.'

export interface DesignGitReadArguments {
  action: typeof DESIGN_GIT_READ_ACTIONS[number]
  project?: string
  checkpoint?: string
  from?: string
  path?: string
  limit?: number
  offset?: number
}

export interface DesignGitReadPorts {
  readonly git: GitVersioning
  readonly projectId: string
  readonly status: (signal?: AbortSignal) => Promise<{ head?: string; porcelain: string }>
}

const PAGE_CHARACTERS = 16_384
const MAX_FILE_BYTES = 16 * 1024 * 1024
const MAX_TREE_BYTES = 2 * 1024 * 1024

function fullCommit(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(value)) throw new Error('Design Git reads require full lowercase commit IDs')
}

function readPath(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.startsWith('/') || value.endsWith('/')
    || /[\\:\u0000-\u001f\u007f]/u.test(value)
    || value.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) {
    throw new Error('Design Git reads require a safe repository-relative path')
  }
}

/** Fail closed for unsupported operations and parameters instead of interpreting argv. */
export function designGitReadArguments(input: unknown): DesignGitReadArguments {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Design Git read arguments are required')
  const value = input as Record<string, unknown>
  const keys = new Set(['action', 'project', 'checkpoint', 'from', 'path', 'limit', 'offset'])
  if (Object.keys(value).some(key => !keys.has(key)) || !DESIGN_GIT_READ_ACTIONS.includes(value.action as DesignGitReadArguments['action'])) throw new Error('Unsupported Design Git read operation or parameter')
  if (value.project !== undefined && (typeof value.project !== 'string' || !value.project || value.project.length > 256)) throw new Error('Invalid Design Git project pin')
  if (value.checkpoint !== undefined) fullCommit(value.checkpoint)
  if (value.from !== undefined) fullCommit(value.from)
  if (value.path !== undefined) readPath(value.path)
  if (value.limit !== undefined && (!Number.isSafeInteger(value.limit) || Number(value.limit) < 1 || Number(value.limit) > 50)) throw new Error('Design Git page limit must be between 1 and 50')
  if (value.offset !== undefined && (!Number.isSafeInteger(value.offset) || Number(value.offset) < 0)) throw new Error('Invalid Design Git page offset')
  if (Number(value.offset ?? 0) > 0 && value.checkpoint === undefined) throw new Error('Design Git continuation requires the exact checkpoint from the first page')
  if (value.from !== undefined && value.action !== 'diff') throw new Error('from is available only for a version comparison')
  if (value.path !== undefined && !['history', 'diff', 'list', 'read'].includes(String(value.action))) throw new Error('This Design Git action does not accept a path')
  if (value.action === 'diff' && value.path !== undefined && value.from === undefined) throw new Error('A path-filtered diff requires both from and checkpoint')
  if (value.action === 'read' && value.path === undefined) throw new Error('Historical file reads require a path')
  if (value.limit !== undefined && !['history', 'list'].includes(String(value.action))) throw new Error('limit is available only for history or path lists')
  if (value.action === 'status' && Number(value.offset ?? 0) !== 0) throw new Error('Live status has no stable pagination cursor')
  return { ...value } as unknown as DesignGitReadArguments
}

function textPage(text: string, offset: number) {
  if (offset > text.length || (offset > 0 && /[\uD800-\uDBFF]/u.test(text[offset - 1]!) && /[\uDC00-\uDFFF]/u.test(text[offset] ?? ''))) throw new Error('Invalid text continuation offset')
  let end = Math.min(text.length, offset + PAGE_CHARACTERS)
  if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1]!) && /[\uDC00-\uDFFF]/u.test(text[end]!)) end--
  return { text: text.slice(offset, end), page: { offset, nextOffset: end < text.length ? end : null,
    complete: end === text.length, totalCharacters: text.length, offsetUnit: 'utf16-code-units' as const } }
}

/** Read immutable data at explicit pins; the Host alone supplies repository identity. */
export async function readDesignGit(ports: DesignGitReadPorts, input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  signal?.throwIfAborted()
  const args = designGitReadArguments(input)
  if (args.project !== undefined && args.project !== ports.projectId) throw new Error('Design Git project pin no longer matches the Host binding')
  const head = await ports.git.head(signal)
  const checkpoint = args.checkpoint ?? head
  if (checkpoint === undefined) throw new Error('No committed Design Project checkpoint is available')
  fullCommit(checkpoint)
  if (head === undefined || (checkpoint !== head && !await ports.git.isAncestor(checkpoint, head, signal))) throw new Error('Design Git checkpoint is outside the selected project history')
  const base = { project: ports.projectId, checkpoint, action: args.action, ...(args.path === undefined ? {} : { path: args.path }) }
  const offset = args.offset ?? 0, limit = args.limit ?? 20
  let result: Record<string, unknown>
  switch (args.action) {
    case 'status': {
      if (checkpoint !== head) throw new Error('Live status cannot describe a historical checkpoint')
      const value = await ports.status(signal)
      if (value.head !== head || await ports.git.head(signal) !== head) throw new Error('Design Git HEAD changed during live status; request a fresh observation')
      if (Buffer.byteLength(value.porcelain) > 256 * 1024) throw new Error('Live status exceeds the bounded Agent response size')
      result = { ...value, dirty: value.porcelain !== '', live: true, complete: true }
      break
    }
    case 'history': {
      const entries = await ports.git.historyAt(checkpoint, limit + 1, args.path, signal, offset)
      const more = entries.length > limit
      result = { entries: entries.slice(0, limit), page: { offset, nextOffset: more ? offset + limit : null, complete: !more, offsetUnit: 'entries' } }
      if (Buffer.byteLength(JSON.stringify(result)) > 256 * 1024) throw new Error('History page exceeds the bounded Agent response size; request fewer entries')
      break
    }
    case 'message': result = textPage(await ports.git.commitMessageAt(checkpoint, signal), offset); break
    case 'diff': {
      if (args.from !== undefined && args.from !== head && !await ports.git.isAncestor(args.from, head, signal)) throw new Error('Comparison baseline is outside the selected project history')
      const text = args.from === undefined ? await ports.git.diffCommit(checkpoint, signal)
        : await ports.git.diffBetween(args.from, checkpoint, args.path, signal)
      result = { comparison: args.from === undefined ? { mode: 'commit', to: checkpoint }
        : { mode: 'between', from: args.from, to: checkpoint }, ...textPage(text, offset) }
      break
    }
    case 'list': {
      const entries = (await ports.git.listEntriesAt(checkpoint, signal, MAX_TREE_BYTES, args.path)).filter(entry =>
        args.path === undefined || entry.path === args.path || entry.path.startsWith(`${args.path}/`))
      if (offset > entries.length) throw new Error('Invalid committed path continuation offset')
      const end = Math.min(entries.length, offset + limit)
      result = { entries: entries.slice(offset, end), page: { offset, nextOffset: end < entries.length ? end : null,
        complete: end === entries.length, totalEntries: entries.length, offsetUnit: 'entries' } }
      break
    }
    case 'read': {
      const bytes = await ports.git.readBytesAt(checkpoint, args.path!, signal, MAX_FILE_BYTES)
      if (bytes === undefined) { result = { found: false }; break }
      const oid = await ports.git.blobOidAt(checkpoint, args.path!, signal)
      let text: string | undefined
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch { /* Binary evidence is not fabricated text. */ }
      if (text === undefined || text.includes('\0')) {
        if (offset !== 0) throw new Error('Binary metadata has no text continuation')
        result = { found: true, oid, size: bytes.length, kind: 'binary', contentIncluded: false }
      } else result = { found: true, oid, size: bytes.length, kind: 'text', encoding: 'utf8', ...textPage(text, offset) }
      break
    }
  }
  signal?.throwIfAborted()
  return { ...base, ...result }
}
