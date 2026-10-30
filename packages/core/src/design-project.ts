/** Host-neutral Design Project metadata, creation, opening, and Git status. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import { randomUUID } from 'node:crypto'
import { spawn as spawnChild } from 'node:child_process'
import { mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { collectGitStdout, GitVersioning, gitBackendSetting, type SpawnFn, type NativeGitRequest } from './git.ts'
import type { NativeGitInspection, NativeGitResult } from './git-native-contract.ts'
import { executeNativeGitRequest } from './git-native-executor.ts'
import { DesignBundleVersion, DesignKitVersion } from './types.ts'

/** Current on-disk Design Project metadata format. */
export const DESIGN_PROJECT_FORMAT_VERSION = 3 as const

/** Stable opaque identity of one Design Project. */
export type DesignProjectId = Branded<'DesignProjectId'>

/** Opaque host-registered Design Knowledge provider identity. */
export type DesignKnowledgeProviderId = Branded<'DesignKnowledgeProviderId'>

/** Exact Design Knowledge provider selection stored in project metadata. */
export interface DesignProjectKnowledgePin {
  readonly provider: DesignKnowledgeProviderId
}

/** One exact Kit pin stored in project metadata. */
export interface DesignProjectKitPin {
  readonly name: string
  readonly version: DesignKitVersion
  /** Exact overrides for catalog identities already mounted by this Kit. */
  readonly bundles?: Readonly<Record<string, DesignBundleVersion>>
  /** Fingerprint of the complete effective definitions, independent of installation paths. */
  readonly contentHash?: string
}

/** Complete persisted `project.json` metadata. */
export interface DesignProjectMetadata {
  readonly kind: 'dsh-design-project'
  readonly formatVersion: typeof DESIGN_PROJECT_FORMAT_VERSION
  readonly id: DesignProjectId
  readonly name: string
  readonly createdAt: string
  readonly knowledge: DesignProjectKnowledgePin
  readonly kit?: DesignProjectKitPin
}

/** Resolved immutable view of an opened Design Project. */
export interface DesignProject {
  readonly root: string
  readonly designFilesRoot: string
  readonly metadata: DesignProjectMetadata
}

/** Git status of one validated Design Project. */
export interface DesignProjectStatus {
  readonly head: string
  readonly dirty: boolean
  readonly porcelain: string
}

/** Filesystem operations required by the host-neutral project core. */
export interface DesignProjectFs {
  readonly createDirectory: (path: string) => Promise<void>
  readonly ensureDirectory: (path: string) => Promise<void>
  readonly readText: (path: string) => Promise<string>
  readonly writeNewText: (path: string, content: string) => Promise<void>
  readonly requireDirectory: (path: string) => Promise<void>
  readonly realpath: (path: string) => Promise<string>
  readonly removeTree: (path: string) => Promise<void>
}

/** Injectable dependencies and deterministic creation hooks. */
export interface DesignProjectDependencies {
  readonly fs?: DesignProjectFs
  readonly spawn?: SpawnFn
  /** Explicit diagnostic/test selection; normal product routing is library Git. */
  readonly gitBackend?: 'cli' | 'native'
  readonly createId?: () => string
  readonly now?: () => Date
}

/** Input for creating a managed Design Project. */
export interface CreateDesignProjectInput {
  readonly root: string
  readonly name: string
  readonly knowledge: { readonly provider: string }
  readonly kit?: { readonly name: string; readonly version: string; readonly bundles?: Readonly<Record<string, string>>; readonly contentHash?: string }
  readonly signal?: AbortSignal
}

