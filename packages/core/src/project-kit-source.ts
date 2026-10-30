/** One editable, byte-complete Kit source per project. No local release catalog. */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { stringify } from 'yaml'
import { contentNodeFs, copyTree } from './content-store.ts'
import { loadDesignBundle, loadDesignKit, type DesignKitLocation, type KitFsLike } from './kit-loader.ts'
import type { DesignKit } from './types.ts'
import { projectKitContentHash } from './project-content.ts'

export const DESIGN_PROJECT_KIT_DIRECTORY = 'design_kit'
export interface ProjectKitSource { readonly kit: DesignKit; readonly revision: string }
interface SourceLayout {
  format: 1
  kit: { sourceId: string; mindset: string; manifest: string; relations?: string }
  bundles: { name: string; sourceId: string }[]
}
const identity = (name: string): string => {
  if (!/^[a-z][a-z0-9_]*$/u.test(name)) throw new Error('project Kit: invalid Bundle identity')
  return name
}
function rootOf(projectRoot: string): string {
  if (!isAbsolute(projectRoot)) throw new Error('project Kit: absolute project root required')
  return join(projectRoot, DESIGN_PROJECT_KIT_DIRECTORY)
}
function localPath(root: string, path: string): string {
  const rel = relative(root, resolve(root, path))
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('../')) throw new Error('project Kit: source path escapes its root')
  return rel
}
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}

/** Virtual S2 trees and real retained trees preserve the same complete bytes. */
async function copySource(fs: KitFsLike, source: string, target: string, checks: (() => Promise<void>)[]): Promise<void> {
  if (!fs.readBytes) {
    const before = await revisionOf(source)
    checks.push(async () => { if (before !== await revisionOf(source)) throw new Error('project Kit: source changed while copying; retry from current source') })
    return copyTree(source, target)
  }
  const budget = { bytes: 0, nodes: 0 }
  const walk = async (path: string, to: string, depth: number): Promise<void> => {
    if (++budget.nodes > 20000 || depth > 32) throw new Error('project Kit: source tree exceeds limits')
    if (await fs.isDirectory?.(path)) {
      await mkdir(to, { recursive: true })
      for (const name of (await fs.listDir(path)).sort()) {
        if (!name || name === '.' || name === '..' || /[\\/\u0000]/u.test(name)) throw new Error('project Kit: invalid resource path')
        await walk(join(path, name), join(to, name), depth + 1)
      }
    } else {
      const bytes = await fs.readBytes!(path)
      if (!bytes) throw new Error(`project Kit: missing source resource ${path}`)
      budget.bytes += bytes.byteLength
      if (budget.bytes > 128 * 1024 * 1024) throw new Error('project Kit: source bytes exceed limits')
      await writeFile(to, bytes, { flag: 'wx' })
    }
  }
  await walk(source, target, 0)
}

/** Hash the current bytes, including binary assets and empty directories. Not a release pin. */
async function revisionOf(root: string): Promise<string> {
  const hash = createHash('sha256'), budget = { bytes: 0, nodes: 0 }
  const walk = async (path: string, rel: string): Promise<void> => {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) throw new Error(`project Kit: symlink source is unsupported: ${rel}`)
    if (++budget.nodes > 20000 || rel.split('/').length > 32) throw new Error('project Kit: source tree exceeds limits')
    if (stat.isDirectory()) {
      hash.update(`directory\0${rel}\0`)
      for (const name of (await readdir(path)).sort()) await walk(join(path, name), rel ? `${rel}/${name}` : name)
    } else if (stat.isFile()) {
      budget.bytes += stat.size
      if (budget.bytes > 128 * 1024 * 1024) throw new Error('project Kit: source bytes exceed limits')
      const bytes = await readFile(path)
      hash.update(`file\0${rel}\0${bytes.length}\0`).update(bytes)
    } else throw new Error(`project Kit: unsupported source resource ${rel}`)
  }
  await walk(root, '')
  return hash.digest('hex')
}

/** Existing but invalid source is diagnosed; a library fallback never hides edits. */
export async function loadProjectKit(projectRoot: string): Promise<ProjectKitSource> {
  const root = rootOf(projectRoot), revision = await revisionOf(root)
  const layout = JSON.parse(await readFile(join(root, 'source.json'), 'utf8')) as SourceLayout
  if (layout.format !== 1 || !Array.isArray(layout.bundles) || typeof layout.kit?.sourceId !== 'string') throw new Error('project Kit: invalid source layout')
  const kitRoot = join(root, 'kit')
  const kit = await loadDesignKit(contentNodeFs, {
    rootDir: kitRoot, skillsDir: join(kitRoot, 'skills'),
    mindsetPath: resolve(kitRoot, localPath(kitRoot, layout.kit.mindset)),
    manifestPath: resolve(kitRoot, localPath(kitRoot, layout.kit.manifest)),
    ...(layout.kit.relations ? { relationsPath: resolve(kitRoot, localPath(kitRoot, layout.kit.relations)) } : {}),
  }, { sourceId: layout.kit.sourceId, current: true, resolveBundle: async pin => {
    const source = layout.bundles.find(item => item.name === pin.name)
    if (!source) throw new Error(`project Kit: missing mounted Bundle ${pin.name}`)
    return loadDesignBundle(contentNodeFs, { rootDir: join(root, 'bundles', identity(source.name)), sourceId: source.sourceId, current: true }, { name: source.name })
  } })
  if (revision !== await revisionOf(root)) throw new Error('project Kit: source changed while loading; retry using the current files')
  return { kit, revision }
}

