/** Native-Agent semantic migration in an isolated candidate, followed by same-ID adoption. */
import { mkdir, readFile, readdir, lstat, writeFile } from 'node:fs/promises'
import { join, dirname, isAbsolute, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DesignProjectManager, parseDesignProjectJson, type DesignProjectKitPin } from './design-project.ts'
import type { DesignKit } from './types.ts'
import { GitVersioning, type SpawnFn } from './git.ts'
import { projectKitContentHash, sameProjectContentPin } from './project-content.ts'
import { ProjectContentTransaction, type ProjectContentAdoptionReceipt } from './project-content-transaction.ts'
import { ProjectContentCandidate } from './project-content-candidate.ts'

interface MigrationPlan {
  readonly formatVersion: 1
  readonly id: string
  readonly projectId: string
  readonly sourceCheckpoint: string
  readonly sourcePin: DesignProjectKitPin
  readonly targetPin: DesignProjectKitPin
  readonly sourceHash: string
  readonly sourceFiles: readonly string[]
}
export interface NativeContentMigrationEvidence {
  readonly status: 'equivalent' | 'needs-user-input'
  readonly summary: string
  /** Every existing canonical source must be accounted for, including unchanged data. */
  readonly sources: readonly { readonly file: string; readonly explanation: string }[]
  readonly unresolvedFacts: readonly string[]
}
export interface ProjectContentMigrationPorts {
  readonly root: string
  readonly stateRoot: string
  readonly spawn: SpawnFn
  readonly mutate: <T>(operation: () => Promise<T>) => Promise<T>
  readonly resolveKit: (pin: DesignProjectKitPin) => DesignKit | undefined | Promise<DesignKit | undefined>
  /** Owning Host checks actual contributions/ABI before preparing or adopting. */
  readonly assertCompatible: (kit: DesignKit) => void | Promise<void>
  /** Actual run and Panel draft observations, never Agent-supplied boolean assertions. */
  readonly assertQuiescent: () => Promise<void>
  /** Validate all target state and reference/artifact contracts using existing validators. */
  readonly validate: (kit: DesignKit, files: ReadonlyMap<string, Uint8Array>) => Promise<void>
  /** Host-owned receipt verification (native parent/child/transcript or equivalent). */
  readonly verifyNativeProducer: (proof: unknown, candidateRoot: string) => Promise<void>
  readonly record: (receipt: ProjectContentAdoptionReceipt, journalOwner?: string) => Promise<void>
  readonly journalOwner?: string
}

async function candidateFiles(root: string): Promise<Map<string, Uint8Array>> {
  const result = new Map<string, Uint8Array>()
  let bytes = 0, nodes = 0
  const walk = async (directory: string, prefix: string): Promise<void> => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (++nodes > 4096 || prefix.split('/').length > 32 || /[\\:\u0000-\u001f]/u.test(item.name)) throw new Error('migration: candidate exceeds confinement limits')
      const path = join(directory, item.name), key = `${prefix}/${item.name}`
      const info = await lstat(path)
      if (info.isSymbolicLink()) throw new Error('migration: candidate cannot contain symlinks')
      if (info.isDirectory()) await walk(path, key)
      else if (info.isFile()) {
        bytes += info.size
        if (bytes > 64 * 1024 * 1024) throw new Error('migration: candidate exceeds byte limit')
        result.set(key, await readFile(path))
      } else throw new Error('migration: candidate contains non-regular resources')
    }
  }
  await walk(join(root, 'design_files'), 'design_files')
  result.set('project.json', await readFile(join(root, 'project.json')))
  return result
}

