/** Safe explicit-path Git publication for the project's single durable records. */
import { readFile } from 'node:fs/promises'
import { resolveConfinedFilePath } from './confined-fs.ts'
import { GitVersioning, type SpawnFn } from './git.ts'
import { nodeDesignProjectSpawn } from './design-project.ts'
import { DESIGN_PROJECT_RECORDS_DIRECTORY, designProjectRecordsRoot } from './design-project-record-paths.ts'

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
  const head = await git.head(input.signal)
  if (!head) throw new Error('design records: an initialized Design Project is required')
  if (input.expectedHead !== undefined && input.expectedHead !== head
    && await git.designEvidenceRevisionAt(input.expectedHead, input.signal) !== await git.designEvidenceRevisionAt(head, input.signal)) {
    throw new Error('design records: Design evidence changed before record publication')
  }
  const bytes = new Map<string, Uint8Array | undefined>()
  for (const path of input.paths) {
    input.signal?.throwIfAborted()
    if (!path.startsWith(`${DESIGN_PROJECT_RECORDS_DIRECTORY}/`)) throw new Error('design records: path is outside the project record directory')
    const file = await resolveConfinedFilePath(input.projectRoot, path)
    try { bytes.set(path, await readFile(file)) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      bytes.set(path, undefined)
    }
  }
  return git.commitExact(input.message, bytes, head, input.signal)
}
