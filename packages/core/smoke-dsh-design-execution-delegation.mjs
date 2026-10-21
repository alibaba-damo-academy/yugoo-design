/** Focused smoke for exact-path direct Worker artifact delegation. */
import assert from 'node:assert/strict'
import { createDshDesignDelegation, createDesignArtifactAttemptRegistry } from './lib/index.js'
import { delegatedArtifactIntegrationDiagnostics } from './lib/dsh-design-execution-plugin.js'
import { RECONSTRUCTION_EVIDENCE_METHOD, RECONSTRUCTION_CONVERSION_METHOD } from './src/reconstruction-prompt.ts'
import { DESIGN_WORKER_EVIDENCE_GUIDANCE } from './src/design-generation-guidance.ts'
import { KNOWLEDGE_AGENTIC_GUIDANCE } from './src/design-knowledge-query.ts'

const signal = new AbortController().signal
const tools = new Map()
const files = new Map()
const events = []
const starts = []
let childSequence = 0

const workspace = {
  async list() { return [...files.keys()] },
  async read(path) { return files.get(path) },
  async write(path, file) { files.set(path, Object.freeze({ ...file })) },
  async edit(path, oldText, newText, replaceAll) {
    const file = files.get(path)
    if (file?.encoding !== 'utf8') throw new Error('not UTF-8')
    const occurrences = file.content.split(oldText).length - 1
    if (occurrences === 0) throw new Error('old text not found')
    const content = replaceAll ? file.content.split(oldText).join(newText) : file.content.replace(oldText, newText)
    files.set(path, { encoding: 'utf8', content })
    return { replacements: replaceAll ? occurrences : 1 }
  },
}

const producer = { session: { id: 'producer' } }
const context = {
  tools: {
    register(definition) {
      tools.set(definition.name, definition)
      return () => tools.delete(definition.name)
    },
  },
}
let mode = 'write'
const delegation = createDshDesignDelegation({
  skillName: 'page_design',
  provider: 'local-worker',
  async startSubagent(_provider, request) {
    starts.push(request)
    if (mode === 'start-failure') throw new Error('worker failed to start')
    const index = ++childSequence
    const child = { session: { id: `child-${index}`, events: [] } }
    const prompt = request.prompt[0].text
    const assignmentId = prompt.match(/assignment_id "([^"]+)"/)?.[1]
    assert.equal(typeof assignmentId, 'string')
    return {
      id: child.session.id,
      localAgent: child,
      result: (async () => {
        if (mode === 'write') {
          const html = `<html>page-${index}-${'x'.repeat(40 * 1024)}</html>`
          await tools.get('design_worker_write_artifact').execute(
            { assignment_id: assignmentId, content: html },
            { agent: child, signal },
          )
          const read = await tools.get('design_worker_read_artifact').execute(
            { assignment_id: assignmentId },
            { agent: child, signal },
          )
          assert.equal(read.content, html)
        }
        return { stopReason: 'completed', output: [] }
      })(),
      async dispose() {},
    }
  },
  maxDepth: 2,
  maxTokens: 512,
  attempts: createDesignArtifactAttemptRegistry(),
  workspace,
  recordAttempt(event) { events.push(event) },
})
delegation.install(context)

const delegate = tools.get('design_delegate')
const delegateFrontier = tools.get('design_delegate_frontier')
assert.notEqual(delegate, undefined)
assert.notEqual(delegateFrontier, undefined)
assert.notEqual(tools.get('design_worker_write_artifact'), undefined)
assert.equal(delegate.parameters.type, 'object')
assert.deepEqual(Object.keys(delegate.parameters.properties), [
  'artifact_kind',
  'artifact_id',
  'artifact_file',
  'prompt',
])
assert.deepEqual(delegate.parameters.required, [
  'artifact_kind',
  'artifact_id',
  'artifact_file',
  'prompt',
])

