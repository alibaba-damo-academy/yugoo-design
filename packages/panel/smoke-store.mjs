/**
 * Host-neutral browser store smoke: tab order, activity routing, registry
 * lifetimes, and presentation-scoped draft equality.
 */
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import {
  areRenderEqual,
  editDraft,
  hasPendingChanges,
  isDirty,
  panelStore,
  resetPanelStore,
  revertAll,
  selectTab,
  syncProjection,
} from './src/client/store.ts'
import { NativePanelRegistry } from './src/client/native-panel-registry.ts'
import { latestActiveFileExecution, producerExecutionForCall } from './src/client/design-activity.ts'

const attempt = (overrides) => ({
  projectId: 'project', invocationId: 'invocation', skill: 'research', artifactId: 'research',
  attemptId: 'attempt', role: 'producer', phase: 'working', sequence: 1, timestamp: 1,
  ...overrides,
})
assert.equal(
  latestActiveFileExecution({}, [attempt({})]),
  undefined,
  'execution alone cannot open a panel before its canonical file is visible',
)
assert.deepEqual(
  latestActiveFileExecution({ research: { state: {} } }, [
    attempt({ phase: 'queued', sequence: 1 }),
    attempt({ phase: 'working', sequence: 2 }),
    attempt({ role: 'worker', attemptId: 'worker', phase: 'completed', sequence: 3 }),
    attempt({ artifactKind: 'research_direction', attemptId: 'artifact-producer', phase: 'completed', sequence: 4 }),
  ]),
  { skill: 'research', invocationId: 'invocation', sequence: 2 },
  'the latest active Host attempt focuses a filesystem-visible Bundle',
)
assert.equal(
  latestActiveFileExecution({ research: { state: {} } }, [
    attempt({ phase: 'working', sequence: 2 }),
    attempt({ phase: 'completed', sequence: 3 }),
  ]),
  undefined,
  'a terminal phase supersedes an earlier working event from the same invocation',
)
const firstCall = attempt({ invocationId: 'first', rootCallId: 'call-first', runId: 'run-first', phase: 'completed', sequence: 2 })
const secondCall = attempt({ invocationId: 'second', rootCallId: 'call-second', runId: 'run-second', phase: 'working', sequence: 4 })
assert.equal(
  producerExecutionForCall([firstCall, secondCall], 'research', 'call-first', false)?.runId,
  'run-first',
  'a settled historical row remains bound to its own Producer when the same skill runs again',
)
assert.equal(
  producerExecutionForCall([firstCall, secondCall], 'research', 'call-second', true)?.runId,
  'run-second',
  'the current row binds to the current Producer by root tool call id',
)

const effectContext = new Context()
const nativePanels = new NativePanelRegistry(effectContext)
let nativePanelChanges = 0
const stopNativePanelChanges = nativePanels.subscribe(() => { nativePanelChanges += 1 })
const lifecycleDefinition = {
  id: 'example.lifecycle/v1',
  scrollOwner: 'workspace',
  render: () => { throw new Error('render is outside this store smoke') },
}
const disposeLifecycle = nativePanels.register(lifecycleDefinition)
assert.equal(nativePanels.get(lifecycleDefinition.id), lifecycleDefinition)
assert.equal(nativePanels.revision(), 1)
assert.equal(nativePanelChanges, 1)
assert.throws(() => nativePanels.register(lifecycleDefinition), /already registered/)
disposeLifecycle()
assert.equal(nativePanels.get(lifecycleDefinition.id), undefined)
assert.equal(nativePanels.revision(), 2)
assert.equal(nativePanelChanges, 2)
stopNativePanelChanges()

nativePanels.register({
  id: 'example.answers/v1',
  scrollOwner: 'panel',
  render: () => { throw new Error('render is outside this store smoke') },
  equalsDraft: (a, b) => a?.answer === b?.answer,
})

const native = (renderer, order) => ({ order, presentation: { mode: 'native', renderer } })
const declarative = (renderer, order) => ({ order, presentation: { mode: 'declarative', renderer } })
const firstManifest = native('example.answers/v1', 1)
const secondManifest = declarative('example.structural/v1', 2)

