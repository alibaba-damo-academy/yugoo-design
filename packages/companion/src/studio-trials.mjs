/** Isolated Studio trials over existing project, snapshot and native transport ports. */
import { mkdir, lstat, realpath, readFile, writeFile, rename, readdir, rm, rmdir } from 'node:fs/promises'
import { resolve, relative, join, sep, isAbsolute } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { DesignProjectManager } from '../../core/lib/index.js'
import { loadStudioKit } from '../../studio/src/load.ts'
import { createStudioDraftPorts } from './studio-panel-drafts.mjs'
import { companionFs } from './project.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const inside = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) }
const terminal = new Set(['completed', 'failed', 'stopped'])
const pin = value => value && typeof value.name === 'string' && /^[a-z][a-z0-9_]*$/.test(value.name)
  && typeof value.version === 'string' && value.version.length > 0 && value.version.length <= 128
const validTask = task => typeof task === 'string' && !!task.trim() && Buffer.byteLength(task) <= 32 * 1024
const validLocale = locale => locale === undefined || locale === 'zh-CN' || locale === 'en-US'
const sourceIdentity = source => JSON.stringify([source.kind, source.kit.name, source.kit.version, source.bundle.name, source.bundle.version, source.id ?? null, source.expectedRevision ?? null])

/** Trusted child-service binding, not browser-selected identity or a new model client. */
export function createStudioTrialInputGate(binding) {
  return {
    async submit(params) {
      if (!binding || params?.trialId !== binding.id || Object.keys(params).some(key => !['trialId', 'task'].includes(key))) throw new Error('Input receipt requires the exact owned trial child.')
      if (binding.inputMode !== 'generated' || !validTask(params.task) || !params.task.includes(binding.bundle.name)) throw new Error('Generated input must be bounded and include the tested Bundle name.')
      return binding.submitInput(params.task)
    },
    async assertExecution(params) {
      if (!binding) return
      if (params?.skill !== binding.bundle.name) throw new Error('Only the bound trial Bundle may execute.')
      if (binding.inputMode === 'generated' && !validTask(await binding.readInput())) throw new Error('Record generated trial input before beginning or registering execution.')
    },
  }
}

