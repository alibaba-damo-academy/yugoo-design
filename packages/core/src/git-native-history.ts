/** Git-compatible bounded history reads, without launching a Git executable. */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Commit, Repository, Tree } from 'yugoo-design-git-native'
import iconv from 'iconv-lite'
import { NativeGitError } from './git-native-contract.ts'
import type { GitHistoryEntry } from './git.ts'

function findCommit(repo: Repository, oid: string): Commit {
  if (!/^[0-9a-f]{40}$/u.test(oid)) throw new NativeGitError('invalid-request')
  const commit = repo.findCommit(oid)
  if (commit === null) throw new NativeGitError('commit-not-found')
  return commit
}

function config(repo: Repository, name: string): string | undefined {
  try { return repo.config().getString(name) }
  catch (error) {
    if ((error as { code?: string }).code !== 'NotFound') throw error
  }
}

function outputEncoding(repo: Repository): string {
  return config(repo, 'i18n.logOutputEncoding') || config(repo, 'i18n.commitEncoding') || 'UTF-8'
}

/** Failed iconv conversion leaves Git's input bytes intact, rather than replacing characters. */
function reencode(original: Buffer, input: string, output: string): Buffer {
  if (input.toLowerCase() === output.toLowerCase()) return original
  if (!iconv.encodingExists(input) || !iconv.encodingExists(output)) return original
  const decoded = iconv.decode(original, input, { stripBOM: false })
  // A valid legacy character can have several byte spellings (notably
  // CP932). Re-encoding may choose its canonical spelling; that is not an
  // input error. Only a substituted decoding error needs the round-trip test.
  if (decoded.includes('\uFFFD') && !iconv.encode(decoded, input).equals(original)) return original
  const encoded = iconv.encode(decoded, output)
  if (iconv.decode(encoded, output, { stripBOM: false }) !== decoded) return original
  return encoded
}

function messageBytes(commit: Commit, output: string): Buffer {
  return reencode(commit.messageRawBytes(), commit.messageEncoding() || 'UTF-8', output)
}

/** `%B` is the unprettified message, followed by the format record's own LF. */
export function nativeCommitMessage(repo: Repository, oid: string): string {
  // Git's user-format path first normalizes the commit to UTF-8, formats the
  // record, then converts that record to the configured output encoding. A
  // failed second conversion retains UTF-8, not the original legacy bytes.
  const utf8 = messageBytes(findCommit(repo, oid), 'UTF-8')
  return Buffer.concat([reencode(utf8, 'UTF-8', outputEncoding(repo)), Buffer.from('\n')]).toString('utf8')
}

interface Pending { readonly commit: Commit; readonly time: number; readonly sequence: number }
function before(a: Pending, b: Pending): boolean { return a.time > b.time || (a.time === b.time && a.sequence < b.sequence) }

/** Git's default walk expands a date-ordered frontier; it does not globally sort ancestry. */
class Frontier {
  private readonly heap: Pending[] = []
  push(value: Pending): void {
    const heap = this.heap
    let index = heap.length
    heap.push(value)
    while (index > 0) {
      const parent = (index - 1) >>> 1
      if (!before(value, heap[parent]!)) break
      heap[index] = heap[parent]!
      index = parent
    }
    heap[index] = value
  }
  pop(): Commit | undefined {
    const heap = this.heap
    const first = heap[0]
    const last = heap.pop()
    if (heap.length > 0) {
      let index = 0
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1
        if (child + 1 < heap.length && before(heap[child + 1]!, heap[child]!)) child++
        if (!before(heap[child]!, last!)) break
        heap[index] = heap[child]!
        index = child
      }
      heap[index] = last!
    }
    return first?.commit
  }
}

