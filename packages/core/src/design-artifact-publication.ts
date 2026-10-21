/** Trusted preparation and atomic publication for model-drafted Design File artifacts. */
import { requireDesignFileRelativePath } from './design-files.ts'
import { createHash } from 'node:crypto'

/** One host-read dependency included in a pinned model input. */
export interface DesignArtifactDependency {
  readonly path: string
  readonly sha256: string
}

/** Host-owned dependency manifest for one artifact production attempt. */
export interface DesignArtifactDependencyManifest {
  readonly sourceRevision: string
  readonly files: readonly DesignArtifactDependency[]
}

/** Resource limits applied before an artifact transaction may begin. */
export interface DesignArtifactPublicationLimits {
  readonly maxArtifactCount: number
  readonly maxTextBytes: number
  readonly maxBinaryBytes: number
  readonly maxTotalBytes: number
}

/** Bounds for a host-selected cross-Bundle model input snapshot. */
export interface DesignArtifactInputLimits {
  readonly maxFileCount: number
  readonly maxPathBytes: number
  readonly maxFileBytes: number
  readonly maxTotalBytes: number
}

/** One exact source Bundle serialized into artifact-production model input. */
export interface PinnedDesignArtifactSource {
  readonly skillName: string
  readonly state: Readonly<Record<string, unknown>>
  readonly artifacts: readonly Readonly<{ readonly path: string; readonly content: string }>[]
}

/** Bounded model input paired with its private dependency manifest. */
export interface PreparedDesignArtifactInput {
  readonly input: Readonly<{
    readonly sourceRevision: string
    readonly sources: readonly PinnedDesignArtifactSource[]
  }>
  readonly dependencies: DesignArtifactDependencyManifest
}

/** Trusted output ready for one Design Files transaction. */
export interface TrustedDesignArtifactWrite {
  readonly state: Record<string, unknown>
  readonly artifacts: Readonly<Record<string, string | Uint8Array>>
}

/**
 * Select source Bundle names that have canonical state at an exact revision.
 * Auxiliary artifacts never make an otherwise-unlanded Bundle a model input.
 * @param candidateNames - Kit Bundles eligible to provide source evidence.
 * @param paths - sorted Design File paths present at the pinned revision.
 * @returns eligible names whose canonical `<name>/<name>.json` file exists.
 */
export function landedDesignArtifactSourceNames(
  candidateNames: readonly string[],
  paths: readonly string[],
): readonly string[] {
  const available = new Set(paths)
  return Object.freeze(candidateNames.filter(name => available.has(`${name}/${name}.json`)))
}

