/** UI inventory, not publication inventory: confined to design_files output folders. */
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveConfinedFilePath } from './confined-fs.ts'
import type { GitWorkingFile } from './git.ts'

export async function listDisplayFiles(root: string, bundles: readonly string[]): Promise<readonly GitWorkingFile[]> {
  const files: GitWorkingFile[] = []
  let entries = 0
  const pending: { path: string; depth: number }[] = []
  const enqueue = (path: string, depth: number) => {
    if (++entries > 10000 || depth > 24) throw new Error('design panel: display inventory limit exceeded')
    pending.push({ path, depth })
  }
  const walk = async (path: string, depth: number): Promise<void> => {
    // Validate ancestors again before each read, including a replaced output root.
    const absolute = join(root, path)
    let info
    try { info = await lstat(absolute) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    if (info.isSymbolicLink()) throw new Error(`design panel: symbolic link is not a display file: ${path}`)
    if (info.isDirectory()) {
      await resolveConfinedFilePath(root, `${path}/.display-inventory-probe`)
      let names: string[]
      try { names = await readdir(absolute) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
      for (const name of names.sort()) {
        // Do not blanket-exclude vendor/tmp/hidden assets: they can be referenced
        // Bundle artifacts. Only reserved infrastructure directories are skipped.
        if (name === '.git' || name === 'node_modules' || name === '.DS_Store' || name === 'Thumbs.db') continue
        enqueue(`${path}/${name}`, depth + 1)
      }
    } else if (info.isFile()) {
      await resolveConfinedFilePath(root, path)
      files.push(Object.freeze({ path, size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, ino: info.ino }))
    } else throw new Error(`design panel: unsupported display entry: ${path}`)
  }
  await resolveConfinedFilePath(root, '.display-inventory-probe')
  // Preserve other Bundle outputs (including uncommitted first artifacts and
  // evidence from a no-longer-installed Bundle), but never scan the repository.
  const outputNames = (await readdir(root, { withFileTypes: true }))
    .filter(entry => !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .filter(entry => entry.isDirectory() || entry.isSymbolicLink()).map(entry => entry.name)
  for (const name of [...new Set([...bundles, ...outputNames])].sort()) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('design panel: invalid Bundle output directory')
    enqueue(name, 0)
  }
  // Bound the whole traversal, not each recursive directory. Keep every path
  // confinement check fresh; this is concurrency, not a stale directory cache.
  while (pending.length > 0) {
    const results = await Promise.allSettled(pending.splice(0, 8).map(({ path, depth }) => walk(path, depth)))
    const failure = results.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  }
  return Object.freeze(files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}
