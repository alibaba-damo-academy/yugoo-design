/** Installed source reads share the same DSH filesystem containment boundary. */
import { isAbsolute, join } from 'node:path'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import { StudioBinaryContentError, type StudioBundleSourcePort } from 'dsh-design-studio'
import type { StudioSourceEntry } from 'dsh-design-studio/node'

const MAX_TEXT_BYTES = 1024 * 1024

// Filesystem case sensitivity must not change the viewer's directory boundary.
const excludedDirectory = (name: string): boolean => /^(?:\.git|node_modules)$/iu.test(name)

interface InstalledSourceFiles extends StudioBundleSourcePort {
  readFile(path: string): Promise<{ readonly content: string }>
  /** Complete bounded byte capture; no UTF-8 viewer conversion or installed writes. */
  captureTree(): Promise<readonly StudioSourceEntry[]>
}

/** A code survives the Remote gateway while the message remains useful in the viewer. */
export function kitFileError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(`${code}: ${message}`), { code })
}

/** One read's installed resource root is the complete filesystem boundary, not its catalog id. */
export async function openInstalledSourceFiles(fs: FileSystem, root: string, kind: 'Kit' | 'Bundle' = 'Bundle'): Promise<InstalledSourceFiles> {
  if (!isAbsolute(root)) throw new Error(`design studio dsh: installed ${kind} resource root must be absolute`)
  const base = await fs.resolve(root)
  if ((await fs.stat(base))?.type !== 'directory') throw new Error(`design studio dsh: installed ${kind} resource root is not a directory`)
  const target = async (path: string): Promise<FsTarget> => {
    const resolved = await fs.resolve(path)
    if (!fs.contains(base, resolved)) {
      if (kind === 'Kit') throw kitFileError('kit_file.path_forbidden', 'Path escapes installed Kit resource root.')
      throw new Error(`design studio dsh: path escapes installed ${kind} resource root`)
    }
    return resolved
  }
  const code = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  return {
    async captureTree() {
      // The public Fs resolves targets and owns containment/grants. These reads
      // detect observed changes; they do not add a raw-path symlink policy or
      // promise an atomic snapshot across the whole installed tree.
      const files: StudioSourceEntry[] = [], seen = new Set<FsTarget['targetKey']>()
      let visited = 0, total = 0
      const limit = (message: string) => kitFileError('studio.source_limit', message)
      const invalid = (message: string) => kitFileError('studio.source_invalid', message)
      const unchanged = async (item: FsTarget, before: Awaited<ReturnType<FileSystem['stat']>>) => {
        const after = await fs.stat(item)
        if (!before || !after || before.type !== after.type || before.version !== after.version
          || before.size !== after.size) throw kitFileError('studio.source_changed', 'Installed source changed during capture. Retry the exact source.')
      }
      const walk = async (directory: FsTarget, prefix: string, observed?: Awaited<ReturnType<FileSystem['stat']>>): Promise<void> => {
        if (seen.has(directory.targetKey)) throw invalid('Repeated directory identity in installed source.')
        seen.add(directory.targetKey)
        const info = observed ?? await fs.stat(directory)
        if (info?.type !== 'directory') throw invalid('Installed source directory is missing or not a directory.')
        const entries = await fs.listDir(directory)
        visited += entries.length
        if (visited > 20000) throw limit('Installed source exceeds 20000 directory entries.')
        const names = new Set<string>()
        for (const entry of entries) {
          if (typeof entry.name !== 'string' || !entry.name || /[\\/:\u0000-\u001f\u007f]/u.test(entry.name)
            || ['.', '..', '__proto__', 'constructor', 'prototype'].includes(entry.name) || names.has(entry.name)) throw invalid('Invalid or duplicate installed source entry name.')
          names.add(entry.name)
        }
        for (const entry of [...entries].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
          if (excludedDirectory(entry.name)) continue
          if (!fs.contains(base, entry.target)) throw kitFileError('studio.source_forbidden', 'Capture target escapes installed resource root.')
          const path = prefix ? `${prefix}/${entry.name}` : entry.name
          if (path.length > 1024 || path.split('/').length > 32) throw limit('Installed source exceeds path length or depth limit.')
          const before = await fs.stat(entry.target)
          if (!before || before.type !== entry.type) throw invalid('Installed source entry changed or has invalid metadata.')
          if ((entry.version !== undefined && entry.version !== before.version)
            || (entry.size !== undefined && before.size !== undefined && entry.size !== before.size)) throw kitFileError('studio.source_changed', 'Listed source metadata differs from its first stat.')
          if (entry.type === 'directory') await walk(entry.target, path, before)
          else if (entry.type === 'file') {
            if (files.length >= 4096 || (before.size ?? entry.size ?? 0) > 16 * 1024 * 1024 - total) throw limit('Installed source exceeds 4096 files or 16 MiB.')
            let bytes: Uint8Array
            try { bytes = await fs.readBytes(entry.target, undefined, 16 * 1024 * 1024 - total) }
            catch (error) { if (code(error) === 'FS_TOO_LARGE') throw limit('Installed source exceeds 16 MiB.'); throw error }
            if (!(bytes instanceof Uint8Array) || bytes.byteLength > 16 * 1024 * 1024 - total) throw limit('Installed source exceeds its byte budget.')
            if ((before.size !== undefined && bytes.byteLength !== before.size)
              || (entry.size !== undefined && bytes.byteLength !== entry.size)) throw kitFileError('studio.source_changed', 'Source byte length differs from its observed metadata.')
            await unchanged(entry.target, before)
            total += bytes.byteLength
            files.push({ path, base64: Buffer.from(bytes).toString('base64') })
          } else throw invalid('Installed source contains a non-regular entry.')
        }
        await unchanged(directory, info)
      }
      await walk(await target(root), '')
      return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    },
    async readFile(path) {
      if (typeof path !== 'string' || /[\\:\u0000-\u001f\u007f]/u.test(path)
        || path.split('/').some(part => !part || part === '.' || part === '..' || excludedDirectory(part))) {
        throw kitFileError('kit_file.path_forbidden', 'Invalid Kit file path.')
      }
      try {
        const resolved = await target(join(root, path))
        const info = await fs.stat(resolved)
        if (info?.type !== 'file') throw kitFileError('kit_file.missing', 'Kit file not found or not a regular file.')
        if ((info.size ?? 0) > MAX_TEXT_BYTES) throw kitFileError('kit_file.too_large', 'This file exceeds the 1 MiB text viewer limit.')
        const bytes = await fs.readBytes(resolved, undefined, MAX_TEXT_BYTES)
        let content: string
        try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch {
          throw kitFileError('kit_file.binary', 'Kit file is binary or invalid UTF-8 text.')
        }
        if (content.includes('\0')) throw kitFileError('kit_file.binary', 'Kit file is binary, not UTF-8 text.')
        return { content }
      } catch (error) {
        if (code(error) === 'FS_TOO_LARGE') throw kitFileError('kit_file.too_large', 'This file exceeds the 1 MiB text viewer limit.')
        if (code(error) === 'FS_NOT_FOUND') throw kitFileError('kit_file.missing', 'Kit file not found.')
        if (code(error) === 'FS_NOT_TEXT') throw kitFileError('kit_file.binary', 'Kit file is binary or invalid UTF-8 text.')
        throw error
      }
    },
    listKitRoots: async () => [],
    async readText(path) {
      try { return await fs.readText(await target(path)) } catch (error) {
        if (code(error) === 'FS_NOT_FOUND') return undefined
        if (code(error) === 'FS_NOT_TEXT') throw new StudioBinaryContentError(path)
        throw error
      }
    },
    async listDir(path) {
      try { return (await fs.listDir(await target(path))).map(entry => entry.name) } catch (error) {
        if (code(error) === 'FS_NOT_FOUND' || code(error) === 'FS_NOT_DIRECTORY') return []
        throw error
      }
    },
    async isDirectory(path) {
      try { return (await fs.stat(await target(path)))?.type === 'directory' } catch (error) {
        if (code(error) === 'FS_NOT_FOUND') return false
        throw error
      }
    },
    async listFiles(path) {
      const files: string[] = []
      let visited = 0
      const walk = async (directory: FsTarget, prefix: string, depth: number): Promise<void> => {
        if (depth > 32) throw new Error(`design studio dsh: ${kind} file tree exceeds depth limit`)
        for (const entry of await fs.listDir(directory)) {
          if (++visited > 20000) throw new Error(`design studio dsh: ${kind} file tree exceeds entry limit`)
          if (kind === 'Kit' && excludedDirectory(entry.name)) continue
          if (!fs.contains(base, entry.target)) continue
          const relative = prefix ? `${prefix}/${entry.name}` : entry.name
          if (entry.type === 'directory') await walk(entry.target, relative, depth + 1)
          else if (entry.type === 'file') files.push(relative)
        }
      }
      await walk(await target(path), '', 0)
      return files.sort()
    },
  }
}

