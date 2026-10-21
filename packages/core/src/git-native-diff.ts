/** Native, read-only committed diffs. No working-tree reads or child processes. */
import { type Commit, type Repository, type Tree } from 'yugoo-design-git-native'
import { NativeGitError } from './git-native-contract.ts'

function commitAt(repo: Repository, id: string): Commit {
  if (/^[a-f0-9]{64}$/u.test(id)) throw new NativeGitError('unsupported-object-format')
  if (!/^[a-f0-9]{40}$/u.test(id)) throw new NativeGitError('invalid-request')
  const commit = repo.findCommit(id)
  if (commit === null) throw new NativeGitError('commit-not-found')
  return commit
}

function checkedPath(value: string): string {
  if (!value || value.startsWith('/') || value.endsWith('/') || value.includes('\\')
    || /[\u0000-\u001f\u007f]/u.test(value)
    || value.split('/').some(part => !part || part === '.' || part === '..' || part === '.git')) {
    throw new NativeGitError('invalid-request')
  }
  return value
}

function selected(prefix?: string, path?: string): (candidate: string) => boolean {
  if (prefix !== undefined) checkedPath(prefix)
  if (path !== undefined) checkedPath(path)
  const exact = path === undefined ? prefix : prefix === undefined ? path : `${prefix}/${path}`
  // A listed child can itself be a directory. Metacharacters are filenames,
  // never pathspec syntax; in particular [] and * do not widen this scope.
  return exact === undefined ? () => true : candidate => candidate === exact || candidate.startsWith(`${exact}/`)
}

interface FilePatch { path: string; patch: string }
function normalizePatch(patch: string): string {
  const hunk = patch.indexOf('\n@@ ')
  let header = hunk < 0 ? patch : patch.slice(0, hunk + 1)
  const body = hunk < 0 ? '' : patch.slice(hunk + 1)
  if (hunk < 0) header = header.replace(/^(?:---|\+\+\+) .*\n/gmu, '')
  else header = header.replace(/^((?:---|\+\+\+) )([^"\n][^\n]* [^\n]*)\n/gmu, '$1$2\t\n')
  return header + body
}
function patches(repo: Repository, from: Tree | null, to: Tree, accepts: (path: string) => boolean): FilePatch[] {
  const diff = repo.diffTreeToTree(from, to)
  const bytes = diff.toPatch()
  // Patch records, unlike their content lines, begin at column zero. Do not
  // parse or interpolate quoted path headers to make an authorization choice.
  const text = bytes.toString('utf8')
  const pieces = text === '' ? [] : text.split(/(?=^diff --git )/mu).filter(Boolean)
  const deltas = [...diff.deltas()]
  if (pieces.length !== deltas.length) throw new NativeGitError('native-operation-failed')
  return deltas.flatMap((delta, index) => {
    const path = delta.newFile().path() ?? delta.oldFile().path()
    if (path === null) throw new NativeGitError('native-operation-failed')
    return accepts(path) ? [{ path, patch: normalizePatch(pieces[index]!) }] : []
  })
}

/** Unified tree diff, with literal optional directory/child scope. */
export function nativeDiffBetween(repo: Repository, from: string, to: string, pathPrefix?: string, path?: string): string {
  const accepts = selected(pathPrefix, path)
  const before = commitAt(repo, from), after = commitAt(repo, to)
  return patches(repo, before.tree(), after.tree(), accepts).map(file => file.patch).join('')
}

/** Each merge parent is a separate immutable input, never an invented baseline. */
function mergeParentDiffs(repo: Repository, commit: Commit, accepts: (path: string) => boolean): string {
  const count = commit.parentCount(), result = commit.id(), tree = commit.tree()
  const comparisons = Array.from({ length: count }, (_, index) => {
    const parent = commit.parent(index)
    return { parent: parent.id(), patch: patches(repo, parent.tree(), tree, accepts).map(file => file.patch).join('') }
  })
  if (comparisons.every(comparison => comparison.patch === '')) return ''
  return comparisons.map(({ parent, patch }, index) =>
    `Merge parent ${index + 1}/${count}: ${parent} -> ${result}\n${patch || '(No changes in the selected scope.)\n'}`).join('\n')
}

/** Root versus empty; ordinary versus parent; merges expose labeled per-parent views. */
export function nativeDiffCommit(repo: Repository, id: string, pathPrefix?: string): string {
  const accepts = selected(pathPrefix), commit = commitAt(repo, id)
  if (commit.parentCount() > 1) return mergeParentDiffs(repo, commit, accepts)
  const before = commit.parentCount() === 0 ? null : commit.parent(0).tree()
  return patches(repo, before, commit.tree(), accepts).map(file => file.patch).join('')
}

/** Current callers supply an immutable id; default is the first parent of HEAD. */
export function nativeDiffSince(repo: Repository, baseline?: string, pathPrefix?: string): string {
  const head = repo.head().target()
  if (head === null) throw new NativeGitError('commit-not-found')
  const latest = commitAt(repo, head)
  const expression = baseline ?? 'HEAD~1'
  const relative = /^HEAD(?:(~|\^)(\d*))?$/u.exec(expression)
  let from: Commit
  if (relative === null) from = commitAt(repo, expression)
  else {
    const count = relative[1] === undefined ? 0 : relative[2] === '' ? 1 : Number(relative[2])
    if (!Number.isSafeInteger(count) || count > 1_000_000) throw new NativeGitError('invalid-request')
    from = latest
    if (relative[1] === '^') { if (count > 0) from = from.parent(count - 1) }
    else for (let index = 0; index < count; index++) from = from.parent(0)
  }
  return nativeDiffBetween(repo, from.id(), head, pathPrefix)
}
