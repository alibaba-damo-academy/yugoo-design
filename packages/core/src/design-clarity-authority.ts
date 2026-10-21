/**
 * The project-scoped latest clarity authority.
 *
 * One `design_records/clarity.json` inside the Git-tracked project is the direct
 * authority for the project's current clarity assessment. The journal's
 * `design/clarity-reported` facts stay an audit record only: current-state
 * reads come from this file, never from a journal fold. An absent file means
 * no assessment — reads never scan journals and nothing is backfilled or
 * migrated. The embedded report digest remains the report content digest;
 * the checkpoint is bound by this outer document. Writes replace the whole
 * document atomically (temp + rename).
 */
import { randomUUID } from 'node:crypto'
import { renameSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDesignClarityReported } from './design-clarity-report.ts'
import { DesignProjectId } from './design-project.ts'
import type { DesignClarityReportedPayload } from './types.ts'
import { resolveConfinedFilePath } from './confined-fs.ts'

/** On-disk clarity authority document version. */
export const DESIGN_CLARITY_AUTHORITY_SCHEMA_VERSION = 1 as const

/** Authority file name inside one project's records root. */
export const DESIGN_CLARITY_AUTHORITY_FILE = 'clarity.json'

// Five 64 KiB text fields can expand up to sixfold when JSON-escaped.
const MAX_AUTHORITY_BYTES = 2 * 1024 * 1024
/** UTF-8 byte bound shared by every durable clarity checkpoint value. */
export const MAX_CHECKPOINT_BYTES = 512

/** The latest clarity assessment promoted for one project. */
export interface DesignClarityAuthority {
  readonly schemaVersion: typeof DESIGN_CLARITY_AUTHORITY_SCHEMA_VERSION
  readonly projectId: DesignProjectId
  /** Exact committed checkpoint the assessment describes. */
  readonly assessedCheckpoint: string
  /** The complete validated report exactly as promoted. */
  readonly report: DesignClarityReportedPayload
}

function plainObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path}: expected a plain object`)
  }
  return value as Record<string, unknown>
}

function boundedText(value: unknown, path: string, maxBytes: number): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path}: expected non-empty text`)
  if (Buffer.byteLength(value, 'utf8') > maxBytes) throw new Error(`${path}: exceeds ${maxBytes} UTF-8 bytes`)
  return value
}

/**
 * Strictly parse one clarity authority document bound to an expected
 * project. Unknown fields, a foreign schema version, or a projectId that
 * does not match the expected project fail loud.
 * @param value - untrusted decoded document value.
 * @param projectId - the project whose state root the document was read from.
 * @returns the frozen validated authority document.
 */
export function parseDesignClarityAuthority(value: unknown, projectId: DesignProjectId): DesignClarityAuthority {
  const data = plainObject(value, '$')
  const keys = Object.keys(data).sort()
  const required = ['assessedCheckpoint', 'projectId', 'report', 'schemaVersion']
  const missing = required.filter((field) => !Object.hasOwn(data, field))
  const extra = keys.filter((field) => !required.includes(field))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`design clarity authority: invalid fields (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`)
  }
  if (data.schemaVersion !== DESIGN_CLARITY_AUTHORITY_SCHEMA_VERSION) {
    throw new Error(`design clarity authority: unsupported schemaVersion ${JSON.stringify(data.schemaVersion)}`)
  }
  const documentProjectId = DesignProjectId(boundedText(data.projectId, '$.projectId', 64))
  if (documentProjectId !== projectId) {
    throw new Error(`design clarity authority: document is bound to project ${JSON.stringify(documentProjectId)}, not ${JSON.stringify(projectId)}`)
  }
  return Object.freeze({
    schemaVersion: DESIGN_CLARITY_AUTHORITY_SCHEMA_VERSION,
    projectId: documentProjectId,
    assessedCheckpoint: boundedText(data.assessedCheckpoint, '$.assessedCheckpoint', MAX_CHECKPOINT_BYTES),
    report: parseDesignClarityReported(data.report),
  })
}

function serializeDesignClarityAuthority(authority: DesignClarityAuthority): string {
  return `${JSON.stringify({
    schemaVersion: authority.schemaVersion,
    projectId: authority.projectId,
    assessedCheckpoint: authority.assessedCheckpoint,
    report: authority.report,
  }, null, 2)}\n`
}

/**
 * Read and strictly parse one project's clarity authority.
 * @param projectStateRoot - trusted records root inside one project.
 * @param projectId - the project the document must be bound to.
 * @returns the validated authority, or undefined when no assessment exists.
 */
export async function readDesignClarityAuthority(
  projectStateRoot: string,
  projectId: DesignProjectId,
): Promise<DesignClarityAuthority | undefined> {
  const file = await resolveConfinedFilePath(projectStateRoot, DESIGN_CLARITY_AUTHORITY_FILE)
  let bytes: Buffer
  try {
    bytes = await readFile(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  if (bytes.byteLength > MAX_AUTHORITY_BYTES) {
    throw new Error(`design clarity authority: file exceeds ${MAX_AUTHORITY_BYTES} bytes`)
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    throw new Error('design clarity authority: invalid JSON', { cause: error })
  }
  return parseDesignClarityAuthority(decoded, projectId)
}

/**
 * Atomically replace one project's clarity authority document.
 * @param projectStateRoot - trusted records root inside one project.
 * @param authority - validated authority document to persist.
 * @param options - optional synchronous admission check at the replacement point.
 * Guarded writes prepare the temp file asynchronously, then check and rename
 * in one synchronous turn. Cancellation/input changes during preparation cannot
 * replace the old authority. This is not a cross-process transaction or rollback
 * of a replacement that already committed.
 */
export async function writeDesignClarityAuthority(
  projectStateRoot: string,
  authority: DesignClarityAuthority,
  options?: { readonly beforeReplace?: () => void },
): Promise<void> {
  await resolveConfinedFilePath(projectStateRoot, DESIGN_CLARITY_AUTHORITY_FILE)
  await mkdir(projectStateRoot, { recursive: true })
  const target = await resolveConfinedFilePath(projectStateRoot, DESIGN_CLARITY_AUTHORITY_FILE)
  const temp = join(projectStateRoot, `.clarity-${randomUUID()}.tmp`)
  const content = serializeDesignClarityAuthority(authority)
  if (Buffer.byteLength(content, 'utf8') > MAX_AUTHORITY_BYTES) {
    throw new Error(`design clarity authority: file exceeds ${MAX_AUTHORITY_BYTES} bytes`)
  }
  try {
    await writeFile(temp, content, { encoding: 'utf8', flag: 'wx' })
    if (options?.beforeReplace) {
      const checked = options.beforeReplace()
      if (checked !== undefined) throw new Error('design clarity authority: beforeReplace must be a synchronous check without a return value')
      // No await between the owning caller's final check and atomic replace.
      renameSync(temp, target)
    } else await rename(temp, target)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}