/** Initialize once from the actual selected/retained closure; later reads use project files. */
export async function ensureProjectKit(projectRoot: string, options: { readonly loadSource: () => Promise<DesignKit> }): Promise<ProjectKitSource> {
  const root = rootOf(projectRoot)
  if (await exists(root)) return loadProjectKit(projectRoot)
  if (!(await lstat(projectRoot)).isDirectory()) throw new Error('project Kit: project directory unavailable')
  const kit = await options.loadSource()
  if (!kit.sourceRoot || !kit.sourceId) throw new Error('project Kit: original complete Kit source is unavailable')
  const sourceFs = kit.sourceFs ?? contentNodeFs
  const location: DesignKitLocation = kit.sourceLocation ?? { rootDir: kit.sourceRoot, mindsetPath: join(kit.sourceRoot, 'mindset.md'), skillsDir: join(kit.sourceRoot, 'skills') }
  const staging = `${root}.tmp-${randomUUID()}`
  const kitRoot = join(staging, 'kit')
  const checks: (() => Promise<void>)[] = []
  const layout: SourceLayout = { format: 1, kit: { sourceId: kit.sourceId,
    mindset: localPath(location.rootDir, location.mindsetPath),
    manifest: localPath(location.rootDir, location.manifestPath ?? join(location.rootDir, 'kit.yaml')),
    ...(location.relationsPath ? { relations: localPath(location.rootDir, location.relationsPath) } : {}),
  }, bundles: [] }
  try {
    await mkdir(staging)
    const manifest = await sourceFs.readText(location.manifestPath ?? join(location.rootDir, 'kit.yaml'))
    if (manifest !== undefined) await copySource(sourceFs, location.rootDir, kitRoot, checks)
    else {
      // Legacy package adapters expose engineering alongside content. Retain its owned resources only.
      await mkdir(kitRoot)
      const engineering = new Set(['skills', 'node_modules', 'lib', 'dist', 'src', 'test', 'tests', 'scripts', '.git', '.cache', 'package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'tsconfig.json', 'tsdown.config.ts'])
      for (const name of await sourceFs.listDir(location.rootDir)) {
        if (engineering.has(name) || ['mindset.md', 'kit.yaml', 'relations.yaml'].includes(name) || /^(smoke-|test-|preview-|compare-).*\.(mjs|html)$/u.test(name)) continue
        await copySource(sourceFs, join(location.rootDir, name), join(kitRoot, name), checks)
      }
      layout.kit.mindset = 'mindset.md'; layout.kit.manifest = 'kit.yaml'
      await writeFile(join(kitRoot, 'mindset.md'), kit.mindsetSource)
      const relations = await sourceFs.readText(location.relationsPath ?? join(location.rootDir, 'relations.yaml'))
      if (relations !== undefined) { layout.kit.relations = 'relations.yaml'; await writeFile(join(kitRoot, 'relations.yaml'), relations) }
      await writeFile(join(kitRoot, 'kit.yaml'), stringify({ version: 1, mounts: kit.skills.map(skill => ({ bindingKey: skill.name, name: skill.catalogName ?? skill.name, version: String(skill.version) })) }))
    }
    await mkdir(join(staging, 'bundles'))
    for (const skill of kit.skills) {
      const name = identity(skill.catalogName ?? skill.name)
      if (!skill.resourceRoot || !skill.sourceId) throw new Error(`project Kit: original complete Bundle source unavailable: ${name}`)
      await copySource(skill.sourceFs ?? contentNodeFs, skill.resourceRoot, join(staging, 'bundles', name), checks)
      layout.bundles.push({ name, sourceId: skill.sourceId })
    }
    await writeFile(join(staging, 'source.json'), JSON.stringify(layout, null, 2) + '\n')
    // Use the same loader over the whole staged source before making it visible.
    const verified = await loadDesignKit(contentNodeFs, { rootDir: kitRoot, skillsDir: join(kitRoot, 'skills'), mindsetPath: join(kitRoot, layout.kit.mindset), manifestPath: join(kitRoot, layout.kit.manifest), ...(layout.kit.relations ? { relationsPath: join(kitRoot, layout.kit.relations) } : {}) }, {
      sourceId: layout.kit.sourceId, current: true, resolveBundle: pin => {
        const source = layout.bundles.find(item => item.name === pin.name)
        return source ? loadDesignBundle(contentNodeFs, { rootDir: join(staging, 'bundles', source.name), sourceId: source.sourceId, current: true }, { name: source.name }) : Promise.resolve(undefined)
      },
    })
    for (const check of checks) await check()
    if (projectKitContentHash(verified) !== projectKitContentHash(kit)) throw new Error('project Kit: source changed while copying; retry from the current source')
    try { await rename(staging, root) } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
    }
  } finally { await rm(staging, { recursive: true, force: true }) }
  return loadProjectKit(projectRoot)
}