/** Operations required to prepare and publish one model result. */
export interface DesignArtifactPublicationRequest<ModelResult, CommitResult> {
  readonly modelResult: ModelResult
  readonly dependencies: DesignArtifactDependencyManifest
  readonly limits: DesignArtifactPublicationLimits
  readonly signal?: AbortSignal
  readonly prepare: (
    modelResult: ModelResult,
    dependencies: DesignArtifactDependencyManifest,
    signal?: AbortSignal,
  ) => Promise<TrustedDesignArtifactWrite>
  readonly validate: (
    write: TrustedDesignArtifactWrite,
    dependencies: DesignArtifactDependencyManifest,
    signal?: AbortSignal,
  ) => Promise<void>
  readonly revalidateDependencies: (
    dependencies: DesignArtifactDependencyManifest,
    signal?: AbortSignal,
  ) => Promise<void>
  readonly commit: (
    write: TrustedDesignArtifactWrite,
    dependencies: DesignArtifactDependencyManifest,
    signal?: AbortSignal,
  ) => Promise<CommitResult>
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`)
}

function byteLength(content: string | Uint8Array): number {
  return typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : content.byteLength
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function plainJsonObject(text: string, path: string): Readonly<Record<string, unknown>> {
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch (error) {
    throw new Error(`pinned canonical Design File ${JSON.stringify(path)} is invalid JSON`, { cause: error })
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`pinned canonical Design File ${JSON.stringify(path)} must contain an object`)
  }
  return Object.freeze(value as Record<string, unknown>)
}

/**
 * Build the complete model input from a host-selected exact-revision path list.
 * The model cannot add, omit, or redirect source files.
 * @param request - pinned paths, active source identities, text reader, and bounds.
 * @returns bounded model input and a separate host-owned digest manifest.
 */
export async function buildPinnedDesignArtifactInput(request: {
  readonly sourceRevision: string
  readonly activeSourceSkills: readonly string[]
  readonly paths: readonly string[]
  readonly limits: DesignArtifactInputLimits
  readonly readText: (relativePath: string) => Promise<string | undefined>
}): Promise<PreparedDesignArtifactInput> {
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(request.sourceRevision)) {
    throw new Error('artifact input sourceRevision must be a full lowercase object id')
  }
  requirePositiveInteger(request.limits.maxFileCount, 'artifact input maxFileCount')
  requirePositiveInteger(request.limits.maxPathBytes, 'artifact input maxPathBytes')
  requirePositiveInteger(request.limits.maxFileBytes, 'artifact input maxFileBytes')
  requirePositiveInteger(request.limits.maxTotalBytes, 'artifact input maxTotalBytes')
  const skills = [...request.activeSourceSkills]
  if (skills.length === 0 || new Set(skills).size !== skills.length) throw new Error('artifact input active source skills must be non-empty and unique')
  for (const skill of skills) {
    requireDesignFileRelativePath(`${skill}/${skill}.json`)
    if (skill.includes('/')) throw new Error(`artifact input contains invalid source skill ${JSON.stringify(skill)}`)
  }
  if (request.paths.length > request.limits.maxFileCount) throw new Error('artifact input exceeded maxFileCount')
  const paths = [...request.paths]
  const sortedPaths = paths.toSorted()
  if (new Set(paths).size !== paths.length || JSON.stringify(paths) !== JSON.stringify(sortedPaths)) {
    throw new Error('artifact input paths must be sorted and unique')
  }
  let totalBytes = 0
  const dependencies: DesignArtifactDependency[] = []
  const bySkill = new Map(skills.map((skill) => [skill, { state: undefined as Readonly<Record<string, unknown>> | undefined, artifacts: [] as Array<Readonly<{ path: string; content: string }>> }]))
  for (const path of paths) {
    requireDesignFileRelativePath(path)
    const pathBytes = Buffer.byteLength(path, 'utf8')
    if (pathBytes > request.limits.maxPathBytes) throw new Error(`artifact input path exceeds maxPathBytes: ${path}`)
    const owner = skills.find((skill) => path.startsWith(`${skill}/`))
    if (owner === undefined) throw new Error(`artifact input path is outside the active source set: ${path}`)
    const content = await request.readText(path)
    if (content === undefined) throw new Error(`artifact input path is missing at the pinned revision: ${path}`)
    const contentBytes = Buffer.byteLength(content, 'utf8')
    if (contentBytes > request.limits.maxFileBytes) throw new Error(`artifact input file exceeds maxFileBytes: ${path}`)
    totalBytes += pathBytes + contentBytes
    if (totalBytes > request.limits.maxTotalBytes) throw new Error('artifact input exceeded maxTotalBytes')
    dependencies.push(Object.freeze({ path, sha256: sha256(content) }))
    const source = bySkill.get(owner) as { state?: Readonly<Record<string, unknown>>; artifacts: Array<Readonly<{ path: string; content: string }>> }
    if (path === `${owner}/${owner}.json`) source.state = plainJsonObject(content, path)
    else source.artifacts.push(Object.freeze({ path, content }))
  }
  const sources = skills.toSorted().map((skill) => {
    const source = bySkill.get(skill) as { state?: Readonly<Record<string, unknown>>; artifacts: Array<Readonly<{ path: string; content: string }>> }
    if (source.state === undefined) throw new Error(`artifact input is missing canonical source ${skill}/${skill}.json`)
    return Object.freeze({ skillName: skill, state: source.state, artifacts: Object.freeze(source.artifacts) })
  })
  return Object.freeze({
    input: Object.freeze({ sourceRevision: request.sourceRevision, sources: Object.freeze(sources) }),
    dependencies: Object.freeze({ sourceRevision: request.sourceRevision, files: Object.freeze(dependencies) }),
  })
}

/**
 * Re-read and verify every host-owned dependency immediately before commit.
 * @param manifest - exact path and digest set retained outside model output.
 * @param readText - reader pinned to the manifest revision.
 */
export async function revalidateDesignArtifactDependencies(
  manifest: DesignArtifactDependencyManifest,
  readText: (relativePath: string) => Promise<string | undefined>,
): Promise<void> {
  for (const dependency of manifest.files) {
    const content = await readText(dependency.path)
    if (content === undefined) throw new Error(`artifact dependency disappeared: ${dependency.path}`)
    if (sha256(content) !== dependency.sha256) throw new Error(`artifact dependency digest changed: ${dependency.path}`)
  }
}

/**
 * Validate host-owned pins and artifact bounds, then perform exactly one commit.
 * Dependency pins are rechecked in the operation immediately preceding commit.
 * @param request - trusted preparation, validation, pin check, and commit operations.
 * @returns the atomic commit result.
 */
export async function publishTrustedDesignArtifacts<ModelResult, CommitResult>(
  request: DesignArtifactPublicationRequest<ModelResult, CommitResult>,
): Promise<CommitResult> {
  const { dependencies, limits } = request
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(dependencies.sourceRevision)) {
    throw new Error('artifact dependency sourceRevision must be a full lowercase object id')
  }
  const seenDependencies = new Set<string>()
  for (const dependency of dependencies.files) {
    requireDesignFileRelativePath(dependency.path)
    if (seenDependencies.has(dependency.path)) throw new Error(`duplicate artifact dependency path: ${dependency.path}`)
    seenDependencies.add(dependency.path)
    if (!/^[0-9a-f]{64}$/u.test(dependency.sha256)) {
      throw new Error(`artifact dependency ${JSON.stringify(dependency.path)} must have a lowercase sha256 digest`)
    }
  }
  requirePositiveInteger(limits.maxArtifactCount, 'maxArtifactCount')
  requirePositiveInteger(limits.maxTextBytes, 'maxTextBytes')
  requirePositiveInteger(limits.maxBinaryBytes, 'maxBinaryBytes')
  requirePositiveInteger(limits.maxTotalBytes, 'maxTotalBytes')

  const write = await request.prepare(request.modelResult, dependencies, request.signal)
  const entries = Object.entries(write.artifacts)
  if (entries.length === 0) throw new Error('artifact production returned no artifacts')
  if (entries.length > limits.maxArtifactCount) throw new Error('artifact production exceeded maxArtifactCount')
  let totalBytes = 0
  for (const [path, content] of entries) {
    requireDesignFileRelativePath(path)
    if (typeof content !== 'string' && !(content instanceof Uint8Array)) {
      throw new Error(`artifact ${JSON.stringify(path)} must contain text or bytes`)
    }
    const size = byteLength(content)
    const bound = typeof content === 'string' ? limits.maxTextBytes : limits.maxBinaryBytes
    if (size === 0) throw new Error(`artifact ${JSON.stringify(path)} is empty`)
    if (size > bound) throw new Error(`artifact ${JSON.stringify(path)} exceeds its size limit`)
    totalBytes += size
    if (totalBytes > limits.maxTotalBytes) throw new Error('artifact production exceeded maxTotalBytes')
  }
  await request.validate(write, dependencies, request.signal)
  await request.revalidateDependencies(dependencies, request.signal)
  return request.commit(write, dependencies, request.signal)
}
