/** Persistent user-selected panels. Unlike generated-panels, this directory is not
 * a disposable generation cache. Call writes only for explicit user retention,
 * inside the host's existing project mutation fence. */
import { randomUUID } from 'node:crypto'
import { mkdir, rename, unlink, writeFile, open, lstat, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { preserveAutoPanelDefinition, readSavedAutoPanelDefinition,
  type AutoPanelContext, type AutoPanelSnapshot, type SavedAutoPanelDefinition } from './auto-panel-spec.ts'

const MAX_BYTES = 262_144
const OWNER = 'dsh-saved-panels-v1\n'
function definitionPath(stateRoot: string, bundle: string): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(bundle)) throw new Error('saved panel: invalid Bundle id')
  return join(stateRoot, 'saved-panels', `${bundle}.json`)
}

/** Refuse pre-existing symlink redirection. The project mutation fence handles
 * cooperating writers; this is not a defense against arbitrary same-UID races.
 */
async function confinedDefinitionPath(stateRoot: string, bundle: string, create: boolean): Promise<string> {
  const path = definitionPath(stateRoot, bundle)
  if (resolve(stateRoot) !== stateRoot || await realpath(stateRoot) !== stateRoot
    || !(await lstat(stateRoot)).isDirectory()) throw new Error('saved panel: state root must be a canonical directory')
  const directory = join(stateRoot, 'saved-panels')
  let created = false
  if (create) await mkdir(directory, { mode: 0o700 }).then(() => { created = true }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error })
  const info = await lstat(directory)
  if (info.isSymbolicLink() || !info.isDirectory() || await realpath(directory) !== directory) {
    throw new Error('saved panel: storage directory is not confined')
  }
  try {
    const file = await lstat(path)
    if (file.isSymbolicLink() || !file.isFile()) throw new Error('saved panel: definition is not a confined regular file')
  } catch (error) { if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error }
  // Never claim a pre-existing user directory merely because its name matches.
  const owner = join(directory, '.owner')
  if (created) await writeFile(owner, OWNER, { flag: 'wx', mode: 0o600 })
  try {
    const meta = await lstat(owner)
    if (!meta.isFile() || meta.isSymbolicLink() || meta.size !== Buffer.byteLength(OWNER)) throw new Error('invalid marker')
    const handle = await open(owner, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const bytes = Buffer.alloc(Buffer.byteLength(OWNER) + 1)
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
      if (bytes.subarray(0, bytesRead).toString('utf8') !== OWNER) throw new Error('invalid marker')
    } finally { await handle.close() }
  } catch { throw new Error('saved panel: storage directory ownership conflict; existing content was preserved') }
  return path
}

export type SavedAutoPanelRead =
  | { status: 'missing' }
  | { status: 'incompatible'; reason: string }
  | { status: 'ready'; definition: SavedAutoPanelDefinition; manifest: ReturnType<typeof readSavedAutoPanelDefinition>['manifest']; sourceChanged: boolean }

export async function loadSavedAutoPanel(stateRoot: string, context: AutoPanelContext): Promise<SavedAutoPanelRead> {
  definitionPath(stateRoot, context.bundle)
  try {
    const path = await confinedDefinitionPath(stateRoot, context.bundle, false)
    // Bound the actual read as well as metadata, including a concurrently growing file.
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    let text: string
    try {
      if (!(await handle.stat()).isFile()) throw new Error('saved panel: definition is not a file')
      const buffer = Buffer.alloc(MAX_BYTES + 1)
      let length = 0
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null)
        if (bytesRead === 0) break
        length += bytesRead
      }
      if (length > MAX_BYTES) throw new Error('saved panel: definition exceeds size limit')
      text = buffer.subarray(0, length).toString('utf8')
    } finally { await handle.close() }
    const definition: unknown = JSON.parse(text)
    const checked = readSavedAutoPanelDefinition(definition, context)
    return { status: 'ready', definition: definition as SavedAutoPanelDefinition, ...checked }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { status: 'missing' }
    return { status: 'incompatible', reason: error instanceof Error ? error.message : String(error) }
  }
}

/** Never accepts a model-selected path or arbitrary unvalidated DSL. Replacing
 * a retained definition is an explicit action, not part of auto generation. */
export async function saveAutoPanelDefinition(stateRoot: string, snapshot: AutoPanelSnapshot, context: AutoPanelContext): Promise<void> {
  definitionPath(stateRoot, context.bundle)
  const definition = preserveAutoPanelDefinition(snapshot, context)
  const text = `${JSON.stringify(definition)}\n`
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new Error('saved panel: definition exceeds size limit')
  const directory = join(stateRoot, 'saved-panels')
  const path = await confinedDefinitionPath(stateRoot, context.bundle, true)
  const temporary = join(directory, `.${context.bundle}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, text, { flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
  }
}