const executeContext = { agent: producer, signal, concludeTurn() {} }
const [first, second] = await Promise.all([
  delegate.execute({ artifact_kind: 'page_html', artifact_id: 'a', artifact_file: 'page_design/pages/a.html', prompt: 'Author A.' }, executeContext),
  delegate.execute({ artifact_kind: 'page_html', artifact_id: 'b', artifact_file: 'page_design/pages/b.html', prompt: 'Author B.' }, executeContext),
])
assert.equal(starts.length, 2, 'independent assignments fan out as sibling Workers')
assert.equal(starts.every(request => request.outputSchema === undefined), true, 'file Workers do not use structured candidates')
// RC2's public scope composition replaced the retired patched-Host flag.
// Keep the restriction checks below; do not restore a private Host requirement.
assert.equal(starts.every(request => !Object.hasOwn(request, 'inheritParentAgentScope')), true)
assert.equal(starts.every(request => request.maxDepth === 2), true)
assert.equal(starts.every(request => request.toolFilter?.deny.includes('design_publish')), true)
assert.equal(starts.every(request => request.toolFilter?.deny.includes('write')), true)
assert.equal(starts.every(request => !request.toolFilter?.deny.includes('read')), true)
assert.equal(starts.every(request => !request.toolFilter?.deny.includes('read_image')), true)
assert.equal(starts.every(request => !request.toolFilter?.deny.includes('glob')), true)
assert.equal(starts.every(request => !request.toolFilter?.deny.includes('grep')), true)
assert.equal(starts.every(request => !request.toolFilter?.deny.includes('design_query_knowledge')), true)
assert.equal(starts.every(request => request.toolFilter?.deny.includes('design_delegate')), true)
assert.equal(starts.every(request => request.toolFilter?.deny.includes('design_delegate_frontier')), true)
assert.equal(starts.every(request => request.toolFilter?.deny.includes('delete')), true)
assert.equal(starts.every(request => request.toolFilter?.deny.includes('move')), true)
assert.equal(starts.every(request => request.toolFilter?.deny.includes('copy')), true)
assert.equal(starts.every(request => !request.prompt[0].text.includes('<reconstruction_assignment>')), true, 'ordinary page generation does not receive reconstruction-specific override')
assert.equal(starts.every(request => request.toolFilter?.deny.includes('design_restore_snapshot')), true)
assert.equal(starts.every(request => request.toolFilter?.deny.includes('read_design_file')), true)
assert.equal(starts.every(request => request.prompt[0].text.includes('design_worker_write_artifact')), true)
assert.equal(starts.every(request => request.prompt[0].text.includes('Host-native read-only workspace tools')), true)
assert.equal(starts.every(request => request.prompt[0].text.includes(DESIGN_WORKER_EVIDENCE_GUIDANCE)), true)
assert.equal(starts.every(request => request.prompt[0].text.includes(KNOWLEDGE_AGENTIC_GUIDANCE)), true)
assert.equal(starts.every(request => request.prompt[0].text.includes('Do not read or inspect executable script source before running it')), true)
assert.equal(starts.every(request => request.prompt[0].text.includes('write the complete artifact directly')), true)
assert.equal(starts.every(request => request.prompt[0].text.includes('Do not call design_worker_read_artifact merely to check whether a write was complete')), true)
assert.equal(starts.every(request => request.prompt[0].text.includes('"artifact_kind":"page_html"')), true)
assert.equal(files.get(first.artifact.path).content, `<html>page-1-${'x'.repeat(40 * 1024)}</html>`)
assert.equal(files.get(second.artifact.path).content, `<html>page-2-${'x'.repeat(40 * 1024)}</html>`)
assert.match(first.artifact.sha256, /^[a-f0-9]{64}$/)
for (const [skillName, artifactKind, artifactFile] of [
  ['page_design', 'page_html', 'page_design/pages/restored.html'],
  ['research', 'research_findings', 'research/R-001/restored.md'],
  ['flow_design', 'flow_bpmn', 'flow_design/restored.bpmn'],
]) {
  let received
  const reconstructionTools = new Map()
  const reconstructed = createDshDesignDelegation({
    skillName, reconstruct: true, provider: 'local-worker', maxDepth: 2,
    attempts: createDesignArtifactAttemptRegistry(), workspace, recordAttempt() {},
    async startSubagent(_provider, request) {
      received = request
      await workspace.write(artifactFile, { encoding: 'utf8', content: 'source-supported fixture bytes' })
      return { id: 'restored-worker', localAgent: { session: { id: 'restored-worker' } }, result: Promise.resolve({ stopReason: 'completed', output: [] }), async dispose() {} }
    },
  })
  reconstructed.install({ tools: { register(definition) { reconstructionTools.set(definition.name, definition) } } })
  await reconstructionTools.get('design_delegate').execute({ artifact_kind: artifactKind, artifact_id: 'restored', artifact_file: artifactFile, prompt: 'Generate a prototype using placeholder icons.' }, executeContext)
  const delivered = received.prompt[0].text
  assert.ok(delivered.includes(RECONSTRUCTION_CONVERSION_METHOD), `${skillName}: actual Worker gets conversion sequence, not only a no-redesign warning`)
  assert.ok(delivered.includes(RECONSTRUCTION_EVIDENCE_METHOD), `${skillName}: actual Worker assignment preserves source-authority distinctions`)
  assert.ok(delivered.indexOf('<reconstruction_assignment>') > delivered.indexOf('using placeholder icons'))
  assert.match(delivered, /Extract the supported content into the existing Bundle format/)
  assert.match(delivered, /Only for visual artifacts:/)
  assert.match(delivered, /Generated Style previews and other generated pages are interpretations, not source evidence/)
  assert.match(delivered, /Image-reader refusal means visual inspection failed, not that the asset is absent or cannot be copied/)
}
assert.deepEqual(
  events.filter(event => event.phase === 'working').map(event => event.artifactId).sort(),
  ['a', 'b'],
)

