/** Persistent registry and reference resolution for managed Design Projects. */
import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { isDeepStrictEqual } from 'node:util'
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import {
  DesignProjectId,
  DesignProjectManager,
  parseDesignProjectJson,
  type DesignProject,
  type DesignProjectId as DesignProjectIdType,
  type DesignProjectKnowledgePin,
  type DesignProjectKitPin,
  type DesignProjectMetadata,
} from './design-project.ts'
import { GitVersioning } from './git.ts'
import { sameProjectContentPin } from './project-content.ts'
import { defaultDesignProjectsRoot } from './design-project-paths.ts'

/** Current serialized project-registry format. */
export const DESIGN_PROJECT_REGISTRY_VERSION = 1 as const

/** Explicit roots must be absolute; new projects default to system Documents. */
export interface DesignProjectRegistryOptions {
  readonly projectsRoot?: string
  readonly stateRoot: string
  readonly manager?: DesignProjectManager
}

/** One validated registered project plus its external runtime-state directory. */
export interface RegisteredDesignProject {
  readonly projectId: DesignProjectIdType
  readonly name: string
  readonly root: string
  readonly designFilesRoot: string
  readonly stateRoot: string
  readonly knowledge: DesignProjectKnowledgePin
  readonly kit?: DesignProjectKitPin
}

/** Live Git status for one registered project. */
export interface RegisteredDesignProjectStatus extends RegisteredDesignProject {
  readonly gitClean: boolean
  readonly lastCheckpoint: string
  readonly porcelain: string
}

/** Browser/catalog projection ordered by the newest durable project checkpoint. */
export interface RegisteredDesignProjectSummary extends RegisteredDesignProject {
  readonly updatedAt: string
}

/** Newly created current-format project with source files staged for Agent migration. */
export interface MigratedDesignProject extends RegisteredDesignProject {
  readonly sourceRoot: string
  readonly migratedBundles: readonly string[]
}

/** Read-only facts available from a migration source before a target exists. */
export interface DesignProjectMigrationSource {
  readonly sourceRoot: string
  readonly metadata?: DesignProjectMetadata
}

/** Local authority used to create the new migration target. */
export interface DesignProjectMigrationBasis {
  readonly knowledge: DesignProjectKnowledgePin
  readonly kit: DesignProjectKitPin
}

/** Canonical read-only evidence file or directory for Agentic reconstruction. */
export interface DesignProjectReconstructionSource {
  readonly sourceRoot: string
  readonly suggestedProjectName: string
}

/** Bounded committed Bundle states used to hydrate a selected project. */
export interface DesignProjectRegistrySnapshot {
  readonly projectId: DesignProjectIdType
  readonly checkpoint: string
  readonly bundleStates: Readonly<Record<string, unknown>>
}

const SNAPSHOT_MAX_BUNDLES = 128
const SNAPSHOT_MAX_BUNDLE_BYTES = 1024 * 1024
const SNAPSHOT_MAX_TOTAL_BYTES = 8 * 1024 * 1024

interface RegistryDocument {
  readonly formatVersion: typeof DESIGN_PROJECT_REGISTRY_VERSION
  readonly projects: Readonly<Record<string, string>>
}

interface RegistryLayout {
  readonly stateRoot: string
  readonly registryFile: string
}

function requireAbsoluteRoot(value: string, name: string): string {
  if (value === '' || !isAbsolute(value)) {
    throw new Error(`design project registry: ${name} must be an absolute path: ${JSON.stringify(value)}`)
  }
  return resolve(value)
}

function isWithin(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

function plainObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path}: expected a plain object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
  const actual = Object.keys(value)
  const missing = expected.filter(key => !Object.hasOwn(value, key))
  const extra = actual.filter(key => !expected.includes(key))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`${path}: invalid fields (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`)
  }
}

