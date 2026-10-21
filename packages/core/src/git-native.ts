/** Node-only implementation. Imported by the contained worker, never Session/UI code. */
import { createHash } from 'node:crypto'
import { readFile, open, opendir, realpath, lstat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Repository, RepositoryOpenFlags, Signature, type Tree } from 'yugoo-design-git-native'
import { NativeGitError, type NativeGitFile, type NativeGitInspection, type NativeGitOperation, type NativeGitResult } from './git-native-contract.ts'
import { nativeCommitMessage, nativeLatestMarker, nativeHistory } from './git-native-history.ts'
import { nativeDiffCommit, nativeDiffBetween, nativeDiffSince } from './git-native-diff.ts'
import { nativeStatus } from './git-native-status.ts'

interface Entry { oid: string; mode: number }
async function optionalText(path: string, maxBytes: number): Promise<string | undefined> {
  let file
  try { file = await open(path, 'r') }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return }
  try {
    const bytes = Buffer.allocUnsafe(maxBytes + 1)
    let size = 0
    while (size < bytes.length) {
      const next = await file.read(bytes, size, bytes.length - size, size)
      if (next.bytesRead === 0) return bytes.subarray(0, size).toString('utf8')
      size += next.bytesRead
    }
    throw new NativeGitError('unsupported-history')
  } finally { await file.close() }
}
async function hasLooseReplacement(directory: string): Promise<boolean> {
  let entries
  try { entries = await opendir(join(directory, 'refs', 'replace')) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return false }
  try { return (await entries.read()) !== null }
  finally { await entries.close() }
}

