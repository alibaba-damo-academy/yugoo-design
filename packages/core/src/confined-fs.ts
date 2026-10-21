/** Filesystem helpers that reject symbolic-link traversal below a trusted root. */
import { lstat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** Minimal filesystem used by confined Design File operations. */
export interface ConfinedTextFs {
  /** Read UTF-8 text, or undefined when absent. */
  readText(path: string): Promise<string | undefined>
  /** Replace one file with UTF-8 text. */
  writeText(path: string, content: string): Promise<void>
  /** Atomically replace one file with UTF-8 text when supported. */
  replaceText?(path: string, content: string): Promise<void>
  /** Read byte-exact content, or undefined when absent. */
  readBytes?(path: string): Promise<Uint8Array | undefined>
  /** Replace one file with byte-exact content. */
  writeBytes?(path: string, content: Uint8Array): Promise<void>
  /** Atomically replace one file with byte-exact content when supported. */
  replaceBytes?(path: string, content: Uint8Array): Promise<void>
  /** Create a directory and its missing parents. */
  ensureDir?(path: string): Promise<void>
  /** Remove one regular file. */
  removeFile?(path: string): Promise<void>
}

function pathParts(path: string): readonly string[] {
  if (path === '' || path.startsWith('/') || path.endsWith('/') || path.includes('\\') || /[\u0000-\u001f\u007f]/u.test(path)) {
    throw new Error(`artifact path must stay inside design_files/: ${path}`)
  }
  const parts = path.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..' || part === '.git')) {
    throw new Error(`artifact path must stay inside design_files/: ${path}`)
  }
  return parts
}

async function status(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function assertDirectory(path: string, value: Awaited<ReturnType<typeof lstat>>): void {
  if (value.isSymbolicLink()) throw new Error(`design_files path traverses a symbolic link: ${path}`)
  if (!value.isDirectory()) throw new Error(`design_files path parent is not a directory: ${path}`)
}

/**
 * Resolve one relative file path after rejecting every existing symlink below
 * the trusted root. Missing suffixes are allowed so callers can create them.
 * @param root - trusted Design Files root.
 * @param relativePath - slash-separated path below the root.
 * @returns the absolute target path.
 */
export async function resolveConfinedFilePath(root: string, relativePath: string): Promise<string> {
  const parts = pathParts(relativePath)
  const absoluteRoot = resolve(root)
  const rootStatus = await status(absoluteRoot)
  if (rootStatus !== undefined) assertDirectory(absoluteRoot, rootStatus)

  let current = absoluteRoot
  let missing = rootStatus === undefined
  for (const [index, part] of parts.entries()) {
    current = join(current, part)
    if (missing) continue
    const value = await status(current)
    if (value === undefined) {
      missing = true
      continue
    }
    if (value.isSymbolicLink()) throw new Error(`design_files path traverses a symbolic link: ${current}`)
    if (index < parts.length - 1) assertDirectory(current, value)
    else if (!value.isFile()) throw new Error(`design_files target is not a regular file: ${current}`)
  }
  return current
}

/**
 * Read a text file after rejecting existing symlinks below the root.
 * @param fs - text filesystem implementation.
 * @param root - trusted Design Files root.
 * @param relativePath - file path below the root.
 * @returns text content or undefined when absent.
 */
export async function readConfinedText(
  fs: Pick<ConfinedTextFs, 'readText'>,
  root: string,
  relativePath: string,
): Promise<string | undefined> {
  return fs.readText(await resolveConfinedFilePath(root, relativePath))
}

/**
 * Write a text file after checking the path before and after parent creation.
 * @param fs - text filesystem implementation.
 * @param root - trusted Design Files root.
 * @param relativePath - file path below the root.
 * @param content - complete text content.
 */
export async function writeConfinedText(
  fs: Pick<ConfinedTextFs, 'writeText' | 'replaceText' | 'ensureDir'>,
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const initial = await resolveConfinedFilePath(root, relativePath)
  await fs.ensureDir?.(dirname(initial))
  const checked = await resolveConfinedFilePath(root, relativePath)
  if (fs.replaceText === undefined) await fs.writeText(checked, content)
  else await fs.replaceText(checked, content)
}

/**
 * Read a binary file after rejecting existing symlinks below the root.
 * @param fs - binary filesystem implementation.
 * @param root - trusted Design Files root.
 * @param relativePath - file path below the root.
 * @returns bytes or undefined when absent.
 */
export async function readConfinedBytes(
  fs: Required<Pick<ConfinedTextFs, 'readBytes'>>,
  root: string,
  relativePath: string,
): Promise<Uint8Array | undefined> {
  return fs.readBytes(await resolveConfinedFilePath(root, relativePath))
}

/**
 * Write a binary file after checking the path before and after parent creation.
 * @param fs - binary filesystem implementation.
 * @param root - trusted Design Files root.
 * @param relativePath - file path below the root.
 * @param content - complete binary content.
 */
export async function writeConfinedBytes(
  fs: Required<Pick<ConfinedTextFs, 'writeBytes'>> & Pick<ConfinedTextFs, 'replaceBytes' | 'ensureDir'>,
  root: string,
  relativePath: string,
  content: Uint8Array,
): Promise<void> {
  const initial = await resolveConfinedFilePath(root, relativePath)
  await fs.ensureDir?.(dirname(initial))
  const checked = await resolveConfinedFilePath(root, relativePath)
  if (fs.replaceBytes === undefined) await fs.writeBytes(checked, content)
  else await fs.replaceBytes(checked, content)
}

/**
 * Remove one file after rejecting symlink traversal below the trusted root.
 * @param fs - filesystem implementation with file removal.
 * @param root - trusted Design Files root.
 * @param relativePath - file path below the root.
 */
export async function removeConfinedFile(
  fs: Required<Pick<ConfinedTextFs, 'removeFile'>>,
  root: string,
  relativePath: string,
): Promise<void> {
  const target = await resolveConfinedFilePath(root, relativePath)
  await fs.removeFile(target)
}
