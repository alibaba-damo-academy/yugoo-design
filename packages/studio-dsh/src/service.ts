/** DSH lifecycle and Remote adapter for the read-only Studio service. */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type DesignService from 'dsh-design-core'
import { DesignKitVersion } from 'dsh-design-core'
import {
  loadStudioKit,
  snapshotKit,
  StudioBundleSourceService,
  StudioManagementService,
  type DesignCatalogSnapshot,
  type StudioBundleFileResult,
  type StudioBundleSourcePort,
  type StudioBundleWorkspaceResult,
  type StudioCatalogSnapshotPort,
  type StudioKitWorkspaceResult,
  type StudioWorkspaceView,
} from 'dsh-design-studio'
import { openInstalledSourceFiles, kitFileError } from './kit-files.ts'
import { markStudioRemote } from './remote-method.ts'
import { openDshStudioBundleSource, resolveKitSourceRoot, type StudioKitSourceConfig } from './kit-sources.ts'

/** DSH Studio adapter configuration. */
export interface Config {
  /** Follow source roots from the registered Kit catalog, including hot-discovered Kits. */
  readonly followInstalledSources?: boolean
  /**
   * Kit source directories enabling read-only Bundle inspection. Each entry
   * configures exactly one installed content `packageName` or absolute `root`.
   * Omitted: the compiled catalog stays readable and Bundle source reads
   * diagnose `studio.source_not_configured`.
   */
  readonly kitSources?: readonly StudioKitSourceConfig[]
}

interface StudioHostContext extends Context {
  readonly design: DesignService
  readonly fs: FileSystem
}

/** Global read-only DSH Studio service. It never creates or resolves an Agent. */
export class DshStudioManagementService extends TypertRemoteService {
  static inject = ['design', 'fs']

  private readonly host: StudioHostContext
  private readonly config: Config
  private management?: StudioManagementService
  private bundles?: StudioBundleSourceService
  private readonly configuredKitRoots = new Map<string, string>()
  private accepting = true
  private readonly inFlight = new Set<Promise<unknown>>()