await assert.rejects(
  tools.get('design_worker_write_artifact').execute(
    { assignment_id: 'not-an-active-assignment', content: 'forbidden' },
    executeContext,
  ),
  /only to an active delegated Worker/,
)
assert.deepEqual(
  events.filter(event => event.phase === 'completed').map(event => event.receipt.path).sort(),
  ['page_design/pages/a.html', 'page_design/pages/b.html'],
)

mode = 'no-write'
await assert.rejects(
  delegate.execute({ artifact_kind: 'page_html', artifact_id: 'missing', artifact_file: 'page_design/pages/missing.html', prompt: 'Do not write.' }, executeContext),
  /completed without writing/,
)
assert.equal(events.some(event => event.artifactId === 'missing' && event.phase === 'failed'), true)

mode = 'start-failure'
await assert.rejects(
  delegate.execute({ artifact_kind: 'page_html', artifact_id: 'start-failure', artifact_file: 'page_design/pages/fail.html', prompt: 'Start.' }, executeContext),
  /worker failed to start/,
)
assert.equal(events.some(event => event.artifactId === 'start-failure' && event.phase === 'failed'), true)
assert.deepEqual(delegation.settlementDiagnostics(), [])

await assert.rejects(
  delegate.execute({ artifact_kind: 'page_html', artifact_id: 'outside', artifact_file: 'research/outside.html', prompt: 'Outside.' }, executeContext),
  /outside Bundle/,
)
await assert.rejects(
  delegate.execute({ artifact_kind: 'page_html', artifact_id: 'canonical', artifact_file: 'page_design/page_design.json', prompt: 'Canonical.' }, executeContext),
  /outside Bundle/,
)

