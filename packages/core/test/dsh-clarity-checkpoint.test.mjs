import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as nextTick } from 'node:timers/promises'
import { evaluateDesignClarityCheckpoint } from '../src/dsh-clarity-checkpoint.ts'
import { designClarityScopeDigest } from '../src/design-clarity-context.ts'
import { designClarityDigest } from '../src/design-clarity-report.ts'
import { composeProjectKit, projectKitContentHash } from '../src/project-content.ts'

const COMMIT = 'a'.repeat(40), OTHER = 'b'.repeat(40)
const human = text => ({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
const assessment = () => ({ summary: 'The bounded decision is explicit.',
  u: { score: 70, evidence: 'The intended outcome and actors are recorded.' },
  s: { score: 45, evidence: 'Some relationships remain unspecified.' },
  t: { score: 35, evidence: 'The outcome has not yet been given an observable check.' },
  nextGap: 'Confirm the observable outcome.' })

// Scripted evaluator and service ports: this tests the real shared evaluator
// wrapper and scope functions, without a model, filesystem mutation or Host.
function fixture(kit = { name: 'decision_modeling', version: '1.0', mindset: 'One bounded decision.', skills: [] }) {
  const kitHash = projectKitContentHash(kit)
  const project = { projectId: '11111111-1111-4111-8111-111111111111', root: '/fixture/project',
    designFilesRoot: '/fixture/project/design_files', stateRoot: '/fixture/state', kit: { name: kit.name, version: kit.version } }
  const events = [human('Compare the two options for this local prototype.'), { type: 'turn/start', data: { turn: 39 } }]
  const agent = { session: { snapshotEvents: () => events } }
  const state = { selected: project, kit, head: COMMIT, equivalent: false, authority: undefined,
    starts: 0, disposals: 0, promotions: 0, authorityReads: 0, headReads: 0, requests: [], reports: [] }
  const controller = new AbortController()
  const currentScope = () => designClarityScopeDigest(events)
  const design = {
    async selectedProjectForAgent() { return state.selected },
    requireKitForAgent() { return state.resolveKit?.() ?? state.kit },
    async designFilesForProject(_agent, id) {
      assert.equal(id, project.projectId)
      return { async head() { state.headReads++; return state.head }, async sameDesignEvidenceAt(left, right) {
        assert.equal(left, state.head); assert.equal(right, COMMIT); return state.equivalent
      } }
    },
    async readClarityAuthority(id) {
      assert.equal(id, project.projectId); state.authorityReads++
      await state.onAuthorityRead?.(state.authorityReads)
      return state.authority
    },
    async advisoryEvidence() { throw Error('Scripted tests must not enter the native factory') },
    async reportEvaluatedClarity(_agent, commit, report, options) {
      state.promotions++; state.reports.push(report)
      assert.deepEqual(options, { expectedProjectId: project.projectId, signal: controller.signal })
      await state.onPromote?.()
      if (state.selected.projectId !== project.projectId || projectKitContentHash(design.requireKitForAgent()) !== report.kitContentHash
        || report.scopeDigest !== currentScope() || (state.head !== commit && !state.equivalent)) {
        return { status: 'stale', journalRevision: 0 }
      }
      if (state.promotionError) throw state.promotionError
      state.authority = state.wrongAuthority ?? { projectId: project.projectId, assessedCheckpoint: commit, report }
      return { status: state.promotionStatus ?? 'updated', journalRevision: 1 }
    },
  }
  const start = async (provider, request) => {
    state.starts++; state.requests.push(request)
    assert.equal(provider, 'spawn'); assert.equal(request.reviewCommit, COMMIT)
    assert.deepEqual(request.toolFilter, { allow: [] }); assert.equal(request.parent, agent)
    await state.onStart?.(request)
    if (state.startError) throw state.startError
    return { id: 'real-scripted-evaluation-id',
      result: state.result ?? Promise.resolve({ stopReason: 'completed', structured: assessment() }),
      async dispose() { state.disposals++ },
    }
  }
  const report = (extra = {}) => ({ origin: 'evaluator', digest: designClarityDigest(assessment(), kit.name, kit.version),
    scopeDigest: currentScope(), kitContentHash: kitHash, turn: 38, callId: 'existing-evaluator-id', kit: kit.name, version: kit.version, ...assessment(), ...extra })
  const request = { design, agent, project, kit, commit: COMMIT, turn: 39, signal: controller.signal, start }
  return { state, events, project, kit, controller, request, report, currentScope }
}

// A real override composition allocates a new Kit/ontology object per resolution.
function composedFixture() {
  const skill = { name: 'decision', version: '1.0', authority: 'fixture:decision', description: 'Describe the decision.',
    title: { zh: '决策', en: 'Decision' }, label: { zh: '决策', en: 'Decision' }, content: 'Preserve saved facts.',
    execution: { mode: 'main', handoff: 'none' }, metadata: { schemaDocument: { type: 'object', properties: {} } } }
  const base = { name: 'fixture_kit', version: '1.0', mindsetSource: 'One bounded decision.',
    mindset: 'One bounded decision.', skills: [skill], resources: {} }
  const replacement = { skill: { ...skill, version: '1.1' }, resourceRoot: '/fixture/bundle',
    resources: { 'reference/guide.md': 'Use the saved decision.' } }
  const pin = { name: base.name, version: base.version, bundles: { decision: '1.1' } }
  const resolveKit = () => composeProjectKit(pin, base, [replacement])
  const f = fixture(resolveKit())
  f.state.resolveKit = resolveKit
  assert.notEqual(resolveKit(), f.kit)
  assert.equal(projectKitContentHash(resolveKit()), projectKitContentHash(f.kit))
  return { ...f, replacement }
}

test('equivalent fresh Kit override compositions pass every evaluation and promotion guard', async () => {
  const f = composedFixture(), result = await evaluateDesignClarityCheckpoint(f.request)
  assert.equal(result.status, 'updated'); assert.equal(f.state.starts, 1); assert.equal(f.state.promotions, 1)
  assert.equal(f.state.disposals, 1); assert.equal(result.report, f.state.authority.report)
})

test('matching authority is reused across equivalent fresh Kit compositions', async () => {
  const f = composedFixture()
  f.state.authority = { projectId: f.project.projectId, assessedCheckpoint: COMMIT, report: f.report() }
  const result = await evaluateDesignClarityCheckpoint(f.request)
  assert.equal(result.status, 'unchanged'); assert.equal(result.report, f.state.authority.report)
  assert.equal(f.state.starts, 0); assert.equal(f.state.promotions, 0)
})

test('fresh Kit compositions do not misclassify an evaluator error as stale', async () => {
  const f = composedFixture(); f.state.startError = Error('evaluator unavailable')
  const result = await evaluateDesignClarityCheckpoint(f.request)
  assert.equal(result.status, 'failed'); assert.match(result.summary, /evaluator unavailable/)
  assert.equal(f.state.starts, 1); assert.equal(f.state.promotions, 0)
})

test('rejects changed composed Bundle resources even when Kit and Bundle versions are unchanged', async () => {
  const f = composedFixture(); f.state.onStart = () => {
    f.replacement.resources['reference/guide.md'] = 'Use a different decision.'
    const changed = f.state.resolveKit()
    assert.equal(changed.name, f.kit.name); assert.equal(changed.version, f.kit.version)
    assert.equal(changed.skills[0].version, f.kit.skills[0].version)
    assert.notEqual(projectKitContentHash(changed), projectKitContentHash(f.kit))
  }
  const result = await evaluateDesignClarityCheckpoint(f.request)
  assert.equal(result.status, 'stale'); assert.equal(f.state.starts, 1); assert.equal(f.state.promotions, 0)
  assert.equal(f.state.disposals, 1)
})

test('captures the Kit content hash before evaluation rather than rehashing the mutable original as the pin', async () => {
  const f = fixture(); f.state.onStart = () => { f.kit.mindset = 'Different calibration with the same object and version.' }
  const result = await evaluateDesignClarityCheckpoint(f.request)
  assert.equal(result.status, 'stale'); assert.equal(f.state.promotions, 0); assert.equal(f.state.disposals, 1)
})

test('evaluates the exact commit with real evaluation identity and promotes/readbacks the shared authority', async () => {
  const f = fixture(), result = await evaluateDesignClarityCheckpoint(f.request)
  assert.equal(result.status, 'updated'); assert.equal(f.state.starts, 1); assert.equal(f.state.promotions, 1)
  assert.equal(f.state.disposals, 1); assert.equal(result.report.callId, 'real-scripted-evaluation-id')
  assert.equal(result.report.turn, 39); assert.equal(result.report.scopeDigest, f.currentScope())
  assert.equal(result.report.origin, 'evaluator'); assert.equal(result.report, f.state.authority.report)
  const prompt = f.state.requests[0].prompt.map(p => p.text).join('\n')
  assert.match(prompt, new RegExp(COMMIT)); assert.match(prompt, /local prototype/)
  assert.match(prompt, /decision_modeling/); assert.match(prompt, /No shell/)
})

test('one post-authority currentness fence precedes child creation without repeating immutable preflight', async () => {
  const f = fixture(); let headReadsAtStart
  f.state.onStart = () => { headReadsAtStart = f.state.headReads }
  assert.equal((await evaluateDesignClarityCheckpoint(f.request)).status, 'updated')
  assert.equal(f.state.authorityReads, 2, 'keep authority lookup and promoted-result readback')
  assert.equal(headReadsAtStart, 1, 'readonly historical authority lookup does not need two full Git fences')
  assert.equal(f.state.headReads, 3, 'retain post-model and post-promotion currentness checks')
})

test('scope or selection changing during readonly authority lookup still prevents any child or promotion', async () => {
  for (const change of [
    f => f.events.push(human('Use a different bounded decision.')),
    f => { f.state.selected = { ...f.project, projectId: '22222222-2222-4222-8222-222222222222' } },
    f => { f.state.head = OTHER },
  ]) {
    const f = fixture(); f.state.onAuthorityRead = () => change(f)
    assert.equal((await evaluateDesignClarityCheckpoint(f.request)).status, 'stale')
    assert.equal(f.state.starts, 0); assert.equal(f.state.promotions, 0)
  }
})

for (const cached of [false, true]) for (const [label, change] of [
  ['scope', f => { f.events.push(human('Use a different bounded decision.')) }],
  ['selection', f => { f.state.selected = { ...f.project, projectId: '22222222-2222-4222-8222-222222222222' } }],
  ['project root', f => { f.state.selected = { ...f.project, root: '/fixture/replaced-project' } }],
  ['Design Files root', f => { f.state.selected = { ...f.project, designFilesRoot: '/fixture/replaced-design-files' } }],
  ['Kit version', f => { f.state.selected = { ...f.project, kit: { ...f.project.kit, version: '2.0' } } }],
  ['same-version Kit content', f => { f.state.kit = { ...f.kit, mindset: 'Different calibration.' } }],
  ['checkpoint', f => { f.state.head = OTHER }],
  ['cancellation', f => { f.controller.abort() }],
]) test(`delayed authority ${cached ? 'cache hit' : 'cache miss'} rejects ${label} change before admission`, async () => {
  const f = fixture()
  const retained = cached ? { projectId: f.project.projectId, assessedCheckpoint: COMMIT, report: f.report() } : undefined
  f.state.authority = retained
  let release, entered
  const held = new Promise(resolve => { release = resolve })
  const lookupStarted = new Promise(resolve => { entered = resolve })
  f.state.onAuthorityRead = async count => {
    assert.equal(count, 1)
    entered()
    await held
  }
  const pending = evaluateDesignClarityCheckpoint(f.request)
  await lookupStarted
  assert.equal(f.state.starts, 0)
  assert.equal(f.state.promotions, 0)
  change(f)
  release()
  const result = await pending
  assert.equal(result.status, 'stale')
  assert.equal(f.state.starts, 0)
  assert.equal(f.state.promotions, 0)
  assert.equal(f.state.authority, retained, 'readonly lookup does not alter historical authority')
  assert.equal('report' in result, false, 'a cache hit must not expose stale authority as current')
})

test('matching commit+Kit+scope authority is reused without evaluator or promotion', async () => {
  const f = fixture(); f.state.authority = { projectId: f.project.projectId, assessedCheckpoint: COMMIT, report: f.report() }
  const result = await evaluateDesignClarityCheckpoint(f.request)
  assert.equal(result.status, 'unchanged'); assert.equal(result.report, f.state.authority.report)
  assert.equal(f.state.starts, 0); assert.equal(f.state.promotions, 0)
})

for (const [label, change] of [
  ['historical authority without Kit closure', r => { delete r.report.kitContentHash }],
  ['other Kit closure', r => { r.report.kitContentHash = 'd'.repeat(64) }],
  ['other commit', r => { r.assessedCheckpoint = OTHER }],
  ['other Kit', r => { r.report.kit = 'web_app' }],
]) test('does not reuse '+label, async () => {
  const f = fixture(); f.state.authority = { projectId: f.project.projectId, assessedCheckpoint: COMMIT, report: f.report() }
  change(f.state.authority)
  const result = await evaluateDesignClarityCheckpoint(f.request)
  assert.equal(result.status, 'updated'); assert.equal(f.state.starts, 1)
})

for (const scopeDigest of [undefined, 'c'.repeat(64)]) test('scope metadata does not force a second score: '+scopeDigest, async () => {
  const f = fixture()
  const value = f.report()
  if (scopeDigest === undefined) delete value.scopeDigest
  else value.scopeDigest = scopeDigest
  f.state.authority = { projectId: f.project.projectId, assessedCheckpoint: COMMIT, report: value }
  const result = await evaluateDesignClarityCheckpoint(f.request)
  assert.equal(result.status, 'unchanged')
  assert.equal(f.state.starts, 0); assert.equal(f.state.promotions, 0)
  assert.equal(result.report, value, 'optional metadata is retained, never rewritten as native proof')
})

test('a new call with same-version changed Kit content evaluates rather than reusing old authority', async () => {
  const f = fixture()
  assert.equal((await evaluateDesignClarityCheckpoint(f.request)).status, 'updated')
  const prior = f.state.authority.report
  f.state.kit = { ...f.kit, mindset: 'Different calibration for the same version.' }
  const result = await evaluateDesignClarityCheckpoint({ ...f.request, kit: f.state.kit })
  assert.equal(result.status, 'updated'); assert.equal(f.state.starts, 2); assert.equal(f.state.promotions, 2)
  assert.notEqual(result.report.kitContentHash, prior.kitContentHash)
  assert.equal(result.report.kitContentHash, projectKitContentHash(f.state.kit))
})

for (const [label, change] of [
  ['project', f => { f.state.selected = { ...f.project, projectId: '22222222-2222-4222-8222-222222222222' } }],
  ['Kit version', f => { f.state.selected = { ...f.project, kit: { name: f.kit.name, version: '2.0' } } }],
  ['same-version Kit content replacement', f => { f.state.kit = { ...f.kit, mindset: 'Different scope calibration.' } }],
  ['scope', f => { f.events.push(human('Use production customer data instead.')) }],
  ['Design checkpoint', f => { f.state.head = OTHER }],
]) test('drops an evaluation when '+label+' changes during the readonly run', async () => {
  const f = fixture(); f.state.onStart = () => change(f)
  const result = await evaluateDesignClarityCheckpoint(f.request)
  assert.equal(result.status, 'stale'); assert.equal(f.state.promotions, 0); assert.equal(f.state.disposals, 1)
})

test('refuses an already stale checkpoint before starting a child', async () => {
  const f = fixture(); f.state.head = OTHER
  assert.equal((await evaluateDesignClarityCheckpoint(f.request)).status, 'stale'); assert.equal(f.state.starts, 0)
})

test('preserves existing equivalent-Design evidence behavior while reading only the requested commit', async () => {
  const f = fixture(); f.state.head = OTHER; f.state.equivalent = true
  assert.equal((await evaluateDesignClarityCheckpoint(f.request)).status, 'updated')
  assert.equal(f.state.requests[0].reviewCommit, COMMIT); assert.equal(f.state.authority.assessedCheckpoint, COMMIT)
})

test('ordinary save control and tool activity do not invalidate the captured human scope', async () => {
  const f = fixture(); f.state.onStart = () => {
    f.events.push(human('保存并继续设计'), { type: 'tool/result', data: { content: 'background activity' } })
  }
  assert.equal((await evaluateDesignClarityCheckpoint(f.request)).status, 'updated')
})

test('service promotion fence can reject a scope change after the helper precheck', async () => {
  const f = fixture(); f.state.onPromote = () => f.events.push(human('The original scope is cancelled.'))
  const result = await evaluateDesignClarityCheckpoint(f.request)
  assert.equal(result.status, 'stale'); assert.equal(f.state.promotions, 1); assert.equal(f.state.authority, undefined)
})

test('a project-selection exception at promotion is classified stale after identity changed', async () => {
  const f = fixture(); f.state.onPromote = () => {
    f.state.selected = { ...f.project, projectId: '22222222-2222-4222-8222-222222222222' }
    throw Error('selected project changed before promotion')
  }
  assert.equal((await evaluateDesignClarityCheckpoint(f.request)).status, 'stale')
})

test('pre-cancelled work never starts or promotes', async () => {
  const f = fixture(); f.controller.abort()
  assert.equal((await evaluateDesignClarityCheckpoint(f.request)).status, 'stale')
  assert.equal(f.state.starts, 0); assert.equal(f.state.promotions, 0)
})

test('cancellation while a child is being created disposes the late handle without promotion', async () => {
  const f = fixture(); let release
  f.state.onStart = () => new Promise(resolve => { release = resolve })
  const pending = evaluateDesignClarityCheckpoint(f.request)
  while (!release) await nextTick()
  f.controller.abort(); release()
  assert.equal((await pending).status, 'stale'); await nextTick()
  assert.equal(f.state.promotions, 0); assert.equal(f.state.disposals, 1)
})

test('missing/invalid structured result fails without a second execution or authority', async () => {
  const f = fixture(); f.state.result = Promise.resolve({ stopReason: 'completed', structured: { summary: 'No scores.' } })
  const result = await evaluateDesignClarityCheckpoint(f.request)
  assert.equal(result.status, 'failed'); assert.equal(f.state.starts, 1); assert.equal(f.state.disposals, 1)
  assert.equal(f.state.promotions, 0); assert.equal(f.state.authority, undefined)
})

test('an evaluator failure is bounded and does not retry or mutate saved design', async () => {
  const f = fixture(); f.state.startError = Error('x'.repeat(3000))
  const result = await evaluateDesignClarityCheckpoint(f.request)
  assert.equal(result.status, 'failed'); assert.equal(result.summary.length, 1000)
  assert.equal(f.state.starts, 1); assert.equal(f.state.promotions, 0); assert.equal(f.state.authority, undefined)
})

test('promotion failure remains retryable and does not invent a successful authority', async () => {
  const f = fixture(); f.state.promotionError = Error('authority storage unavailable')
  const result = await evaluateDesignClarityCheckpoint(f.request)
  assert.equal(result.status, 'failed'); assert.match(result.summary, /authority storage/)
  assert.equal(f.state.authority, undefined)
  delete f.state.promotionError
  assert.equal((await evaluateDesignClarityCheckpoint(f.request)).status, 'updated')
})

test('promotion readback must match every assessment pin', async () => {
  const f = fixture(); f.state.wrongAuthority = { projectId: f.project.projectId, assessedCheckpoint: OTHER, report: f.report() }
  const result = await evaluateDesignClarityCheckpoint(f.request)
  assert.equal(result.status, 'failed'); assert.match(result.summary, /authority does not match/)
})

test('returns the retained authority when atomic promotion reports unchanged', async () => {
  const f = fixture(), retained = f.report({ callId: 'winning-concurrent-evaluation' })
  f.state.promotionStatus = 'unchanged'
  f.state.wrongAuthority = { projectId: f.project.projectId, assessedCheckpoint: COMMIT, report: retained }
  const result = await evaluateDesignClarityCheckpoint(f.request)
  assert.equal(result.status, 'unchanged'); assert.equal(result.report.callId, retained.callId)
})

test('invalid turn or mutable commit inputs never start a reviewer', async () => {
  for (const input of [{ turn: -1 }, { turn: 0.5 }, { turn: NaN }, { commit: 'HEAD' }]) {
    const f = fixture()
    assert.equal((await evaluateDesignClarityCheckpoint({ ...f.request, ...input })).status, 'failed')
    assert.equal(f.state.starts, 0)
  }
})
