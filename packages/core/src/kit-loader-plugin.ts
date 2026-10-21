/**
 * Kit loader subplugin: loads one Design Kit content package and registers it
 * on `ctx.design`. A Loader row resolves either an installed package's
 * host-neutral `designSystem.kit` manifest or an absolute development directory. This shared
 * loader keeps Design Kits as zero-code content packages.
 */
import type { Context } from '@deepseek-ai/cordis'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type DesignService from './design-service.ts'
import { loadDesignBundle, loadDesignKit, resolveDesignKitPackage, createDirectoryBundleResolver, type DesignKitLocation, type KitFsLike } from './kit-loader.ts'
import { DesignContentStore } from './content-store.ts'
import { watch as watchFiles, type FSWatcher } from 'chokidar'
import type { DesignKit } from './types.ts'
import { startKitDiscovery } from './kit-discovery.ts'

export const name = 'dsh-design-core/kit-loader'
export const inject = ['design']

/** Kit loader configuration. */
export interface Config {
  /** Trusted independent source roots. Content cannot grant its own authority. */
  bundleRoots?: readonly { readonly rootDir: string; readonly sourceId: string }[]
  /** Trusted state root containing retained immutable content versions. */
  contentStateRoot?: string
  /** Additional roots whose direct children contain Kits. Includes the default user Kit root. */
  discoveryRoots?: readonly string[]
  /** Absolute source directory containing `mindset.md` and `skills/`. */
  kitDir?: string
  /** Installed content package whose `designSystem.kit` manifest resolves the kit files. */
  packageName?: string
  /** Watch the resolved content tree and publish validated candidates in-process. */
  watch?: boolean
  /** Quiet period after a filesystem event before validating the next candidate. */
  watchDebounceMs?: number
  /** Use stat polling instead of native filesystem events. */
  watchUsePolling?: boolean
  /** Stable-size duration before a changed file becomes a reload event. */
  watchStabilityThresholdMs?: number
  /** Stat polling interval used by write stabilization and polling mode. */
  watchPollIntervalMs?: number
}

interface ResolvedConfig {
  readonly sourceId: string
  readonly location?: string
  readonly packageName?: string
  readonly watch: boolean
  readonly watchDebounceMs: number
  readonly watchUsePolling: boolean
  readonly watchStabilityThresholdMs: number
  readonly watchPollIntervalMs: number
}

/** Serialized, last-event-wins reload coordination for one watched Kit source. */
export class KitReloadQueue {
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private chain = Promise.resolve()
  private disposed = false

  /**
   * @param delayMs - quiet period after the newest filesystem event.
   * @param load - stage and validate a complete candidate without publishing it.
   * @param publish - atomically make a validated candidate latest.
   * @param onError - report invalid or unreadable candidates while retaining the last registered Kit.
   */
  constructor(
    private readonly delayMs: number,
    private readonly load: () => Promise<DesignKit>,
    private readonly publish: (kit: DesignKit) => void | Promise<void>,
    private readonly onError: (error: unknown) => void,
  ) {}

  /** Schedule validation after the configured quiet period. */
  trigger(): void {
    if (this.disposed) return
    this.generation += 1
    const generation = this.generation
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.chain = this.chain.then(async () => {
        try {
          const candidate = await this.load()
          if (!this.disposed && generation === this.generation) await this.publish(candidate)
        } catch (error) {
          if (!this.disposed && generation === this.generation) {
            try {
              this.onError(error)
            } catch {
              // Diagnostic reporter failures must not disable later reload attempts.
            }
          }
        }
      })
    }, this.delayMs)
  }

  /**
   * Stop timers, prevent publication, and wait for an in-flight load.
   * @returns when the queue has no remaining work.
   */
  async dispose(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true
      this.generation += 1
      if (this.timer !== undefined) clearTimeout(this.timer)
      this.timer = undefined
    }
    await this.chain
  }
}

/** Node filesystem adapter for reading the kit content directory. */
const kitFs: KitFsLike = {
  readText: async (path) => {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  },
  listDir: async (path) => await readdir(path),
  isDirectory: async (path) => (await stat(path)).isDirectory(),
  realPath: async (path) => await realpath(path),
}

interface DesignKitPackageManifest {
  designSystem?: {
    kit?: {
      mindset?: unknown
      skills?: unknown
    }
  }
}

