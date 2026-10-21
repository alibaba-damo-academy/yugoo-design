import { open, stat } from 'node:fs/promises'

/** Flush a copied file without truncating it. Windows requires a writable handle. */
export async function syncKnowledgeFile(path: string): Promise<void> {
  const file = await open(path, 'r+')
  try { await file.sync() } finally { await file.close() }
}

/**
 * POSIX directory durability after rename/copy. Node cannot flush a Windows
 * directory handle: preserve file flushes and atomic rename, but do not claim
 * the same directory-entry power-loss guarantee there. Never suppress file I/O
 * errors, including EPERM, as an unsupported-directory workaround.
 */
export async function syncKnowledgeDirectory(path: string): Promise<void> {
  if (!(await stat(path)).isDirectory()) throw new Error('Knowledge durability path must be a directory')
  if (process.platform === 'win32') {
    return
  }
  const directory = await open(path, 'r')
  try { await directory.sync() } finally { await directory.close() }
}
