/** Read-only Kit source access over the DSH host filesystem capability. */
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import { StudioBinaryContentError, type StudioBundleSourcePort } from 'dsh-design-studio'

/** One configured Kit source: an installed content package or an explicit directory. */
export type StudioKitSourceConfig =
  | { readonly packageName: string }
  | { readonly root: string }

/**
 * Resolve one configured Kit source to an absolute directory. Package-name
 * resolution belongs to this DSH adapter layer; the generic Studio domain
 * only ever sees absolute roots.
 * @param config - exactly one of `packageName` or `root`.
 * @param baseUrl - module base for package resolution; defaults to this module.
 * @returns the absolute Kit source directory.
 */
export function resolveKitSourceRoot(config: StudioKitSourceConfig, baseUrl?: string): string {
  const hasPackage = 'packageName' in config
  const hasRoot = 'root' in config
  if (hasPackage === hasRoot) {
    throw new Error('design studio dsh: configure exactly one of packageName or root per kitSources entry')
  }
  if (hasRoot) {
    const { root } = config as { root: string }
    if (!isAbsolute(root)) throw new Error(`design studio dsh: kitSources root must be absolute: ${JSON.stringify(root)}`)
    return resolve(root)
  }
  const { packageName } = config as { packageName: string }
  const require = createRequire(baseUrl ?? import.meta.url)
  return dirname(require.resolve(`${packageName}/package.json`))
}

function fsErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined
}

/**
 * Open the read-only Bundle source port over `ctx.fs`. Every configured root
 * must resolve to a directory holding `mindset.md`, and duplicate roots fail
 * loud. Every later read resolves through the host filesystem capability and
 * must stay canonically contained in one configured root, so traversal and
 * symlink escapes never read outside the authored trees; non-UTF-8 content
 * surfaces as {@link StudioBinaryContentError}.
 * @param fs - the DSH filesystem capability.
 * @param roots - absolute Kit source directories.
 * @returns the validated port consumed by the host-neutral Bundle read model.
 */
export async function openDshStudioBundleSource(fs: FileSystem, roots: readonly string[]): Promise<StudioBundleSourcePort> {
  const canonical = new Map<string, FsTarget>()
  for (const root of roots) {
    const resolved = resolve(root)
    if (canonical.has(resolved)) {
      throw new Error(`design studio dsh: duplicate kitSources root ${JSON.stringify(resolved)}`)
    }
    const target = await fs.resolve(resolved)
    const info = await fs.stat(target)
    if (info?.type !== 'directory') throw new Error(`design studio dsh: kitSources root is not a directory: ${JSON.stringify(resolved)}`)
    canonical.set(resolved, target)
  }
  const containment = async (path: string): Promise<FsTarget> => {
    const target = await fs.resolve(path)
    for (const rootTarget of canonical.values()) {
      if (fs.contains(rootTarget, target)) return target
    }
    throw new Error(`design studio dsh: path escapes the configured Kit sources: ${JSON.stringify(path)}`)
  }
  const port: StudioBundleSourcePort = {
    async listKitRoots() {
      return [...canonical.keys()]
    },
    async readText(path) {
      let target: FsTarget
      try {
        target = await containment(path)
      } catch (error) {
        // A path the backend cannot resolve does not exist; genuine escapes
        // carry no FS_NOT_FOUND code and stay loud.
        if (fsErrorCode(error) === 'FS_NOT_FOUND') return undefined
        throw error
      }
      try {
        return await fs.readText(target)
      } catch (error) {
        const code = fsErrorCode(error)
        if (code === 'FS_NOT_FOUND') return undefined
        if (code === 'FS_NOT_TEXT') throw new StudioBinaryContentError(path)
        throw error
      }
    },
    async listDir(path) {
      let target: FsTarget
      try {
        target = await containment(path)
      } catch {
        return []
      }
      try {
        return (await fs.listDir(target)).map((entry) => entry.name)
      } catch (error) {
        const code = fsErrorCode(error)
        if (code === 'FS_NOT_FOUND' || code === 'FS_NOT_DIRECTORY') return []
        throw error
      }
    },
    async isDirectory(path) {
      let target: FsTarget
      try {
        target = await containment(path)
      } catch {
        return false
      }
      const info = await fs.stat(target)
      return info?.type === 'directory'
    },
    async listFiles(dir) {
      const base = await containment(dir)
      const files: string[] = []
      const walk = async (target: FsTarget, relative: string): Promise<void> => {
        for (const entry of await fs.listDir(target)) {
          // listDir targets are already resolved; a symlink escaping a
          // configured root fails containment and stays invisible.
          let contained = false
          for (const rootTarget of canonical.values()) {
            if (fs.contains(rootTarget, entry.target)) { contained = true; break }
          }
          if (!contained) continue
          const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`
          if (entry.type === 'directory') await walk(entry.target, childRelative)
          else if (entry.type === 'file') files.push(childRelative)
        }
      }
      await walk(base, '')
      return files.sort()
    },
  }
  for (const root of canonical.keys()) {
    if (await port.readText(join(root, 'mindset.md')) === undefined) {
      throw new Error(`design studio dsh: kitSources root has no mindset.md: ${JSON.stringify(root)}`)
    }
  }
  return Object.freeze(port)
}