  /**
   * @param ctx - DSH host context carrying the Design catalog and filesystem.
   * @param config - optional Kit source roots for Bundle inspection.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'studioManagement')
    this.host = ctx as StudioHostContext
    this.config = config
  }

  /** Validate the configured sources and publish the read-only services; ambiguity fails loud at startup. */
  protected async [Service.init](): Promise<void> {
    this.ctx.effect(() => async () => {
      this.accepting = false
      await Promise.allSettled([...this.inFlight])
      this.management = undefined
      this.bundles = undefined
      this.configuredKitRoots.clear()
    }, 'design-studio-dsh.readonly')
    const catalog: StudioCatalogSnapshotPort = Object.freeze({
      snapshot: async (): Promise<DesignCatalogSnapshot> => Object.freeze({
        kits: Object.freeze(this.host.design.listKits()
          .map(snapshotKit)
          .sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version))),
        ...this.independentCatalog(),
      }),
    })
    this.management = new StudioManagementService(catalog)
    const configs = this.config.kitSources ?? []
    if (configs.length === 0) return
    const roots = configs.map((entry) => resolveKitSourceRoot(entry, this.ctx.baseUrl))
    this.bundles = await this.openBundleService(this.host.design.listKits(), roots, true)
  }

  private async openBundleService(kits: ReturnType<DesignService['listKits']>, roots: readonly string[], recordKitRoots = false): Promise<StudioBundleSourceService> {
    const catalog: StudioCatalogSnapshotPort = { snapshot: async () => ({ kits: kits.map(snapshotKit) }) }
    const source: StudioBundleSourcePort = await openDshStudioBundleSource(this.host.fs, roots)
    // Cross-root identity must be unambiguous before any read: one Kit name
    // and one Bundle name resolve to exactly one physical source.
    const kitNames = new Map<string, string>()
    const bundleNames = new Map<string, string>()
    for (const root of await source.listKitRoots()) {
      const kit = await loadStudioKit(source, root)
      const installed = kits.find((candidate) => candidate.name === kit.name && candidate.version === kit.version)
      if (installed === undefined) {
        throw new Error(`design studio dsh: configured Kit source ${JSON.stringify(kit.name)}@${JSON.stringify(String(kit.version))} is not installed`)
      }
      const installedVocabulary = installed.relationVocabulary
      const configuredVocabulary = kit.relationVocabulary
      if ((installedVocabulary !== undefined && installedVocabulary.revision !== configuredVocabulary?.revision)
        || (installedVocabulary === undefined && (configuredVocabulary?.relations.length ?? 0) > 0)) {
        throw new Error(`design studio dsh: relations.yaml does not match installed Kit ${JSON.stringify(kit.name)}@${JSON.stringify(String(kit.version))}`)
      }
      const previousKit = kitNames.get(kit.name)
      if (previousKit !== undefined) {
        throw new Error(`design studio dsh: Kit ${JSON.stringify(kit.name)} is declared by two kitSources roots: ${JSON.stringify(previousKit)} and ${JSON.stringify(root)}`)
      }
      kitNames.set(kit.name, root)
      if (recordKitRoots) this.configuredKitRoots.set(`${kit.name}\0${kit.version}`, root)
      for (const skill of kit.skills) {
        const previousBundle = bundleNames.get(skill.name)
        if (previousBundle !== undefined) {
          throw new Error(`design studio dsh: Bundle ${JSON.stringify(skill.name)} is declared by two kitSources roots: ${JSON.stringify(previousBundle)} and ${JSON.stringify(root)}`)
        }
        bundleNames.set(skill.name, root)
      }
    }
    return new StudioBundleSourceService(catalog, source)
  }

  private independentCatalog(): Pick<DesignCatalogSnapshot, 'bundles'> {
    // Older explicit-source adapters may not expose the independent catalog yet.
    if (typeof this.host.design.listBundles !== 'function') return {}
    return {bundles: Object.freeze(this.host.design.listBundles().map(definition => Object.freeze({
      name: definition.catalogName ?? definition.name, version: String(definition.version), definition,
    })))}
  }

  private async bundleService(name: string, version?: string): Promise<StudioBundleSourceService | undefined> {
    if (!this.config.followInstalledSources) return this.bundles
    const independent = this.independentCatalog()
    if (independent.bundles !== undefined) {
      const snapshot: DesignCatalogSnapshot = {kits: this.host.design.listKits().map(snapshotKit), ...independent}
      const candidates = independent.bundles.filter(bundle => bundle.name === name && (version === undefined || bundle.version === version))
      // The shared read model diagnoses missing/ambiguous exact versions before source access.
      let files: StudioBundleSourcePort | undefined
      const requireFiles = () => {
        if (!files) throw new Error('design studio dsh: independent source is not resolved')
        return files
      }
      const source: StudioBundleSourcePort = {
        listKitRoots: async () => [],
        resolveBundleRoot: async pin => {
          const selected = candidates.find(bundle => bundle.name === pin.name && bundle.version === pin.version)
          if (!selected) return undefined
          const root = this.host.design.resolveBundleRoot(pin) ?? selected.definition.resourceRoot
          if (!root) return undefined
          files = await openInstalledSourceFiles(this.host.fs, root)
          return root
        },
        readText: path => requireFiles().readText(path),
        listDir: path => requireFiles().listDir(path),
        isDirectory: path => requireFiles().isDirectory(path),
        listFiles: path => requireFiles().listFiles(path),
      }
      return new StudioBundleSourceService({snapshot: async () => snapshot}, source)
    }
    // One catalog snapshot owns this read; no second filesystem discovery loop.
    const kits = this.host.design.listKits()
    const owners = kits.filter(kit => kit.skills.some(skill => skill.name === name))
    const installedRoots = owners.flatMap(kit => kit.sourceRoot ? [kit.sourceRoot] : [])
    // A broken/removed unrelated Kit must not make all Studio source reads fail.
    const roots = [...new Set(installedRoots.length ? installedRoots
      : owners.length ? (this.config.kitSources ?? []).map(entry => resolveKitSourceRoot(entry, this.ctx.baseUrl)) : [])]
    if (roots.length === 0) return undefined
    return this.openBundleService(kits, roots)
  }

  /** Read the global Studio workspace without requiring a conversation. */
  workspace(query: string): Promise<StudioWorkspaceView> {
    return this.run(() => this.requireManagement().workspace(query))
  }

  /** Read one exact installed Kit version's workspace and verify the returned identity matches. */
  readKitWorkspace(name: string, version: string): Promise<StudioKitWorkspaceResult> {
    return this.run(async () => {
      const result = await this.requireManagement().readKitWorkspace(name, version)
      if (result.workspace !== undefined && (result.workspace.name !== name || result.workspace.version !== version)) {
        return Object.freeze({
          diagnostics: Object.freeze([Object.freeze({
            code: 'workspace.version_mismatch',
            message: `design studio dsh: requested Kit ${JSON.stringify(name)}@${JSON.stringify(version)} but received ${JSON.stringify(result.workspace.name)}@${JSON.stringify(result.workspace.version)}`,
            subject: version,
          })]),
        })
      }
      return result
    })
  }

  /** List all authored files of one exact installed Kit, including kit.yaml. */
  readKitFiles(name: string, version: string): Promise<readonly string[]> {
    return this.run(async () => {
      const { root, files } = await this.kitFiles(name, version)
      return files.listFiles(root)
    })
  }

  /** Read one root-confined Kit file as bounded UTF-8 text. */
  readKitFile(name: string, version: string, path: string): Promise<{ readonly content: string }> {
    return this.run(async () => (await this.kitFiles(name, version)).files.readFile(path))
  }

  private async kitFiles(name: string, version: string) {
    if (typeof name !== 'string' || !name || typeof version !== 'string' || !version) {
      throw kitFileError('workspace.version_missing', 'An exact Kit name and version are required.')
    }
    // Core owns exact retained/installed versions. Older explicit-source hosts
    // may only provide the snapshot catalog; neither route falls back to latest.
    let exactVersion
    try { exactVersion = DesignKitVersion(version) } catch {
      throw kitFileError('workspace.version_missing', 'An exact Kit major.minor version is required.')
    }
    const kit = typeof this.host.design.resolveKit === 'function'
      ? this.host.design.resolveKit({ kit: name, version: exactVersion })
      : this.host.design.listKits().find(candidate => candidate.name === name && candidate.version === version)
    if (!kit || kit.name !== name || kit.version !== version) {
      throw kitFileError('workspace.version_missing', `Kit ${JSON.stringify(name)}@${JSON.stringify(version)} is not installed.`)
    }
    const configured = this.configuredKitRoots.get(`${name}\0${version}`)
    const root = this.config.followInstalledSources ? kit.sourceRoot ?? configured : configured
    if (!root) throw kitFileError('studio.source_not_configured', `No source root is configured for Kit ${JSON.stringify(name)}@${JSON.stringify(version)}.`)
    try {
      return { root, files: await openInstalledSourceFiles(this.host.fs, root, 'Kit') }
    } catch (error) {
      throw kitFileError('studio.source_unavailable', `Kit source is unavailable; the process may retain last-good content: ${String(error)}`)
    }
  }

  /** Read one Bundle's read-only source workspace. */
  readBundleWorkspace(name: string, version?: string): Promise<StudioBundleWorkspaceResult> {
    return this.run(async () => {
      try {
        const bundles = await this.bundleService(name, version)
        if (bundles === undefined) return sourceNotConfigured(name)
        return await bundles.readBundleWorkspace(name, version)
      } catch (error) {
        if (!this.config.followInstalledSources) throw error
        return sourceUnavailable(name, error)
      }
    })
  }

  /** Read one complete Bundle file byte-exactly as UTF-8 text. */
  readBundleFile(name: string, path: string, version?: string): Promise<StudioBundleFileResult> {
    return this.run(async () => {
      try {
        const bundles = await this.bundleService(name, version)
        if (bundles === undefined) return sourceNotConfigured(name)
        return await bundles.readBundleFile({ name, path, version })
      } catch (error) {
        if (!this.config.followInstalledSources) throw error
        return sourceUnavailable(name, error)
      }
    })
  }

  private requireManagement(): StudioManagementService {
    if (this.management === undefined) throw new Error('design studio dsh: service is not initialized')
    return this.management
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.accepting) return Promise.reject(new Error('design studio dsh: service is disposing'))
    const result = Promise.resolve().then(operation)
    this.inFlight.add(result)
    void result.finally(() => { this.inFlight.delete(result) }).catch(() => undefined)
    return result
  }
}

