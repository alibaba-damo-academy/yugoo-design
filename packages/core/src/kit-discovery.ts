/** Bounded content discovery; never executes Kit scripts or scans arbitrary workspaces. */
import { readdir, realpath, lstat, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import type { Context } from '@deepseek-ai/cordis'
import type DesignService from './design-service.ts'
import type { DesignKitPublisher } from './design-service.ts'
import { type KitFsLike } from './kit-loader.ts'
import { loadConfiguredDesignKit } from './kit-loader-plugin.ts'
import type { Config } from './kit-loader-plugin.ts'

export function defaultKitDiscoveryRoot(): string {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'design-system', 'kits')
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'
const ignoredNames = new Set(['node_modules', '.git', '.cache', 'lib', 'dist'])

export async function startKitDiscovery(ctx: Context, config: Config, fs: KitFsLike): Promise<() => Promise<void>> {
  const design = (ctx as unknown as { design: DesignService }).design
  const roots = [...new Set([defaultKitDiscoveryRoot(), ...(config.discoveryRoots ?? [])].map(root => resolve(root)))]
  const owned = new Map<string, { publisher: DesignKitPublisher; name: string; digest: string }>()
  const candidateWatchers = new Map<string, FSWatcher>()
  const diagnostics = new Set<string>()
  let closed = false, timer: ReturnType<typeof setTimeout> | undefined, generation = 0
  let pending = Promise.resolve()
  const warn = (message: string) => {
    if (!diagnostics.has(message)) { diagnostics.add(message); ctx.logger.warn(message) }
  }
  const options = {
    ignoreInitial: true, followSymlinks: false,
    usePolling: config.watchUsePolling ?? false,
    interval: config.watchPollIntervalMs ?? 100,
    awaitWriteFinish: { stabilityThreshold: config.watchStabilityThresholdMs ?? 500, pollInterval: config.watchPollIntervalMs ?? 100 },
  }
  const watchEnabled = config.watch !== false
  const trigger = () => {
    if (closed) return
    generation += 1
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      const expected = generation
      pending = pending.then(() => reconcile(expected)).catch(error => warn(`design kit: discovery failed: ${String(error)}`))
    }, config.watchDebounceMs ?? 250)
  }
  async function reconcile(expected: number) {
    const candidates = new Set<string>()
    const uncertain = new Set<string>()
    for (const root of roots) {
      try {
        const canonicalRoot = await realpath(root)
        const entries = (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith('.') || ignoredNames.has(entry.name)) continue
          const path = join(root, entry.name)
          // Never follow a child symlink, even if it is swapped after readdir.
          if (!(await lstat(path)).isDirectory()) continue
          const canonical = await realpath(path)
          const rel = relative(canonicalRoot, canonical)
          if (rel.startsWith('..') || isAbsolute(rel)) continue
          try { if ((await lstat(join(path, 'mindset.md'))).isFile()) candidates.add(canonical) }
          catch (error) { if (!missing(error)) throw error }
        }
      } catch (error) {
        if (!missing(error)) {
          uncertain.add(root)
          warn(`design kit: cannot inspect discovery root ${root}: ${String(error)}`)
        }
      }
    }
    if (closed || generation !== expected) return
    for (const path of candidates) {
      if (closed || generation !== expected) return
      if (watchEnabled && !candidateWatchers.has(path)) {
        const watcher = watch(path, { ...options, ignored: p => relative(path, p).split(/[\\/]/).some(part => ignoredNames.has(part) || part.startsWith('.')) })
        watcher.on('all', trigger).on('ready', trigger).on('error', error => warn(`design kit: source watcher failed ${path}: ${String(error)}`))
        candidateWatchers.set(path, watcher)
      }
      try {
        const existing = owned.get(path)
        // Explicitly installed sources keep their original Bundle authority.
        const installed = design.listKits()
        let sameSource = false
        if (!existing) for (const kit of installed) {
          if (kit.sourceRoot && await realpath(kit.sourceRoot).catch(() => resolve(kit.sourceRoot!)) === path) { sameSource = true; break }
        }
        if (sameSource) continue
        const kit = await loadConfiguredDesignKit(fs, path, `directory:${path}`, config)
        if (closed || generation !== expected) return
        design.assertKitInstallable(kit)
        const digest = JSON.stringify(kit)
        if (existing) {
          if (kit.name !== existing.name) throw new Error('Kit name changed in-place; restart to replace the retained process-level identity')
          if (existing.digest !== digest) { existing.publisher.publish(kit); existing.digest = digest }
        } else {
          if (installed.some(value => value.name === kit.name)) throw new Error(`duplicate Kit identity ${kit.name}; existing source is retained`)
          owned.set(path, { publisher: design.registerKitSource(kit), name: kit.name, digest })
        }
      } catch (error) { warn(`design kit: discovery rejected ${path}: ${String(error)}`) }
    }
    if (closed || generation !== expected) return
    for (const [path, current] of owned) {
      if (candidates.has(path) || [...uncertain].some(root => !relative(root, path).startsWith('..'))) continue
      // Removing files must not strand an already selected project/version.
      // Retain the in-process last-good Kit until shutdown, without inventing
      // a durable copy. A fresh process will no longer discover this source.
      warn(`design kit: source removed ${path}; retaining process-level last-good ${current.name} (including the selection catalog) until restart; source scripts may be unavailable`)
    }
    for (const [path, watcher] of candidateWatchers) {
      if (!candidates.has(path)) { candidateWatchers.delete(path); await watcher.close() }
    }
  }
  await reconcile(generation)
  // Only two discovery levels are observed. Full content watching is confined
  // to discovered candidates, not unrelated packages/workspaces.
  const rootIdentity = async (root: string) => {
    try { const info = await stat(root); return info.isDirectory() ? `${info.dev}:${info.ino}` : undefined }
    catch { return undefined }
  }
  const rootTopology = async (root: string): Promise<string> => {
    try {
      const entries = (await readdir(root, { withFileTypes: true }))
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !ignoredNames.has(entry.name))
        .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
      const stamps = []
      for (const entry of entries) {
        const path = join(root, entry.name)
        try {
          const info = await lstat(path)
          if (!info.isDirectory()) continue
          const marker = await lstat(join(path, 'mindset.md')).catch(() => undefined)
          stamps.push([entry.name, info.ino, info.mtimeMs, marker?.isFile(), marker?.mtimeMs, marker?.size])
        } catch { /* A concurrent directory replacement is observed next tick. */ }
      }
      return JSON.stringify(stamps)
    } catch { return 'unavailable' }
  }
  const watchedRoots = new Map<string, string>()
  const rootTopologies = new Map<string, string>()
  for (const root of roots) { const identity = await rootIdentity(root); if (identity) watchedRoots.set(root, identity) }
  for (const root of roots) rootTopologies.set(root, await rootTopology(root))
  const rootWatcher = watchEnabled ? watch([...watchedRoots.keys()], { ...options, depth: 1,
    ignored: path => roots.some(root => {
      const rel = relative(root, path)
      return !rel.startsWith('..') && rel.split(/[\\/]/).some(part => ignoredNames.has(part) || part.startsWith('.'))
    }),
  }) : undefined
  rootWatcher?.on('all', trigger).on('ready', trigger).on('error', error => warn(`design kit: discovery watcher failed: ${String(error)}`))
  // Do not report the discovery plugin ready before its existing roots are
  // actually observed. This closes the copy-immediately-after-start window.
  if (rootWatcher && watchedRoots.size > 0) {
    await new Promise<void>((resolveReady, reject) => {
      rootWatcher.once('ready', resolveReady)
      rootWatcher.once('error', reject)
    }).catch(async error => {
      closed = true
      if (timer) clearTimeout(timer)
      await rootWatcher.close()
      await Promise.all([...candidateWatchers.values()].map(watcher => watcher.close()))
      await pending
      for (const source of owned.values()) source.publisher.dispose()
      throw error
    })
  }
  // Watching nonexistent paths with missing ancestors is not reliable on all
  // filesystems. Inspect configured roots and direct child metadata to recover
  // lost add events. Do not scan parent trees or reload unchanged Kit bodies.
  let probing = false
  const missingRootProbe = watchEnabled ? setInterval(() => {
    if (closed || probing) return
    probing = true
    void (async () => {
      for (const root of roots) {
        const identity = await rootIdentity(root)
        const topology = await rootTopology(root)
        if (closed) return
        const changed = watchedRoots.get(root) !== identity
        if (changed) {
          await rootWatcher?.unwatch(root)
          if (closed) return
          if (identity) { watchedRoots.set(root, identity); rootWatcher?.add(root) }
          else watchedRoots.delete(root)
        }
        if (changed || rootTopologies.get(root) !== topology) {
          rootTopologies.set(root, topology)
          trigger()
        }
      }
    })().finally(() => { probing = false })
  }, 1000) : undefined
  missingRootProbe?.unref()
  return async () => {
    closed = true; generation += 1
    if (timer) clearTimeout(timer)
    if (missingRootProbe) clearInterval(missingRootProbe)
    await rootWatcher?.close()
    await Promise.all([...candidateWatchers.values()].map(watcher => watcher.close()))
    await pending
    for (const source of owned.values()) source.publisher.dispose()
    owned.clear()
  }
}