resetPanelStore()
syncProjection({
  second: { state: { value: 'second' }, skillManifest: secondManifest },
  first: { state: { prompt: 'First', answer: '' }, skillManifest: firstManifest },
}, true, nativePanels)
assert.deepEqual(panelStore.getSnapshot().skills, ['first', 'second'], 'initial tabs use manifest order')
syncProjection({
  second: { state: { value: 'second' }, skillManifest: secondManifest },
  first: { state: { prompt: 'First', answer: '' }, skillManifest: firstManifest },
  zero: { state: {}, skillManifest: native('example.zero/v1', 0) },
}, true, nativePanels)
assert.deepEqual(
  panelStore.getSnapshot().skills,
  ['first', 'second', 'zero'],
  'a new lower-order tab appends instead of entering the second position',
)
syncProjection({
  another: { state: {}, skillManifest: native('example.another/v1', -1) },
  zero: { state: {}, skillManifest: native('example.zero/v1', 0) },
  first: { state: { prompt: 'First', answer: '' }, skillManifest: firstManifest },
  second: { state: { value: 'second-v2' }, skillManifest: secondManifest, changedSeq: 1 },
}, true, nativePanels)
assert.deepEqual(
  panelStore.getSnapshot().skills,
  ['first', 'second', 'zero', 'another'],
  'projection key order, an existing update, and another lower-order tab preserve append order',
)
selectTab('first')
syncProjection({
  first: { state: { prompt: 'First', answer: '' }, skillManifest: firstManifest },
  another: { state: {}, skillManifest: native('example.another/v1', -1) },
  second: { state: { value: 'second-v2' }, skillManifest: secondManifest, changedSeq: 1 },
  zero: { state: {}, skillManifest: native('example.zero/v1', 0) },
}, true, nativePanels)
assert.deepEqual(panelStore.getSnapshot().skills, ['first', 'second', 'zero', 'another'], 'polling does not reorder tabs')
assert.equal(panelStore.getSnapshot().active, 'first', 'polling does not change the selected tab')

syncProjection({
  first: { state: { prompt: 'First', answer: '' }, skillManifest: firstManifest },
  second: { state: { value: 'second-v3' }, skillManifest: secondManifest, changedSeq: 2 },
  zero: { state: {}, skillManifest: native('example.zero/v1', 0) },
  another: { state: {}, skillManifest: native('example.another/v1', -1) },
  next: { state: {}, skillManifest: native('example.next/v1', -20) },
  latest: { state: {}, skillManifest: native('example.latest/v1', -30), changedSeq: 3 },
}, true, nativePanels)
assert.deepEqual(
  panelStore.getSnapshot().skills,
  ['first', 'second', 'zero', 'another', 'next', 'latest'],
  'several newly visible tabs append after every retained tab, with the latest publication rightmost',
)
assert.equal(panelStore.getSnapshot().active, 'latest', 'the rightmost newly published tab becomes active')
assert.equal(panelStore.getSnapshot().unread.second, true, 'an existing off-screen update is unread without moving its tab')
selectTab('second')
assert.equal(panelStore.getSnapshot().unread.second, undefined, 'viewing an updated existing tab clears New')
assert.deepEqual(
  panelStore.getSnapshot().skills,
  ['first', 'second', 'zero', 'another', 'next', 'latest'],
  'viewing an updated existing tab does not reorder it',
)

resetPanelStore()
syncProjection({
  projectSecond: { state: {}, skillManifest: native('example.project-second/v1', 20) },
  projectFirst: { state: {}, skillManifest: native('example.project-first/v1', 10) },
}, true, nativePanels)
assert.deepEqual(
  panelStore.getSnapshot().skills,
  ['projectFirst', 'projectSecond'],
  'a session or project reset establishes the new workspace initial manifest order',
)

resetPanelStore()
syncProjection({
  second: { state: { value: 'v1' }, skillManifest: secondManifest },
  first: { state: { prompt: 'Original', answer: '' }, skillManifest: firstManifest },
}, true, nativePanels)
let snap = panelStore.getSnapshot()
assert.deepEqual(snap.skills, ['first', 'second'], 'tabs sort by manifest order')
assert.equal(snap.active, 'first', 'first new skill becomes active')

syncProjection({
  first: { state: { ...snap.originals.first }, skillManifest: firstManifest },
  second: { state: { value: 'v2' }, skillManifest: secondManifest, origin: 'agent', changedSeq: 7 },
}, true, nativePanels, 'second')
snap = panelStore.getSnapshot()
assert.equal(snap.unread.second, true, 'off-screen agent update badges unread')
assert.equal(snap.unread.first, undefined, 'RPC object churn does not badge an unchanged sibling')
assert.equal(snap.active, 'first', 'Host activity for an existing Panel does not steal focus')
assert.equal(snap.flash, undefined)