// One Producer-level frontier call owns atomic preflight, bounded fanout,
// all-settled results, invocation-local idempotency, and cancellation.
{
  const frontierTools = new Map()
  const frontierFiles = new Map()
  const frontierEvents = []
  const frontierStarts = []
  const gates = new Map()
  let live = 0
  let peak = 0
  let cancelMode = false
  const frontierWorkspace = {
    async list() { return [...frontierFiles.keys()] },
    async read(path) { return frontierFiles.get(path) },
    async write(path, file) { frontierFiles.set(path, Object.freeze({ ...file })) },
    async edit() { throw new Error('not used') },
  }
  const batchDelegation = createDshDesignDelegation({
    skillName: 'research', provider: 'local-worker', maxDepth: 2, maxConcurrency: 2,
    attempts: createDesignArtifactAttemptRegistry(), workspace: frontierWorkspace,
    recordAttempt(event) { frontierEvents.push(event) },
    async startSubagent(_provider, request) {
      const descriptor = JSON.parse(request.prompt[0].text.match(/<delegation_artifact>\n(.+)\n<\/delegation_artifact>/)?.[1] ?? 'null')
      const itemId = descriptor.artifact_id
      const gate = Promise.withResolvers()
      gates.set(itemId, gate)
      frontierStarts.push(itemId)
      live += 1
      peak = Math.max(peak, live)
      if (cancelMode) request.signal.addEventListener('abort', () => gate.resolve('cancelled'), { once: true })
      const child = { session: { id: `frontier-${itemId}` } }
      return {
        id: child.session.id,
        localAgent: child,
        result: (async () => {
          try {
            const outcome = await gate.promise
            if (outcome === 'cancelled') return { stopReason: 'cancelled', output: [] }
            if (outcome === 'failed') return { stopReason: 'failed', diagnostic: `failed ${itemId}`, output: [] }
            await frontierWorkspace.write(descriptor.artifact_file, { encoding: 'utf8', content: `findings ${itemId}` })
            return { stopReason: 'completed', output: [] }
          } finally {
            live -= 1
          }
        })(),
        async dispose() {},
      }
    },
  })
  batchDelegation.install({ tools: { register(definition) { frontierTools.set(definition.name, definition) } } })
  const batch = frontierTools.get('design_delegate_frontier')
  const item = (id, file = `research/R-001/${id}.md`, prompt = `Research ${id}.`) => ({
    artifact_kind: 'research_direction', artifact_id: `R-001/${id}`, artifact_file: file, prompt,
  })
  const waitForStarts = async count => {
    for (let retry = 0; retry < 100 && frontierStarts.length < count; retry += 1) {
      await new Promise(resolve => setImmediate(resolve))
    }
    assert.equal(frontierStarts.length, count)
  }

  assert.deepEqual(Object.keys(batch.parameters.properties), ['batch_id', 'items'])
  const beforeInvalid = frontierStarts.length
  await assert.rejects(
    batch.execute({ batch_id: 'duplicate-id', items: [item('D-001'), item('D-001', 'research/R-001/other.md')] }, executeContext),
    /duplicate artifact_id/,
  )
  await assert.rejects(
    batch.execute({ batch_id: 'duplicate-path', items: [item('D-010'), item('D-011', 'research/R-001/D-010.md')] }, executeContext),
    /duplicate artifact_file/,
  )
  assert.equal(frontierStarts.length, beforeInvalid, 'atomic preflight starts no Worker on any invalid item')

  const frontierArgs = {
    batch_id: 'R-001-frontier-1',
    items: [item('D-001'), item('D-002'), item('D-003')],
  }
  const pendingFrontier = batch.execute(frontierArgs, executeContext)
  const concurrentReplay = batch.execute(frontierArgs, executeContext)
  await waitForStarts(2)
  assert.equal(peak, 2)
  assert.deepEqual(batchDelegation.settlementDiagnostics(), ['3 delegated Worker call(s) are still active'])
  gates.get('R-001/D-001').resolve('completed')
  await waitForStarts(3)
  gates.get('R-001/D-002').resolve('failed')
  gates.get('R-001/D-003').resolve('completed')
  const frontierResult = await pendingFrontier
  assert.deepEqual(await concurrentReplay, frontierResult)
  assert.deepEqual(frontierResult.items.map(entry => entry.artifact_id), frontierArgs.items.map(entry => entry.artifact_id))
  assert.deepEqual(frontierResult.items.map(entry => entry.status), ['completed', 'failed', 'completed'])
  assert.match(frontierResult.items[0].artifact.sha256, /^[a-f0-9]{64}$/)
  assert.equal(frontierResult.items[1].artifact, undefined)
  assert.match(frontierResult.items[1].diagnostic, /failed R-001\/D-002/)
  assert.equal(frontierStarts.filter(id => id === 'R-001/D-002').length, 1, 'failed work is not retried automatically')
  assert.deepEqual(batchDelegation.settlementDiagnostics(), [])

  const idempotent = await batch.execute(frontierArgs, executeContext)
  assert.deepEqual(idempotent, frontierResult)
  assert.equal(frontierStarts.length, 3, 'same batch id and items reuse the settled invocation-local promise')
  await assert.rejects(
    batch.execute({ ...frontierArgs, items: [item('D-001', undefined, 'Changed prompt.')] }, executeContext),
    /already used for different items/,
  )

  cancelMode = true
  const cancel = new AbortController()
  const cancelledArgs = {
    batch_id: 'R-001-frontier-cancel',
    items: [item('D-004'), item('D-005'), item('D-006'), item('D-007')],
  }
  const cancelledPending = batch.execute(cancelledArgs, { ...executeContext, signal: cancel.signal })
  await waitForStarts(5)
  gates.get('R-001/D-004').resolve('completed')
  await waitForStarts(6)
  cancel.abort()
  const cancelled = await cancelledPending
  assert.deepEqual(cancelled.items.map(entry => entry.status), ['completed', 'cancelled', 'cancelled', 'not_started'])
  assert.match(cancelled.items[0].artifact.sha256, /^[a-f0-9]{64}$/, 'receipt completed before cancellation is preserved')
  assert.equal(frontierStarts.includes('R-001/D-007'), false, 'queued work is not launched after parent cancellation')
  assert.equal(frontierEvents.some(event => event.artifactId === 'R-001/D-007' && event.phase === 'cancelled'), true)
  assert.deepEqual(batchDelegation.settlementDiagnostics(), [])
}

