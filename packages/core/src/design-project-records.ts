/** Safe explicit-path Git publication for the project's single durable records. */
import { readFile } from 'node:fs/promises'
import { resolveConfinedFilePath } from './confined-fs.ts'
import { GitVersioning, type SpawnFn } from './git.ts'
import { nodeDesignProjectSpawn } from './design-project.ts'
import { DESIGN_PROJECT_RECORDS_DIRECTORY, designProjectRecordsRoot } from './design-project-record-paths.ts'

const MAX_PUBLICATION_ATTEMPTS = 3
const sameBytes = (left: Uint8Array | undefined, right: Uint8Array | undefined): boolean =>
  left === undefined ? right === undefined : right !== undefined && Buffer.from(left).equals(right)

/** Only the existing publication-CAS failures are retryable. */
function stalePublication(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.message === 'design git native: stale-publication'
    || error.message === 'design git: publication revision is stale'
    || error.message.startsWith('design git: publication revision is stale: expected ')
}

/** Caller owns the existing project mutation lane. This adds no lock or identity ticket. */
export async function commitDesignProjectRecords(input: {
  readonly projectRoot: string
  /** Explicit project-relative files, never a directory, glob, or arbitrary repository. */
  readonly paths: readonly string[]
  readonly message: string
  readonly expectedHead?: string
  readonly signal?: AbortSignal
  readonly spawn?: SpawnFn
}): Promise<string | undefined> {
  designProjectRecordsRoot(input.projectRoot)
  if (!input.paths.length || !input.message.trim()) throw new Error('design records: explicit files and a commit message are required')
  const git = new GitVersioning(input.spawn ?? nodeDesignProjectSpawn, input.projectRoot)
  let head = await git.head(input.signal)
  if (!head) throw new Error('design records: an initialized Design Project is required')
  const evidence = await git.designEvidenceRevisionAt(head, input.signal)
  if (input.expectedHead !== undefined && input.expectedHead !== head
    && await git.designEvidenceRevisionAt(input.expectedHead, input.signal) !== evidence) {
    throw new Error('design records: Design evidence changed before record publication')
  }
  const bytes = new Map<string, Uint8Array | undefined>()
  const baseline = new Map<string, Uint8Array | undefined>()
  const read = async (path: string): Promise<Uint8Array | undefined> => {
    const file = await resolveConfinedFilePath(input.projectRoot, path)
    try { return await readFile(file) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return undefined
    }
  }
  for (const path of new Set(input.paths)) {
    input.signal?.throwIfAborted()
    if (!path.startsWith(`${DESIGN_PROJECT_RECORDS_DIRECTORY}/`)) throw new Error('design records: path is outside the project record directory')
    bytes.set(path, await read(path))
    baseline.set(path, await git.readBytesAt(input.expectedHead ?? head, path, input.signal))
  }
  // Freeze the caller's exact files once. A retry may change only the parent
  // commit, never absorb another writer's bytes or a newer Design checkpoint.
  for (let attempt = 0; attempt < MAX_PUBLICATION_ATTEMPTS; attempt++) {
    input.signal?.throwIfAborted()
    if (attempt > 0) {
      head = await git.head(input.signal)
      if (!head || await git.designEvidenceRevisionAt(head, input.signal) !== evidence) {
        throw new Error('design records: Design evidence changed during record publication')
      }
    }
    for (const [path, frozen] of bytes) {
      if (!sameBytes(await read(path), frozen)) throw new Error('design records: target bytes changed during record publication')
      const current = await git.readBytesAt(head, path, input.signal)
      if (!sameBytes(current, baseline.get(path)) && !sameBytes(current, frozen)) {
        throw new Error('design records: committed target changed during record publication')
      }
    }
    try { return await git.commitExact(input.message, bytes, head, input.signal) }
    catch (error) {
      input.signal?.throwIfAborted()
      if (!stalePublication(error) || attempt === MAX_PUBLICATION_ATTEMPTS - 1) throw error
    }
  }
  throw new Error('design records: publication attempts exhausted')
}
