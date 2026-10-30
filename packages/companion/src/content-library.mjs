/** Companion adapter over the shared Core content authority, not a second store. */
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path'
import {
  DesignContentStore, createDirectoryBundleResolver, loadDesignBundle, loadDesignKit, resolveDesignKitPackage,
  composeProjectKit, projectBundleOverrides,
  parseFrontmatter,
} from '../../core/lib/index.js'


const SOURCE_ID = 'companion:explicit-kit'

/** Content cannot register executable/native contributions in the Companion host. */
export function assertCompanionKitContributions(target, installed) {
  const contributions = kit => kit.skills.flatMap(skill => {
    const manifest = skill.metadata?.skillManifest
    return [
      ['runtime', manifest?.runtime?.driver],
      ['native Panel', manifest?.presentation?.mode === 'native' ? manifest.presentation.renderer : undefined],
      ...(manifest?.capabilities ?? []).map(id => ['capability', id]),
      ...(skill.metadata?.validationDocument?.rules ?? []).map(rule => ['validation', rule.check?.driver]),
    ].filter(([, id]) => typeof id === 'string').map(([kind, id]) => ({ kind, id, authority: skill.authority }))
  })
  const key = contribution => JSON.stringify(contribution)
  const available = new Set(contributions(installed).map(key))
  for (const contribution of contributions(target)) {
    if (!available.has(key(contribution))) {
      throw new Error(`Install and verify the required Host ${contribution.kind} contribution ${contribution.id} for Bundle authority ${contribution.authority} before selecting this Kit.`)
    }
  }
}

/** Sources are host-selected; authored manifests cannot grant installation trust. */
export function createCompanionContentLibrary({ fs, kitRoot, stateRoot, trustedContentSources }) {
  const store = new DesignContentStore(stateRoot)
  let installed
  let studio
  const loadInstalled = async () => {
    const location = await resolveDesignKitPackage(fs, kitRoot) ?? kitRoot
    const ownedRoot = typeof location === 'string' ? location : location.rootDir
    const bundleRoot = typeof location !== 'string' && location.bundlesDir
      ? location.bundlesDir : join(dirname(dirname(ownedRoot)), 'bundles')
    const resolveBundle = trustedContentSources ? async pin => {
      const source = trustedContentSources.bundles.find(entry => entry.name === pin.name && entry.version === pin.version)
      return source ? loadDesignBundle(fs, source, pin) : undefined
    } : createDirectoryBundleResolver(fs, [{ rootDir: bundleRoot, sourceId: SOURCE_ID }])
    return loadDesignKit(fs, location, { sourceId: trustedContentSources?.sourceId ?? SOURCE_ID, resolveBundle })
  }
  return {
    store,
    loadInstalled: () => installed ??= loadInstalled().catch(error => { installed = undefined; throw error }),
    reloadInstalled: async () => { const value = await loadInstalled(); installed = Promise.resolve(value); return value },
    /** The shared Studio store owns current library edits; projects take a copy. */
    async studio() {
      return studio ??= import('./studio.mjs')
        .then(({ createCompanionStudio }) => createCompanionStudio(() => this.loadInstalled(), kitRoot, stateRoot, this))
        .catch(error => { studio = undefined; throw error })
    },
    async loadCurrentKit(pin) { return (await this.studio()).loadCurrentKit(pin) },
    /** Discovery labels only: no Bundle loading, validation or immutable retention. */
    async availableMindsetNames() {
      const names = (await (await this.studio()).listInstances({ kind: 'kit' })).flatMap(record => record.kit ? [record.kit.name] : [])
      const location = await resolveDesignKitPackage(fs, kitRoot) ?? kitRoot
      const sourceRoot = typeof location === 'string' ? location : location.rootDir
      const path = typeof location === 'string' ? join(location, 'mindset.md') : location.mindsetPath
      if (fs.realPath) {
        try {
          const rel = relative(await fs.realPath(sourceRoot), await fs.realPath(path))
          if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Mindset metadata escapes its installed content root.')
        } catch (error) {
          if (error.code === 'ENOENT') return [...new Set(names)].sort()
          throw error
        }
      }
      const text = await fs.readText(path)
      if (text !== undefined) {
        const { meta } = parseFrontmatter(text, path)
        if (typeof meta.name !== 'string' || !meta.name.trim()) throw new Error('Installed Mindset metadata has no name.')
        names.push(meta.name)
      }
      return [...new Set(names)].sort()
    },
    /** Current library identities; old retained definitions only seed old projects. */
    async availableKits() {
      const base = await this.loadInstalled()
      const entries = new Map([[base.name, base]])
      for (const record of await (await this.studio()).listInstances({ kind: 'kit' })) {
        if (record.kit) entries.set(record.kit.name, { ...record.kit, description: record.description })
      }
      return [...entries.values()]
    },
    /** New selection only; existing projects read their own current source tree. */
    async latestInstalled(name) {
      const selectedName = name ?? (await this.loadInstalled()).name
      const pin = (await this.availableKits()).find(kit => kit.name === selectedName)
      return pin ? this.loadCurrentKit(pin) : undefined
    },
    async resolveProject(pin) {
      if (pin) {
        const retained = await store.resolveProjectKit(pin)
        if (retained) return retained
      }
      const base = await (installed ??= loadInstalled().catch(error => { installed = undefined; throw error }))
      // Mutable directory authoring is explicit development input, never an exact-version fallback.
      if (!pin || base.name !== pin.name || base.version !== pin.version) return base
      const replacements = await Promise.all(projectBundleOverrides(pin, base).map(async target => {
        const bundle = await store.resolveBundle(target)
        if (!bundle) throw new Error(`project content: unavailable exact Bundle ${target.name}@${target.version}`)
        return bundle
      }))
      return composeProjectKit(pin, base, replacements)
    },
    async resolveExactProject(pin) {
      const result = await this.resolveProject(pin)
      if (result.name !== pin.name || result.version !== pin.version) throw new Error('Restore the full exact Kit definitions before upgrading; latest is not a fallback.')
      return result
    },
  }
}