export class ProjectContentMigration {
  private readonly git: GitVersioning
  private readonly manager: DesignProjectManager
  private readonly candidates = new Map<string, ProjectContentCandidate>()
  constructor(private readonly ports: ProjectContentMigrationPorts) {
    if (!isAbsolute(ports.root) || !isAbsolute(ports.stateRoot)) throw new Error('migration: exact absolute project and state roots are required')
    const location = relative(ports.root, ports.stateRoot)
    if (!location || location !== '..' && !location.startsWith('../') && !location.startsWith('..\\') && !isAbsolute(location)) throw new Error('migration: candidate storage must be outside the live project')
    this.git = new GitVersioning(ports.spawn, ports.root)
    this.manager = new DesignProjectManager({ spawn: ports.spawn })
  }
  private directory(id: string): string {
    if (!/^[a-f0-9-]{36}$/u.test(id)) throw new Error('migration: invalid exact candidate id')
    return join(this.ports.stateRoot, 'content-migrations', id)
  }
  private canonicalSources(plan: MigrationPlan, evidence: NativeContentMigrationEvidence): readonly string[] {
    if (evidence.status !== 'equivalent' || !evidence.summary?.trim() || evidence.unresolvedFacts.length) {
      throw new Error(`migration: unresolved semantic decisions require user input: ${evidence.unresolvedFacts.join('; ')}`)
    }
    const sources = plan.sourceFiles.filter(path => /^design_files\/([^/]+)\/\1\.json$/u.test(path))
    if (sources.some(path => !evidence.sources.some(source => source.file === path && source.explanation.trim()))) {
      throw new Error('migration: native evidence must account for every saved canonical source')
    }
    return sources
  }
  /** Bound tools consume an exact prepared operation; model arguments never choose its root. */
  async candidate(id: string): Promise<ProjectContentCandidate> {
    const directory = this.directory(id)
    const plan = JSON.parse(await readFile(join(directory, 'plan.json'), 'utf8')) as MigrationPlan
    if (plan.formatVersion !== 1 || plan.id !== id) throw new Error('migration: invalid candidate plan')
    const current = await this.manager.open(this.ports.root)
    if (current.metadata.id !== plan.projectId || !sameProjectContentPin(current.metadata.kit, plan.sourcePin)
      || (await this.git.head()) !== plan.sourceCheckpoint) throw new Error('migration: candidate is not bound to the current exact project checkpoint')
    const cached = this.candidates.get(id)
    if (cached) return cached
    const candidate = new ProjectContentCandidate(join(directory, 'candidate'), join(directory, 'definitions.json'))
    this.candidates.set(id, candidate)
    return candidate
  }
  async prepare(targetPin: DesignProjectKitPin): Promise<{
    readonly id: string; readonly projectId: string; readonly sourceCheckpoint: string
    readonly candidateRoot: string; readonly definitions: string; readonly method: string
  }> {
    return this.ports.mutate(async () => {
      await this.ports.assertQuiescent()
      const project = await this.manager.open(this.ports.root)
      if (!project.metadata.kit) throw new Error('migration: activate a Kit before selecting a version')
      if (targetPin.name !== project.metadata.kit.name) throw new Error('migration: version selection preserves the active Kit catalog identity')
      const status = await this.manager.status(project)
      if (status.dirty) throw new Error('migration: preserve or settle uncommitted project edits before upgrading')
      const source = await this.ports.resolveKit(project.metadata.kit), target = await this.ports.resolveKit(targetPin)
      if (!source || !target) throw new Error('migration: restore the full exact source and target definitions before upgrading')
      if (target.name !== targetPin.name || target.version !== targetPin.version) throw new Error('migration: exact target resolution required')
      await this.ports.assertCompatible(target)
      const id = randomUUID(), directory = this.directory(id), candidateRoot = join(directory, 'candidate')
      await mkdir(join(candidateRoot, 'design_files'), { recursive: true })
      const paths = (await this.git.listPathsAt(status.head)).filter(path => path.startsWith('design_files/'))
      if (paths.length > 4096) throw new Error('migration: project exceeds file limit')
      let total = 0
      for (const path of paths) {
        if (/[\\:\u0000-\u001f]/u.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('migration: unsafe source path')
        const bytes = await this.git.readBytesAt(status.head, path, undefined, 64 * 1024 * 1024)
        if (!bytes || (total += bytes.byteLength) > 64 * 1024 * 1024) throw new Error('migration: project exceeds byte limit')
        await mkdir(dirname(join(candidateRoot, path)), { recursive: true })
        await writeFile(join(candidateRoot, path), bytes, { flag: 'wx' })
      }
      const effectivePin = { ...targetPin, contentHash: projectKitContentHash(target) }
      const plan: MigrationPlan = { formatVersion: 1, id, projectId: project.metadata.id, sourceCheckpoint: status.head,
        sourcePin: project.metadata.kit, targetPin: effectivePin, sourceHash: projectKitContentHash(source), sourceFiles: paths }
      await writeFile(join(candidateRoot, 'project.json'), `${JSON.stringify({ ...project.metadata, kit: effectivePin }, null, 2)}\n`, { flag: 'wx' })
      // Immutable plans/definitions are outside the Producer-writable candidate directory.
      const definitions = join(directory, 'definitions.json')
      await writeFile(definitions, JSON.stringify({ source, target }, null, 2), { flag: 'wx', mode: 0o400 })
      await writeFile(join(directory, 'plan.json'), JSON.stringify(plan), { flag: 'wx', mode: 0o400 })
      return { id, projectId: plan.projectId, sourceCheckpoint: plan.sourceCheckpoint, candidateRoot, definitions,
        method: 'Use an isolated native Host Producer. Read every page of both required reading sets: complete changed domain methods and output contracts, related cross-Bundle contracts and shared constraints. Every original resource and complete source/target definition remains available on demand; read additional evidence when needed for semantic fidelity. Modify only the exact candidate directory. Preserve saved user facts, stable IDs, references and existing assets. Translate semantics; schema validity alone does not establish equivalence. Account for every existing canonical source in the evidence receipt. If new facts or domain decisions are needed, return needs-user-input with exact unresolved facts; never invent values to pass validation. Return the actual native execution proof and semantic evidence. Only the owning Core transaction may adopt this candidate into the original project; do not edit or repin that project yourself.' }
    })
  }
  async finish(id: string, proof: unknown, evidence: NativeContentMigrationEvidence): Promise<ProjectContentAdoptionReceipt> {
    const directory = this.directory(id), candidateRoot = join(directory, 'candidate')
    const plan = JSON.parse(await readFile(join(directory, 'plan.json'), 'utf8')) as MigrationPlan
    if (plan.formatVersion !== 1 || plan.id !== id) throw new Error('migration: invalid candidate plan')
    await this.ports.verifyNativeProducer(proof, candidateRoot)
    const canonicalSources = this.canonicalSources(plan, evidence)
    const files = await candidateFiles(candidateRoot)
    // Assets and unfamiliar source files survive byte-for-byte; deletion is not a hidden upgrade side effect.
    for (const path of plan.sourceFiles.filter(path => !canonicalSources.includes(path))) {
      const original = await this.git.readBytesAt(plan.sourceCheckpoint, path)
      if (!files.get(path) || !Buffer.from(files.get(path)!).equals(Buffer.from(original!))) throw new Error(`migration: preserve existing asset/source ${path}`)
    }
    if (canonicalSources.some(path => !files.has(path))) throw new Error('migration: canonical sources cannot disappear during upgrade')
    const transaction = new ProjectContentTransaction(this.ports)
    return transaction.adopt({ projectId: plan.projectId, sourceCheckpoint: plan.sourceCheckpoint,
      contentHash: plan.targetPin.contentHash!, files, validate: async captured => {
        await this.ports.assertQuiescent()
        const current = await this.manager.open(this.ports.root)
        if (!sameProjectContentPin(current.metadata.kit, plan.sourcePin)) throw new Error('migration: project content selection changed')
        const source = await this.ports.resolveKit(plan.sourcePin), target = await this.ports.resolveKit(plan.targetPin)
        if (!source || !target || projectKitContentHash(source) !== plan.sourceHash
          || projectKitContentHash(target) !== plan.targetPin.contentHash) throw new Error('migration: source or target definitions changed')
        const candidate = parseDesignProjectJson(Buffer.from(captured.get('project.json')!).toString('utf8'))
        if (!sameProjectContentPin(candidate.kit, plan.targetPin)) throw new Error('migration: candidate changed the authorized exact target')
        await this.ports.assertCompatible(target)
        await this.ports.validate(target, captured as ReadonlyMap<string, Uint8Array>)
        await this.ports.assertQuiescent()
      } })
  }
  /** Same target validation inside the still-attached native generator's repair loop. */
  async validateCandidate(id: string, evidence: NativeContentMigrationEvidence): Promise<void> {
    const directory = this.directory(id)
    const plan = JSON.parse(await readFile(join(directory, 'plan.json'), 'utf8')) as MigrationPlan
    if (plan.formatVersion !== 1 || plan.id !== id) throw new Error('migration: invalid candidate plan')
    this.canonicalSources(plan, evidence)
    await this.ports.assertQuiescent()
    const source = await this.ports.resolveKit(plan.sourcePin), target = await this.ports.resolveKit(plan.targetPin)
    if (!source || !target || projectKitContentHash(source) !== plan.sourceHash || projectKitContentHash(target) !== plan.targetPin.contentHash) throw new Error('migration: source or target definitions changed')
    await this.ports.assertCompatible(target)
    const files = await candidateFiles(join(directory, 'candidate'))
    const metadata = parseDesignProjectJson(Buffer.from(files.get('project.json')!).toString('utf8'))
    if (!sameProjectContentPin(metadata.kit, plan.targetPin)) throw new Error('migration: candidate changed the authorized exact target')
    for (const path of plan.sourceFiles) {
      if (!files.has(path)) throw new Error('migration: canonical sources cannot disappear during upgrade')
      if (!/^design_files\/([^/]+)\/\1\.json$/u.test(path)
        && !Buffer.from(files.get(path)!).equals(Buffer.from((await this.git.readBytesAt(plan.sourceCheckpoint, path))!))) throw new Error(`migration: preserve existing asset/source ${path}`)
    }
    await this.ports.validate(target, files)
    await this.ports.assertQuiescent()
  }
  async recover(): Promise<ProjectContentAdoptionReceipt | undefined> {
    return new ProjectContentTransaction(this.ports).recover()
  }
}