export async function createStudioTrials({ stateRoot, kitRoot, readInstalledKit, readInstalledBundle, connection, startCompanion, parentOrigin,
  companionOptions = {}, readTrialEvidence, createProject = input => new DesignProjectManager().create(input) }) {
  if (!isAbsolute(stateRoot) || typeof connection?.send !== 'function' || typeof startCompanion !== 'function') throw new Error('Studio trial requires trusted storage and host ports.')
  const state = await realpath(stateRoot), installed = await realpath(kitRoot)
  if (state !== resolve(stateRoot) || inside(installed, state) || inside(state, installed)) throw new Error('Trial state must be canonical and separate from installed content.')
  const root = join(state, 'studio-trials')
  await mkdir(root, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error })
  if (!(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink()) throw new Error('Unsafe trial storage.')
  const live = new Map()
  const pathFor = id => { if (!UUID.test(id)) throw new Error('Invalid trial identity.'); return join(root, `${id}.json`) }
  const persist = async record => {
    const path = pathFor(record.id), temporary = join(root, `${randomUUID()}.tmp`)
    try { await writeFile(temporary, JSON.stringify(record), { flag: 'wx', mode: 0o600 }); await rename(temporary, path) }
    finally { await rm(temporary, { force: true }) }
    return record
  }
  const stored = async id => {
    const path = pathFor(id), info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) throw new Error('Invalid trial record.')
    const record = JSON.parse(await readFile(path, 'utf8'))
    if (record.id !== id || record.format !== 'studio-trial/v1' || !pin(record.source?.kit) || !pin(record.source?.bundle) || !validLocale(record.locale)) throw new Error('Invalid trial record.')
    return record
  }
  const updates = new Map()
  const updateRecord = async (id, change) => {
    const previous = updates.get(id) ?? Promise.resolve()
    const update = previous.catch(() => {}).then(async () => {
      const path = join(root, id, 'input.lock')
      try { await mkdir(path, { mode: 0o700 }) } catch (error) { if (error.code === 'EEXIST') throw new Error('Trial input receipt is already active.'); throw error }
      try { return await persist(await change(await stored(id))) } finally { await rmdir(path) }
    })
    updates.set(id, update)
    try { return await update } finally { if (updates.get(id) === update) updates.delete(id) }
  }
  const ids = async () => (await readdir(root)).filter(name => name.endsWith('.json') && UUID.test(name.slice(0, -5))).sort().map(name => name.slice(0, -5))
  const lock = async operation => {
    const path = join(root, 'operation.lock')
    try { await mkdir(path, { mode: 0o700 }) } catch (error) { if (error.code === 'EEXIST') throw new Error('Another trial operation is active.'); throw error }
    try { return await operation() } finally { await rmdir(path) }
  }
  const publicRecord = record => {
    const { id, source, createdAt, status, sourceLabel, projectLabel, resultUrl, message, task, inputMode, locale } = record
    return { id, source, createdAt, status, sourceLabel, projectLabel, inputMode: inputMode ?? 'manual', ...(locale !== undefined ? { locale } : {}), ...(task !== undefined ? { task } : {}), ...(resultUrl ? { resultUrl } : {}), ...(message ? { message } : {}) }
  }
  const readInternal = async id => {
    let record = await stored(id)
    if (record.dispatchAttempted && !record.terminalVerified) {
      // No output-file heuristic. Evidence must belong to this exact isolated trial.
      const companion = live.get(id)
      const evidenceReader = readTrialEvidence ?? (companion?.readTrialEvidence ? input => companion.readTrialEvidence(input) : undefined)
      let evidence
      try { evidence = await evidenceReader?.({ id, projectId: record.projectId, source: record.source,
        connectionPath: companion?.connectionPath, companion }) } catch { /* Unavailable evidence is unknown, not failed. */ }
      if (evidence && evidence.id === id && evidence.projectId === record.projectId
        && ['queued', 'running', 'waiting', 'completed', 'failed', 'stopped'].includes(evidence.status)) {
        const pendingInput = record.inputMode === 'generated' && !record.task && !['failed', 'stopped'].includes(evidence.status)
        record = { ...record, status: pendingInput ? 'preparing' : evidence.status, terminalVerified: !pendingInput && terminal.has(evidence.status), message: evidence.message }
      } else if (record.status !== 'preparing') record = { ...record, status: 'unknown', message: 'Native execution state is unverified. Do not resend or delete this trial.' }
    }
    if (!live.has(id) && record.resultUrl) record = { ...record, resultUrl: undefined, message: 'Trial retained; its prior Panel server is not owned by this service instance.' }
    return record
  }
  const read = async id => publicRecord(await readInternal(id))
  return {
    read,
    async list() { const all = await ids(); if (all.length > 100) throw new Error('Trial record limit exceeded.'); return Promise.all(all.map(read)) },
    async start(input) {
      const source = structuredClone(input?.source), task = input?.task, locale = input?.locale
      if (!validLocale(locale)) throw new Error('Trial locale must be zh-CN or en-US when supplied.')
      const inputMode = task === undefined ? 'generated' : 'manual'
      if (!source || !['installed', 'panel-draft'].includes(source.kind) || !pin(source.kit) || !pin(source.bundle)
        || Object.keys(source).some(key => !['kind', 'kit', 'bundle', 'id', 'expectedRevision'].includes(key))
        || (inputMode === 'manual' && !validTask(task))) throw new Error('Select an exact trial source and a bounded task.')
      if (source.kind === 'panel-draft' && (!UUID.test(source.id) || !Number.isSafeInteger(source.expectedRevision))) throw new Error('Select a saved draft revision.')
      return lock(async () => {
        const existing = await ids()
        if (existing.length >= 100) throw new Error('Trial limit reached; no active trial is evicted.')
        for (const previousId of existing) {
          const previous = await readInternal(previousId)
          if (sourceIdentity(previous.source) === sourceIdentity(source) && ['preparing', 'queued', 'running', 'unknown'].includes(previous.status)) throw new Error('This source has an active or unverified trial. Do not redispatch it.')
        }
        const { sources, repository } = await createStudioDraftPorts({ stateRoot: state, kitRoot: installed, readInstalledKit, readInstalledBundle }, 'panel')
        let draft, snapshot
        if (source.kind === 'panel-draft') {
          draft = await repository.read(source.id)
          if (draft.revision !== source.expectedRevision || JSON.stringify(draft.kit) !== JSON.stringify(source.kit)
            || JSON.stringify(draft.bundle) !== JSON.stringify(source.bundle)) throw new Error('Draft changed or source pin differs. Reopen before trial.')
          snapshot = await sources.open(draft.baseSnapshot)
        } else snapshot = await sources.capture(source.kit)
        const id = randomUUID(), directory = join(root, id)
        await mkdir(directory, { mode: 0o700 })
        let record = { format: 'studio-trial/v1', id, source, inputMode, ...(locale !== undefined ? { locale } : {}), ...(task !== undefined ? { task } : {}), createdAt: new Date().toISOString(), status: 'unknown',
          sourceLabel: `${source.kit.name}@${source.kit.version}/${source.bundle.name}@${source.bundle.version}`,
          projectLabel: `Studio trial ${id}`, dispatchAttempted: false, terminalVerified: false }
        await persist(record)
        let host
        try {
          const trialSources = join(directory, 'kit')
          const storageRoot = snapshot.storageRoot ?? snapshot.root
          const rebase = path => {
            if (!inside(storageRoot, path)) throw new Error('Trial source escapes retained closure.')
            return join(trialSources, relative(storageRoot, path))
          }
          const trialKit = rebase(snapshot.root)
          const loadOptions = snapshot.loadOptions ? { ...snapshot.loadOptions,
            bundles: snapshot.loadOptions.bundles?.map(bundle => ({ ...bundle, rootDir: rebase(bundle.rootDir) })) } : undefined
          await mkdir(trialSources, { mode: 0o700 })
          let total = 0, count = 0
          const copy = async (from, to) => {
            for (const name of await snapshot.fs.listDir(from)) {
              if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') throw new Error('Invalid snapshot path.')
              const inputPath = join(from, name), outputPath = join(to, name)
              if (await snapshot.fs.isDirectory(inputPath)) { await mkdir(outputPath, { mode: 0o700 }); await copy(inputPath, outputPath) }
              else {
                const bytes = await snapshot.fs.readBytes(inputPath)
                if (!bytes || ++count > 4096 || (total += bytes.length) > 16 * 1024 * 1024) throw new Error('Trial snapshot exceeds limits.')
                await writeFile(outputPath, bytes, { flag: 'wx', mode: 0o600 })
              }
            }
          }
          await copy(storageRoot, trialSources)
          const base = await loadStudioKit(companionFs, trialKit, loadOptions)
          if (draft) {
            const mounted = base.skills.find(skill => skill.name === source.bundle.name && String(skill.version) === source.bundle.version)
            if (!mounted) throw new Error('Trial source Bundle pin mismatch.')
            await writeFile(join(mounted.resourceRoot ?? join(trialKit, 'skills', source.bundle.name), 'panel.yaml'), draft.panelSource)
          }
          const compiled = draft ? await loadStudioKit(companionFs, trialKit, loadOptions) : base
          if (compiled.name !== source.kit.name || String(compiled.version) !== source.kit.version
            || !compiled.skills.some(skill => skill.name === source.bundle.name && String(skill.version) === source.bundle.version)) throw new Error('Trial source pin mismatch.')
          const snapshotId = createHash('sha256').update(JSON.stringify([snapshot.id, draft?.panelSource ?? null])).digest('hex')
          const project = await createProject({ root: join(directory, 'project'), name: record.projectLabel, kit: source.kit, knowledge: { provider: 'ladybug-wasm' } })
          record = { ...record, snapshotId, projectId: project.metadata.id }
          await persist(record)
          await mkdir(join(directory, 'runtime'), { mode: 0o700 })
          const trialInput = { id, bundle: source.bundle, inputMode, ...(locale !== undefined ? { locale } : {}),
            readInput: async () => (await stored(id)).task,
            submitInput: async generatedTask => {
              const saved = await updateRecord(id, current => {
                if (current.task !== undefined || current.inputMode !== 'generated' || !current.dispatchAttempted || current.terminalVerified) throw new Error('Trial input cannot be overwritten or submitted outside its active preparation.')
                return { ...current, task: generatedTask, status: 'queued', message: 'Generated input recorded; execution completion remains unverified.' }
              })
              return publicRecord(saved)
            } }
          host = await startCompanion({ ...companionOptions, studioTrial: true, port: 0, backgroundReviews: false,
            projectRoot: project.root, kitRoot: trialKit, stateRoot: join(directory, 'runtime'), connection, trialInput,
            ...(loadOptions ? { trustedContentSources: loadOptions } : {}),
            trialEmbedOrigin: parentOrigin })
          live.set(id, host)
          const url = new URL(host.url)
          if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.origin !== host.origin) throw new Error('Trial Panel must be an owned loopback server.')
          record = { ...record, resultUrl: host.url, dispatchAttempted: true }
          await persist(record) // A crash/unknown delivery must never become retryable failed.
          const instructions = inputMode === 'manual' ? `Use this exact user-edited input without generating replacement input:\n\n${task}`
            : `First read the Bundle method using design_prepare_bundle. Generate a concrete synthetic test input appropriate to that method, explicitly including the tested Bundle name ${source.bundle.name}. Do not use originating user-project content. Submit the actual input once with design_submit_trial_input({trialId:"${id}",task:<your generated input>}) using this exact child connection. Before a successful receipt, do not begin/register Bundle execution. After recording it, execute that exact input through the existing Bundle execution protocol in this same native turn. Do not queue a second prompt or create a model client.`
          const language = locale === undefined ? '' : `\n\nTrial output language: ${locale} (${locale === 'zh-CN' ? 'Simplified Chinese' : 'English'}). Use this language for generated test input and human-facing Panel content, including titles, descriptions, questions, option labels and generated explanatory artifacts. Preserve technical identifiers, schema keys, Bundle names, paths, version pins and code; do not translate them. Preserve user-edited task text verbatim rather than translating or generating replacement input. Carry this language contract into any native Producer/Worker delegation.`
          const receipt = await host.project.sendPrompt({ text: `Studio trial ${id}. Execute only Bundle ${source.bundle.name}@${source.bundle.version} in this isolated project, with this exact Companion binding. Do not change the originating project or installed content.${language}\n\n${instructions}` })
          // Serialize delivery bookkeeping with a fast native receipt; preserve actual input.
          record = await updateRecord(id, current => ({ ...current,
            status: receipt?.accepted === true ? inputMode === 'generated' && !current.task ? 'preparing' : 'queued' : 'unknown', message: 'Queue acceptance is not execution completion.' }))
          return publicRecord(record)
        } catch (error) {
          record = await updateRecord(id, current => ({ ...current, status: current.dispatchAttempted ? 'unknown' : 'failed', terminalVerified: !current.dispatchAttempted,
            message: current.dispatchAttempted ? 'Native delivery is unverified; no automatic retry.' : 'Trial preparation failed before native dispatch.' }))
          if (!record.dispatchAttempted) {
            try { await host?.close(); live.delete(id) }
            catch { record = { ...record, message: 'Preparation failed; owned Panel cleanup must be retried before removal.' }; await persist(record) }
          }
          return publicRecord(record)
        }
      })
    },
    async stop(id) { await stored(id); throw new Error('This host port does not support verified trial interruption. The trial remains retained; do not delete it.') },
    async remove(id) {
      return lock(async () => {
        const record = await readInternal(id)
        if (!terminal.has(record.status) || !record.terminalVerified) throw new Error('Active or unverified trials cannot be removed.')
        await live.get(id)?.close(); live.delete(id)
        const directory = join(root, id)
        if (await lstat(directory).then(info => info.isSymbolicLink())) throw new Error('Unsafe trial directory.')
        await rm(directory, { recursive: true }); await rm(pathFor(id))
        return { id, removed: true }
      })
    },
    async close() {
      const errors = []
      for (const [id, host] of live) {
        try { await host.close(); live.delete(id) } catch (error) { errors.push(error) }
      }
      if (errors.length) throw new AggregateError(errors, 'Some owned trial Panel servers could not be closed; native execution was not stopped.')
    },
  }
}