const PROJECT_KIND = 'dsh-design-project' as const
const PROJECT_FILE = 'project.json'
const PROJECT_README_FILE = 'README.md'
const DESIGN_FILES_DIRECTORY = 'design_files'
const PROJECT_IGNORE = '# Local operating-system metadata\n.DS_Store\nThumbs.db\n'
// Product guidance travels with the project; it is not a Bundle or a design source.
const PROJECT_README = `# Yugoo Design 设计项目

这个目录是一个语构设计系统（Yugoo Design）的设计项目，保存人与 AI 共同推敲形成的设计成果，可用于继续讨论、评估方案，或指导后续实现。

## Yugoo Design 是什么

Yugoo Design 是一款兼容主流 AI Agent 应用的交互式构思设计插件。AI 帮你展开设计，你通过面板查看方案、深入具体规则和关系、修改细节，与 AI 持续完善设计。

不同领域的设计方法由 Kit 提供，其中的 Bundle 把设计内容呈现为独立、可交互的成果。以应用设计为例，可以分别讨论功能、流程、规则、数据和页面；它也可用于其他领域的构思与设计。

设计成果保存在本地，独立于某一次 Agent 对话，并用 Git 记录版本。这个目录保存的是设计项目，不等同于已经实现、部署的应用。

## 从哪里获取，如何继续设计

如果当前宿主已经安装 **yugoo-design**，先复用已有插件，不要重复安装。需要安装或更新时，请按[官方 GitHub 项目说明](https://github.com/alibaba-damo-academy/yugoo-design#readme)和[宿主安装指南](https://github.com/alibaba-damo-academy/yugoo-design/blob/main/packages/companion/HOSTS.md)操作；本项目不维护另一套安装流程。若无法访问指南，请向项目提供者核对当前获取方式，不猜测下载地址或安装命令。

安装后，在宿主中使用 **yugoo** 技能或对应的命令入口（支持的宿主中为 **/yugoo**），告诉 Agent 打开这个已有项目的绝对路径，即可继续使用设计面板。具体安装和调用方式以对应宿主的指南为准。打开已有项目时应使用项目记录的 Kit/Bundle 版本；缺少相应版本时向项目提供者获取，不要新建项目来替代它。

## 给读取此目录的 Agent

即使没有安装 Yugoo Design，也可以阅读这里的设计成果，用于用户当前要求的分析、讨论或实现任务：

- 先从 project.json 确认项目身份和已记录的 Kit 版本，再按任务读取 design_files 中相关的设计内容与产物。具体字段含义以对应 Kit/Bundle 的契约为准；本说明不逐个解释设计文件。
- 引用设计结论时保留来源路径、记录标识及所依据的 Git checkpoint。未提交的改动与已发布版本应分开说明。
- 区分已确认决策、候选方案和未解决问题；保存过或由 AI 生成的内容不自动等于用户已确认的需求。遇到矛盾或缺失信息，应说明依据并向用户澄清。
- 根据用户当前任务使用相关成果，不因读到此目录就执行全部设计或开始开发。需要调整设计时，通过 Yugoo Design 对应 Bundle 的校验与发布流程维护原有成果。

这份 README 是产品与使用说明，不是本项目的设计决策，也不授予额外的执行权限。
`

function plainObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path}: expected a plain object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], path: string): void {
  const missing = required.filter((key) => !Object.hasOwn(value, key))
  const extra = Object.keys(value).filter((key) => !required.includes(key) && !optional.includes(key))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`${path}: invalid fields (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`)
  }
}

