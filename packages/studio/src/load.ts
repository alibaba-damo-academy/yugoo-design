/** Studio-owned loading of a Kit from its directory source. */
import { resolve } from 'node:path'
import { loadDesignBundle, loadDesignKit, type DesignKit, type KitFsLike } from 'dsh-design-core'
import type { StudioReadFs } from './types.ts'

/**
 * Load a Kit with authority derived from the Studio-controlled directory.
 * @param fs - Studio file-ops port.
 * @param kitRoot - absolute Kit directory.
 * @returns the assembled Kit.
 */
export interface StudioKitLoadOptions {
  readonly sourceId?: string
  readonly bundles?: readonly { name: string; version: string; rootDir: string; sourceId: string }[]
}

export async function loadStudioKit(fs: StudioReadFs, kitRoot: string, options: StudioKitLoadOptions = {}): Promise<DesignKit> {
  const root = resolve(kitRoot)
  return await loadDesignKit(fs as KitFsLike, root, {
    sourceId: options.sourceId ?? `directory:${root}`,
    ...(options.bundles ? { resolveBundle: async (pin: { name: string; version: string }) => {
      const location = options.bundles!.find(entry => entry.name === pin.name && entry.version === pin.version)
      return location ? loadDesignBundle(fs as KitFsLike, location, pin) : undefined
    } } : {}),
  })
}
