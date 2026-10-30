/** Bind native child threads to design targets. This module never starts an agent. */
import { open, mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createCodexTranscript, executionRowMessage } from './codex-transcript.mjs'
import { requireThreadId } from './codex-connection.mjs'
import { bindNativeProject } from './native-project-binding.mjs'
import { requireNativeId, nativeScope, nativeInvocationId } from './native-identity.mjs'
import { DesignWriteSettlementError, projectKitContentHash } from '../../core/lib/index.js'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')

function committedRecovery(error) {
  if (!(error instanceof DesignWriteSettlementError) || !error.result.commit) throw error
  return recoveryReceipt(error.result, error.result.recovery)
}

function recoveryReceipt(settlement, recovery) {
  return { accepted: false, committed: true, settlement,
    recovery: { ...recovery, action: 'retry-same-finish-once',
      instruction: 'Content is already committed. Retry the exact same finish once; do not rewrite files, change Git configuration or remove an index lock. If it still fails, report this receipt.' } }
}

async function metadata(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    if (!(await file.stat()).isFile()) throw new Error('Native transcript must be a regular file.')
    const bytes = Buffer.alloc(65536)
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
    const end = bytes.subarray(0, bytesRead).indexOf(10)
    if (end < 0) throw new Error('Native transcript metadata is not ready.')
    const event = JSON.parse(bytes.subarray(0, end).toString('utf8'))
    if (event.type !== 'session_meta') throw new Error('Native transcript has no session identity.')
    return event.payload
  } finally { await file.close() }
}

export async function verifyNativeChild({ runId, parentRunId, transcriptPath, projectRoot }) {
  requireThreadId(runId); requireThreadId(parentRunId)
  const meta = await metadata(transcriptPath)
  if (meta.id !== runId || meta.source?.subagent?.thread_spawn?.parent_thread_id !== parentRunId) throw new Error('Native parent/child identity does not match.')
  const log = await createCodexTranscript({ path: transcriptPath, threadId: runId, projectRoot, parentRunId }).read()
  if (!log.available) throw new Error(log.error ?? 'Native child metadata not ready.')
  return log
}