function parseRegistryDocument(value: unknown): RegistryDocument {
  const document = plainObject(value, '$')
  exactKeys(document, ['formatVersion', 'projects'], '$')
  if (document.formatVersion !== DESIGN_PROJECT_REGISTRY_VERSION) {
    throw new Error(`design project registry: unsupported format ${JSON.stringify(document.formatVersion)}`)
  }
  const projects = plainObject(document.projects, '$.projects')
  const parsed: Record<string, string> = Object.create(null) as Record<string, string>
  const roots = new Set<string>()
  for (const [rawId, rawRoot] of Object.entries(projects)) {
    const id = DesignProjectId(rawId)
    if (typeof rawRoot !== 'string' || rawRoot === '' || !isAbsolute(rawRoot) || resolve(rawRoot) !== rawRoot) {
      throw new Error(`design project registry: root for ${JSON.stringify(id)} must be a normalized absolute path`)
    }
    if (roots.has(rawRoot)) {
      throw new Error(`design project registry: duplicate registered root ${JSON.stringify(rawRoot)}`)
    }
    roots.add(rawRoot)
    parsed[id] = rawRoot
  }
  return Object.freeze({
    formatVersion: DESIGN_PROJECT_REGISTRY_VERSION,
    projects: Object.freeze(parsed),
  })
}

function folderSlug(name: string): string {
  const value = name.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '')
  return value === '' ? 'design' : value.slice(0, 48)
}

function registryText(projects: Readonly<Record<string, string>>): string {
  const sorted = Object.fromEntries(Object.entries(projects).sort(([left], [right]) => left.localeCompare(right)))
  return `${JSON.stringify({ formatVersion: DESIGN_PROJECT_REGISTRY_VERSION, projects: sorted }, null, 2)}\n`
}

async function copyMigrationTree(source: string, target: string): Promise<void> {
  const sourceInfo = await lstat(source)
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
    throw new Error(`design project migration: source must be a real directory: ${JSON.stringify(source)}`)
  }
  await mkdir(target, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error(`design project migration: symbolic links are not accepted: ${JSON.stringify(from)}`)
    }
    if (entry.isDirectory()) await copyMigrationTree(from, to)
    else if (entry.isFile()) await copyFile(from, to)
    else throw new Error(`design project migration: unsupported filesystem entry: ${JSON.stringify(from)}`)
  }
}

/** Persistent owner of registered Design Project identities and roots. */
export class DesignProjectRegistry {
  private resolvedProjectsRoot?: string
  /** The creation destination, not a constraint on already registered projects. */
  get projectsRoot(): string {
    return this.resolvedProjectsRoot ??= requireAbsoluteRoot(defaultDesignProjectsRoot(), 'projectsRoot')
  }
  readonly stateRoot: string
  readonly registryFile: string
  private readonly manager: DesignProjectManager
  private mutationTail: Promise<void> = Promise.resolve()
  private readonly snapshotCache = new Map<string, DesignProjectRegistrySnapshot>()
  private readonly readScope = new AsyncLocalStorage<{
    active: boolean
    displayOnly: boolean
    projects: Map<string, Promise<RegisteredDesignProject>>
  }>()

  /** Share identity probes only within a read; independently revalidate before returning. */
  async withReadSnapshot<T>(operation: () => Promise<T>, signal?: AbortSignal, displayOnly = false): Promise<T> {
    const scope = { active: true, displayOnly, projects: new Map<string, Promise<RegisteredDesignProject>>() }
    return this.readScope.run(scope, async () => {
      try {
        signal?.throwIfAborted()
        const result = await operation()
        for (const [id, pending] of scope.projects) {
          const original = await pending
          const current = await this.requireFresh(id, signal)
          if (!isDeepStrictEqual(original, current)) throw new Error('design project: identity or Kit changed while reading workspace')
        }
        signal?.throwIfAborted()
        return result
      } finally {
        scope.active = false
        scope.projects.clear()
      }
    })
  }

  /**
   * Bind one registry to its managed-project parent and external runtime state.
   * @param options - absolute roots and optional project manager.
   */
  constructor(options: DesignProjectRegistryOptions) {
    this.resolvedProjectsRoot = options.projectsRoot === undefined ? undefined : requireAbsoluteRoot(options.projectsRoot, 'projectsRoot')
    this.stateRoot = requireAbsoluteRoot(options.stateRoot, 'stateRoot')
    if (this.resolvedProjectsRoot !== undefined && isWithin(this.resolvedProjectsRoot, this.stateRoot)) {
      throw new Error('design project registry: stateRoot must live outside projectsRoot')
    }
    this.registryFile = join(this.stateRoot, 'design-projects.json')
    this.manager = options.manager ?? new DesignProjectManager()
  }