function shallowBoundary(repo: Repository): ReadonlySet<string> {
  if (!repo.isShallow()) return new Set()
  let directory = repo.path()
  try { directory = resolve(directory, readFileSync(join(directory, 'commondir'), 'utf8').trim()) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const contents = readFileSync(join(directory, 'shallow'), 'utf8')
  if (contents.length > 2 << 20) throw new NativeGitError('unsupported-history')
  const entries = contents.trim().split(/\r?\n/u)
  if (entries.some(oid => !/^[0-9a-f]{40}$/u.test(oid))) throw new NativeGitError('unsupported-history')
  return new Set(entries)
}

function* walk(repo: Repository, from: string, selectedPath?: string): Generator<Commit> {
  const frontier = new Frontier(), seen = new Set<string>(), shallow = shallowBoundary(repo)
  let sequence = 0
  const enqueue = (commit: Commit): void => {
    if (seen.has(commit.id())) return
    seen.add(commit.id())
    frontier.push({ commit, time: commit.time().valueOf(), sequence: sequence++ })
  }
  enqueue(findCommit(repo, from))
  for (let commit = frontier.pop(); commit !== undefined; commit = frontier.pop()) {
    const parents = shallow.has(commit.id()) ? [] : Array.from({ length: commit.parentCount() }, (_, index) => commit!.parent(index))
    let visible = true, followed = parents
    if (selectedPath !== undefined) {
      const entry = treeEntry(repo, commit.tree(), selectedPath)
      const sameParent = parents.find(parent => treeEntry(repo, parent.tree(), selectedPath) === entry)
      // Default dense history follows only one TREESAME parent. This is what
      // omits both an unchanged merge and its irrelevant side branch.
      if (sameParent !== undefined) { visible = false; followed = [sameParent] }
      else if (parents.length === 0 && entry === undefined) visible = false
    }
    for (const parent of followed) enqueue(parent)
    if (visible) yield commit
  }
}

function treeEntry(repo: Repository, tree: Tree, path: string): string | undefined {
  const parts = path.split('/')
  for (let index = 0; index < parts.length; index++) {
    const entry = repo.treebuilder(tree).get(parts[index]!)
    if (entry === null) return
    if (index === parts.length - 1) return `${entry.filemode}:${entry.oid}`
    if (entry.filemode !== 0o040000) return
    const child = repo.findTree(entry.oid)
    if (child === null) throw new NativeGitError('native-operation-failed')
    tree = child
  }
}

/** Match fixed grep markers against the same encoded message bytes as `git log`. */
export function nativeLatestMarker(repo: Repository, from: string, marker: string): string | undefined {
  if (marker === '' || /[\r\n\0]/u.test(marker)) throw new NativeGitError('invalid-request')
  const needle = Buffer.from(marker, 'utf8'), output = outputEncoding(repo)
  for (const commit of walk(repo, from)) if (messageBytes(commit, output).includes(needle)) return commit.id()
}

function safePath(path: string): void {
  if (!path || path.startsWith('/') || path.endsWith('/') || path.includes('\\') || /[\u0000-\u001f\u007f]/u.test(path)
    || path.split('/').some(part => !part || part === '.' || part === '..' || part === '.git')) throw new NativeGitError('invalid-request')
}

function committedAt(commit: Commit): string {
  // The Signature API normalizes offsets to UTC. `%cI` preserves the offset
  // from the commit object, so read that immutable header instead.
  const match = /^committer [^\n]* (-?\d+) ([+-])(\d{2})(\d{2})$/mu.exec(commit.rawHeaderBytes().toString('utf8'))
  if (match === null) throw new NativeGitError('native-operation-failed')
  const offset = (Number(match[3]) * 60 + Number(match[4])) * (match[2] === '-' ? -1 : 1)
  const date = new Date(Number(match[1]) * 1000 + offset * 60_000)
  if (!Number.isFinite(date.valueOf())) throw new NativeGitError('native-operation-failed')
  return `${date.toISOString().slice(0, -5)}${match[2]}${match[3]}:${match[4]}`
}

function subject(bytes: Buffer): Buffer {
  // Pretty-format `%s` joins the first nonblank paragraph with spaces; tabs
  // and internal spaces in each line remain meaningful.
  const lines = bytes.toString('latin1').split('\n')
  while (lines.length && /^[\t\r ]*$/u.test(lines[0]!)) lines.shift()
  const paragraph: string[] = []
  for (const line of lines) {
    if (/^[\t\r ]*$/u.test(line)) break
    paragraph.push(line.replace(/[\t\r ]+$/u, ''))
  }
  return Buffer.from(paragraph.join(' '), 'latin1')
}

/** Literal child/subtree history, optionally paged from one immutable full commit. */
export function nativeHistory(repo: Repository, limit: number, pathPrefix?: string, path?: string, from?: string, offset = 0): readonly GitHistoryEntry[] {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new NativeGitError('invalid-request')
  if (!Number.isSafeInteger(offset) || offset < 0) throw new NativeGitError('invalid-request')
  if (pathPrefix !== undefined) safePath(pathPrefix)
  if (path !== undefined) safePath(path)
  const selected = path === undefined ? pathPrefix : pathPrefix === undefined ? path : `${pathPrefix}/${path}`
  const head = from ?? repo.head().target()
  if (head === null) throw new NativeGitError('commit-not-found')
  const output = outputEncoding(repo), records: Buffer[] = []
  let skipped = 0
  for (const commit of walk(repo, head, selected)) {
    if (skipped < offset) { skipped++; continue }
    const record = Buffer.concat([Buffer.from(`${commit.id()}\t${committedAt(commit)}\t`), subject(messageBytes(commit, 'UTF-8'))])
    records.push(reencode(record, 'UTF-8', output), Buffer.from('\n'))
    if (records.length === limit * 2) break
  }
  if (!records.length) return Object.freeze([])
  // Preserve the existing string adapter/parser boundary, including rejecting
  // output encodings whose record bytes cannot form ordinary history fields.
  return Object.freeze(Buffer.concat(records).toString('utf8').trimEnd().split('\n').map((line): GitHistoryEntry => {
    const first = line.indexOf('\t'), second = first < 0 ? -1 : line.indexOf('\t', first + 1)
    if (first < 0 || second < 0) throw new NativeGitError('native-operation-failed')
    const commit = line.slice(0, first), date = line.slice(first + 1, second)
    if (!/^[0-9a-f]{40}$/u.test(commit) || date === '' || !Number.isFinite(new Date(date).valueOf())) throw new NativeGitError('native-operation-failed')
    return Object.freeze({ commit, committedAt: date, subject: line.slice(second + 1) })
  }))
}