function sourceNotConfigured(name: string): { diagnostics: readonly { code: string; message: string; subject: string }[] } {
  return Object.freeze({
    diagnostics: Object.freeze([Object.freeze({
      code: 'studio.source_not_configured',
      message: `no Kit sources are configured for Bundle inspection; cannot read ${JSON.stringify(name)}`,
      subject: name,
    })]),
  })
}

function sourceUnavailable(name: string, error: unknown) {
  return { diagnostics: [{ code: 'studio.source_unavailable', subject: name,
    message: `Kit source is unavailable for ${JSON.stringify(name)}; the process may retain last-good content: ${String(error)}` }] }
}

function markRemote<Args extends unknown[], Result>(
  name: string,
  method: (this: DshStudioManagementService, ...args: Args) => Result,
): void {
  markStudioRemote(DshStudioManagementService.prototype, name, method)
}

// Plain ESM must stay parseable on every supported Node engine.
markRemote('workspace', DshStudioManagementService.prototype.workspace)
markRemote('readKitWorkspace', DshStudioManagementService.prototype.readKitWorkspace)
markRemote('readKitFiles', DshStudioManagementService.prototype.readKitFiles)
markRemote('readKitFile', DshStudioManagementService.prototype.readKitFile)
markRemote('readBundleWorkspace', DshStudioManagementService.prototype.readBundleWorkspace)
markRemote('readBundleFile', DshStudioManagementService.prototype.readBundleFile)
