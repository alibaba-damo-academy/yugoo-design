/** Native entry syntax is host-owned; project semantics are the existing Core's. */
import { mkdir, readFile, writeFile, rename, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { DesignProjectRegistry, parseDesignCommand, runDesignProjectCommand } from '../../core/lib/index.js'
import { companionFs } from './project.mjs'
import { assertCompanionKitContributions, createCompanionContentLibrary } from './content-library.mjs'

export async function runCompanionCommand({ input, host = 'codex', threadId, projectsRoot, stateRoot, kitRoot }) {
  if (!['codex', 'claude-code', 'qoder', 'qwenwork', 'workbuddy'].includes(host)) throw new Error('Unknown host.')
  if (typeof threadId !== 'string' || !threadId.trim() || threadId.length > 256) throw new Error('Explicit native session identity is required.')
  const invocation = parseDesignCommand(input)
  if (!invocation) throw new Error('Unknown design command. Use help.')
  const root = join(stateRoot, 'project-management')
  const readOnly = ['help', 'status', 'list', 'compose_spec'].includes(invocation.verb)
  // Pure inspection neither admits installed content nor serializes behind a
  // selection writer. Mutating CLI processes still protect registry updates.
  const lock = join(root, 'command.lock')
  if (!readOnly) {
    await mkdir(root, { recursive: true, mode: 0o700 })
    try { await mkdir(lock) } catch (error) {
      if (error.code === 'EEXIST') throw new Error(`Another project command is active. Retry after it finishes. If it crashed, stop project commands before removing the empty lock directory: ${lock}`)
      throw error
    }
  }
  try {
    const registry = new DesignProjectRegistry({ projectsRoot, stateRoot: join(root, 'registry') })
    const key = createHash('sha256').update(JSON.stringify([host, threadId])).digest('hex')
    const path = join(root, `${key}.json`)
    let selection
    try { selection = JSON.parse(await readFile(path, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    const persist = async value => {
      const next = { revision: (selection?.revision ?? 0) + 1, ...value }
      const temporary = join(root, `${randomUUID()}.tmp`)
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' })
      await rename(temporary, path)
      selection = next
      return { revision: next.revision }
    }
    if (selection?.projectId && !(await registry.list()).some(record => record.projectId === selection.projectId)) {
      // A reader can show a forgotten selection as closed without rewriting it.
      if (readOnly) selection = undefined
      else await persist({})
    }
    let kits
    const contentLibrary = createCompanionContentLibrary({ fs: companionFs, kitRoot, stateRoot })
    const availableKits = async () => kits ??= await contentLibrary.availableKits()
    const knowledge = { provider: 'ladybug-wasm' } // Metadata pin only; never starts a database here.
    const projects = Object.fromEntries(['open', 'status', 'close', 'forget', 'snapshot', 'inspectReconstructionSource'].map(name => [name, registry[name].bind(registry)]))
    projects.create = name => registry.create(name, knowledge)
    projects.list = () => registry.listRecent()
    projects.migrate = async (reference, currentId) => {
      const basis = currentId ? await registry.open(currentId) : undefined
      if (!basis?.kit) throw new Error('Select a Kit before migration: create a project if needed, then kit <kit>.')
      const exposed = await contentLibrary.resolveExactProject(basis.kit)
      return registry.migrate(reference, { knowledge: basis.knowledge, kit: basis.kit }, exposed.skills.map(skill => skill.name))
    }
    const result = await runDesignProjectCommand(invocation, { projects, conversation: {
      current: async () => selection?.projectId ? selection : undefined,
      select: record => persist({ projectId: record.projectId }),
      close: () => persist({}),
      changeMindset: async (projectId, name) => {
        const available = await availableKits()
        const exposed = available.find(kit => kit.name === name)
        if (!exposed) throw new Error(`Available Kits: ${available.map(kit => `${kit.name}@${kit.version}`).join(', ')}`)
        const previous = await registry.open(projectId)
        if (previous.kit && previous.kit.name !== exposed.name) throw new Error('Changing an existing Kit requires migration; no implicit upgrade.')
        const pin = previous.kit ?? { name: exposed.name, version: exposed.version }
        const effective = await contentLibrary.resolveProject(pin)
        if (effective.name !== pin.name || effective.version !== pin.version) throw new Error('Restore the exact pinned Kit or explicitly migrate.')
        if (!previous.kit) assertCompanionKitContributions(effective, await contentLibrary.loadInstalled())
        await registry.setKitPin(projectId, pin)
        const saved = await persist({ projectId })
        return { kit: effective.name, version: effective.version, sourceRevision: saved.revision }
      },
    } })
    const selected = selection?.projectId ? (await registry.list()).find(record => record.projectId === selection.projectId) : undefined
    const entry = host === 'codex' ? '$yugoo' : ['claude-code', 'qoder'].includes(host) ? '/yugoo-design:yugoo' : 'yugoo'
    let availableMindsets, mindsetCatalogError
    if (invocation.verb === 'kit' || invocation.verb === 'mindset') availableMindsets = (await availableKits()).map(kit => kit.name)
    else {
      try { availableMindsets = await contentLibrary.availableMindsetNames() }
      catch (error) { availableMindsets = []; mindsetCatalogError = String(error.message ?? error) }
    }
    return { ...result, commandEntry: entry, selected,
      availableMindsets, ...(mindsetCatalogError ? { mindsetCatalogError } : {}),
      panelRestartRequired: ['new', 'open', 'migrate', 'reconstruct', 'close', 'delete'].includes(invocation.verb) && result.kind === 'success',
    }
  } finally { if (!readOnly) await rmdir(lock) }
}
