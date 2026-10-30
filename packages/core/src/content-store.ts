/** File-backed immutable content. The caller supplies trusted installation provenance. */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { stringify } from 'yaml'
import { loadDesignBundle, loadDesignKit, resolveDesignKitPackage, type DesignBundleContent, type DesignBundlePin, type DesignKitLocation, type DesignKitLoadOptions, type KitFsLike } from './kit-loader.ts'
import { DesignBundleVersion, DesignKitVersion, type DesignKit } from './types.ts'
import type { DesignProjectKitPin } from './design-project.ts'
import { composeProjectKit, projectBundleOverrides } from './project-content.ts'

export const contentNodeFs: KitFsLike = {
  readText: async path => { try { return await readFile(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  } },
  listDir: path => readdir(path),
  isDirectory: async path => (await lstat(path)).isDirectory(),
  realPath: async path => (await import('node:fs/promises')).realpath(path),
}

interface KitPaths {readonly mindset: string; readonly manifest: string; readonly relations?: string}
interface RetainedEntry extends DesignBundlePin { readonly hash: string; readonly sourceId: string; readonly kitPaths?: KitPaths }
interface ContentIndex { readonly formatVersion: 1; readonly kits: RetainedEntry[]; readonly bundles: RetainedEntry[] }
const emptyIndex = (): ContentIndex => ({ formatVersion: 1, kits: [], bundles: [] })
const encode = (name: string) => {
  if (!name || name.includes('\0')) throw new Error('content: invalid identity')
  return Buffer.from(name, 'utf8').toString('hex')
}
const key = (pin: DesignBundlePin) => `${pin.name}\0${pin.version}`

function confinedRelativePath(root: string, path: string): string {
  const result = relative(root, resolve(root, path))
  if (!result || result === '..' || result.startsWith('../') || isAbsolute(result)) throw new Error('content: Kit entry path escapes retained root')
  return result
}
function retainedKitLocation(rootDir: string, paths?: KitPaths): string | DesignKitLocation {
  if (!paths) return rootDir
  if (Object.values(paths).some(path => isAbsolute(path))) throw new Error('content: retained Kit paths must be relative')
  return {rootDir, skillsDir: join(rootDir, 'skills'),
    mindsetPath: resolve(rootDir, confinedRelativePath(rootDir, paths.mindset)),
    manifestPath: resolve(rootDir, confinedRelativePath(rootDir, paths.manifest)),
    ...(paths.relations === undefined ? {} : {relationsPath: resolve(rootDir, confinedRelativePath(rootDir, paths.relations))})}
}

/** Copy bytes, rejecting symlinks and special files. Also hash empty directories. */
export async function copyTree(source: string, target: string, digest = createHash('sha256'), relativePath = '', budget = { bytes: 0, nodes: 0 }): Promise<void> {
  if (++budget.nodes > 20000 || relativePath.split('/').length > 32) throw new Error('content: resource tree exceeds limits')
  const info = await lstat(source)
  if (info.isSymbolicLink()) throw new Error(`content: symlink resource is not retained: ${source}`)
  if (info.isDirectory()) {
    digest.update(`directory\0${relativePath}\0`)
    await mkdir(target, { recursive: true })
    for (const entry of (await readdir(source)).sort()) {
      await copyTree(join(source, entry), join(target, entry), digest, relativePath ? `${relativePath}/${entry}` : entry, budget)
    }
  } else if (info.isFile()) {
    budget.bytes += info.size
    if (budget.bytes > 128 * 1024 * 1024) throw new Error('content: resource bytes exceed limits')
    const bytes = await readFile(source)
    digest.update(`file\0${relativePath}\0${bytes.length}\0`).update(bytes)
    await writeFile(target, bytes, { flag: 'wx', mode: info.mode & 0o777 })
  } else throw new Error(`content: unsupported resource ${source}`)
}

/** Exact version catalog; editable sources and their discovery are not this authority. */
export class DesignContentStore {
  readonly root: string
  constructor(stateRoot: string) {
    if (!isAbsolute(stateRoot)) throw new Error('content: stateRoot must be absolute')
    this.root = join(stateRoot, 'content')
  }
  private async index(): Promise<ContentIndex> {
    const text = await contentNodeFs.readText(join(this.root, 'index.json'))
    if (text === undefined) return emptyIndex()
    const data = JSON.parse(text) as ContentIndex
    if (data.formatVersion !== 1 || !Array.isArray(data.kits) || !Array.isArray(data.bundles)) throw new Error('content: invalid retained index')
    for (const entry of [...data.kits, ...data.bundles]) {
      if (typeof entry.name !== 'string' || typeof entry.version !== 'string' || typeof entry.sourceId !== 'string'
        || !/^[a-f0-9]{64}$/.test(entry.hash)) throw new Error('content: invalid retained entry')
      encode(entry.name)
      if (entry.kitPaths !== undefined) {
        if (typeof entry.kitPaths.mindset !== 'string' || typeof entry.kitPaths.manifest !== 'string'
          || (entry.kitPaths.relations !== undefined && typeof entry.kitPaths.relations !== 'string')) throw new Error('content: invalid retained Kit paths')
        retainedKitLocation(this.directory('kits', entry), entry.kitPaths)
      }
    }
    return data
  }
  private directory(kind: 'kits' | 'bundles', pin: DesignBundlePin): string {
    const version = kind === 'kits' ? DesignKitVersion(pin.version) : DesignBundleVersion(pin.version)
    return join(this.root, kind, encode(pin.name), String(version))
  }
  async listBundles(): Promise<readonly DesignBundlePin[]> {
    return (await this.index()).bundles.map(({ name, version }) => Object.freeze({ name, version }))
  }
  async listKits(): Promise<readonly DesignBundlePin[]> {
    return (await this.index()).kits.map(({ name, version }) => Object.freeze({ name, version }))
  }
  /** Publish an independent version even when no Kit mounts it. */
  async retainBundle(rootDir: string, options: {readonly sourceId: string}, expectedPin?: DesignBundlePin): Promise<DesignBundleContent> {
    const bundle = await loadDesignBundle(contentNodeFs, {rootDir, sourceId: options.sourceId}, expectedPin)
    const pin = {name: bundle.skill.catalogName ?? bundle.skill.name, version: String(bundle.skill.version)}
    await mkdir(this.root, {recursive: true})
    const lock = join(this.root, '.retain.lock')
    await writeFile(lock, String(process.pid), {flag:'wx'})
    const staging = join(this.root, `.staging-${randomUUID()}`)
    try {
      await mkdir(staging)
      const directory = join(staging, 'bundle')
      await mkdir(directory)
      const digest = createHash('sha256')
      await copyTree(rootDir, join(directory, 'files'), digest)
      await loadDesignBundle(contentNodeFs, {rootDir:join(directory,'files'), sourceId:options.sourceId}, pin)
      const current = await this.index()
      await this.publish([{kind:'bundles',entry:{...pin, sourceId:options.sourceId, hash:digest.digest('hex')},directory}], staging,
        {formatVersion:1,kits:[...current.kits],bundles:[...current.bundles]})
    } finally {
      await rm(staging,{recursive:true,force:true}); await rm(lock,{force:true})
    }
    return (await this.resolveBundle(pin))!
  }
  async resolveBundle(pin: DesignBundlePin): Promise<DesignBundleContent | undefined> {
    const entry = (await this.index()).bundles.find(e => key(e) === key(pin))
    if (!entry) return undefined
    const rootDir = join(this.directory('bundles', pin), 'files')
    if (await hashTree(rootDir) !== entry.hash) throw new Error('content: retained Bundle hash mismatch')
    return loadDesignBundle(contentNodeFs, { rootDir, sourceId: entry.sourceId }, pin)
  }
  async loadRetainedKit(pin: DesignBundlePin): Promise<DesignKit | undefined> {
    const entry = (await this.index()).kits.find(e => key(e) === key(pin))
    if (!entry) return undefined
    const rootDir = join(this.directory('kits', pin), 'files')
    if (await hashTree(rootDir) !== entry.hash) throw new Error('content: retained Kit hash mismatch')
    const kit = await loadDesignKit(contentNodeFs, retainedKitLocation(rootDir, entry.kitPaths), {
      sourceId: entry.sourceId, resolveBundle: bundle => this.resolveBundle(bundle),
    })
    if (kit.name !== pin.name || String(kit.version) !== pin.version) throw new Error('content: retained Kit pin mismatch')
    return kit
  }
  /** Reuse a verified closure from another configured store without exposing or
   * inferring its internal layout. The source index owns provenance and paths. */
  async retainKitFrom(source: DesignContentStore, pin: DesignBundlePin): Promise<DesignKit> {
    const entry = (await source.index()).kits.find(value => key(value) === key(pin))
    const kit = await source.loadRetainedKit(pin)
    if (!entry || !kit) throw new Error('content: unavailable exact retained Kit source')
    const root = join(source.directory('kits', pin), 'files')
    return this.retainKitClosure(retainedKitLocation(root, entry.kitPaths), {
      sourceId: entry.sourceId, resolveBundle: bundle => source.resolveBundle(bundle),
    })
  }
  /** All project reads and writes resolve the same exact closure. */
  async resolveProjectKit(pin: DesignProjectKitPin): Promise<DesignKit | undefined> {
    const base = await this.loadRetainedKit(pin)
    if (!base) return undefined
    const replacements = await Promise.all(projectBundleOverrides(pin, base).map(async target => {
      const bundle = await this.resolveBundle(target)
      if (!bundle) throw new Error(`project content: unavailable exact Bundle ${target.name}@${target.version}`)
      return bundle
    }))
    return composeProjectKit(pin, base, replacements)
  }
  /** Retain a complete validated closure; publish index only after every byte is ready. */
  async retainKitClosure(location: string | DesignKitLocation, options: DesignKitLoadOptions): Promise<DesignKit> {
    if (typeof location === 'string') location = await resolveDesignKitPackage(contentNodeFs, location) ?? location
    const bundles = new Map<string, DesignBundleContent>()
    const kit = await loadDesignKit(contentNodeFs, location, {
      ...options,
      ...(options.resolveBundle === undefined ? {} : { resolveBundle: async pin => {
        const bundle = await options.resolveBundle!(pin)
        if (bundle) bundles.set(key(pin), bundle)
        return bundle
      } }),
    })
    for (const skill of kit.skills) {
      if (!bundles.has(key({ name: skill.catalogName ?? skill.name, version: String(skill.version) }))) {
        const bundle = await loadDesignBundle(contentNodeFs, { rootDir: skill.resourceRoot!, sourceId: options.sourceId },
          { name: skill.catalogName ?? skill.name, version: String(skill.version) })
        bundles.set(key({ name: skill.catalogName ?? skill.name, version: String(skill.version) }), bundle)
      }
    }
    await mkdir(this.root, { recursive: true })
    const lock = join(this.root, '.retain.lock')
    await writeFile(lock, String(process.pid), { flag: 'wx' })
    const staging = join(this.root, `.staging-${randomUUID()}`)
    try {
      await mkdir(staging)
      const current = await this.index()
      const next: ContentIndex = { formatVersion: 1, kits: [...current.kits], bundles: [...current.bundles] }
      const staged: { kind: 'kits' | 'bundles'; entry: RetainedEntry; directory: string }[] = []
      for (const bundle of bundles.values()) {
        const pin = { name: bundle.skill.catalogName ?? bundle.skill.name, version: String(bundle.skill.version) }
        const sourceId = await this.bundleSourceId(bundle, options, pin)
        const directory = join(staging, `bundle-${staged.length}`)
        await mkdir(directory)
        const digest = createHash('sha256')
        await copyTree(bundle.resourceRoot, join(directory, 'files'), digest)
        const retained = await loadDesignBundle(contentNodeFs, { rootDir: join(directory, 'files'), sourceId }, pin)
        if (retained.skill.authority !== bundle.skill.authority) throw new Error('content: Bundle authority changed during retention')
        const entry = { ...pin, sourceId, hash: digest.digest('hex') }
        staged.push({ kind: 'bundles', entry, directory })
      }
      const directory = join(staging, 'kit')
      await mkdir(join(directory, 'files'), { recursive: true })
      const root = typeof location === 'string' ? location : location.rootDir
      const originalManifest = await contentNodeFs.readText(typeof location === 'string' ? join(root, 'kit.yaml') : location.manifestPath ?? join(root, 'kit.yaml'))
      let kitPaths: KitPaths | undefined
      if (originalManifest !== undefined) {
        kitPaths = {
          mindset: confinedRelativePath(root, typeof location === 'string' ? join(root, 'mindset.md') : location.mindsetPath),
          manifest: confinedRelativePath(root, typeof location === 'string' ? join(root, 'kit.yaml') : location.manifestPath ?? join(root, 'kit.yaml')),
          ...(typeof location === 'string' || location.relationsPath === undefined ? {} : {relations: confinedRelativePath(root, location.relationsPath)}),
        }
        if (kitPaths.mindset === 'mindset.md' && kitPaths.manifest === 'kit.yaml'
          && (kitPaths.relations === undefined || kitPaths.relations === 'relations.yaml')) kitPaths = undefined
        // Formal independent Kit roots contain only Kit-owned content.
        await copyTree(root, join(directory, 'files'), createHash('sha256'))
      } else {
        // Legacy package roots include engineering files, excluded explicitly rather than copying node_modules.
        // Preserve all other owned resources and notices, including binary assets.
        const engineering = new Set(['skills','node_modules','lib','dist','src','test','tests','scripts','.git','.cache','package.json','pnpm-lock.yaml','package-lock.json','yarn.lock','tsconfig.json','tsdown.config.ts'])
        for (const name of (await readdir(root)).sort()) {
          if (engineering.has(name) || name === 'mindset.md' || name === 'kit.yaml' || name === 'relations.yaml'
            || /^(smoke-|test-|preview-|compare-).*\.(mjs|html)$/.test(name)) continue
          await copyTree(join(root,name),join(directory,'files',name),createHash('sha256'),name)
        }
        await writeFile(join(directory, 'files', 'mindset.md'), kit.mindsetSource)
        const relations = await contentNodeFs.readText(typeof location === 'string' ? join(root, 'relations.yaml') : location.relationsPath ?? join(root, 'relations.yaml'))
        if (relations !== undefined) await writeFile(join(directory, 'files', 'relations.yaml'), relations)
        await writeFile(join(directory, 'files', 'kit.yaml'), stringify({ version: 1, mounts: kit.skills.map(s => ({ bindingKey: s.name, name: s.catalogName ?? s.name, version: String(s.version) })) }))
      }
      const stagedByPin = new Map(staged.map(s => [key(s.entry), s]))
      const verified = await loadDesignKit(contentNodeFs, retainedKitLocation(join(directory, 'files'), kitPaths), { sourceId: options.sourceId,
        resolveBundle: async pin => {
          const value = stagedByPin.get(key(pin))
          return value ? loadDesignBundle(contentNodeFs, { rootDir: join(value.directory, 'files'), sourceId: value.entry.sourceId }, pin) : undefined
        },
      })
      if (verified.name !== kit.name || verified.version !== kit.version) throw new Error('content: source changed while retaining Kit')
      const kitHash = await hashTree(join(directory, 'files'))
      staged.push({ kind: 'kits', entry: { name: kit.name, version: String(kit.version), hash: kitHash, sourceId: options.sourceId,
        ...(kitPaths === undefined ? {} : {kitPaths}) }, directory })
      await this.publish(staged, staging, next)
    } finally {
      await rm(staging, { recursive: true, force: true })
      await rm(lock, { force: true })
    }
    return (await this.loadRetainedKit({ name: kit.name, version: String(kit.version) }))!
  }
  private async publish(staged: {kind: 'kits' | 'bundles'; entry: RetainedEntry; directory: string}[], staging: string, next: ContentIndex): Promise<void> {
    for (const value of staged) {
      const existing = next[value.kind].find(e => key(e) === key(value.entry))
      if (existing && (existing.hash !== value.entry.hash || existing.sourceId !== value.entry.sourceId
        || JSON.stringify(existing.kitPaths) !== JSON.stringify(value.entry.kitPaths))) {
        throw new Error(`content: immutable ${value.kind} pin conflict ${value.entry.name}@${value.entry.version}`)
      }
    }
    for (const value of staged) {
      if (next[value.kind].some(e => key(e) === key(value.entry))) continue
      const target = this.directory(value.kind, value.entry)
      await mkdir(resolve(target, '..'), { recursive: true })
      await writeFile(join(value.directory, 'metadata.json'), JSON.stringify(value.entry))
      // A leftover unindexed version from a failed publication is never overwritten.
      try { await rename(value.directory, target) } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
        const previous = JSON.parse(await readFile(join(target, 'metadata.json'), 'utf8')) as RetainedEntry
        if (previous.hash !== value.entry.hash || previous.sourceId !== value.entry.sourceId
          || JSON.stringify(previous.kitPaths) !== JSON.stringify(value.entry.kitPaths)) throw new Error('content: unindexed immutable version conflict')
      }
      next[value.kind].push(value.entry)
    }
    const indexPath = join(staging, 'index.json')
    await writeFile(indexPath, JSON.stringify(next))
    await rename(indexPath, join(this.root, 'index.json'))
  }
  private async bundleSourceId(bundle: DesignBundleContent, options: DesignKitLoadOptions, pin: DesignBundlePin): Promise<string> {
    // Provenance is host-supplied by the resolver, never a field read from Bundle content.
    const sourceId = bundle.sourceId ?? options.sourceId
    const loaded = await loadDesignBundle(contentNodeFs, { rootDir: bundle.resourceRoot, sourceId }, pin)
    if (loaded.skill.authority !== bundle.skill.authority) throw new Error('content: resolver must supply original trusted sourceId')
    return sourceId
  }
}

async function hashTree(root: string): Promise<string> {
  const digest = createHash('sha256')
  async function walk(path: string, rel: string): Promise<void> {
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new Error('content: symlink in retained content')
    if (info.isDirectory()) {
      digest.update(`directory\0${rel}\0`)
      for (const name of (await readdir(path)).sort()) await walk(join(path, name), rel ? `${rel}/${name}` : name)
    } else if (info.isFile()) {
      const bytes = await readFile(path)
      digest.update(`file\0${rel}\0${bytes.length}\0`).update(bytes)
    } else throw new Error('content: unsupported retained resource')
  }
  await walk(root, '')
  return digest.digest('hex')
}