async function resolvePackageLocation(ctx: Context, packageName: string): Promise<DesignKitLocation> {
  const require = createRequire(ctx.baseUrl ?? import.meta.url)
  const manifestPath = require.resolve(`${packageName}/package.json`)
  const packageDir = dirname(manifestPath)
  const location = await resolveDesignKitPackage(kitFs, packageDir)
  if (!location) throw new Error(`design kit: package ${JSON.stringify(packageName)} must declare designSystem.kit`)
  return location
}

/** Shared loader for discovery and explicit hosts, preserving the original compiled projection. */
export async function loadConfiguredDesignKit(fs: KitFsLike, location: string | DesignKitLocation, sourceId: string, config: Config): Promise<DesignKit> {
  const paths = typeof location === 'string' ? await resolveDesignKitPackage(fs, location) ?? location : location
  const roots = [
    ...(typeof paths === 'string' || !paths.bundlesDir ? [] : [{rootDir: paths.bundlesDir, sourceId}]),
    ...(config.bundleRoots ?? []),
  ]
  const directoryResolver = createDirectoryBundleResolver(fs, roots)
  const retained = config.contentStateRoot ? new DesignContentStore(config.contentStateRoot) : undefined
  return loadDesignKit(fs, paths, {sourceId, resolveBundle: async pin =>
    await directoryResolver(pin) ?? await retained?.resolveBundle(pin) })
}

async function registerBundleRoots(design: DesignService, sources: Config['bundleRoots']): Promise<void> {
  for (const source of sources ?? []) {
    const base = await realpath(source.rootDir)
    for (const entry of (await kitFs.listDir(source.rootDir)).filter(name => !name.startsWith('.')).sort()) {
      const rootDir = resolve(source.rootDir, entry)
      const target = await realpath(rootDir)
      const path = relative(base, target)
      if (path === '..' || path.startsWith('../') || isAbsolute(path)) throw new Error('design kit: Bundle root escapes trusted directory')
      if (await kitFs.readText(resolve(rootDir, 'skill.yaml')) === undefined) continue
      const bundle = await loadDesignBundle(kitFs, {rootDir, sourceId: source.sourceId})
      if ((bundle.skill.catalogName ?? bundle.skill.name) !== entry) throw new Error('design kit: Bundle directory identity mismatch')
      design.registerBundleContent(bundle)
    }
  }
}

function validateWatchConfig(config: Config): void {
  if (config.watch !== undefined && typeof config.watch !== 'boolean') throw new Error('design kit: watch must be a boolean')
  if (config.watchUsePolling !== undefined && typeof config.watchUsePolling !== 'boolean') throw new Error('design kit: watchUsePolling must be a boolean')
  if (config.watchDebounceMs !== undefined && (!Number.isInteger(config.watchDebounceMs) || config.watchDebounceMs <= 0)) {
    throw new Error('design kit: watchDebounceMs must be a positive integer')
  }
  for (const [name, value] of [
    ['watchStabilityThresholdMs', config.watchStabilityThresholdMs],
    ['watchPollIntervalMs', config.watchPollIntervalMs],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) throw new Error(`design kit: ${name} must be a positive integer`)
  }
}

function resolveConfig(config: Config): ResolvedConfig {
  const hasDir = typeof config.kitDir === 'string' && config.kitDir !== ''
  const hasPackage = typeof config.packageName === 'string' && config.packageName !== ''
  if (hasDir === hasPackage) {
    throw new Error('design kit: configure exactly one of kitDir or packageName')
  }
  if (hasDir && !isAbsolute(config.kitDir as string)) {
    throw new Error('design kit: kitDir must be absolute')
  }
  const location = hasDir ? resolve(config.kitDir as string) : undefined
  const packageName = hasPackage ? config.packageName as string : undefined
  return {
    sourceId: packageName === undefined ? `directory:${location as string}` : `package:${packageName}`,
    ...(location === undefined ? {} : { location }),
    ...(packageName === undefined ? {} : { packageName }),
    watch: config.watch ?? hasDir,
    watchDebounceMs: config.watchDebounceMs ?? 250,
    watchUsePolling: config.watchUsePolling ?? false,
    watchStabilityThresholdMs: config.watchStabilityThresholdMs ?? 500,
    watchPollIntervalMs: config.watchPollIntervalMs ?? 100,
  }
}