/** libgit2 does not implement Git's replacement/graft view. Never mix views. */
async function assertSupportedHistory(repo: Repository): Promise<void> {
  // Explicitly limit the experiment rather than interpreting custom Git views.
  if (process.env.GIT_REPLACE_REF_BASE !== undefined || process.env.GIT_GRAFT_FILE !== undefined) {
    throw new NativeGitError('unsupported-history')
  }
  const gitDir = repo.path(), common = await optionalText(join(gitDir, 'commondir'), 4096)
  const directories = new Set([gitDir, common === undefined ? gitDir : resolve(gitDir, common.trim())])
  for (const directory of directories) {
    const [packed, grafts, loose] = await Promise.all([
      optionalText(join(directory, 'packed-refs'), 2 << 20), optionalText(join(directory, 'info', 'grafts'), 64 << 10),
      hasLooseReplacement(directory),
    ])
    if (loose || /^[0-9a-f]+ refs\/replace\//mu.test(packed ?? '')
      || (grafts ?? '').split(/\r?\n/u).some(line => line.trim() !== '' && !line.trimStart().startsWith('#'))) {
      throw new NativeGitError('unsupported-history')
    }
  }
}
function oid(value: string): void {
  if (/^[a-f0-9]{64}$/u.test(value)) throw new NativeGitError('unsupported-object-format')
  if (!/^[a-f0-9]{40}$/u.test(value)) throw new NativeGitError('invalid-request')
}
function safePath(value: string): void {
  if (!value || value.startsWith('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/u.test(value)
    || value.split('/').some(p => !p || p === '.' || p === '..' || p === '.git')) throw new NativeGitError('invalid-request')
}
function currentHead(repo: Repository): string | undefined {
  let value: string | null
  try { value = repo.head().target() }
  catch (error) {
    if ((error as { code?: string }).code === 'UnbornBranch') return
    throw error
  }
  if (value === null) throw new NativeGitError('native-operation-failed')
  oid(value)
  return value
}

async function inspect(repo: Repository, root: string): Promise<NativeGitInspection> {
  const workdir = repo.workdir()
  if (workdir === null || await realpath(workdir) !== await realpath(root)) throw new NativeGitError('invalid-request')
  let format: string = 'sha1'
  try { format = repo.config().getString('extensions.objectformat') }
  catch (error) { if ((error as { code?: string }).code !== 'NotFound') throw error }
  if (format !== 'sha1' && format !== 'sha256') throw new NativeGitError('unsupported-object-format')
  return { format, head: currentHead(repo), gitDir: resolve(repo.path()), workdir: resolve(workdir), indexPath: join(repo.path(), 'index') }
}
function commitTree(repo: Repository, commit: string): Tree {
  oid(commit)
  const found = repo.findCommit(commit)
  if (found === null) throw new NativeGitError('commit-not-found')
  return found.tree()
}
function entryAt(repo: Repository, tree: Tree, path: string): Entry | undefined {
  safePath(path)
  const parts = path.split('/')
  for (let i = 0; i < parts.length; i++) {
    const entry = repo.treebuilder(tree).get(parts[i]!)
    if (entry === null) return
    if (i === parts.length - 1) return { oid: entry.oid, mode: entry.filemode }
    if (entry.filemode !== 0o040000) return
    const child = repo.findTree(entry.oid)
    if (child === null) throw new NativeGitError('native-operation-failed')
    tree = child
  }
}
function treeEntries(repo: Repository, tree: Tree, scope: string | undefined, maxBytes: number, signal?: AbortSignal): { path: string; mode: number; oid: string; type: 'blob' | 'commit' }[] {
  if (scope !== undefined) safePath(scope)
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new NativeGitError('invalid-request')
  const result: ReturnType<typeof treeEntries> = []
  let bytes = 0
  const visit = (current: Tree, prefix: string): void => {
    for (let index = 0; index < current.size(); index++) {
      signal?.throwIfAborted()
      const child = current.get(index)
      if (child === null) throw new NativeGitError('native-operation-failed')
      const nameBytes = child.nameBytes(), name = nameBytes.toString('utf8'), path = prefix + name
      const inside = scope === undefined || path === scope || path.startsWith(`${scope}/`)
      const ancestor = scope !== undefined && scope.startsWith(`${path}/`)
      if (!inside && !ancestor) continue
      if (!Buffer.from(name).equals(nameBytes)) throw new NativeGitError('invalid-request')
      safePath(path)
      const metadata = repo.treebuilder(current).get(name)
      if (metadata === null) throw new NativeGitError('native-operation-failed')
      if (metadata.filemode === 0o040000) {
        const next = repo.findTree(metadata.oid)
        if (next === null) throw new NativeGitError('native-operation-failed')
        visit(next, `${path}/`)
      } else if (inside) {
        const type = metadata.filemode === 0o160000 ? 'commit' : 'blob'
        bytes += Buffer.byteLength(`${metadata.filemode.toString(8).padStart(6, '0')} ${type} ${metadata.oid}\t${path}\0`)
        if (bytes > maxBytes) throw new NativeGitError('invalid-request')
        result.push({ path, mode: metadata.filemode, oid: metadata.oid, type })
      }
    }
  }
  visit(tree, '')
  return result
}

function updatedTree(repo: Repository, base: Tree | null, entries: readonly [readonly string[], NativeGitFile][]): string {
  const builder = repo.treebuilder(base)
  const nested = new Map<string, [readonly string[], NativeGitFile][]>()
  for (const [parts, file] of entries) {
    const name = parts[0]!
    if (parts.length > 1) {
      const group = nested.get(name) ?? []
      group.push([parts.slice(1), file]); nested.set(name, group)
    } else if (file.oid === undefined) {
      const old = builder.get(name)
      // An index contains leaf paths, not directory entries. Removing a
      // nonexistent directory path never removes its unlisted descendants.
      if (old !== null && old.filemode !== 0o040000) builder.remove(name)
    } else {
      // Match update-index: a caller must explicitly remove conflicting leaf
      // paths first; replacing a directory must not delete unlisted facts.
      if (builder.get(name)?.filemode === 0o040000) throw new NativeGitError('invalid-request')
      builder.insert(name, file.oid, file.mode)
    }
  }
  for (const [name, children] of nested) {
    const old = builder.get(name)
    if (old !== null && old.filemode !== 0o040000) {
      if (children.every(([, file]) => file.oid === undefined)) continue
      throw new NativeGitError('invalid-request')
    }
    const prior = old?.filemode === 0o040000 ? repo.findTree(old.oid) : null
    const next = updatedTree(repo, prior, children)
    if (repo.findTree(next)!.isEmpty()) { if (builder.get(name) !== null) builder.remove(name) }
    else builder.insert(name, next, 0o040000)
  }
  return builder.write()
}

/** Caller/transport owns authorization, cancellation and the existing worker lifetime. */
export async function executeNativeGit(root: string, operation: NativeGitOperation, signal?: AbortSignal): Promise<NativeGitResult> {
  signal?.throwIfAborted()
  let repo: Repository
  try {
    if (operation.kind === 'init') {
      // Init belongs to this exact project directory, never an ancestor repo.
      let present = true
      try { await lstat(join(root, '.git')) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; present = false }
      signal?.throwIfAborted()
      repo = present ? Repository.openExt(root, RepositoryOpenFlags.NoSearch, []) : Repository.init(root)
    } else repo = Repository.openExt(root, RepositoryOpenFlags.NoSearch, [])
  }
  catch (error) {
    if (/unsupported.*(?:extension|version|sha256|object)/iu.test(String(error))) throw new NativeGitError('unsupported-object-format')
    throw new NativeGitError('native-operation-failed')
  }
  try {
    const facts = await inspect(repo, root)
    await assertSupportedHistory(repo)
    signal?.throwIfAborted()
    switch (operation.kind) {
      case 'init':
      case 'inspect': return { value: facts }
      case 'head': return { value: { head: currentHead(repo) } }
      case 'ancestor': {
        oid(operation.ancestor); oid(operation.descendant)
        const pending = [operation.descendant], seen = new Set<string>()
        if (repo.findCommit(operation.ancestor) === null) throw new NativeGitError('commit-not-found')
        while (pending.length) {
          signal?.throwIfAborted()
          const id = pending.pop()!
          if (seen.has(id)) continue
          seen.add(id)
          const commit = repo.findCommit(id)
          if (commit === null) throw new NativeGitError('commit-not-found')
          if (id === operation.ancestor) return { value: { isAncestor: true } }
          for (let index = 0; index < commit.parentCount(); index++) pending.push(commit.parentId(index))
        }
        return { value: { isAncestor: false } }
      }
      case 'status': return { value: await nativeStatus(repo, operation.pathPrefix) }
      case 'entry': {
        oid(operation.commit)
        const found = repo.findCommit(operation.commit)
        return { value: { commitFound: found !== null, entry: found === null ? undefined : entryAt(repo, found.tree(), operation.path) } }
      }
      case 'tree': return { value: { entries: treeEntries(repo, commitTree(repo, operation.commit), operation.pathPrefix, operation.maxBytes ?? (1 << 20), signal) } }
      case 'blob': {
        oid(operation.oid)
        if (!Number.isSafeInteger(operation.size) || operation.size < 0) throw new NativeGitError('invalid-request')
        const blob = repo.findBlob(operation.oid)
        if (blob.size() !== operation.size) throw new NativeGitError('native-operation-failed')
        return { value: { size: blob.size() }, bytes: blob.content() }
      }
      case 'blob-header': {
        oid(operation.oid)
        const reader = repo as Repository & { readObjectHeader?: (oid: string) => { kind: string; size: number } | null }
        if (typeof reader.readObjectHeader !== 'function') throw new NativeGitError('native-unavailable')
        const header = reader.readObjectHeader(operation.oid)
        if (header === null) return { value: { found: false } }
        if (!Number.isSafeInteger(header.size) || header.size < 0) throw new NativeGitError('native-operation-failed')
        return { value: { found: true, kind: header.kind, size: header.size } }
      }
      case 'message': return { value: { message: nativeCommitMessage(repo, operation.commit) } }
      case 'latest-marker': return { value: { commit: nativeLatestMarker(repo, operation.from, operation.marker) } }
      case 'history': return { value: { entries: nativeHistory(repo, operation.limit, operation.pathPrefix, operation.path, operation.from, operation.offset) } }
      case 'diff-commit': return { value: { diff: nativeDiffCommit(repo, operation.commit, operation.pathPrefix) } }
      case 'diff-between': return { value: { diff: nativeDiffBetween(repo, operation.from, operation.to, operation.pathPrefix, operation.path) } }
      case 'diff-since': return { value: { diff: nativeDiffSince(repo, operation.baseline, operation.pathPrefix) } }
      case 'index-read': {
        const { readLibraryIndex } = await import('./git-index-library.ts')
        const bytes = operation.bytes === undefined ? await readFile(facts.indexPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error
          return undefined
        }) : operation.bytes === null ? undefined : Buffer.from(operation.bytes, 'base64')
        try { return { value: { entries: await readLibraryIndex(bytes, operation.paths) } } }
        catch (error) {
          signal?.throwIfAborted()
          if (error instanceof Error && 'code' in error && error.code === 'unsupported-index') {
            // The ordinary index is maintenance, not design publication authority.
            // Preserve an unknown representation rather than rewriting its flags.
            return { value: { unavailable: 'unsupported-index' } }
          }
          throw error
        }
      }
      case 'index-update': {
        const { updateLibraryIndex } = await import('./git-index-library.ts')
        return { value: { bytes: Buffer.from(await updateLibraryIndex(operation.bytes === undefined ? undefined : Buffer.from(operation.bytes, 'base64'), operation.updates)).toString('base64') } }
      }
      case 'publish': {
        if (operation.expectedHead !== undefined) oid(operation.expectedHead)
        if (currentHead(repo) !== operation.expectedHead) throw new NativeGitError('stale-publication')
        const frozen: NativeGitFile[] = []
        const staging = await realpath(operation.stagingRoot)
        signal?.throwIfAborted()
        for (const file of operation.files) {
          signal?.throwIfAborted()
          safePath(file.path)
          if (file.mode !== 0o100644 && file.mode !== 0o100755) throw new NativeGitError('invalid-request')
          if (file.source === undefined) {
            if (file.oid !== undefined) throw new NativeGitError('invalid-request')
            frozen.push(file); continue
          }
          if (resolve(dirname(file.source)) !== resolve(staging) || !(await lstat(file.source)).isFile()) throw new NativeGitError('invalid-request')
          const bytes = await readFile(file.source)
          signal?.throwIfAborted()
          const expected = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
          if (file.oid !== expected || repo.blob(bytes) !== expected) throw new NativeGitError('native-operation-failed')
          frozen.push(file)
        }
        const prior = operation.expectedHead === undefined ? null : commitTree(repo, operation.expectedHead)
        // Preserve index-update order for explicit file/directory replacements.
        let tree = prior?.id() ?? repo.treebuilder(null).write()
        for (const file of frozen) tree = updatedTree(repo, repo.findTree(tree), [[file.path.split('/'), file]])
        const change = prior?.id() === tree ? 'unchanged' : 'changed'
        if (change === 'unchanged' && !operation.forceCommit) return { value: {} }
        const signature = Signature.now('dsh-design', 'dsh-design@local')
        let commit: string
        try {
          const message = operation.message.endsWith('\n') ? operation.message : `${operation.message}\n`
          // No asynchronous gap between the worker's cancellation fence and CAS.
          signal?.throwIfAborted()
          commit = repo.commit('HEAD', signature, signature, message, repo.findTree(tree)!, operation.expectedHead === undefined ? [] : [operation.expectedHead])
        } catch (error) {
          if (/current tip is not the first parent|reference.*(?:modified|changed)/iu.test(String(error))) throw new NativeGitError('stale-publication')
          throw new NativeGitError('native-operation-failed')
        }
        return { value: { commit, change } }
      }
    }
  } finally { repo.free() }
}