const landedPath = 'research/R-001/D-001.md'
const receipt = { path: landedPath, sha256: 'c'.repeat(64), bytes: 42 }
const completeSnapshot = {
  state: { rounds: [{ directions: [{ findings_file: landedPath }] }] },
  artifacts: { [landedPath]: '# findings' },
  ownedArtifacts: [landedPath],
  mode: 'complete',
  baseRevision: 'a'.repeat(40),
}
assert.deepEqual(
  delegatedArtifactIntegrationDiagnostics(completeSnapshot, [receipt, receipt]),
  [],
  'duplicate current-invocation receipts dedupe by exact artifact path',
)
assert.deepEqual(
  delegatedArtifactIntegrationDiagnostics({ ...completeSnapshot, mode: 'in_progress', state: {} }, [receipt]),
  [],
  'in-progress and handoff publication do not require final receipt integration',
)
assert.equal(
  delegatedArtifactIntegrationDiagnostics({ ...completeSnapshot, state: { note: `prefix:${landedPath}` } }, [receipt]).length,
  1,
  'a substring is not a canonical artifact reference',
)
assert.equal(
  delegatedArtifactIntegrationDiagnostics({ ...completeSnapshot, state: { [landedPath]: true } }, [receipt]).length,
  1,
  'a JSON key is not a canonical artifact reference',
)
assert.match(
  delegatedArtifactIntegrationDiagnostics({ ...completeSnapshot, artifacts: {} }, [receipt])[0],
  /missing from the current Producer working copy/,
  'completion rejects a receipt whose artifact is absent',
)

console.log('DSH DIRECT WORKER DELEGATION OK')