  /** Create, validate, and register a project below the configured projects root. */
  async create(name: string, knowledge: DesignProjectKnowledgePin, signal?: AbortSignal): Promise<RegisteredDesignProject> {
    return this.mutate(async () => {
      const layout = await this.creationLayout()
      const current = await this.loadValidated(layout, signal)
      this.requireUniqueName(current.records, name)
      const folder = `${folderSlug(name)}-${randomUUID()}`
      const created = await this.manager.create({ root: join(layout.projectsRoot, folder), name, knowledge, signal })
      let persisted = false
      try {
        const canonical = await this.canonicalProject(created)
        this.requireNewIdentity(current.document.projects, current.records, canonical)
        const projects = { ...current.document.projects, [canonical.metadata.id]: canonical.root }
        await this.writeDocument(layout.registryFile, projects)
        persisted = true
        return this.record(canonical, layout.stateRoot)
      } finally {
        if (!persisted) await this.manager.fs.removeTree(created.root)
      }
    })
  }

  /**
   * Inspect the source directory without registering or modifying it.
   * Current-format metadata is optional because older migration sources may
   * contain only Design Files.
   */
  async inspectMigrationSource(sourceReference: string, signal?: AbortSignal): Promise<DesignProjectMigrationSource> {
    signal?.throwIfAborted()
    if (!isAbsolute(sourceReference)) throw new Error('design project migration: source path must be absolute')
    const sourceRoot = await this.manager.fs.realpath(resolve(sourceReference))
    await this.manager.fs.requireDirectory(sourceRoot)
    await this.manager.fs.requireDirectory(join(sourceRoot, 'design_files'))
    signal?.throwIfAborted()
    let projectJson: string
    try {
      projectJson = await this.manager.fs.readText(join(sourceRoot, 'project.json'))
    } catch (error) {
      if (isENOENT(error)) return Object.freeze({ sourceRoot })
      throw error
    }
    try {
      return Object.freeze({ sourceRoot, metadata: parseDesignProjectJson(projectJson) })
    } catch {
      // An older project.json is migration input, not current authority.
      return Object.freeze({ sourceRoot })
    }
  }

  /**
   * Resolve a local file or directory used only as reconstruction evidence.
   * A Design Project is migration input instead and must not enter this path.
   */
  async inspectReconstructionSource(
    sourceReference: string,
    signal?: AbortSignal,
  ): Promise<DesignProjectReconstructionSource> {
    signal?.throwIfAborted()
    if (!isAbsolute(sourceReference)) throw new Error('design reconstruction: source path must be absolute')
    const sourceRoot = await this.manager.fs.realpath(resolve(sourceReference))
    const sourceInfo = await lstat(sourceRoot)
    if (!sourceInfo.isFile() && !sourceInfo.isDirectory()) {
      throw new Error('design reconstruction: source must be a regular file or directory')
    }
    const designFiles = sourceInfo.isDirectory() ? await lstat(join(sourceRoot, 'design_files')).catch((error: unknown) => {
      if (isENOENT(error)) return undefined
      throw error
    }) : undefined
    if (designFiles?.isDirectory() === true && !designFiles.isSymbolicLink()) {
      throw new Error('design reconstruction: source contains Design Files; use /yugoo migrate <path>')
    }
    signal?.throwIfAborted()

    await this.mutationTail
    const layout = await this.layout()
    const registered = await this.loadValidated(layout, signal)
    if (registered.records.some(project => isWithin(project.root, sourceRoot))) {
      throw new Error('design reconstruction: source is a registered Design Project; use /yugoo migrate <path> for Design Files')
    }

    let projectJson: string | undefined
    try {
      if (sourceInfo.isDirectory()) projectJson = await this.manager.fs.readText(join(sourceRoot, 'project.json'))
    } catch (error) {
      if (!isENOENT(error)) throw error
    }
    let metadata: DesignProjectMetadata | undefined
    if (projectJson !== undefined) {
      try {
        metadata = parseDesignProjectJson(projectJson)
      } catch {
        // An unrelated application project.json is ordinary source evidence.
      }
    }
    if (metadata !== undefined) {
      throw new Error('design reconstruction: source is a Design Project; use /yugoo migrate <path> for Design Files')
    }

    return Object.freeze({
      sourceRoot,
      suggestedProjectName: `${folderSlug(basename(sourceRoot))}-reconstructed`,
    })
  }

