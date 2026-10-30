/** Trusted DSH source captures for the existing S2 catalog/composition authorities. */
import type DesignService from 'dsh-design-core'
import { DesignKitVersion } from 'dsh-design-core'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { createStudioInstanceAdapters, type StudioInstanceAdapters, type StudioInstances } from 'dsh-design-studio/node'
import type { DesignBundleVersionPin, DesignKitVersionPin } from 'dsh-design-studio'
import { kitFileError, openInstalledSourceFiles } from './kit-files.ts'

export interface DshStudioInstanceSources {
  readonly design: Pick<DesignService, 'listBundles' | 'resolveBundle' | 'resolveKit'>
  readonly fs: FileSystem
}

/** A trusted library source for initial project copies, never a project registry. */
export function registerDshStudioCurrentKitSource(
  design: Pick<DesignService, 'registerCurrentKitSource' | 'listKits'>,
  instances: Pick<StudioInstances, 'list' | 'editCurrent' | 'loadKit'>,
): () => void {
  // Ordinary model requests need saved identity/description, not every mounted
  // definition's validation. The selected Kit is checked by loadKit itself.
  const records = async () => (await instances.list({ kind: 'kit', includeReadiness: false })).filter(record => record.kit)
  return design.registerCurrentKitSource({
    async load(name) {
      const matches = (await records()).filter(record => record.kit!.name === name)
      const selected = matches.find(record => record.current) ?? matches[0]
      if (selected) return instances.loadKit({ id: selected.id, expectedRevision: selected.revision })
      const installed = design.listKits().find(kit => kit.name === name)
      if (!installed) return undefined
      const current = await instances.editCurrent({ kind: 'kit', kit: { name: installed.name, version: String(installed.version) } })
      return instances.loadKit({ id: current.id, expectedRevision: current.revision })
    },
    async list() {
      return (await records()).map(record => {
        // Users name local Kits by their display title, not the generated identity.
        // This is discovery copy only; the saved Mindset remains unchanged.
        const description = [...new Set([record.title?.zh, record.title?.en, record.description].filter(Boolean))].join(' · ')
        return { name: record.kit!.name, version: record.kit!.version, ...(description ? { description } : {}) }
      })
    },
  })
}

/**
 * No source discovery, Node source I/O, stateRoot or native session. S2 remains
 * the compiler, snapshot, composition and save owner, including its list policy.
 */
export function createDshStudioInstanceAdapters({ design, fs }: DshStudioInstanceSources): StudioInstanceAdapters {
  const unavailable = (message: string) => kitFileError('studio.source_unavailable', message)
  const bundle = (pin: DesignBundleVersionPin) => {
    const content = design.resolveBundle(pin)
    if (!content) throw unavailable(`Independent Bundle ${pin.name}@${pin.version} is not registered.`)
    if ((content.skill.catalogName ?? content.skill.name) !== pin.name || String(content.skill.version) !== pin.version) {
      throw kitFileError('studio.source_pin_mismatch', 'Resolved Bundle differs from the exact requested pin.')
    }
    if (typeof content.sourceId !== 'string' || !content.sourceId || content.sourceId.length > 4096
      || /[\u0000-\u001f\u007f]/u.test(content.sourceId)) throw unavailable('Registered Bundle has no valid trusted sourceId.')
    if (typeof content.resourceRoot !== 'string' || !content.resourceRoot) throw unavailable('Registered Bundle has no resourceRoot.')
    return { sourceId: content.sourceId, root: content.resourceRoot }
  }
  return createStudioInstanceAdapters({
    async listBundles() {
      const skills = design.listBundles()
      if (skills.length > 1024) throw kitFileError('studio.source_limit', 'Bundle catalog exceeds 1024 entries.')
      // Legacy Kit projections are not independent source registrations. A
      // resolved but broken independent registration stays visible and fails
      // honestly during S2 capture; it is never silently filtered as legacy.
      return skills.map(skill => ({ name: skill.catalogName ?? skill.name, version: String(skill.version) }))
        .filter(pin => design.resolveBundle(pin) !== undefined)
        .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : a.version > b.version ? 1 : 0)
    },
    async captureBundle(pin: DesignBundleVersionPin) {
      const { root, sourceId } = bundle(pin)
      const files = await openInstalledSourceFiles(fs, root)
      return { sourceId, files: await files.captureTree() }
    },
    async captureKit(pin: DesignKitVersionPin) {
      const kit = design.resolveKit({ kit: pin.name, version: DesignKitVersion(pin.version) })
      if (!kit) throw unavailable(`Kit ${pin.name}@${pin.version} is not registered.`)
      if (kit.name !== pin.name || String(kit.version) !== pin.version) throw kitFileError('studio.source_pin_mismatch', 'Resolved Kit differs from the exact requested pin.')
      if (typeof kit.sourceRoot !== 'string' || !kit.sourceRoot) throw unavailable('Registered Kit has no sourceRoot.')
      const files = await openInstalledSourceFiles(fs, kit.sourceRoot, 'Kit')
      return { files: await files.captureTree() }
    },
  })
}
