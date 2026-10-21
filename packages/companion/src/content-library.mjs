/** Companion adapter over the shared Core content authority, not a second store. */
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path'
import { mkdir, mkdtemp, writeFile, rm, readdir, readFile, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import {
  DesignContentStore, createDirectoryBundleResolver, loadDesignBundle, loadDesignKit, resolveDesignKitPackage,
  composeProjectKit, projectBundleOverrides, latestInstalledKit,
  parseFrontmatter,
} from '../../core/lib/index.js'

import { normalizeLegacyKitImport } from './content-import-legacy.mjs'

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
      throw new Error(`Install and verify the required Host ${contribution.kind} contribution ${contribution.id} for Bundle authority ${contribution.authority} before selecting or upgrading this Kit.`)
    }
  }
}

/** Sources are host-selected; authored manifests cannot grant installation trust. */
export function createCompanionContentLibrary({ fs, kitRoot, stateRoot, trustedContentSources }) {
  const store = new DesignContentStore(stateRoot)
  let installed
  const loadInstalled = async () => {
    const location = await resolveDesignKitPackage(fs, kitRoot) ?? kitRoot
    const ownedRoot = typeof location === 'string' ? location : location.rootDir
    const manifest = await fs.readText(typeof location === 'string' ? join(ownedRoot, 'kit.yaml') : location.manifestPath ?? join(ownedRoot, 'kit.yaml'))
    if (manifest === undefined) {
      // Existing directory authoring remains explicit mutable development input.
      // Formal independent content below never replaces an immutable same pin.
      return loadDesignKit(fs, location, { sourceId: SOURCE_ID })
    }
    const bundleRoot = typeof location !== 'string' && location.bundlesDir
      ? location.bundlesDir : join(dirname(dirname(ownedRoot)), 'bundles')
    const resolveBundle = trustedContentSources ? async pin => {
      const source = trustedContentSources.bundles.find(entry => entry.name === pin.name && entry.version === pin.version)
      return source ? loadDesignBundle(fs, source, pin) : undefined
    } : createDirectoryBundleResolver(fs, [{ rootDir: bundleRoot, sourceId: SOURCE_ID }])
    return store.retainKitClosure(location, { sourceId: trustedContentSources?.sourceId ?? SOURCE_ID, resolveBundle })
  }
  const sameFiles = async (root, files) => {
    const actual = new Map()
    const walk = async dir => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isSymbolicLink()) throw new Error('Retained content contains a symlink.')
        if (entry.isDirectory()) await walk(path)
        else if (entry.isFile()) actual.set(relative(root, path).split(sep).join('/'), await readFile(path))
        else throw new Error('Retained content contains a non-regular resource.')
      }
    }
    await walk(root)
    return actual.size === files.length && files.every(file => actual.get(file.path)?.equals(Buffer.from(file.base64, 'base64')))
  }
  return {
    store,
    loadInstalled: () => installed ??= loadInstalled().catch(error => { installed = undefined; throw error }),
    reloadInstalled: async () => { const value = await loadInstalled(); installed = Promise.resolve(value); return value },
    /** Discovery labels only: no Bundle loading, validation or immutable retention. */
    async availableMindsetNames() {
      const names = (await store.listKits()).map(pin => pin.name)
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
    /** One latest complete closure per catalog name, including explicitly adopted Kits. */
    async availableKits() {
      const base = await this.loadInstalled()
      const retained = await Promise.all((await store.listKits()).map(pin => store.loadRetainedKit(pin)))
      const kits = [base, ...retained.filter(Boolean)]
      return [...new Set(kits.map(kit => kit.name))].map(name => latestInstalledKit(kits, name))
    },
    /** New selection only; an existing project always resolves its retained exact pin. */
    async latestInstalled(name) {
      const selectedName = name ?? (await this.loadInstalled()).name
      return (await this.availableKits()).find(kit => kit.name === selectedName)
    },
    /** Prepared inert bytes only: staging is private and never runs dependency scripts. */
    async adoptPrepared(prepared) {
      if (!prepared.validation?.valid || !prepared.contents?.length) throw new Error('Only a validated content archive can be adopted.')
      await mkdir(stateRoot, { recursive: true })
      const staging = await mkdtemp(join(stateRoot, 'content-import-'))
      const sourceId = `import:${createHash('sha256').update(JSON.stringify(prepared.archive)).digest('hex')}`
      let staged = []
      let total = 0, count = 0
      try {
        for (const [index, unit] of prepared.contents.entries()) {
          const rootDir = join(staging, String(index))
          await mkdir(rootDir)
          for (const file of unit.files) {
            if (typeof file.path !== 'string' || /[\\:\u0000]/.test(file.path)
              || file.path.split('/').some(part => !part || ['.', '..', '.git', 'node_modules'].includes(part))) throw new Error('Unsafe imported resource path.')
            const target = resolve(rootDir, file.path), rel = relative(rootDir, target)
            if (isAbsolute(rel) || rel.startsWith(`..${sep}`) || rel === '..') throw new Error('Imported resource escapes its content root.')
            const bytes = Buffer.from(file.base64, 'base64')
            if (++count > 4096 || (total += bytes.length) > 16 * 1024 * 1024) throw new Error('Imported content exceeds bounded archive limits.')
            await mkdir(dirname(target), { recursive: true })
            await writeFile(target, bytes, { flag: 'wx', mode: 0o600 })
          }
          staged.push({ ...unit, rootDir })
        }
        staged = await normalizeLegacyKitImport(staged, { stagingRoot: staging, sourceId })
        const bundles = new Map()
        for (const unit of staged.filter(unit => unit.kind === 'bundle')) {
          const existing = await store.resolveBundle(unit.pin)
          if (existing && !await sameFiles(existing.resourceRoot, unit.files)) throw new Error('Imported Bundle conflicts with an existing exact version.')
          const content = existing ?? await loadDesignBundle(fs, { rootDir: unit.rootDir, sourceId }, unit.pin)
          bundles.set(`${unit.pin.name}@${unit.pin.version}`, content)
        }
        const kit = staged.find(unit => unit.kind === 'kit')
        if (kit) {
          const existing = await store.loadRetainedKit(kit.pin)
          if (existing && !await sameFiles(existing.sourceRoot, kit.files)) throw new Error('Imported Kit conflicts with an existing exact version.')
          if (!existing) await store.retainKitClosure(kit.rootDir, { sourceId, resolveBundle: pin => bundles.get(`${pin.name}@${pin.version}`) })
        } else {
          for (const unit of staged) {
            const existing = await store.resolveBundle(unit.pin)
            if (existing) {
              if (!await sameFiles(existing.resourceRoot, unit.files)) throw new Error('Imported Bundle conflicts with an existing exact version.')
            } else await store.retainBundle(unit.rootDir, { sourceId }, unit.pin)
          }
        }
        return { contents: staged.map(({ kind, pin }) => ({ kind, pin })), executionGranted: false }
      } finally {
        // Only this call's exact private staging directory is disposable.
        if ((await lstat(staging)).isDirectory()) await rm(staging, { recursive: true })
      }
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