selectTab('second')
assert.equal(panelStore.getSnapshot().unread.second, undefined, 'selectTab clears unread')
syncProjection({
  first: { state: { ...snap.originals.first }, skillManifest: firstManifest },
  second: { state: { value: 'v2' }, skillManifest: secondManifest, origin: 'agent', changedSeq: 7 },
}, true, nativePanels)
snap = panelStore.getSnapshot()
assert.equal(snap.unread.second, undefined, 'polling the same publication does not restore unread')
assert.equal(snap.flash, undefined, 'polling the same publication does not flash')

syncProjection({
  first: { state: { ...snap.originals.first }, skillManifest: firstManifest },
  second: { state: { value: 'v3' }, skillManifest: secondManifest, origin: 'agent', changedSeq: 8 },
}, true, nativePanels)
snap = panelStore.getSnapshot()
assert.equal(snap.flash?.skill, 'second', 'on-screen agent update flashes')
assert.equal(snap.flash?.nonce, 1)

editDraft('second', { value: 'v4' })
syncProjection({
  first: { state: { ...snap.originals.first }, skillManifest: firstManifest },
  second: { state: { value: 'v4' }, skillManifest: secondManifest, origin: 'agent', changedSeq: 9 },
  third: { state: {}, skillManifest: native('example.third/v1', 3) },
}, true, nativePanels, 'third')
snap = panelStore.getSnapshot()
assert.equal(snap.flash, undefined, 'a matching panel-save echo does not re-flash on the newly selected tab')
assert.equal(snap.unread.second, undefined, 'a matching panel-save echo does not badge')
assert.equal(isDirty('second', nativePanels), false, 'the matching authoritative save echo clears dirty state')
assert.equal(snap.active, 'third', 'a brand-new skill auto-switches the tab')

selectTab('first')
syncProjection({
  first: { state: { ...snap.originals.first }, skillManifest: firstManifest },
  second: { state: { value: 'v5' }, skillManifest: secondManifest, origin: 'agent', changedSeq: 10 },
  third: { state: {}, skillManifest: native('example.third/v1', 3) },
}, true, nativePanels)
snap = panelStore.getSnapshot()
assert.equal(snap.unread.second, true, 'only the off-screen skill with a newer sequence becomes unread')
assert.equal(snap.unread.first, undefined)
selectTab('second')
assert.equal(panelStore.getSnapshot().unread.second, undefined, 'opening the target clears unread immediately')
selectTab('second')
assert.equal(panelStore.getSnapshot().unread.second, undefined, 'reselecting the active target remains acknowledged')

selectTab('first')
editDraft('first', { prompt: 'Host metadata changed', answer: '' })
assert.equal(isDirty('first', nativePanels), false, 'the registered comparator owns native equality')
editDraft('first', { prompt: 'Original', answer: 'edited' })
assert.equal(isDirty('first', nativePanels), true)
assert.equal(hasPendingChanges(nativePanels), true)
revertAll()
assert.equal(isDirty('first', nativePanels), false)

assert.equal(
  areRenderEqual(
    { presentation: { mode: 'declarative', renderer: 'example.declarative/v1' } },
    nativePanels,
    { value: 1 },
    { value: 1 },
  ),
  true,
  'declarative presentations use structural equality',
)
assert.equal(
  areRenderEqual(native('example.missing/v1', 99), nativePanels, { value: 1 }, { value: 1 }),
  false,
  'an unavailable native renderer does not silently use structural equality',
)

resetPanelStore()
syncProjection({
  second: { state: { value: 'v5' }, skillManifest: secondManifest, origin: 'agent', changedSeq: 10 },
}, true, nativePanels)
assert.equal(panelStore.getSnapshot().unread.second, undefined, 'session remount establishes a clean read baseline')
syncProjection({
  second: { state: { value: 'v5' }, skillManifest: secondManifest, origin: 'agent', changedSeq: 10 },
}, true, nativePanels)
assert.equal(panelStore.getSnapshot().unread.second, undefined, 'the baseline sequence stays clear across polls')

resetPanelStore()
syncProjection({
  hidden: { state: {}, skillManifest: { presentation: { mode: 'none' } } },
}, true, nativePanels)
assert.deepEqual(panelStore.getSnapshot().skills, [], 'a no-panel Bundle does not create an empty tab')

resetPanelStore()
const stableState = { value: 'unchanged' }
syncProjection({ sample: { state: stableState, skillManifest: native('example.panel-a/v1', 1) } }, true, nativePanels)
syncProjection({ sample: { state: stableState, skillManifest: native('example.panel-b/v1', 1) } }, true, nativePanels)
assert.equal(panelStore.getSnapshot().manifests.sample?.presentation?.renderer, 'example.panel-b/v1')

resetPanelStore()
assert.deepEqual(panelStore.getSnapshot().skills, [], 'reset clears the store')

console.log('STORE OK')