/**
 * Load the configured kit and register it for the plugin's lifetime. An
 * invalid source fails loud at startup; watched reloads replace the
 * registered Kit only with fully validated candidates.
 * @param ctx - context carrying `ctx.design`.
 * @param config - the kit content directory.
 */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  validateWatchConfig(config)
  if (config.contentStateRoot !== undefined && !isAbsolute(config.contentStateRoot)) throw new Error('design kit: contentStateRoot must be absolute')
  for (const source of config.bundleRoots ?? []) {
    if (!isAbsolute(source.rootDir) || typeof source.sourceId !== 'string' || !source.sourceId) throw new Error('design kit: invalid trusted Bundle root')
  }
  const design = (ctx as unknown as { design: DesignService }).design
  if (config.contentStateRoot) {
    const retained = new DesignContentStore(config.contentStateRoot)
    for (const pin of await retained.listKits()) {
      const kit = await retained.loadRetainedKit(pin)
      if (kit) design.registerRetainedKit(kit)
    }
    for (const pin of await retained.listBundles()) {
      const bundle = await retained.resolveBundle(pin)
      if (bundle) design.registerBundleContent(bundle, {retained: true})
    }
  }
  const discovery = config.discoveryRoots !== undefined || (!config.kitDir && !config.packageName)
  if (config.discoveryRoots !== undefined && (!Array.isArray(config.discoveryRoots)
    || config.discoveryRoots.some(root => typeof root !== 'string' || !isAbsolute(root)))) {
    throw new Error('design kit: discoveryRoots must be an array of absolute directories')
  }
  if (discovery) {
    // Load explicitly configured content first, preserving its package authority.
    if (config.kitDir || config.packageName) {
      const { discoveryRoots: _roots, ...explicit } = config
      await apply(ctx, explicit)
    } else {
      await registerBundleRoots(design, config.bundleRoots)
    }
    const stop = await startKitDiscovery(ctx, config, kitFs)
    ctx.effect(() => stop)
    return
  }
  await registerBundleRoots(design, config.bundleRoots)
  const resolved = resolveConfig(config)
  const configuredLocation = resolved.location ?? await resolvePackageLocation(ctx, resolved.packageName as string)
  const location = typeof configuredLocation === 'string'
    ? await resolveDesignKitPackage(kitFs, configuredLocation) ?? configuredLocation : configuredLocation
  const current = await loadConfiguredDesignKit(kitFs, location, resolved.sourceId, config)
  design.assertKitInstallable(current)
  await registerBundleRoots(design, typeof location === 'string' || !location.bundlesDir ? [] : [{rootDir: location.bundlesDir, sourceId: resolved.sourceId}])
  const configuredRoot = typeof location === 'string' ? location : location.rootDir
  const watchRoot = resolved.watch ? configuredRoot : undefined
  ctx.effect(() => {
    const publisher = design.registerKitSource(current)
    if (!resolved.watch || watchRoot === undefined) return publisher.dispose
    let lastContent = JSON.stringify(current)
    const reloads = new KitReloadQueue(
      resolved.watchDebounceMs,
      () => loadConfiguredDesignKit(kitFs, location, resolved.sourceId, config),
      async (candidate) => {
        design.assertKitInstallable(candidate)
        const content = JSON.stringify(candidate)
        if (content === lastContent) return
        publisher.publish(candidate)
        lastContent = content
      },
      (error) => { ctx.logger.warn(`design kit: reload rejected; retaining the last registered Kit: ${String(error)}`) },
    )
    let watcher: FSWatcher
    try {
      watcher = watchFiles([watchRoot as string, ...(typeof location === 'string' || !location.bundlesDir ? [] : [location.bundlesDir]), ...(config.bundleRoots ?? []).map(root => root.rootDir)], {
        ignoreInitial: true,
        followSymlinks: false,
        usePolling: resolved.watchUsePolling,
        interval: resolved.watchPollIntervalMs,
        awaitWriteFinish: {
          stabilityThreshold: resolved.watchStabilityThresholdMs,
          pollInterval: resolved.watchPollIntervalMs,
        },
      })
      watcher.on('all', () => { reloads.trigger() })
      watcher.on('ready', () => { reloads.trigger() })
    } catch (error) {
      void reloads.dispose()
      publisher.dispose()
      throw error
    }
    let stopping: Promise<void> | undefined
    const stopWatcher = (): Promise<void> => {
      stopping ??= (async () => {
        const drained = reloads.dispose()
        try {
          await watcher.close()
        } catch (error) {
          ctx.logger.warn(`design kit: watcher close failed: ${String(error)}`)
        }
        await drained
      })()
      return stopping
    }
    watcher.on('error', (error) => {
      ctx.logger.warn(`design kit: watcher failed; live reload stopped: ${String(error)}`)
      void stopWatcher()
    })
    return async () => {
      await stopWatcher()
      publisher.dispose()
    }
  })
}