export async function createNativeRuns({ project, stateRoot, threadId, nativeCwd = project.project.root,
  host = 'codex', createObserver = createCodexTranscript, verifyChild = verifyNativeChild, readMainTranscript }) {
  requireThreadId(threadId)
  const directory = join(stateRoot, project.project.metadata.id, 'native-bindings', nativeScope(host, threadId))
  const path = join(directory, 'bindings.json')
  const mainPath = join(directory, 'main-invocations.json')
  let mainInvocations = []
  try { mainInvocations = JSON.parse(await readFile(mainPath, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!Array.isArray(mainInvocations)) throw new Error('Invalid main Bundle invocations.')
  let bindings = []
  try { bindings = JSON.parse(await readFile(path, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!Array.isArray(bindings)) throw new Error('Invalid native bindings.')
  for (const binding of bindings) await bindNativeProject({ stateRoot, runId: binding.runId, projectId: project.project.metadata.id, host, sessionId: threadId })
  const observers = new Map()
  const receipts = new Map()
  let tail = Promise.resolve(), revision = 0, lastProjection = ''
  const serial = operation => {
    const result = tail.then(operation)
    tail = result.catch(() => {})
    return result
  }
  const nextExecutionSequence = () => Math.max(0, ...mainInvocations.map(item => item.executionSequence ?? 0), ...bindings.map(item => item.executionSequence ?? 0)) + 1
  const persist = async next => {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temporary = join(directory, `${randomUUID()}.tmp`)
    await writeFile(temporary, JSON.stringify(next), { mode: 0o600 })
    await rename(temporary, path)
    bindings = next
  }
  const persistMain = async next => {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temporary = join(directory, `${randomUUID()}.tmp`)
    await writeFile(temporary, JSON.stringify(next), { mode: 0o600 })
    await rename(temporary, mainPath)
    mainInvocations = next
  }
  const mainFor = id => {
    const invocation = mainInvocations.find(item => item.invocationId === id)
    if (!invocation) throw new Error('Unknown main Bundle invocation in this conversation.')
    return invocation
  }
  const skillFor = name => {
    const skill = project.kit.skills.find(skill => skill.name === name)
    if (!skill) throw new Error('Unknown Bundle in the pinned Kit.')
    return skill
  }
  const definitionRevision = () => project.definitionRevision ?? projectKitContentHash(project.kit)
  const observer = binding => {
    if (!observers.has(binding.runId)) observers.set(binding.runId, createObserver({
      path: binding.transcriptPath, threadId: binding.runId, projectRoot: nativeCwd,
      parentRunId: binding.parentRunId, taskPath: binding.taskPath,
    }))
    return observers.get(binding.runId)
  }
  const bindingFor = id => {
    const binding = bindings.find(item => item.runId === id)
    if (!binding) throw new Error('Unknown native run in this project and conversation.')
    return binding
  }
  const ownerLog = owner => owner.mode === 'main'
    ? readMainTranscript?.() ?? Promise.resolve({ available: false, rows: [], omitted: 0, recordedStatus: 'unknown' })
    : observer(owner).read()
  const targetOf = segment => ({ artifactId: segment.artifactId, artifactKind: segment.artifactKind, artifactFile: segment.artifactFile })
  const logCursor = log => (log.omitted ?? 0) + log.rows.length
  const nextFocusSequence = () => Math.max(bindings.length, 0, ...[...bindings, ...mainInvocations]
    .flatMap(owner => (owner.artifactFocusSegments ?? []).map(segment => segment.sequence))) + 1
  const segmentsAvailable = (owner, log, segments) => {
    if (!log.available || log.threadId !== (owner.mode === 'main' ? threadId : owner.runId)) return false
    const first = log.omitted ?? 0, total = logCursor(log)
    return segments.every(segment => {
      if (segment.startSeq > total + 1) return false
      const anchor = segment.anchor
      return !anchor || anchor.seq <= first || (log.rows[anchor.seq - first - 1]?.id === anchor.id
        && log.rows[anchor.seq - first - 1]?.timestamp === anchor.timestamp)
    })
  }
  const closeFocus = async owner => {
    const segments = owner.artifactFocusSegments
    if (!segments?.length) return {}
    const log = await ownerLog(owner)
    return { artifactFocusSegments: segments.map((segment, index) => index === segments.length - 1 && segment.endSeq === undefined
      ? { ...segment, endSeq: log.available ? logCursor(log) : segment.startSeq - 1 } : segment) }
  }
  const focusProjection = (owner, log) => {
    const segments = owner.artifactFocusSegments ?? []
    const ids = [...new Set(segments.map(segment => segment.artifactId))]
    return ids.map(artifactId => {
      const index = segments.findLastIndex(segment => segment.artifactId === artifactId)
      const segment = segments[index]
      const available = segmentsAvailable(owner, log, segments.filter(item => item.artifactId === artifactId))
      return { ...targetOf(segment), executor: owner.mode === 'main' ? 'main' : 'producer',
        projectId: project.project.metadata.id, skill: owner.skill, invocationId: owner.invocationId,
        runId: owner.mode === 'main' ? owner.mainThreadId : owner.runId,
        sequence: segment.sequence, active: !owner.finished && index === segments.length - 1,
        available, nativeStatus: available ? log.recordedStatus : 'unknown',
        logTarget: { artifactId, ...(owner.mode === 'main' ? { invocationId: owner.invocationId } : {}) } }
    })
  }
  return {
    // Read-only trial observation; settlement and host liveness stay separate facts.
    getTrialBindings(skill) {
      return [...mainInvocations, ...bindings.filter(item => item.role === 'producer')]
        .filter(item => item.skill === skill).map(item => ({
          mode: item.mode ?? 'subagent', runId: item.runId, invocationId: item.invocationId,
          finished: item.finished === true, settledOutcome: item.settledOutcome,
          executionSequence: item.executionSequence,
        }))
    },
    getMainInvocation(invocationId) { return { ...mainFor(invocationId) } },
    async beginMainBundle({ skill }) {
      return serial(async () => {
        await project.requireWritable()
        if (skillFor(skill).execution.mode !== 'main') throw new Error('This Bundle requires a native Producer.')
        const active = mainInvocations.find(item => !item.finished)
        if (active) {
          if (active.skill !== skill) throw new Error('Settle the active main Bundle before starting another.')
          return { ...active }
        }
        const activeProducer = bindings.find(item => item.role === 'producer' && !item.finished && item.skill === skill)
        if (activeProducer) throw new Error('Settle the active native Producer for this Bundle before starting a main Bundle.')
        const invocation = { invocationId: randomUUID(), skill, mainThreadId: threadId,
          executionSequence: nextExecutionSequence(),
          projectId: project.project.metadata.id, mode: 'main',
          kit: project.kit.name, kitVersion: project.kit.version,
          bundleVersion: skillFor(skill).version, definitionRevision: definitionRevision() }
        await persistMain([...mainInvocations, invocation])
        return { ...invocation }
      })
    },
    async focusArtifact({ runId, invocationId, artifactKind, artifactId, artifactFile }) {
      return serial(async () => {
        await project.requireWritable()
        if (!!runId === !!invocationId) throw new Error('Supply exactly one native Producer runId or main invocationId.')
        const owner = invocationId ? mainFor(invocationId) : bindingFor(runId)
        if (owner.finished) throw new Error('Cannot focus a settled Bundle invocation.')
        if (!invocationId && owner.role !== 'producer') throw new Error('Only the actual native Producer can focus serial artifacts.')
        if (owner.mode === 'main' && owner.mainThreadId !== threadId) throw new Error('Main invocation belongs to another conversation.')
        if (owner.projectId !== project.project.metadata.id) throw new Error('Invocation belongs to another Design Project.')
        skillFor(owner.skill)
        const target = { artifactKind: artifactKind?.trim(), artifactId: artifactId?.trim(), artifactFile: artifactFile?.trim() }
        if (!target.artifactKind || !target.artifactId || !target.artifactFile) throw new Error('Explicit non-empty artifact kind, stable ID and file are required.')
        if (!target.artifactFile.startsWith(`${owner.skill}/`) || target.artifactFile === `${owner.skill}/${owner.skill}.json`) throw new Error('Artifact must belong to the invocation Bundle, not canonical JSON.')
        await project.store.readWorktreeBytes(target.artifactFile) // Existing Core traversal/symlink confinement, before creation too.
        const segments = owner.artifactFocusSegments ?? []
        for (const previous of segments) {
          if (previous.artifactId === target.artifactId && (previous.artifactFile !== target.artifactFile || previous.artifactKind !== target.artifactKind)
            || previous.artifactFile === target.artifactFile && previous.artifactId !== target.artifactId) throw new Error('Stable artifact identity cannot be rebound to another path or kind.')
        }
        const log = await ownerLog(owner)
        if (!log.available || log.threadId !== (owner.mode === 'main' ? threadId : owner.runId)) throw new Error('Exact native execution transcript is unavailable.')
        if (owner.mode !== 'main' && ['completed', 'failed', 'interrupted'].includes(log.recordedStatus)) throw new Error('Native Producer has ended; cannot focus another artifact.')
        const current = segments.at(-1)
        const cursor = logCursor(log)
        if (current && !segmentsAvailable(owner, log, segments)) throw new Error('Native log cursor changed; cannot retain artifact focus association.')
        if (current?.artifactId !== target.artifactId) {
          const row = log.rows.at(-1)
          const next = [...segments.map((segment, index) => index === segments.length - 1 ? { ...segment, endSeq: cursor } : segment),
            { ...target, startSeq: cursor + 1, sequence: nextFocusSequence(),
              ...(row ? { anchor: { seq: cursor, id: row.id, timestamp: row.timestamp } } : {}) }]
          const updated = { ...owner, artifactFocusSegments: next }
          if (invocationId) await persistMain(mainInvocations.map(item => item.invocationId === invocationId ? updated : item))
          else await persist(bindings.map(item => item.runId === runId ? updated : item))
        }
        return { artifact_id: target.artifactId, focused: true, invocationId: owner.invocationId,
          runId: owner.mode === 'main' ? threadId : owner.runId }
      })
    },
    async finishMainBundle({ invocationId, scope = 'completion', outcome }) {
      return serial(async () => {
        await project.requireWritable()
        const invocation = mainFor(invocationId)
        if (invocation.finished) {
          if (invocation.settledScope !== scope || invocation.settledOutcome !== (outcome ?? (scope === 'state' ? 'pause' : 'complete'))) throw new Error('Main invocation already settled with another outcome.')
          return { accepted: true, settlement: invocation.settlement }
        }
        if (!['state', 'completion'].includes(scope) || outcome !== undefined && !['complete', 'pause', 'failed', 'cancelled', 'no-progress'].includes(outcome)) throw new Error('Invalid main settlement.')
        if (outcome === 'complete' && scope !== 'completion' || outcome === 'pause' && scope !== 'state') throw new Error('Settlement outcome does not match validation scope.')
        for (const child of bindings.filter(item => item.invocationId === invocationId)) {
          const log = await observer(child).read()
          if (!log.available || !['completed', 'failed', 'interrupted'].includes(log.recordedStatus)) throw new Error('Main Bundle still has an active or unobservable Worker; wait or cancel it before settlement.')
        }
        let settlement
        try { settlement = await project.settleBundle({ skill: invocation.skill, invocationId, scope, outcome, definitionRevision: invocation.definitionRevision }) }
        catch (error) { return committedRecovery(error) }
        try {
          const closedFocus = await closeFocus(invocation)
          await persistMain(mainInvocations.map(item => item.invocationId === invocationId ? { ...item, ...closedFocus, finished: true, settlement,
            settledScope: scope, settledOutcome: outcome ?? (scope === 'state' ? 'pause' : 'complete') } : item))
        } catch (error) {
          if (!settlement.commit) throw error
          return recoveryReceipt(settlement, { stage: 'host-binding', state: 'pending', message: String(error.message ?? error).slice(0, 2048) })
        }
        return { accepted: true, settlement }
      })
    },
    getBinding(runId) {
      const binding = bindingFor(runId)
      return { ...binding }
    },
    async registerNativeRun(input) {
      return serial(async () => {
        await project.requireWritable()
        const { runId, parentRunId, transcriptPath, role, skill, artifactId, artifactKind, artifactFile, taskPath } = input
        requireNativeId(host,runId); requireNativeId(host,parentRunId); skillFor(skill)
        if (!['producer', 'worker'].includes(role) || typeof artifactId !== 'string' || !artifactId.trim()) throw new Error('A producer/worker role and stable artifact ID are required.')
        const main = role === 'worker' && parentRunId === threadId && input.invocationId ? mainFor(input.invocationId) : undefined
        if (main && (main.finished || main.skill !== skill)) throw new Error('Worker must belong to the exact active main Bundle.')
        const parent = role === 'worker' && !main ? bindingFor(parentRunId) : undefined
        if (input.invocationId !== undefined && !main) throw new Error('An explicit invocationId is only for a Worker of the main Agent.')
        if (role === 'producer' && skillFor(skill).execution.mode === 'main') throw new Error('This Bundle executes in the main conversation, not a Producer child.')
        if (role === 'producer' && mainInvocations.some(item => !item.finished && item.skill === skill)) throw new Error('Settle the active main Bundle of this skill before starting a native Producer.')
        if (role === 'producer' && parentRunId !== threadId) throw new Error('Producer must be a child of the bound main conversation.')
        if (parent && (parent.role !== 'producer' || parent.skill !== skill)) throw new Error('Worker must belong to this Bundle Producer.')
        if (role === 'worker' && (typeof artifactFile !== 'string' || !artifactFile.startsWith(`${skill}/`) || artifactFile === `${skill}/${skill}.json`)) throw new Error('Worker requires an exact Bundle-owned artifact path, not canonical JSON.')
        if (artifactFile) await project.store.readWorktreeBytes(artifactFile) // Core path confinement, even before creation.
        await verifyChild({ runId, parentRunId, transcriptPath, taskPath, projectRoot: nativeCwd })
        const existing = bindings.find(item => item.runId === runId)
        const next = { runId, parentRunId, transcriptPath, role, skill, artifactId,
          ...(['qoder', 'qwenwork'].includes(host) ? { taskPath } : {}),
          ...(artifactKind ? { artifactKind } : {}), ...(artifactFile ? { artifactFile } : {}),
          invocationId: main?.invocationId ?? parent?.invocationId ?? nativeInvocationId(host, threadId, runId), attemptId: runId,
          projectId: project.project.metadata.id,
          definitionRevision: existing?.definitionRevision ?? main?.definitionRevision ?? parent?.definitionRevision ?? definitionRevision(),
        }
        if (existing) {
          for (const [key, value] of Object.entries(next)) if (existing[key] !== value) throw new Error('Native run cannot be rebound to another target.')
          return { registered: true, runId }
        }
        if (parent?.finished) throw new Error('Worker must belong to this active Bundle Producer; a finished Producer cannot accept new Workers.')
        const log = await observer(next).read()
        if (!log.available) { observers.delete(runId); throw new Error(log.error ?? 'Native transcript identity not ready.') }
        await bindNativeProject({ stateRoot, runId, projectId: project.project.metadata.id, host, sessionId: threadId })
        next.executionSequence = nextExecutionSequence()
        await persist([...bindings, next])
        return { registered: true, runId }
      })
    },
    async finishNativeRun({ runId, scope = 'completion', outcome }) {
      return serial(async () => {
        await project.requireWritable()
        const binding = bindingFor(runId)
        if (!['state', 'completion'].includes(scope)) throw new Error('Invalid validation scope.')
        if (outcome !== undefined && !['complete', 'pause', 'failed', 'cancelled', 'no-progress'].includes(outcome)) throw new Error('Invalid settlement outcome.')
        if (outcome === 'complete' && scope !== 'completion' || outcome === 'pause' && scope !== 'state') throw new Error('Settlement outcome does not match validation scope.')
        if (binding.role === 'producer' && binding.finished && binding.settlement) {
          if (binding.settledScope !== scope || binding.settledOutcome !== (outcome ?? (scope === 'state' ? 'pause' : 'complete'))) throw new Error('Native run already settled with another outcome.')
          return { accepted: true, settlement: binding.settlement }
        }
        if (binding.role === 'producer') {
          for (const child of bindings.filter(item => item.role === 'worker' && item.parentRunId === runId)) {
            const log = await observer(child).read()
            if (!log.available || !['completed', 'failed', 'interrupted'].includes(log.recordedStatus)) throw new Error('Native Producer still has an active or unobservable Worker; wait or cancel it before settlement.')
          }
        }
        let receipt
        if (binding.role === 'worker') {
          const bytes = await project.store.readWorktreeBytes(binding.artifactFile)
          if (!bytes?.length) throw new Error('Referenced artifact is missing or empty. Repair it before finishing.')
          receipt = { path: binding.artifactFile, sha256: digest(bytes), bytes: bytes.length }
        }
        let settlement
        try { settlement = binding.role === 'producer' ? await project.settleBundle({ skill: binding.skill, invocationId: binding.invocationId, scope, outcome, definitionRevision: binding.definitionRevision }) : undefined }
        catch (error) { return committedRecovery(error) }
        try {
          const closedFocus = await closeFocus(binding)
          await persist(bindings.map(item => item.runId === runId ? { ...item, ...closedFocus, finished: true, settledScope: scope,
            settledOutcome: outcome ?? (scope === 'state' ? 'pause' : 'complete'), ...(receipt ? { receipt } : {}), ...(settlement ? { settlement } : {}) } : item))
        } catch (error) {
          if (!settlement?.commit) throw error
          return recoveryReceipt(settlement, { stage: 'host-binding', state: 'pending', message: String(error.message ?? error).slice(0, 2048) })
        }
        // This is a file receipt, never an assertion that the native agent has stopped.
        return { accepted: true, ...(receipt ? { receipt } : {}), ...(settlement ? { settlement } : {}) }
      })
    },
    readConversationScope() {
      // Role/binding evidence only. An unclosed invocation conservatively keeps
      // foreground presentation; this does not assert that its agent is live.
      return {
        foregroundRunIds: bindings.map(binding => binding.runId),
        foregroundActive: bindings.some(binding => !binding.finished)
          || mainInvocations.some(invocation => !invocation.finished),
      }
    },
    async read(workspace) {
      const attempts = await Promise.all(bindings.map(async (binding, index) => {
        const log = await observer(binding).read()
        const diagnostics = []
        let phase = 'queued'
        if (log.available && log.recordedStatus === 'running') phase = 'working'
        else if (log.available && log.recordedStatus === 'interrupted') phase = 'cancelled'
        else if (log.available && log.recordedStatus === 'failed') phase = 'failed'
        else if (log.available && log.recordedStatus === 'completed') {
          // Native completion does not depend on the agent remembering a finish
          // call. The published file remains a separate availability fact.
          phase = 'completed'
        } else diagnostics.push('Native execution status is unavailable; no completion inferred.')
        let receipt = binding.receipt ?? receipts.get(binding.runId)
        if (binding.role === 'worker' && phase === 'completed' && !receipt) {
          const bytes = await project.store.readWorktreeBytes(binding.artifactFile)
          if (bytes?.length) {
            receipt = { path: binding.artifactFile, sha256: digest(bytes), bytes: bytes.length }
            receipts.set(binding.runId, receipt)
          }
          else { phase = 'failed'; diagnostics.push('Native worker ended but its artifact is missing or empty.') }
        }
        if (receipt) {
          const actualDigest = workspace?.artifactFiles
            ? workspace.artifactFiles[receipt.path]
            : await project.store.readWorktreeBytes(receipt.path).then(bytes => bytes && digest(bytes))
          if (actualDigest !== receipt.sha256) {
            receipt = undefined
            if (phase === 'completed') { phase = 'failed'; diagnostics.push('Artifact changed or disappeared after receipt.') }
          }
        }
        if (phase === 'completed' && binding.role === 'producer' && workspace && !workspace.design[binding.skill]) {
          phase = 'failed'; diagnostics.push('Native producer ended without readable canonical Design JSON.')
        }
        const { transcriptPath, finished, artifactFocusSegments, ...visible } = binding
        return { ...visible, receipt, phase, diagnostics, sequence: index + 1,
          timestamp: Date.parse(log.lastEventAt ?? '') || 0 }
      }))
      const artifactActivities = (await Promise.all([...bindings.filter(binding => binding.role === 'producer'), ...mainInvocations]
        .filter(owner => owner.artifactFocusSegments?.length).map(async owner => focusProjection(owner, await ownerLog(owner))))).flat()
      const encoded = JSON.stringify([attempts, mainInvocations, artifactActivities])
      if (encoded !== lastProjection) { revision++; lastProjection = encoded }
      return { executionAttempts: attempts, artifactActivities, executionRevision: revision,
        activeMainBundles: mainInvocations.filter(item => !item.finished).map(item => ({ skill: item.skill, invocationId: item.invocationId })) }
    },
    async readExecutionLog({ runId, invocationId, artifactId }) {
      const owner = invocationId ? mainFor(invocationId) : bindingFor(runId)
      if (invocationId && runId !== undefined && runId !== owner.mainThreadId) throw new Error('Native main log does not match the invocation conversation.')
      const log = await ownerLog(owner)
      const segments = owner.artifactFocusSegments ?? []
      const target = artifactId
      if (invocationId && target === undefined) throw new Error('A main execution log requires its exact focused artifact target.')
      const selected = target === undefined ? [] : segments.filter(segment => segment.artifactId === target)
      if (target !== undefined && !selected.length) throw new Error('Artifact has no focus association in this invocation.')
      const first = log.omitted ?? 0, total = logCursor(log)
      const valid = segmentsAvailable(owner, log, selected)
      const entries = valid ? log.rows.flatMap((row, index) => {
        const seq = first + index + 1
        if (target !== undefined && !selected.some(segment => seq >= segment.startSeq && (segment.endSeq === undefined || seq <= segment.endSeq))) return []
        return [{ seq, timestamp: Date.parse(row.timestamp ?? '') || 0,
          eventType: row.role === 'tool' ? 'synthesize' : 'message', message: executionRowMessage(row) }]
      }) : []
      return { found: valid, revision: log.lastEventAt ?? null, reset: true, entries,
        ...(target === undefined ? {} : { association: { ...targetOf(selected[0]), invocationId: owner.invocationId,
          runId: owner.mode === 'main' ? owner.mainThreadId : owner.runId,
          executor: owner.mode === 'main' ? 'main' : 'producer',
          segments: selected.map(({ startSeq, endSeq }) => ({ startSeq, ...(endSeq === undefined ? {} : { endSeq }) })),
          truncated: selected.some(segment => segment.startSeq <= first) } }) }
    },
  }
}
