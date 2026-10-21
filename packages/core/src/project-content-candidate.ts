/** Model-facing candidate capability, shared by native Host adapters; never a live project path. */
import { readFile, writeFile, mkdir, lstat, readdir } from 'node:fs/promises'
import { join, dirname, isAbsolute } from 'node:path'
import { migrationDefinitionReadPlan } from './project-content-definition.ts'
import type { DesignKit } from './types.ts'

export class ProjectContentCandidate {
  private readonly covered = { source: new Set<number>(), target: new Set<number>() }
  private readonly totals: Partial<Record<'source' | 'target', number>> = {}
  constructor(private readonly root: string, private readonly definitionsPath: string) {
    if (!isAbsolute(root) || !isAbsolute(definitionsPath)) throw new Error('migration: absolute Host-bound candidate roots required')
  }
  private async path(path: string): Promise<string> {
    if (!path || path.length > 4096 || /[\\:\u0000-\u001f]/u.test(path)
      || path.split('/').some(part => !part || part === '.' || part === '..') || path.split('/').length > 32) throw new Error('migration: use a bounded candidate Design-Files-relative path')
    const root = join(this.root, 'design_files'), full = join(root, path)
    for (let current = dirname(full); ; current = dirname(current)) {
      try { const info = await lstat(current); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('migration: unsafe candidate parent') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      if (current === root) break
    }
    try { const info = await lstat(full); if (!info.isFile() || info.isSymbolicLink()) throw new Error('migration: expected a regular candidate file') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    return full
  }
  async readDefinition(side: 'source' | 'target', offset: number, resource = 'required'): Promise<{ text: string; total: number; nextOffset: number | null }> {
    if (side !== 'source' && side !== 'target' || !Number.isSafeInteger(offset) || offset < 0 || offset % 12_000) throw new Error('migration: invalid definition page')
    const definitions = JSON.parse(await readFile(this.definitionsPath, 'utf8')) as { source: DesignKit; target: DesignKit }
    const structured = Array.isArray(definitions.source.skills) && Array.isArray(definitions.target.skills)
    const plan = structured ? migrationDefinitionReadPlan(definitions.source, definitions.target) : undefined
    const text = resource === 'complete' || !plan ? JSON.stringify(definitions[side], null, 2)
      : resource === 'required' ? plan.required[side] : plan.resources[side].get(resource)
    if (!text || offset >= text.length) throw new Error('migration: definition offset exceeds bounds')
    const end = Math.min(offset + 12_000, text.length)
    if (resource === 'required') {
      this.covered[side].add(offset / 12_000)
      this.totals[side] = text.length
    }
    return { text: text.slice(offset, end), total: text.length, nextOffset: end === text.length ? null : end }
  }
  assertDefinitionsRead(): void {
    for (const side of ['source', 'target'] as const) {
      if (!this.totals[side] || this.covered[side].size !== Math.ceil(this.totals[side]! / 12_000)) throw new Error('migration: read both complete required methods and contracts before submitting evidence')
    }
  }
  async list(): Promise<readonly string[]> {
    const result: string[] = []; let nodes = 0
    const walk = async (directory: string, prefix: string): Promise<void> => {
      const info = await lstat(directory)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('migration: unsafe candidate directory')
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (++nodes > 4096 || prefix.split('/').length > 32 || entry.isSymbolicLink()) throw new Error('migration: bounded regular candidate files required')
        const path = `${prefix}${entry.name}`
        if (entry.isDirectory()) await walk(join(directory, entry.name), `${path}/`)
        else if (entry.isFile()) result.push(path)
        else throw new Error('migration: non-regular candidate file')
      }
    }
    await walk(join(this.root, 'design_files'), '')
    return result
  }
  async read(path: string, offset: number): Promise<{ text: string; total: number; nextOffset: number | null }> {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('migration: invalid candidate offset')
    const file = await this.path(path), info = await lstat(file)
    if (info.size > 8 * 1024 * 1024) throw new Error('migration: candidate file byte limit')
    const text = await readFile(file, 'utf8')
    if (offset > text.length) throw new Error('migration: candidate offset exceeds bounds')
    const end = Math.min(offset + 12_000, text.length)
    return { text: text.slice(offset, end), total: text.length, nextOffset: end === text.length ? null : end }
  }
  async write(path: string, content: string): Promise<void> {
    if (Buffer.byteLength(content) > 8 * 1024 * 1024) throw new Error('migration: candidate file byte limit')
    const file = await this.path(path)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, content)
  }
}