  /**
   * Create a current-format project and stage only selected-Mindset Bundle
   * files from an older project. Bundle Producers own validation and adaptation.
   */
  async migrate(
    sourceReference: string,
    basis: DesignProjectMigrationBasis,
    bundleNames: readonly string[],
    signal?: AbortSignal,
  ): Promise<MigratedDesignProject> {
    return this.mutate(async () => {
      const layout = await this.creationLayout()
      const current = await this.loadValidated(layout, signal)
      const { sourceRoot } = await this.inspectMigrationSource(sourceReference, signal)
      const sourceDesignFiles = join(sourceRoot, 'design_files')
      const available = new Set((await readdir(sourceDesignFiles, { withFileTypes: true }))
        .filter(entry => entry.isDirectory() && !entry.isSymbolicLink())
        .map(entry => entry.name))
      const migratedBundles = [...new Set(bundleNames)].filter(name => available.has(name)).sort()
      if (migratedBundles.length === 0) {
        throw new Error('design project migration: source contains no Bundle directories exposed by the current Mindset')
      }

      const baseName = `${folderSlug(basename(sourceRoot))}-migrated`
      let name = baseName
      for (let suffix = 2; current.records.some(project => project.metadata.name === name); suffix += 1) {
        name = `${baseName}-${suffix}`
      }
      const folder = `${folderSlug(name)}-${randomUUID()}`
      const created = await this.manager.create({
        root: join(layout.projectsRoot, folder),
        name,
        knowledge: basis.knowledge,
        kit: basis.kit,
        signal,
      })
      let persisted = false
      try {
        for (const bundle of migratedBundles) {
          await copyMigrationTree(join(sourceDesignFiles, bundle), join(created.designFilesRoot, bundle))
        }
        const canonical = await this.canonicalProject(created, signal)
        this.requireNewIdentity(current.document.projects, current.records, canonical)
        await this.writeDocument(layout.registryFile, {
          ...current.document.projects,
          [canonical.metadata.id]: canonical.root,
        })
        persisted = true
        return Object.freeze({
          ...this.record(canonical, layout.stateRoot),
          sourceRoot,
          migratedBundles: Object.freeze(migratedBundles),
        })
      } finally {
        if (!persisted) await this.manager.fs.removeTree(created.root)
      }
    })
  }

  /** Resolve id, then unique registered name, then an absolute project path. */
  async open(reference: string, signal?: AbortSignal): Promise<RegisteredDesignProject> {
    return this.mutate(async () => {
      const layout = await this.layout()
      const document = await this.readDocument(layout.registryFile)
      let referencedId: DesignProjectIdType | undefined
      try {
        referencedId = DesignProjectId(reference)
      } catch {
        referencedId = undefined
      }
      if (referencedId !== undefined && document.projects[referencedId] !== undefined) {
        return this.record(await this.openRegistered(referencedId, document.projects[referencedId] as string, signal), layout.stateRoot)
      }

      const current = await this.loadValidated(layout, signal, document)

      const byName = current.records.filter(record => record.metadata.name === reference)
      if (byName.length > 1) {
        throw new Error(`design project registry: registered name ${JSON.stringify(reference)} is ambiguous`)
      }
      if (byName[0] !== undefined) return this.record(byName[0], layout.stateRoot)
      if (!isAbsolute(reference)) {
        throw new Error(`design project registry: no project id or unique name matches ${JSON.stringify(reference)}; a path must be absolute`)
      }

      const opened = await this.manager.open(resolve(reference), signal)
      const canonical = await this.canonicalProject(opened, signal)
      const existingRoot = Object.entries(current.document.projects).find(([, root]) => root === canonical.root)
      if (existingRoot !== undefined) {
        if (existingRoot[0] !== canonical.metadata.id) {
          throw new Error(`design project registry: root ${JSON.stringify(canonical.root)} changed project identity`)
        }
        return this.record(canonical, layout.stateRoot)
      }
      this.requireNewIdentity(current.document.projects, current.records, canonical)
      const record = this.record(canonical, layout.stateRoot)
      const projects = { ...current.document.projects, [canonical.metadata.id]: canonical.root }
      await this.writeDocument(layout.registryFile, projects)
      return record
    })
  }