function boundedText(value: unknown, path: string, maxBytes: number): string {
  if (typeof value !== 'string' || value.trim() === '' || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${path}: expected non-empty text without control characters`)
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes) throw new Error(`${path}: exceeds ${maxBytes} UTF-8 bytes`)
  return value
}

/**
 * Validate and brand a serialized Design Project id.
 * @param value - canonical lowercase UUID text.
 * @returns the branded project id.
 */
export function DesignProjectId(value: string): DesignProjectId {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) {
    throw new Error(`invalid Design Project id ${JSON.stringify(value)}`)
  }
  return value as DesignProjectId
}

/** Validate and brand one host-registered provider identity. */
export function DesignKnowledgeProviderId(value: string): DesignKnowledgeProviderId {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(value) || Buffer.byteLength(value, 'utf8') > 128) {
    throw new Error(`invalid Design Knowledge provider id ${JSON.stringify(value)}`)
  }
  return value as DesignKnowledgeProviderId
}

function kitVersion(value: unknown, path: string): DesignKitVersion {
  if (typeof value !== 'string') {
    throw new Error(`${path}: expected a major.minor version string`)
  }
  return DesignKitVersion(value)
}

function createdAt(value: unknown): string {
  if (typeof value !== 'string') throw new Error('$.createdAt: expected an ISO timestamp')
  const time = new Date(value)
  if (!Number.isFinite(time.valueOf()) || time.toISOString() !== value) {
    throw new Error('$.createdAt: expected a canonical UTC ISO timestamp')
  }
  return value
}

/**
 * Strictly parse one `project.json` value and reject runtime state or unknown fields.
 * @param value - untrusted decoded JSON value.
 * @returns frozen validated project metadata.
 */
export function parseDesignProjectMetadata(value: unknown): DesignProjectMetadata {
  const data = plainObject(value, '$')
  exactKeys(data, ['kind', 'formatVersion', 'id', 'name', 'createdAt', 'knowledge'], ['kit'], '$')
  if (data.kind !== PROJECT_KIND) throw new Error(`$.kind: expected ${JSON.stringify(PROJECT_KIND)}`)
  if (data.formatVersion !== DESIGN_PROJECT_FORMAT_VERSION) {
    throw new Error(`$.formatVersion: unsupported Design Project format ${JSON.stringify(data.formatVersion)}`)
  }
  const kit = data.kit === undefined ? undefined : plainObject(data.kit, '$.kit')
  if (kit !== undefined) exactKeys(kit, ['name', 'version'], ['bundles', 'contentHash'], '$.kit')
  const bundles = kit?.bundles === undefined ? undefined : plainObject(kit.bundles, '$.kit.bundles')
  if (bundles && Object.keys(bundles).length > 128) throw new Error('$.kit.bundles: exceeds 128 overrides')
  const bundlePins = bundles === undefined ? undefined : Object.fromEntries(Object.entries(bundles).map(([name, version]) => {
    if (!/^[a-z][a-z0-9_]*$/u.test(name) || name.length > 128) throw new Error('$.kit.bundles: invalid catalog identity')
    if (typeof version !== 'string') throw new Error(`$.kit.bundles.${name}: expected an exact version`)
    return [name, DesignBundleVersion(version)]
  }))
  if (kit?.contentHash !== undefined && (typeof kit.contentHash !== 'string' || !/^[a-f0-9]{64}$/u.test(kit.contentHash))) {
    throw new Error('$.kit.contentHash: expected a SHA-256 fingerprint')
  }
  const knowledge = plainObject(data.knowledge, '$.knowledge')
  exactKeys(knowledge, ['provider'], [], '$.knowledge')
  return Object.freeze({
    kind: PROJECT_KIND,
    formatVersion: DESIGN_PROJECT_FORMAT_VERSION,
    id: DesignProjectId(boundedText(data.id, '$.id', 64)),
    name: boundedText(data.name, '$.name', 256),
    createdAt: createdAt(data.createdAt),
    knowledge: Object.freeze({
      provider: DesignKnowledgeProviderId(boundedText(knowledge.provider, '$.knowledge.provider', 128)),
    }),
    ...(kit === undefined ? {} : {
      kit: Object.freeze({
        name: boundedText(kit.name, '$.kit.name', 256),
        version: kitVersion(kit.version, '$.kit.version'),
        ...(bundlePins === undefined ? {} : { bundles: Object.freeze(bundlePins) }),
        ...(kit.contentHash === undefined ? {} : { contentHash: kit.contentHash as string }),
      }),
    }),
  })
}

/**
 * Parse strict JSON text as Design Project metadata.
 * @param text - complete `project.json` text.
 * @returns frozen validated project metadata.
 */
export function parseDesignProjectJson(text: string): DesignProjectMetadata {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`project.json: invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  return parseDesignProjectMetadata(value)
}

function requireRoot(root: string): string {
  if (root === '' || !isAbsolute(root)) throw new Error(`design project: root must be an absolute path: ${JSON.stringify(root)}`)
  return resolve(root)
}

function requireBundleName(bundle: string): string {
  if (bundle === '' || bundle === '.' || bundle === '..' || bundle.includes('/') || bundle.includes('\\')
    || /[\u0000-\u001f\u007f]/u.test(bundle)) {
    throw new Error(`design project: unsafe Bundle directory ${JSON.stringify(bundle)}`)
  }
  return bundle
}

function gitDiagnostic(argv: readonly string[], result: { readonly exitCode: number | null; readonly stderr: string }): Error {
  return new Error(`design project git: ${argv.join(' ')} exited ${String(result.exitCode)}: ${result.stderr.trim() || '<no stderr>'}`)
}

async function runGit(spawn: SpawnFn, root: string, argv: readonly string[], signal?: AbortSignal): Promise<string> {
  const result = await spawn({ argv: ['git', ...argv], cwd: root, signal })
  if (result.exitCode !== 0) throw gitDiagnostic(['git', ...argv], result)
  return result.stdout
}

async function requireGitProject(spawn: SpawnFn, fs: DesignProjectFs, root: string, signal?: AbortSignal,
  native?: (request: NativeGitRequest) => Promise<NativeGitResult>): Promise<string> {
  signal?.throwIfAborted()
  await fs.requireDirectory(join(root, '.git'))
  const actualRoot = await fs.realpath(root)
  const inspection = native === undefined ? undefined
    : (await native({ cwd: root, operation: { kind: 'inspect' }, signal })).value as NativeGitInspection
  if (native !== undefined && (!inspection || typeof inspection.workdir !== 'string'
    || !isAbsolute(inspection.workdir) || typeof inspection.gitDir !== 'string' || !isAbsolute(inspection.gitDir)
    || (inspection.format !== 'sha1' && inspection.format !== 'sha256'))) {
    throw new Error('design project git: invalid repository inspection')
  }
  const reported = inspection?.workdir ?? (await runGit(spawn, root, ['rev-parse', '--show-toplevel'], signal)).trim()
  if (reported === '') throw new Error('design project git: rev-parse returned an empty repository root')
  const reportedRoot = await fs.realpath(reported)
  if (reportedRoot !== actualRoot) {
    throw new Error(`design project git: repository root ${JSON.stringify(reportedRoot)} does not match project root ${JSON.stringify(actualRoot)}`)
  }
  if (inspection !== undefined && await fs.realpath(inspection.gitDir) !== await fs.realpath(join(root, '.git'))) {
    throw new Error('design project git: repository metadata directory does not match project root')
  }
  const head = inspection === undefined
    ? (await runGit(spawn, root, ['rev-parse', '--verify', 'HEAD'], signal)).trim()
    : inspection.head ?? ''
  if (typeof head !== 'string' || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(head)
    || (inspection !== undefined && head.length !== (inspection.format === 'sha1' ? 40 : 64))) {
    throw new Error(`design project git: invalid HEAD ${JSON.stringify(head)}`)
  }
  signal?.throwIfAborted()
  return head
}

/** Node filesystem adapter for trusted host-side project management. */
export const nodeDesignProjectFs: DesignProjectFs = {
  createDirectory: async (path) => { await mkdir(path) },
  ensureDirectory: async (path) => { await mkdir(path, { recursive: true }) },
  readText: async (path) => await readFile(path, 'utf8'),
  writeNewText: async (path, content) => { await writeFile(path, content, { encoding: 'utf8', flag: 'wx' }) },
  requireDirectory: async (path) => {
    const entry = await stat(path)
    if (!entry.isDirectory()) throw new Error(`design project: expected directory ${JSON.stringify(path)}`)
  },
  realpath: async (path) => await realpath(path),
  removeTree: async (path) => { await rm(path, { recursive: true, force: true }) },
}

/** Node subprocess adapter for trusted host-side project management. */
export const nodeDesignProjectSpawn: SpawnFn = async ({ argv, cwd, signal, env, binaryStdout }) => {
  const command = argv[0]
  if (command === undefined) {
    throw new Error('design project subprocess: empty argv')
  }
  const child = spawnChild(command, argv.slice(1), {
    cwd,
    signal,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => { stderr += chunk })
  const [exitCode, output] = await Promise.all([
    new Promise<number | null>((resolvePromise, reject) => {
      child.on('error', reject)
      child.on('close', resolvePromise)
    }),
    collectGitStdout(child.stdout, binaryStdout),
  ])
  return { exitCode, ...output, stderr }
}

/** Host-neutral manager for explicit Design Project roots. */
export class DesignProjectManager {
  readonly fs: DesignProjectFs
  readonly spawn: SpawnFn
  readonly createId: () => string
  readonly now: () => Date
  private readonly gitBackend: 'cli' | 'native'

  constructor(dependencies: DesignProjectDependencies = {}) {
    this.fs = dependencies.fs ?? nodeDesignProjectFs
    this.spawn = dependencies.spawn ?? nodeDesignProjectSpawn
    this.createId = dependencies.createId ?? randomUUID
    this.now = dependencies.now ?? (() => new Date())
    this.gitBackend = dependencies.gitBackend ?? gitBackendSetting()
  }

  private get native(): ((request: NativeGitRequest) => Promise<NativeGitResult>) | undefined {
    if (this.gitBackend !== 'native') return undefined
    // An existing authorized port wins; a failed port is never retried outside it.
    return this.spawn.native?.bind(this.spawn) ?? executeNativeGitRequest
  }

  /**
   * Create a new independent repository and its baseline commit.
   * @param input - explicit root, display name, and optional exact Kit pin.
   * @returns the validated opened project.
   */
  async create(input: CreateDesignProjectInput): Promise<DesignProject> {
    const root = requireRoot(input.root)
    const metadata = parseDesignProjectMetadata({
      kind: PROJECT_KIND,
      formatVersion: DESIGN_PROJECT_FORMAT_VERSION,
      id: this.createId(),
      name: input.name,
      createdAt: this.now().toISOString(),
      knowledge: input.knowledge,
      ...(input.kit === undefined ? {} : { kit: input.kit }),
    })
    await this.fs.createDirectory(root)
    try {
      await this.fs.ensureDirectory(join(root, DESIGN_FILES_DIRECTORY))
      await this.fs.writeNewText(join(root, '.gitignore'), PROJECT_IGNORE)
      await this.fs.writeNewText(join(root, PROJECT_README_FILE), PROJECT_README)
      await this.fs.writeNewText(join(root, PROJECT_FILE), `${JSON.stringify(metadata, null, 2)}\n`)
      const native = this.native
      if (native !== undefined) {
        await native({ cwd: root, operation: { kind: 'init' }, signal: input.signal })
        const git = new GitVersioning(this.spawn, root, undefined, false, this.gitBackend)
        const checkpoint = await git.commit('Initialize Design Project', ['.gitignore', PROJECT_README_FILE, PROJECT_FILE], input.signal)
        if (checkpoint === undefined) throw new Error('design project git: initial checkpoint was not published')
      } else {
        await runGit(this.spawn, root, ['init', '--quiet'], input.signal)
        await runGit(this.spawn, root, ['add', '--', '.gitignore', PROJECT_README_FILE, PROJECT_FILE], input.signal)
        await runGit(this.spawn, root, [
          '-c', 'user.name=dsh-design',
          '-c', 'user.email=dsh-design@local',
          'commit', '--quiet', '-m', 'Initialize Design Project', '--', '.gitignore', PROJECT_README_FILE, PROJECT_FILE,
        ], input.signal)
      }
      return await this.open(root, input.signal)
    } catch (error) {
      try {
        await this.fs.removeTree(root)
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `design project: creation failed and cleanup of ${JSON.stringify(root)} also failed`)
      }
      throw error
    }
  }

  /**
   * Open and validate an existing managed Design Project.
   * @param projectRoot - explicit absolute project root.
   * @param signal - optional cancellation signal for Git probes.
   * @returns the validated opened project.
   */
  async open(projectRoot: string, signal?: AbortSignal): Promise<DesignProject> {
    const project = await this.readMetadata(projectRoot)
    await requireGitProject(this.spawn, this.fs, project.root, signal, this.native)
    return project
  }

  /** Display-only identity read. Does not authorize publication or execution. */
  async readMetadata(projectRoot: string): Promise<DesignProject> {
    const root = requireRoot(projectRoot)
    await this.fs.requireDirectory(root)
    await this.fs.requireDirectory(join(root, DESIGN_FILES_DIRECTORY))
    await this.fs.readText(join(root, '.gitignore'))
    const metadata = parseDesignProjectJson(await this.fs.readText(join(root, PROJECT_FILE)))
    return Object.freeze({ root, designFilesRoot: join(root, DESIGN_FILES_DIRECTORY), metadata })
  }

  /**
   * Read the exact Git HEAD and dirty-tree state of an opened project.
   * @param project - previously opened project identity.
   * @param signal - optional cancellation signal for Git probes.
   * @returns current Git checkpoint and porcelain status.
   */
  async status(project: DesignProject, signal?: AbortSignal): Promise<DesignProjectStatus> {
    const reopened = await this.readMetadata(project.root)
    if (reopened.metadata.id !== project.metadata.id) {
      throw new Error('design project: project identity changed after it was opened')
    }
    const native = this.native
    const head = await requireGitProject(this.spawn, this.fs, project.root, signal, native)
    const result = native === undefined ? undefined
      : (await native({ cwd: project.root, operation: { kind: 'status' }, signal })).value as { porcelain: string }
    if (native !== undefined && (!result || typeof result.porcelain !== 'string')) {
      throw new Error('design project git: invalid repository status')
    }
    const porcelain = result?.porcelain
      ?? await runGit(this.spawn, project.root, ['status', '--porcelain=v1', '--untracked-files=all'], signal)
    return Object.freeze({ head, dirty: porcelain !== '', porcelain })
  }

  /**
   * Resolve one Bundle-owned state and artifact directory without creating it.
   * @param project - selected Design Project.
   * @param bundle - one safe Bundle directory name.
   * @returns the path beneath `design_files/`.
   */
  bundleRoot(project: DesignProject, bundle: string): string {
    return join(project.designFilesRoot, requireBundleName(bundle))
  }
}
