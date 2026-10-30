/** One explicit project and one explicit Host conversation, using existing Core. */
import { readFile, writeFile, mkdir, readdir, stat, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { isDeepStrictEqual } from 'node:util'
import { createHash } from 'node:crypto'
import {
  DesignProjectManager, DesignFilesStore, GitVersioning, DesignJournalStorage, DesignExecutionHandoffJournal, nodeDesignProjectSpawn,
  applyPanelEdit, buildPanelSaveNote, parsePanelArtifacts, DESIGN_PANEL_SAVE_ASSESSMENT_GUIDANCE, projectWorktreeDesign, validateSkillDesign, validatorFromSchemaYaml,
  deriveCurrentDesignExecutionGate, deriveDesignContinuation, pendingMustEditAuthorityForSave,
  parseSchemaYaml, resolveAutoPanel, assertResolvedAutoPanelSave, retainResolvedAutoPanel,
  autoPanelGenerationPrompt, publishAutoPanelComponents,
  projectKitContentHash, sameProjectContentPin,
  ensureProjectKit,
  readDesignGit,
} from '../../core/lib/index.js'
import { createCompanionContentLibrary } from './content-library.mjs'
import { createAutoPanelTickets } from './auto-panel-tickets.mjs'
import { nativeExecutionContract } from './native-execution-contract.mjs'
import { createSavedContinuation } from './saved-continuation.mjs'

const optionalRead = async (path, encoding) => {
  try { return await readFile(path, encoding) } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}
export const companionFs = {
  readText: path => optionalRead(path, 'utf8'), readBytes: path => optionalRead(path),
  writeText: (path, text) => writeFile(path, text, 'utf8'), writeBytes: writeFile,
  ensureDir: path => mkdir(path, { recursive: true }), removeFile: path => rm(path),
  listDir: readdir, isDirectory: async path => (await stat(path)).isDirectory(),
  realPath: realpath,
}
const gitSpawn = nodeDesignProjectSpawn

export async function openCompanionProject({ projectRoot, kitRoot, stateRoot, connection, getConnectionPath, statusEntryPath, trustedContentSources, workbuddyProducer = false, getMainAssessmentContext, nativeCwd, transcriptPath }) {
  let project = await new DesignProjectManager().open(projectRoot)
  const fs = companionFs
  const contentLibrary = createCompanionContentLibrary({ fs, kitRoot, stateRoot, trustedContentSources })
  const readDefinition = async metadata => metadata.kit
    ? ensureProjectKit(projectRoot, { loadSource: () => contentLibrary.resolveExactProject(metadata.kit) })
    : contentLibrary.loadInstalled().then(kit => ({ kit, revision: projectKitContentHash(kit) }))
  const initialDefinition = await readDefinition(project.metadata)
  let kit = initialDefinition.kit
  let kitRevision = initialDefinition.revision
  let kitReload = { status: 'ready', revision: kitRevision }
  const accessFor = pin => !pin ? { mode: 'unconfigured', writable: false }
    : pin.name === kit.name
      ? { mode: 'writable', writable: true, kit: { ...pin } }
      : { mode: 'recovery', writable: false, kit: { ...pin } }
  let access = accessFor(project.metadata.kit)
  const assertWritable = () => {
    if (access.writable) return kit
    throw new Error(access.mode === 'unconfigured'
      ? 'No Kit is active. Select a mindset in the native Design command before starting Bundle work; this Panel can remain open.'
      : `The project's Kit ${access.kit.name} is unavailable. Check its project-local definition files before editing.`)
  }
  const refreshAccess = async (displayOnly = false) => {
    const manager = new DesignProjectManager()
    const current = displayOnly ? await manager.readMetadata(projectRoot) : await manager.open(projectRoot)
    if (current.metadata.id !== project.metadata.id) throw new Error('Project identity changed. Reopen the Companion explicitly.')
    const resolved = await readDefinition(current.metadata)
    if (resolved.revision !== kitRevision || !sameProjectContentPin(current.metadata.kit, project.metadata.kit)) {
      kit = resolved.kit; kitRevision = resolved.revision
      projection = undefined; continuationCache = undefined; publishedSnapshot = undefined
    }
    project = current
    access = accessFor(project.metadata.kit)
    return access
  }
  const requireWritable = async () => { await refreshAccess(); return assertWritable() }
  const scope = new AsyncLocalStorage()
  let tail = Promise.resolve()
  const mutate = operation => {
    if (scope.getStore()) return operation()
    const result = tail.then(() => scope.run(true, operation))
    tail = result.then(() => {}, () => {})
    return result
  }
  const store = new DesignFilesStore(fs, new GitVersioning(nodeDesignProjectSpawn, project.root, 'design_files'), project.designFilesRoot, {
    read: operation => operation(), mutate,
  })
  const journal = new DesignJournalStorage(join(stateRoot, project.metadata.id))
  const handoffs = new DesignExecutionHandoffJournal(journal)
  const journalId = `${connection.host ?? 'codex'}:${connection.threadId}`
  let projection
  let continuationCache
  let publishedSnapshot
  const pendingNotes = new Map()
  const savedContinuation = createSavedContinuation({ stateRoot, projectId: project.metadata.id, projectRoot: project.root,
    host: connection.host ?? 'codex', threadId: connection.threadId, nativeCwd, transcriptPath })
  const notificationKitHash = () => createHash('sha256').update(JSON.stringify(project.metadata.kit ?? null)).digest('hex')
  const saves = new Map()
  const requireSkill = name => {
    assertWritable()
    const skill = kit.skills.find(item => item.name === name)
    if (!skill) throw new Error('Unknown Bundle in the project Kit.')
    return skill
  }
  const requireArtifact = path => {
    if (typeof path !== 'string' || !path.includes('/')) throw new Error('Expected a Bundle-owned relative path.')
    return path // Core read/write confinement validates traversal and symlinks.
  }
  const autoContext = (workspace, skill) => ({
    kit: kit.name, kitVersion: String(kit.version), bundle: skill.name, bundleVersion: String(skill.version),
    schema: parseSchemaYaml(skill.metadata.schemaYaml), state: workspace.design[skill.name]?.state,
    artifacts: Object.fromEntries(Object.entries(workspace.artifactFiles).filter(([path]) => path.startsWith(`${skill.name}/`)
      && path !== `${skill.name}/${skill.name}.json` && !path.includes('/attachments/')).slice(0, 30)),
  })
  const autoRoots = () => ({ definitionRoot: project.root, cacheRoot: join(stateRoot, project.metadata.id) })
  const autoTickets = createAutoPanelTickets({
    session: journalId, mutate, prompt: autoPanelGenerationPrompt,
    inspect: async name => {
      await requireWritable()
      const skill = requireSkill(name)
      if (skill.metadata.skillManifest?.presentation?.mode !== 'auto' || skill.metadata.skillManifest.runtime !== undefined) {
        throw new Error('auto panel: generation is unavailable for this Bundle')
      }
      const workspace = await api.readWorkspace()
      if (workspace.access.mode !== 'writable') throw new Error('auto panel: project is read-only')
      const context = autoContext(workspace, skill)
      if (!context.state || typeof context.state !== 'object' || Array.isArray(context.state)) throw new Error('auto panel: saved state unavailable')
      return { projectId: project.metadata.id, definitionRevision: kitRevision,
        sourceRevision: workspace.worktreeRevision, context, resolved: await resolveAutoPanel(autoRoots(), context) }
    },
    publish: (current, components) => publishAutoPanelComponents(autoRoots().cacheRoot, current.context, components),
  })
  const api = {
    get project() { return project }, get installedKit() { return kit }, get kit() { return assertWritable() }, store, refreshAccess, requireWritable, contentLibrary,
    get definitionRevision() { return kitRevision },
    mutateKnowledge: mutate,
    mutateAssessment: mutate,
    async readGit(params, signal) {
      signal?.throwIfAborted()
      await refreshAccess()
      const opened = project
      const result = await readDesignGit({
        git: new GitVersioning(gitSpawn, opened.root),
        projectId: opened.metadata.id,
        status: currentSignal => new DesignProjectManager().status(opened, currentSignal),
      }, params, signal)
      await refreshAccess()
      signal?.throwIfAborted()
      return result
    },
    prepareAutoPanel: request => autoTickets.prepare(request),
    submitAutoPanel: request => autoTickets.submit(request),
    async reloadKit() {
      return mutate(async () => {
        try {
          const previous = kitRevision
          await refreshAccess()
          const changed = previous !== kitRevision
          kitReload = { status: changed ? 'updated' : 'unchanged', revision: kitRevision }
        } catch (error) {
          kitReload = { status: 'rejected', revision: kitRevision, error: String(error.message ?? error) }
        }
        return { ...kitReload }
      })
    },
    async prepareBundle({ skill: name }) {
      await requireWritable()
      const skill = requireSkill(name)
      const execution = { ...skill.execution, mode: skill.execution.mode ?? 'subagent' }
      const executionContract = nativeExecutionContract({ host: connection.host ?? 'codex', mode: execution.mode,
        skill: name, projectRoot: project.root, designFiles: project.designFilesRoot, kitRoot: kit.sourceRoot, stateRoot, cliEntry: statusEntryPath })
      return { skill: name, version: skill.version, kit: { name: kit.name, version: kit.version },
        designFiles: project.designFilesRoot, resources: skill.resourceRoot ?? join(kitRoot, 'skills', name),
        mindset: kit.sourceLocation?.mindsetPath ?? join(kit.sourceRoot ?? kitRoot, 'mindset.md'), executionContract,
        definitionRevision: kitRevision,
        method: `${executionContract.instructions}\n\n# Current project Bundle method (unaltered)\n\n${skill.content}`,
        host: `${connection.host ?? 'codex'}-native`,
        execution,
      }
    },
    async settleBundle({ skill: name, invocationId, scope = 'completion', outcome, definitionRevision }) {
      return mutate(async () => {
        await requireWritable()
        const skill = requireSkill(name)
        if (typeof invocationId !== 'string' || !/^[\w.-]{1,128}$/.test(invocationId)) throw new Error('Exact invocation ID required.')
        if (['failed', 'cancelled', 'no-progress'].includes(outcome)) return store.auditInvocation(name, { eventId: invocationId, outcome })
        const checkDefinition = () => {
          if (definitionRevision !== undefined && definitionRevision !== kitRevision) throw new Error('The project Bundle definitions changed during this invocation. Re-read the current method and repair the existing files before starting another invocation.')
        }
        checkDefinition()
        if (!['state', 'completion'].includes(scope)) throw new Error('Invalid validation scope.')
        const state = await store.read(name)
        if (!state) throw new Error('Canonical Design JSON is missing.')
        const issues = await validateSkillDesign(skill, state, { scopes: scope === 'state' ? ['state'] : ['state', 'completion'], artifactText: path => store.readWorktreeText(path) })
        if (issues.length) throw new Error(JSON.stringify(issues))
        const artifacts = {}
        for (const path of await store.listWorktreePaths()) {
          if (path.startsWith(`${name}/`) && path !== `${name}/${name}.json`) artifacts[path] = await store.readWorktreeBytes(path)
        }
        const publication = { skill: name, bundleVersion: skill.version, invocationId,
          stateStatus: scope === 'state' ? 'pending' : 'complete', handoff: scope === 'state' ? skill.execution.handoff : 'none', outcome: scope === 'state' ? 'pause' : 'complete' }
        await refreshAccess()
        checkDefinition()
        return store.write(name, state, { origin: 'agent', artifacts, ownedArtifacts: Object.keys(artifacts), publication,
          settleEvent: async event => {
            const history = await journal.read(journalId)
            const prior = event.commit && history.records.find(record => record.type === 'design/changed'
              && record.data?.commit === event.commit && record.data?.skill === name && record.data?.origin === 'agent')
            if (prior) {
              if (!isDeepStrictEqual(prior.data.state, event.state)) throw new Error('Committed design event was reused with different facts.')
              return
            }
            await journal.append(journalId, { type: 'design/changed', data: {
            kit: kit.name, version: kit.version, skill: name, state: event.state, origin: 'agent',
            execution: { invocationId: publication.invocationId, stateStatus: publication.stateStatus, handoff: publication.handoff },
            ...(event.commit ? { commit: event.commit } : {}), panelYaml: skill.metadata.panelYaml, skillManifest: skill.metadata.skillManifest,
            } })
          },
        })
      })
    },
    async readWorkspace({ displayOnly = false } = {}) {
      return mutate(async () => {
      const currentAccess = await refreshAccess(displayOnly)
      const skills = currentAccess.writable ? kit.skills : []
      const accessKey = JSON.stringify(currentAccess)
      let checkpoint, publicationError
      try { checkpoint = displayOnly ? await store.pollHead() : await store.head() }
      catch (error) {
        if (!displayOnly) throw error
        publicationError = String(error.message ?? error)
      }
      const history = await journal.read(journalId)
      let publication = publishedSnapshot
      try {
        if (!publication || checkpoint !== publication.checkpoint) {
          const states = {}
          const experienceFiles = {}
          let totalBytes = 0, count = 0
          if (checkpoint) for (const path of await store.listPathsAt(checkpoint)) {
            if (path.startsWith('_experiences/')) experienceFiles[path] = checkpoint
            const parts = path.split('/')
            if (parts.length !== 2 || parts[1] !== `${parts[0]}.json`) continue
            const text = await store.readTextAt(checkpoint, path)
            const bytes = Buffer.byteLength(text ?? '')
            totalBytes += bytes
            if (++count > 128 || bytes > 1024 * 1024 || totalBytes > 8 * 1024 * 1024) throw new Error('Published Bundle snapshot exceeds display limits')
            const state = JSON.parse(text)
            if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid published Bundle state')
            states[parts[0]] = { state, origin: 'agent' }
          }
          publication = { checkpoint, states, experienceFiles }
        }
      } catch (error) {
        if (!displayOnly) throw error
        publicationError = String(error.message ?? error)
        checkpoint = undefined
      }
      const nextProjection = await projectWorktreeDesign(store, publicationError ? {} : publication.states,
        skills, `${checkpoint ?? ''}\u0000${kitRevision}`, projection?.accessKey === accessKey ? projection : undefined)
      const artifactFiles = Object.fromEntries([...nextProjection.fileDigests].map(([path, digest]) => [path, digest.sha256]))
      const autoPanelManifests = {}, autoPanelDefinitions = {}
      for (const skill of skills) {
        if (skill.metadata.skillManifest?.presentation?.mode !== 'auto') continue
        const state = nextProjection.design[skill.name]?.state
        if (!state || typeof state !== 'object' || Array.isArray(state)) continue
        const context = {
          kit: kit.name, kitVersion: String(kit.version), bundle: skill.name, bundleVersion: String(skill.version),
          schema: parseSchemaYaml(skill.metadata.schemaYaml), state,
          artifacts: Object.fromEntries(Object.entries(artifactFiles).filter(([path]) => path.startsWith(`${skill.name}/`)
            && path !== `${skill.name}/${skill.name}.json` && !path.includes('/attachments/')).slice(0, 30)),
        }
        const resolved = await resolveAutoPanel({ definitionRoot: project.root, cacheRoot: join(stateRoot, project.metadata.id) }, context)
        if (resolved.status === 'ready') {
          autoPanelManifests[skill.name] = JSON.stringify(resolved.manifest)
          autoPanelDefinitions[skill.name] = { origin: resolved.origin, definitionRevision: resolved.definitionRevision, sourceChanged: resolved.sourceChanged }
        } else if (resolved.status === 'incompatible') autoPanelDefinitions[skill.name] = { error: resolved.reason }
      }
      const key = `${accessKey}:${checkpoint}:${history.snapshot.revision}:${kitRevision}`
      let continuations = !publicationError && continuationCache?.key === key ? continuationCache.value : undefined
      if (continuations === undefined) {
        continuations = []
        try {
          if (!publicationError && checkpoint) for (const skill of skills) {
            const gate = await deriveCurrentDesignExecutionGate({ projectId: project.metadata.id, records: history.records,
              kit, skill, stateRevision: checkpoint, state: publication.states[skill.name]?.state,
              store, signal: new AbortController().signal })
            if (gate?.kind === 'user_continue') continuations.push(deriveDesignContinuation({ gate, title: skill.title }))
          }
        } catch (error) {
          if (!displayOnly) throw error
          publicationError = String(error.message ?? error)
          continuations = []
        }
      }
      if (JSON.stringify(await refreshAccess(displayOnly)) !== accessKey) throw new Error('Project Kit changed while reading workspace')
      // No partially assembled shared arrays across await boundaries. A late
      // older read may replace a cache hint, but never another response's facts.
      projection = { ...nextProjection, accessKey }
      if (!publicationError) {
        publishedSnapshot = publication
        continuationCache = { key, value: continuations }
      }
      let savedContinuations = [], savedNotificationError
      try { savedContinuations = await savedContinuation.snapshot({ kitHash: notificationKitHash() }) }
      catch { savedNotificationError = '保存后的通知状态不可读；设计文件仍以 Git/DesignJournal 为准，请在原会话核对，不要盲目重发。' }
      return {
        projectId: project.metadata.id, projectName: project.metadata.name, projectPath: project.root,
        kitReload: { ...kitReload },
        checkpoint: checkpoint ?? null, worktreeRevision: nextProjection.revision,
        experienceFiles: publicationError ? {} : publication.experienceFiles,
        evidenceWorktreeRevision: nextProjection.evidenceRevision,
        artifactFiles, autoPanelManifests, autoPanelDefinitions, autoPanelStates: autoTickets.states(),
        executionRevision: 0, executionAttempts: [],
        access: publicationError && currentAccess.writable
          ? { mode: 'recovery', writable: false, kit: currentAccess.kit } : currentAccess,
        ...(publicationError ? { publicationError } : {}),
        journalRevision: history.snapshot.revision ?? 0, design: nextProjection.design,
        continuations, savedContinuations, ...(savedNotificationError ? { savedNotificationError } : {}), clarity: { assessment: null, needsReassessment: false },
      }
      })
    },
    async retainAutoPanel({ projectId, skill: name, sourceRevision, definitionRevision }) {
      return mutate(async () => {
        await requireWritable()
        if (projectId !== project.metadata.id) throw new Error('auto panel: project changed')
        const workspace = await this.readWorkspace()
        if (workspace.access.mode !== 'writable' || workspace.worktreeRevision !== sourceRevision) {
          throw new Error('auto panel: source changed or project is read-only')
        }
        const skill = requireSkill(name)
        const manifest = skill.metadata.skillManifest
        if (manifest?.presentation?.mode !== 'auto' || manifest.runtime !== undefined) {
          throw new Error('auto panel: retention is unavailable for this Bundle')
        }
        const state = workspace.design[name]?.state
        if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('auto panel: current state is unavailable')
        return retainResolvedAutoPanel({
          roots: { definitionRoot: project.root, cacheRoot: join(stateRoot, project.metadata.id) },
          context: {
            kit: kit.name, kitVersion: String(kit.version), bundle: name, bundleVersion: String(skill.version),
            schema: parseSchemaYaml(skill.metadata.schemaYaml), state,
            artifacts: Object.fromEntries(Object.entries(workspace.artifactFiles).filter(([path]) => path.startsWith(`${name}/`)
              && path !== `${name}/${name}.json` && !path.includes('/attachments/')).slice(0, 30)),
          },
          definitionRevision,
        })
      })
    },
    async savePanel({ skill: name, state, artifacts = [], eventId }) {
      await requireWritable()
      if (typeof eventId !== 'string' || !/^[\w-]{1,128}$/.test(eventId)) throw new Error('A stable save event ID is required.')
      const payload = JSON.stringify({ name, state, artifacts })
      const prior = saves.get(eventId)
      if (prior) {
        if (prior.payload !== payload) throw new Error('Save event ID reused with different content.')
        return prior.promise
      }
      const promise = mutate(async () => {
        await requireWritable()
        const skill = requireSkill(name)
        const auto = skill.metadata.skillManifest?.presentation?.mode === 'auto'
        if (auto) {
          if (skill.metadata.skillManifest?.runtime !== undefined) throw new Error('auto panel: unsupported runtime save contract')
          if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)
            || Object.keys(artifacts).some(key => !['autoBefore', 'definitionRevision'].includes(key))
            || !Object.hasOwn(artifacts, 'autoBefore') || typeof artifacts.definitionRevision !== 'string') {
            throw new Error('auto panel: original state and retained definition revision are required')
          }
          const priorState = await store.readPublished(name)
          if (priorState === undefined) throw new Error('auto panel: published state unavailable')
          const history = await journal.read(journalId)
          const visible = await projectWorktreeDesign(store, history.snapshot.design ?? {}, kit.skills, await store.head() ?? '')
          // Exact retry is safe and delegated to the existing save-event audit.
          if (!isDeepStrictEqual(priorState, state) || !await store.hasPanelSaveAudit(name, eventId)) await assertResolvedAutoPanelSave({
            roots: { definitionRoot: project.root, cacheRoot: join(stateRoot, project.metadata.id) },
            context: { kit: kit.name, kitVersion: String(kit.version), bundle: name, bundleVersion: String(skill.version),
              schema: parseSchemaYaml(skill.metadata.schemaYaml), state: priorState,
              artifacts: Object.fromEntries([...visible.fileDigests].filter(([path]) => path.startsWith(`${name}/`)
                && path !== `${name}/${name}.json` && !path.includes('/attachments/')).slice(0, 30).map(([path, digest]) => [path, digest.sha256])),
            }, before: artifacts.autoBefore, visibleState: visible.design[name]?.state, after: state,
            definitionRevision: artifacts.definitionRevision,
          })
          artifacts = []
        }
        if (!Array.isArray(artifacts)) throw new Error('Artifacts must be an array.')
        const prepared = parsePanelArtifacts(name, artifacts)
        for (const artifact of artifacts) {
          if (!artifact.path.startsWith(`${name}/`) || artifact.path === `${name}/${name}.json`) throw new Error('Invalid owned artifact.')
        }
        const issues = await validateSkillDesign(skill, state, {
          scopes: ['state'],
          artifactText: async path => Object.hasOwn(prepared, path) ? Buffer.from(prepared[path]).toString('utf8') : store.readWorktreeText(path),
        })
        if (issues.length) throw new Error(JSON.stringify(issues))
        const authority = skill.execution.handoff === 'must_edit'
          ? await pendingMustEditAuthorityForSave((await journal.read(journalId)).records,
            kit.name, kit.version, name, await store.head(), commit => store.diffCommit(commit))
          : undefined
        let notificationPrepared = true
        try { await savedContinuation.prepare({ eventId, skill: name, payloadHash: createHash('sha256').update(payload).digest('hex'), kitHash: notificationKitHash() }) }
        catch (error) {
          if (error.code === 'CONTINUATION_CONFLICT') throw error
          notificationPrepared = false
        }
        const result = await applyPanelEdit(store, { skill: name, state }, async event => {
          const history = await journal.read(journalId)
          if (event.commit && history.records.some(record => record.type === 'design/changed'
            && record.data?.commit === event.commit && record.data?.skill === name
            && record.data?.origin === 'panel')) return
          await journal.append(journalId, { type: 'design/changed', data: {
            kit: kit.name, version: kit.version, skill: name, state: event.state, origin: 'panel',
            ...(event.commit ? { commit: event.commit } : {}),
            panelYaml: skill.metadata.panelYaml, skillManifest: skill.metadata.skillManifest,
          } })
        }, validatorFromSchemaYaml(skill.metadata.schemaYaml), prepared, undefined, undefined, { eventId, kind: 'panel-save' })
        // Replay the earliest real edit on uncertain saves; audit-only commits
        // never become release authority merely because Git HEAD advanced.
        const releasedPanelRevision = authority?.panelStateRevision ?? (result.diff.trim() === '' ? undefined : result.commit)
        if (authority && releasedPanelRevision) {
          await handoffs.consume(journalId, { invocationId: authority.invocationId,
            pin: { invocationId: authority.invocationId, projectId: project.metadata.id,
              kitName: kit.name, kitVersion: kit.version, skillName: name, bundleVersion: skill.version,
              stateRevision: authority.stateRevision }, panelStateRevision: releasedPanelRevision })
        }
        pendingNotes.set(eventId, result.note)
        // The content publication is already durable. A delivery-metadata IO
        // error must not turn that success into a false "not saved" response.
        try { if (!notificationPrepared) throw Error('Notification metadata unavailable.'); await savedContinuation.saved(eventId, result.commit) }
        catch { return { commit: result.commit, notificationPersistence: 'unavailable' } }
        return { commit: result.commit }
      })
      saves.set(eventId, { payload, promise })
      try { return await promise } catch (error) { saves.delete(eventId); throw error }
    },
    async readArtifact({ path, revision }) {
      const content = revision === undefined || revision.startsWith('worktree:')
        ? await store.readWorktreeText(requireArtifact(path))
        : await store.readTextAt(revision, requireArtifact(path))
      return { found: content !== undefined, content: content ?? '' }
    },
    async readBinaryArtifact({ path, revision }) {
      const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf' }
      const mediaType = types[path?.split('.').pop()?.toLowerCase()]
      if (!mediaType) throw new Error('Unsupported binary preview format.')
      const bytes = revision === undefined || revision.startsWith('worktree:')
        ? await store.readWorktreeBytes(requireArtifact(path))
        : await store.readBytesAt(revision, requireArtifact(path), undefined, 10 * 1024 * 1024)
      if (bytes?.length > 10 * 1024 * 1024) throw new Error('Preview exceeds 10 MiB.')
      return { found: bytes !== undefined, mediaType, base64: bytes ? Buffer.from(bytes).toString('base64') : '', byteLength: bytes?.length ?? 0 }
    },
    async sendPrompt({ text, requestId, saved, studio, verifyStudio }) {
      await refreshAccess()
      if (typeof text !== 'string' || !text.trim()) throw new Error('Message is required.')
      if (/^\/(?:yugoo|design)(?:\s|$)/u.test(text)) throw new Error('Project management commands are not connected in this first companion slice. Use the bound project.')
      const kitHash = notificationKitHash()
      const attempt = await savedContinuation.begin({ text, requestId, saved: studio ? [] : saved, kitHash })
      if (attempt.prior) return attempt.prior
      const notes = []
      let result, dispatched = false
      try {
      for (const entry of attempt.entries) {
        const diff = entry.commit ? await store.diffCommit(entry.commit) : ''
        notes.push([entry.eventId, pendingNotes.get(entry.eventId) ?? buildPanelSaveNote(entry.skill, diff)])
      }
      // Resolve only when notifying: the server creates its private connection
      // file after opening the project. Never discover a latest/global binding.
      const connectionPath = getConnectionPath?.()
      const assessment = getMainAssessmentContext && attempt.entries.length ? await getMainAssessmentContext(attempt.entries) : undefined
      await refreshAccess()
      if (notificationKitHash() !== kitHash) throw Error('Project Kit changed before notification. Reopen the current project.')
      if (studio) {
        if (typeof verifyStudio !== 'function') throw Error('Studio context must be verified by the bound service.')
        await verifyStudio()
      }
      dispatched = true
      const studioPrompt = studio ? [
        'Studio Kit/Bundle customization in this exact main conversation. This request concerns reusable authoring source, not the running Design Project or its Design Files.',
        `Working-copy target: ${JSON.stringify({ id: studio.id, expectedRevision: studio.expectedRevision, kind: studio.kind, title: studio.title, ...(studio.bundle ? { bundle: studio.bundle } : {}) })}. Read this exact copy with design_studio_customize before proposing changes; a changed revision or preview pin requires reopening, never guessing another target. For a Kit, include the exact selected preview Bundle pin only when this request has one. Kit-owned source authoring may omit it; never select a first or latest mount to fill an absent pin.`,
        ...(studio.context ? [`Current editing intent: ${JSON.stringify(studio.context)}. This is editor focus, not additional file/save authority. Read the current saved file through the exact working-copy tools; preserve human edits and ask for clarification if their intended scope is unclear.`] : []),
        'Read the installed design-bundle-creator skill for Bundle changes or design-kit-creator for Kit changes; use design-skill-creator when revising professional methods and output contracts. These are authoring methods; the working copy\'s SKILL.md describes execution of that Bundle and is not a substitute. Read relevant saved methods/contracts through the exact working-copy file list instead of guessing paths. For Panel/component changes, use design-component and design_list_panel_components to discover the actual installed vocabulary, then its exact name with reference=contract/docs/examples for parameters and guidance. If a required tool or authoring method is unavailable, report that limit rather than inventing APIs or component parameters.',
        `Use design_studio_customize with action prepareChanges and top-level authoringRequestId ${JSON.stringify(attempt.requestId)} so the same S2 candidate can be reviewed in Studio. Preparation does not save. Save only when the user explicitly authorizes it, using the same request and digest through saveChanges. Do not publish, install, edit the running Design Files, launch a Bundle/GRA, or create another model/session.`,
        ...(connectionPath ? [`Exact Companion connection file: ${JSON.stringify(connectionPath)}. Pass only this path to the tool; never read or expose its contents or choose a latest connection.`] : []),
        'If the customization tool is unavailable in this host, report that limitation. Message acceptance is not proof that authoring or saving completed.',
        text,
      ] : undefined
      result = await connection.send(studioPrompt ? studioPrompt.join('\n\n') : [
        `Design Project: ${project.metadata.name}\nDesign Files: ${project.designFilesRoot}\nKit: ${project.metadata.kit ? `${project.metadata.kit.name}@${project.metadata.kit.version}` : 'not selected'}\nAccess: ${access.mode}`,
        ...(!access.writable ? ['Select an available Kit for an unconfigured project, or restore the exact pinned Kit for recovery. Do not start Bundle generation or reviews until workspace access is writable.'] : []),
        connection.host === 'workbuddy' && workbuddyProducer ? 'WorkBuddy supports serial foreground native Producers through its yugoo Skill bootstrap/register/resume sequence. Follow the exact declared Bundle execution mode. Workers remain unsupported; GRA follows the shared execution choice, not Bundle placement. Do not launch replacement models.' : connection.host === 'workbuddy' ? 'WorkBuddy adapter currently supports explicitly main-mode Bundles only. Native Producer/Worker execution is unavailable; do not launch replacements or change Bundle execution mode. Use the exact connection for main Bundle prepare/begin/finish and saved-state readback. GRA follows the separate shared execution choice.' : connection.host === 'qwenwork' ? 'Follow the QwenWork native-execution reference for the declared foreground Bundle path and GRA. Read this exact connection\'s design_status.hostCapabilities and reviewPolicy; only current ready capability and an authorized dispatch reference permit a background launch.' : 'Use the Design Panel plugin native-execution reference for Bundle work: native Producer/Worker subagents, not DSH-only tool names. GRA is never a prerequisite for foreground design work.',
        'If background GRA is unavailable or occupies this Host\'s main conversation, offer the user a choice: turn off automatic GRA while retaining manual checks, or accept this manual synchronous check here with a warning that it temporarily occupies the conversation. Until the user chooses, keep requests and policy unchanged. For explicit synchronous acceptance, follow design_recheck_reviews with executionMode="foreground" in the shared reference; do not require a native child or background proof. Manual checks remain available while automatic GRA is off. Never run synchronous GRA automatically.',
        ...notes.map(([, note]) => note),
        ...(assessment ? [assessment] : []),
        ...(connectionPath ? [
          `Exact Companion connection file: ${JSON.stringify(connectionPath)}. Pass the path only; do not read, print, or copy its token or file contents. Never search for a latest/global connection.`,
          ...(statusEntryPath ? [`If design_status is not available in this host, use the existing installed CLI: node ${JSON.stringify(statusEntryPath)} call --connection ${JSON.stringify(connectionPath)} --request /absolute/temporary-status-request.json. The temporary request must contain {"method":"readWorkspace","params":{}}; inspect reviews and reviewPolicy once. Do not install tools or scan unrelated connections.`] : []),
        ] : []),
        ...(notes.length ? [...(assessment ? [] : [DESIGN_PANEL_SAVE_ASSESSMENT_GUIDANCE]), 'After this Panel save, read design_status once. Complete planned edits before preparing a manual review batch. A due review is not an instruction to start another review or repeatedly ask for consent. Follow the native-execution reference and the user\'s execution choice; do not wait for background GRA, busy-poll, or automatically retry failed reviews.'] : []),
        'Read the current Design Files when this notification has no save diff (for example after restarting the companion). File bytes are authoritative; do not reapply already saved edits.',
        text,
      ].join('\n\n'), { requestId: attempt.requestId, saved: attempt.entries.map(({ eventId, commit }) => ({ eventId, commit })) })
      } catch (error) {
        await savedContinuation.settle(attempt.requestId, { accepted: false, status: 'unknown', notSubmitted: !dispatched || error?.notSubmitted === true })
        throw error
      }
      await savedContinuation.settle(attempt.requestId, result)
      // A native transport may return held/refused/unknown without throwing.
      // Explicit queue acceptance retires this pending note, not an Agent turn.
      if (result?.accepted === true) {
        for (const [id, note] of notes) if (pendingNotes.get(id) === note) pendingNotes.delete(id)
      }
      return result
    },
    async listSkills() {
      await refreshAccess()
      return { mindset: access.writable ? kit.name : undefined,
        mindsetMethod: access.writable ? kit.sourceLocation?.mindsetPath ?? join(kit.sourceRoot ?? kitRoot, 'mindset.md') : undefined,
        skills: (access.writable ? kit.skills : []).map(skill => ({ id: skill.name, description: skill.description,
          manifest: skill.metadata.skillManifest, execution: { ...skill.execution, mode: skill.execution.mode ?? 'subagent' } })) }
    },
    async listProjects() {
      await refreshAccess()
      return { currentProjectId: project.metadata.id, projects: [{ projectId: project.metadata.id, name: project.metadata.name, root: project.root, updatedAt: project.metadata.createdAt, kit: project.metadata.kit }], mindsets: [{ name: kit.name, version: kit.version }] }
    },
  }
  return api
}