  /** List every registered project after validating its current metadata and Git root. */
  async list(signal?: AbortSignal): Promise<readonly RegisteredDesignProject[]> {
    await this.mutationTail
    const layout = await this.layout()
    const current = await this.loadValidated(layout, signal)
    return Object.freeze(current.records
      .map(project => this.record(project, layout.stateRoot))
      .sort((left, right) => left.name.localeCompare(right.name) || left.projectId.localeCompare(right.projectId)))
  }

  /** List registered projects newest-first using each repository's latest checkpoint time. */
  async listRecent(signal?: AbortSignal): Promise<readonly RegisteredDesignProjectSummary[]> {
    const records = await this.list(signal)
    const summaries = await Promise.all(records.map(async (record) => {
      const history = await new GitVersioning(this.manager.spawn, record.root).history(1, undefined, signal)
      const updatedAt = history[0]?.committedAt
      if (updatedAt === undefined) throw new Error(`design project registry: project ${JSON.stringify(record.projectId)} has no checkpoint history`)
      return Object.freeze({ ...record, updatedAt })
    }))
    return Object.freeze(summaries.sort((left, right) => (
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
      || left.name.localeCompare(right.name)
      || left.projectId.localeCompare(right.projectId)
    )))
  }

  /** Remove one project from discovery while preserving its repository and Git history. */
  async forget(reference: string, signal?: AbortSignal): Promise<RegisteredDesignProject> {
    return this.mutate(async () => {
      const layout = await this.layout()
      const current = await this.loadValidated(layout, signal)
      const matches = current.records.filter(project => (
        project.metadata.id === reference || project.metadata.name === reference
      ))
      if (matches.length !== 1) {
        throw new Error(matches.length === 0
          ? `design project registry: no registered project matches ${JSON.stringify(reference)}`
          : `design project registry: project name ${JSON.stringify(reference)} is ambiguous`)
      }
      const project = matches[0] as DesignProject
      const projects = { ...current.document.projects }
      delete projects[project.metadata.id]
      await this.writeDocument(layout.registryFile, projects)
      return this.record(project, layout.stateRoot)
    })
  }

  /** Require one exact registered project id and revalidate its on-disk identity. */
  async require(projectId: string, signal?: AbortSignal): Promise<RegisteredDesignProject> {
    signal?.throwIfAborted()
    const scope = this.readScope.getStore()
    if (!scope?.active) return this.requireFresh(projectId, signal)
    let pending = scope.projects.get(projectId)
    if (pending === undefined) {
      pending = this.requireFresh(projectId, signal)
      scope.projects.set(projectId, pending)
    }
    const project = await pending
    signal?.throwIfAborted()
    return project
  }

  private async requireFresh(projectId: string, signal?: AbortSignal): Promise<RegisteredDesignProject> {
    const id = DesignProjectId(projectId)
    await this.mutationTail
    const layout = await this.layout()
    const document = await this.readDocument(layout.registryFile)
    const root = document.projects[id]
    if (root === undefined) throw new Error(`design project registry: project ${JSON.stringify(id)} is not registered`)
    const project = await this.openRegistered(id, root, signal)
    return this.record(project, layout.stateRoot)
  }

  /** Location-only recovery entry; never exposes unsettled metadata or Design Files. */
  async contentRecoveryLocation(projectId: string): Promise<{ readonly projectId: DesignProjectIdType; readonly root: string; readonly stateRoot: string }> {
    const id = DesignProjectId(projectId)
    await this.mutationTail
    const layout = await this.layout(), document = await this.readDocument(layout.registryFile)
    const root = document.projects[id]
    if (!root) throw new Error('design project registry: exact recovery project is not registered')
    return { projectId: id, root, stateRoot: join(layout.stateRoot, 'projects', id) }
  }

