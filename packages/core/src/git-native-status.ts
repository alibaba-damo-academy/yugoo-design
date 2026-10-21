/** Working-tree/index status using the in-process Git library only. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FileStatus, Repository } from 'yugoo-design-git-native'
import { NativeGitError } from './git-native-contract.ts'
import { readLibraryIndex } from './git-index-library.ts'

export interface NativeStatus {
  readonly paths: string[]
  readonly cleanIndex: boolean
  readonly cleanWorktree: boolean
  readonly porcelain: string
}

function requirePath(path: string): void {
  if (!path || path.startsWith('/') || path.endsWith('/') || path.includes('\\') || path.includes('\0')
    || path.split('/').some(part => !part || part === '.' || part === '..' || part === '.git')) throw new NativeGitError('invalid-request')
}

function quotePathSetting(repo: Repository): boolean {
  try { return repo.config().getBoolean('core.quotepath') }
  catch (error) {
    if ((error as { code?: string }).code !== 'NotFound') throw error
    return true
  }
}

/** Porcelain v1 uses C quoting, including UTF-8 byte octals by default. */
function quoted(path: string, quoteHighBytes: boolean): string {
  const escapes = new Map<number, string>([[7, '\\a'], [8, '\\b'], [9, '\\t'], [10, '\\n'], [11, '\\v'], [12, '\\f'], [13, '\\r'], [34, '\\"'], [92, '\\\\']])
  const bytes = Buffer.from(path, 'utf8')
  let needsQuotes = false
  const parts: Buffer[] = []
  for (const byte of bytes) {
    const escape = escapes.get(byte)
    if (escape !== undefined) { needsQuotes = true; parts.push(Buffer.from(escape)) }
    else if (byte < 32 || byte === 127 || (quoteHighBytes && byte >= 128)) {
      needsQuotes = true
      parts.push(Buffer.from(`\\${byte.toString(8).padStart(3, '0')}`))
    } else parts.push(Buffer.from([byte]))
  }
  const value = Buffer.concat(parts).toString('utf8')
  return needsQuotes ? `"${value}"` : value
}

function indexChanged(status: FileStatus): boolean {
  return status.isConflicted || status.isIndexNew || status.isIndexModified || status.isIndexDeleted || status.isIndexRenamed || status.isIndexTypechange
}
function worktreeChanged(status: FileStatus): boolean {
  return status.isWtNew || status.isWtModified || status.isWtDeleted || status.isWtTypechange || status.isWtRenamed
}
function indexLetter(status: FileStatus): string {
  if (status.isIndexDeleted) return 'D'
  if (status.isIndexNew) return 'A'
  if (status.isIndexTypechange) return 'T'
  if (status.isIndexModified) return 'M'
  return ' '
}
function worktreeLetter(status: FileStatus): string {
  if (status.isWtDeleted) return 'D'
  if (status.isWtTypechange) return 'T'
  if (status.isWtModified) return 'M'
  return ' '
}

const conflictLetters = ['', 'DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'] as const
function conflictStatus(lines: string | undefined): string {
  let mask = 0
  for (const line of (lines ?? '').split('\n')) {
    if (!line) continue
    const match = /^[0-7]+ [0-9a-f]{40} ([123])\t/u.exec(line)
    if (match === null) throw new NativeGitError('native-operation-failed')
    mask |= 1 << (Number(match[1]) - 1)
  }
  const letters = conflictLetters[mask]
  if (!letters) throw new NativeGitError('native-operation-failed')
  return letters
}

/**
 * Paths are repository-relative, and the prefix is literal. Index cleanliness
 * is repository-wide; worktree cleanliness and display use the selected scope.
 * Rename detection is deliberately disabled: FileStatus does not supply both
 * rename paths, so an actual rename is truthfully displayed as deletion/addition.
 */
export async function nativeStatus(repo: Repository, pathPrefix?: string): Promise<NativeStatus> {
  if (pathPrefix !== undefined) requirePath(pathPrefix)
  const statuses = repo.statuses({ includeUnmodified: true, includeUntracked: true, recurseUntrackedDirs: true,
    renamesHeadToIndex: false, renamesIndexToWorkdir: false })
  const byPath = statuses.map(status => {
    // A lossy filename could point at another file. Do not replace undefined
    // with a guessed/replacement-character path, even outside the prefix.
    if (status.path === undefined) throw new NativeGitError('native-operation-failed')
    requirePath(status.path)
    if (status.isIndexRenamed || status.isWtRenamed || (status.bits & 0x1000) !== 0) throw new NativeGitError('native-operation-failed')
    return { path: status.path, status }
  }).sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))
  const selected = byPath.filter(({ path }) => pathPrefix === undefined || path === pathPrefix || path.startsWith(`${pathPrefix}/`))
  const conflicted = selected.filter(({ status }) => status.isConflicted).map(({ path }) => path)
  // libgit2's JS status record does not expose CE_INTENT_TO_ADD and reports it
  // as an ordinary staged addition. The owning codec supports exact v2 index
  // snapshots only: validate additions before trusting those flags, so an
  // extended v3 intent entry fails explicitly instead of inventing staging.
  const additions = byPath.filter(({ status }) => status.isIndexNew).map(({ path }) => path)
  let stages: Readonly<Record<string, string>> = {}
  if (conflicted.length || additions.length) {
    let bytes: Buffer | undefined
    try { bytes = await readFile(join(repo.path(), 'index')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    stages = await readLibraryIndex(bytes, [...new Set([...conflicted, ...additions])])
  }
  const quote = quotePathSetting(repo), lines: string[] = [], untracked: string[] = [], paths = new Set<string>()
  for (const { path, status } of selected) {
    if (status.isIgnored) continue
    if (!status.isIndexDeleted || status.isWtNew) paths.add(path)
    const display = quoted(path, quote)
    if (status.isConflicted) { lines.push(`${conflictStatus(stages[path])} ${display}\n`); continue }
    const x = indexLetter(status), y = worktreeLetter(status)
    if (x !== ' ' || y !== ' ') lines.push(`${x}${y} ${display}\n`)
    // A staged deletion can coexist with a new untracked file at that path.
    if (status.isWtNew) untracked.push(`?? ${display}\n`)
  }
  return {
    paths: [...paths].sort(),
    cleanIndex: !byPath.some(({ status }) => indexChanged(status)),
    cleanWorktree: !selected.some(({ status }) => !status.isIgnored && (indexChanged(status) || worktreeChanged(status))),
    porcelain: lines.concat(untracked).join(''),
  }
}