  /** Return current project-root Git status without changing registry or project data. */
  async status(projectId: string, signal?: AbortSignal): Promise<RegisteredDesignProjectStatus> {
    const record = await this.require(projectId, signal)
    const project = await this.manager.open(record.root, signal)
    const status = await this.manager.status(project, signal)
    return Object.freeze({
      ...record,
      gitClean: !status.dirty,
      lastCheckpoint: status.head,
      porcelain: status.porcelain,
    })
  }

  /** Close a runtime selection by reporting status; registration and files remain intact. */
  async close(projectId: string, signal?: AbortSignal): Promise<RegisteredDesignProjectStatus> {
    return this.status(projectId, signal)
  }

  /** Read canonical Bundle JSON states from the registered project's exact committed HEAD. */
  async snapshot(projectId: string, signal?: AbortSignal): Promise<DesignProjectRegistrySnapshot> {
    const project = await this.require(projectId, signal)
    const git = new GitVersioning(this.manager.spawn, project.root, 'design_files')
    const scope = this.readScope.getStore()
    const checkpoint = scope?.active && scope.displayOnly
      ? await git.pollHead(signal) : await git.head(signal)
    if (checkpoint === undefined) throw new Error(`design project registry: project ${JSON.stringify(project.projectId)} has no checkpoint`)
    const cached = this.snapshotCache.get(String(project.projectId))
    if (cached?.checkpoint === checkpoint) return cached
    const paths = await git.listPathsAt(checkpoint, signal)
    const canonical = paths.filter((path) => {
      const parts = path.split('/')
      return parts.length === 2 && parts[0] !== '' && parts[1] === `${parts[0]}.json`
    })
    if (canonical.length > SNAPSHOT_MAX_BUNDLES) {
      throw new Error(`design project registry: snapshot exceeds ${SNAPSHOT_MAX_BUNDLES} Bundle states`)
    }
    const bundleStates: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    let totalBytes = 0
    for (const path of canonical) {
      const bundle = path.slice(0, path.indexOf('/'))
      const text = await git.readTextAt(checkpoint, path, signal)
      if (text === undefined) throw new Error(`design project registry: checkpoint path disappeared: ${JSON.stringify(path)}`)
      const bytes = Buffer.byteLength(text, 'utf8')
      if (bytes > SNAPSHOT_MAX_BUNDLE_BYTES) {
        throw new Error(`design project registry: Bundle state ${JSON.stringify(bundle)} exceeds ${SNAPSHOT_MAX_BUNDLE_BYTES} bytes`)
      }
      totalBytes += bytes
      if (totalBytes > SNAPSHOT_MAX_TOTAL_BYTES) {
        throw new Error(`design project registry: snapshot exceeds ${SNAPSHOT_MAX_TOTAL_BYTES} bytes`)
      }
      let value: unknown
      try {
        value = JSON.parse(text)
      } catch (error) {
        throw new Error(`design project registry: invalid committed Bundle JSON ${JSON.stringify(path)}: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`design project registry: committed Bundle state ${JSON.stringify(path)} must be an object`)
      }
      bundleStates[bundle] = value
    }
    const revalidated = await this.require(project.projectId, signal)
    if (revalidated.root !== project.root) throw new Error('design project registry: project identity changed while loading snapshot')
    const snapshot = Object.freeze({ projectId: project.projectId, checkpoint, bundleStates: Object.freeze(bundleStates) })
    this.snapshotCache.delete(String(project.projectId))
    this.snapshotCache.set(String(project.projectId), snapshot)
    while (this.snapshotCache.size > 32) {
      const oldest = this.snapshotCache.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.snapshotCache.delete(oldest)
    }
    return snapshot
  }

  /** Atomically replace the exact Kit pin and commit only `project.json`. */
  async setKitPin(
    projectId: string,
    kit: DesignProjectKitPin,
    signal?: AbortSignal,
  ): Promise<RegisteredDesignProject> {
    return this.mutate(async () => {
      const layout = await this.layout()
      const id = DesignProjectId(projectId)
      const document = await this.readDocument(layout.registryFile)
      const root = document.projects[id]
      if (root === undefined) throw new Error(`design project registry: project ${JSON.stringify(id)} is not registered`)
      const project = await this.openRegistered(id, root, signal)
      const git = new GitVersioning(this.manager.spawn, project.root)
      const checkpoint = await git.head(signal)
      if (checkpoint === undefined) throw new Error(`design project registry: project ${JSON.stringify(id)} has no checkpoint`)
      const projectFile = join(project.root, 'project.json')
      const committed = await git.readTextAt(checkpoint, 'project.json', signal)
      if (committed === undefined) throw new Error('design project registry: checkpoint has no project.json')
      const live = await readFile(projectFile, 'utf8')
      if (live !== committed) {
        throw new Error('design project registry: project.json has uncommitted changes; preserve or revert them before changing the mindset')
      }
      if (sameProjectContentPin(project.metadata.kit, kit)) {
        return this.record(project, layout.stateRoot)
      }
      const metadata = Object.freeze({ ...project.metadata, kit })
      const replacement = `${JSON.stringify(metadata, null, 2)}\n`
      const temp = join(project.root, `.project-${randomUUID()}.tmp`)
      try {
        await writeFile(temp, replacement, { encoding: 'utf8', flag: 'wx' })
        await rename(temp, projectFile)
        // Validate the exact filesystem scene before publication. After the
        // commit CAS succeeds there is no second fallible reopen/rollback
        // phase: the frozen bytes and returned revision are the authority.
        const prepared = await this.manager.open(project.root, signal)
        if (prepared.metadata.id !== id || prepared.metadata.kit?.name !== kit.name || prepared.metadata.kit.version !== kit.version) {
          throw new Error('design project registry: replacement metadata does not contain the requested Design Kit')
        }
        const committedCheckpoint = await git.commitExact(
          `Select Design Kit ${kit.name}@${kit.version}`,
          new Map([['project.json', replacement]]),
          checkpoint,
          signal,
        )
        if (committedCheckpoint === undefined) {
          const currentHead = await git.head(signal)
          const published = currentHead === undefined ? undefined : await git.readTextAt(currentHead, 'project.json', signal)
          if (published !== replacement) {
            throw new Error('design project registry: Kit pin update produced no checkpoint and current HEAD does not contain the requested metadata')
          }
        }
        return this.record(prepared, layout.stateRoot)
      } finally {
        await rm(temp, { force: true }).catch(() => {})
      }
    })
  }

  private async layout(): Promise<RegistryLayout> {
    await mkdir(this.stateRoot, { recursive: true })
    const stateRoot = await this.manager.fs.realpath(this.stateRoot)
    return { stateRoot, registryFile: join(stateRoot, 'design-projects.json') }
  }

  private async creationLayout(): Promise<RegistryLayout & { projectsRoot: string }> {
    const root = this.projectsRoot
    if (isWithin(root, this.stateRoot)) {
      throw new Error('design project registry: stateRoot must live outside projectsRoot')
    }
    await mkdir(root, { recursive: true })
    const projectsRoot = await this.manager.fs.realpath(root)
    const { stateRoot, registryFile } = await this.layout()
    if (isWithin(projectsRoot, stateRoot)) {
      throw new Error('design project registry: stateRoot must live outside projectsRoot')
    }
    return { projectsRoot, stateRoot, registryFile }
  }

  private async readDocument(registryFile: string): Promise<RegistryDocument> {
    let text: string
    try {
      text = await readFile(registryFile, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return Object.freeze({ formatVersion: DESIGN_PROJECT_REGISTRY_VERSION, projects: Object.freeze({}) })
      }
      throw error
    }
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch (error) {
      throw new Error(`design project registry: invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
    return parseRegistryDocument(value)
  }

  private async loadValidated(
    layout: RegistryLayout,
    signal?: AbortSignal,
    existingDocument?: RegistryDocument,
  ): Promise<{ readonly document: RegistryDocument; readonly records: readonly DesignProject[] }> {
    const document = existingDocument ?? await this.readDocument(layout.registryFile)
    const records: DesignProject[] = []
    const names = new Map<string, DesignProjectIdType>()
    for (const [registeredId, registeredRoot] of Object.entries(document.projects)) {
      const project = await this.openRegistered(DesignProjectId(registeredId), registeredRoot, signal)
      this.assertExternalState(project.root, layout.stateRoot)
      const duplicate = names.get(project.metadata.name)
      if (duplicate !== undefined && duplicate !== project.metadata.id) {
        throw new Error(`design project registry: duplicate registered name ${JSON.stringify(project.metadata.name)}`)
      }
      names.set(project.metadata.name, project.metadata.id)
      records.push(project)
    }
    return { document, records }
  }

  private async canonicalRegisteredRoot(registeredRoot: string): Promise<string> {
    const canonicalRoot = await this.manager.fs.realpath(registeredRoot)
    if (canonicalRoot !== registeredRoot) {
      throw new Error(`design project registry: registered root is not canonical: ${JSON.stringify(registeredRoot)}`)
    }
    return canonicalRoot
  }

  private async openRegistered(
    registeredId: DesignProjectIdType,
    registeredRoot: string,
    signal?: AbortSignal,
  ): Promise<DesignProject> {
    const canonicalRoot = await this.canonicalRegisteredRoot(registeredRoot)
    const scope = this.readScope.getStore()
    const project = scope?.active && scope.displayOnly
      ? await this.manager.readMetadata(canonicalRoot)
      : await this.manager.open(canonicalRoot, signal)
    if (project.metadata.id !== registeredId) {
      throw new Error(`design project registry: project.json id ${JSON.stringify(project.metadata.id)} does not match registered id ${JSON.stringify(registeredId)}`)
    }
    return project
  }

  private async canonicalProject(project: DesignProject, signal?: AbortSignal): Promise<DesignProject> {
    const canonicalRoot = await this.manager.fs.realpath(project.root)
    return this.manager.open(canonicalRoot, signal)
  }

  private record(project: DesignProject, stateRoot: string): RegisteredDesignProject {
    this.assertExternalState(project.root, stateRoot)
    return Object.freeze({
      projectId: project.metadata.id,
      name: project.metadata.name,
      root: project.root,
      designFilesRoot: project.designFilesRoot,
      stateRoot: join(stateRoot, 'projects', project.metadata.id),
      knowledge: project.metadata.knowledge,
      ...(project.metadata.kit === undefined ? {} : { kit: project.metadata.kit }),
    })
  }

  private assertExternalState(projectRoot: string, stateRoot: string): void {
    if (isWithin(projectRoot, stateRoot)) {
      throw new Error('design project registry: stateRoot must live outside the registered project')
    }
  }

  private requireUniqueName(records: readonly DesignProject[], name: string): void {
    if (records.some(project => project.metadata.name === name)) {
      throw new Error(`design project registry: duplicate registered name ${JSON.stringify(name)}`)
    }
  }

  private requireNewIdentity(
    projects: Readonly<Record<string, string>>,
    records: readonly DesignProject[],
    project: DesignProject,
  ): void {
    const existingIdRoot = projects[project.metadata.id]
    if (existingIdRoot !== undefined && existingIdRoot !== project.root) {
      throw new Error(`design project registry: duplicate project id ${JSON.stringify(project.metadata.id)}`)
    }
    if (records.some(candidate => candidate.root === project.root && candidate.metadata.id !== project.metadata.id)) {
      throw new Error(`design project registry: duplicate registered root ${JSON.stringify(project.root)}`)
    }
    this.requireUniqueName(records.filter(candidate => candidate.metadata.id !== project.metadata.id), project.metadata.name)
  }

  private async writeDocument(registryFile: string, projects: Readonly<Record<string, string>>): Promise<void> {
    const temp = join(this.stateRoot, `.design-projects-${randomUUID()}.tmp`)
    try {
      await writeFile(temp, registryText(projects), { encoding: 'utf8', flag: 'wx' })
      await rename(temp, registryFile)
    } catch (error) {
      await rm(temp, { force: true })
      throw error
    }
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const execution = this.mutationTail.then(operation, operation)
    const tail = execution.then(() => undefined, () => undefined)
    this.mutationTail = tail
    return execution
  }
}
