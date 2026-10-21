#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const { register } = await import('tsx/esm/api')
register()

const traceSectionSource = await readFile(
  new URL('./src/client/ported/design/ResearchPanel/ResearchTraceSection.tsx', import.meta.url),
  'utf8',
)
assert.doesNotMatch(traceSectionSource, /[🔍📄✍⚠]/u, 'rolling research traces must not use emoji UI icons')
for (const icon of ['Search', 'FileText', 'Sparkles', 'TriangleAlert']) {
  assert.match(traceSectionSource, new RegExp(`\\b${icon}\\b`), `rolling research traces use the ${icon} professional icon`)
}
assert.match(traceSectionSource, /ReactMarkdown/, 'native research message rows render Markdown')
assert.match(traceSectionSource, /entry\.event_type === 'message'/, 'only Agent message rows use Markdown rendering')
assert.match(traceSectionSource, /skipHtml/, 'rolling transcript Markdown cannot inject raw HTML')

const { projectResearchPanelState } = await import('./src/client/panels/research-panel-projection.ts')
const { mergeExecutionTracePoll, researchRoundItem } = await import('./src/client/panels/research.tsx')
const { pickNewlyConcludedRound } = await import('./src/client/ported/design/ResearchPanel/ResearchPanel.tsx')
const {
  projectTextArtifactView,
  readTextArtifactWithRetry,
  textArtifactStateEpoch,
} = await import('./src/client/panels/artifact-text-hydration.ts')

assert.equal(
  textArtifactStateEpoch({ processes: { 'P-001': { bpmn_file: 'flow_design/P-001.bpmn' } } }),
  textArtifactStateEpoch({ processes: { 'P-001': { bpmn_file: 'flow_design/P-001.bpmn' } } }),
  'referentially new but semantically unchanged polling state keeps the artifact hydration epoch',
)
assert.notEqual(
  textArtifactStateEpoch({ processes: { 'P-001': { bpmn_file: null } } }),
  textArtifactStateEpoch({ processes: { 'P-001': { bpmn_file: 'flow_design/P-001.bpmn' } } }),
  'a canonical artifact reference change advances the hydration epoch',
)

const roundWithoutConclusion = id => ({ round_id: id, topic: id, stage: 'researching', directions: [] })
const newlyPublishedRounds = [
  { ...roundWithoutConclusion('R-001'), conclusion_file: 'research/R-001/conclusion.html', conclusion: '<html>R1</html>', conclusion_available: true },
  { ...roundWithoutConclusion('R-002'), conclusion_file: 'research/R-002/conclusion.html', conclusion: '<html>R2</html>', conclusion_available: true },
]
assert.equal(
  pickNewlyConcludedRound(newlyPublishedRounds, new Map([['R-001', null], ['R-002', null]]), 'R-002')?.round_id,
  'R-002',
  'a newly published current-round conclusion wins automatic root navigation',
)
assert.equal(
  pickNewlyConcludedRound(
    [{ ...roundWithoutConclusion('R-003'), conclusion_file: 'research/R-003/conclusion.html', conclusion_loading: true }],
    new Map([['R-003', null]]),
    'R-003',
  ),
  null,
  'a conclusion ref alone must not switch the UI before its HTML is readable',
)
assert.equal(
  pickNewlyConcludedRound(
    newlyPublishedRounds,
    new Map(newlyPublishedRounds.map(round => [round.round_id, round.conclusion_file])),
    'R-002',
  ),
  null,
  'artifact hydration with an unchanged conclusion ref must not repeatedly steal navigation',
)

const researchTreeSource = await readFile(
  new URL('./src/client/ported/design/ResearchPanel/ResearchDirectionList.tsx', import.meta.url),
  'utf8',
)
assert.match(researchTreeSource, /onToggle=\{\(\) => setExpanded/, 'the round chevron owns expansion')
assert.match(researchTreeSource, /onSelect=\{\(\) => \{\s*onSelect\(/, 'the round body owns root selection independently')

assert.deepEqual(
  projectTextArtifactView('artifact.html', undefined, undefined),
  { loading: true, available: false },
  'a durable ref without a read result is loading',
)
assert.deepEqual(
  projectTextArtifactView('artifact.html', undefined, null),
  { loading: false, available: false },
  'a durable ref with a miss is unavailable',
)
assert.deepEqual(
  projectTextArtifactView('artifact.html', undefined, 'published content'),
  { content: 'published content', loading: false, available: true },
  'a later successful read is available',
)
let rejectedCalls = 0
const afterReject = await readTextArtifactWithRetry(async () => {
  rejectedCalls += 1
  if (rejectedCalls === 1) throw new Error('connection lost')
  return { found: true, content: 'recovered after reject' }
}, 'artifact.html', new AbortController().signal, [0, 0])
assert.equal(afterReject, 'recovered after reject', 'a reconnect succeeds without a state identity change')
assert.equal(rejectedCalls, 2)
assert.equal(projectTextArtifactView('artifact.html', undefined, afterReject).available, true)
let missedCalls = 0
const afterMiss = await readTextArtifactWithRetry(async () => {
  missedCalls += 1
  return missedCalls === 1
    ? { found: false, content: '' }
    : { found: true, content: 'recovered after miss' }
}, 'artifact.html', new AbortController().signal, [0, 0])
assert.equal(afterMiss, 'recovered after miss', 'a transient miss retries without a state identity change')
assert.equal(missedCalls, 2)
assert.equal(projectTextArtifactView('artifact.html', undefined, afterMiss).available, true)
let emptyCalls = 0
const afterEmpty = await readTextArtifactWithRetry(async () => {
  emptyCalls += 1
  return emptyCalls === 1
    ? { found: true, content: '' }
    : { found: true, content: 'recovered after empty response' }
}, 'artifact.html', new AbortController().signal, [0, 0])
assert.equal(afterEmpty, 'recovered after empty response', 'empty text is not cached as a usable artifact')
assert.equal(emptyCalls, 2)
const cancelledController = new AbortController()
let cancelledCalls = 0
const cancelledRead = readTextArtifactWithRetry(async () => {
  cancelledCalls += 1
  return { found: true, content: 'too late' }
}, 'artifact.html', cancelledController.signal, [50])
cancelledController.abort()
assert.equal(await cancelledRead, undefined, 'cancellation stops a pending backoff without publishing a late result')
assert.equal(cancelledCalls, 0)

const authored = {
  rounds: {
    'R-001': {
      round_id: 'R-001',
      topic: 'Durable research',
      stage: 'completed',
      directions: {
        evidence: {
          direction_id: 'evidence',
          title: 'Evidence',
          status: 'completed',
          findings_file: 'research/R-001/evidence.md',
        },
      },
      direction_order: ['evidence'],
      conclusion_file: 'research/R-001/conclusion.html',
    },
  },
  round_order: ['R-001'],
  current_round_id: 'R-001',
}
const files = { 'research/R-001/evidence.md': 'evidence', 'research/R-001/conclusion.html': 'conclusion' }
const projected = projectResearchPanelState(authored, [], files)
const projectedRound = projected.rounds['R-001']
assert.equal(projectedRound.stage, 'completed', 'the canonical conclusion ref drives the completed round')
assert.equal(projectedRound.directions.evidence.status, 'completed', 'the canonical findings ref drives durable completion')

const durablePartial = projectResearchPanelState({
  ...authored,
  rounds: {
    'R-001': {
      ...authored.rounds['R-001'],
      directions: {
        ...authored.rounds['R-001'].directions,
        gap: {
          direction_id: 'gap',
          title: 'Evidence gap',
          status: 'completed',
        },
      },
      direction_order: ['evidence', 'gap'],
    },
  },
}, [], files)
assert.equal(
  durablePartial.rounds['R-001'].stage,
  'partial',
  'a missing findings file makes an accepted conclusion partial regardless of legacy direction status',
)

const loading = researchRoundItem(projectedRound, {})
assert.equal(loading.conclusion_loading, true)
assert.equal(loading.conclusion_available, false)
assert.equal(loading.directions[0].findings_loading, true)
assert.equal(loading.directions[0].findings_available, false)

const unavailable = researchRoundItem(projectedRound, {
  'research/R-001/evidence.md': null,
  'research/R-001/conclusion.html': null,
})
assert.equal(unavailable.conclusion_loading, false)
assert.equal(unavailable.conclusion_available, false)
assert.equal(unavailable.directions[0].findings_loading, false)
assert.equal(unavailable.directions[0].findings_available, false)

const hydrated = researchRoundItem(projectedRound, {
  'research/R-001/evidence.md': '# Findings\n\nVerified evidence.',
  'research/R-001/conclusion.html': '<!doctype html><html><body>Conclusion</body></html>',
})
assert.equal(hydrated.conclusion_available, true)
assert.match(hydrated.conclusion, /Conclusion/)
assert.equal(hydrated.directions[0].findings_available, true)
assert.match(hydrated.directions[0].findings, /Verified evidence/)

const previousTraces = {
  traces: {
    'D-001': [{ timestamp: 1, event_type: 'search', message: 'last good A' }],
    'D-002': [{ timestamp: 2, event_type: 'search', message: 'last good B' }],
  },
  unavailable: {},
  runIds: { 'D-001': 'run-a', 'D-002': 'run-b' },
}
const partialTraceFailure = mergeExecutionTracePoll(previousTraces, [['D-001', 'run-a'], ['D-002', 'run-b']], [
  { artifactId: 'D-001', runId: 'run-a', rejected: true },
  { artifactId: 'D-002', runId: 'run-b', read: { found: true, revision: '2', entries: [{ seq: 3, timestamp: 3, eventType: 'fetch', message: 'fresh B' }] } },
])
assert.equal(partialTraceFailure.traces['D-001'][0].message, 'last good A', 'one rejected log read preserves its last-good trace')
assert.equal(partialTraceFailure.traces['D-002'][0].message, 'fresh B', 'one rejected log read does not block another direction')
assert.equal(partialTraceFailure.unavailable['D-001'], true)
assert.equal(partialTraceFailure.unavailable['D-002'], undefined)
const startupRace = mergeExecutionTracePoll(partialTraceFailure, [['D-001', 'run-a'], ['D-002', 'run-b']], [
  { artifactId: 'D-001', runId: 'run-a', read: { found: false, revision: null, entries: [] } },
])
assert.equal(startupRace.traces['D-001'][0].message, 'last good A', 'found:false is a startup wait and preserves prior trace')
assert.equal(startupRace.unavailable['D-001'], undefined, 'a reachable endpoint clears the transport warning')
const replacementRun = mergeExecutionTracePoll(
  partialTraceFailure,
  [['D-001', 'run-new'], ['D-002', 'run-b']],
  [],
)
assert.equal(replacementRun.traces['D-001'], undefined, 'before a new Worker log request settles, it never inherits the previous run trace')
assert.equal(replacementRun.unavailable['D-001'], undefined, 'before a new Worker log request settles, it never inherits the previous run warning')

const rootDetail = await readFile(new URL('./src/client/ported/design/ResearchPanel/ResearchRootDetail.tsx', import.meta.url), 'utf8')
const directionDetail = await readFile(new URL('./src/client/ported/design/ResearchPanel/ResearchDirectionDetail.tsx', import.meta.url), 'utf8')
const directionList = await readFile(new URL('./src/client/ported/design/ResearchPanel/ResearchDirectionList.tsx', import.meta.url), 'utf8')
const researchAdapter = await readFile(new URL('./src/client/panels/research.tsx', import.meta.url), 'utf8')
const flowAdapter = await readFile(new URL('./src/client/panels/flow-design.tsx', import.meta.url), 'utf8')
const flowPanel = await readFile(new URL('./src/client/ported/design/FlowDesignPanel/FlowDesignPanel.tsx', import.meta.url), 'utf8')
const pageAdapter = await readFile(new URL('./src/client/panels/page-design.tsx', import.meta.url), 'utf8')
const pagePreview = await readFile(new URL('./src/client/ported/design/PageDesignPanel/PagePreview.tsx', import.meta.url), 'utf8')
const hydration = await readFile(new URL('./src/client/panels/artifact-text-hydration.ts', import.meta.url), 'utf8')
assert.match(rootDetail, /if \(!hasConclusionRef \|\| \(producerActive[\s\S]*?ResearchRoundDashboard/, 'the live dashboard remains visible while the Producer is still integrating an unreadable conclusion')
assert.match(rootDetail, /conclusion_loading[\s\S]*?Loading research conclusion/, 'round selection exposes conclusion loading')
assert.match(rootDetail, /conclusion_available[\s\S]*?research conclusion file is currently unavailable/, 'round selection exposes unavailable conclusion')
assert.match(rootDetail, /srcDoc=\{round\.conclusion \?\? ''\}/, 'hydrated HTML conclusion renders in the sandboxed iframe')
assert.match(directionDetail, /ModuleMarkDown[\s\S]*?direction\.findings/, 'hydrated direction findings render as Markdown')
assert.match(directionDetail, /findingsUnavailable[\s\S]*?research report file is currently unavailable/, 'direction selection exposes unavailable findings')
assert.match(traceSectionSource, /实时日志暂不可用，正在重试/, 'rolling trace exposes retrying transport failure without a fake Worker error')
assert.match(researchAdapter, /visibleState[\s\S]*?mergeExecutionTracePoll\(state, refs, \[\]\)[\s\S]*?return visibleState/, 'rendering filters stale run identities before the next log RPC settles')
assert.match(researchAdapter, /subscribeLivePoll/, 'Research Worker traces use the browser-wide polling clock')
assert.doesNotMatch(researchAdapter, /setInterval/, 'Research Worker traces do not create a private polling timer')
assert.match(researchAdapter, /round\.round_id === state\.current_round_id[\s\S]*?current \? traceState\.traces : \{\}[\s\S]*?current \? traceState\.unavailable : \{\}/, 'rolling traces are attached only to the current round when direction ids are reused')
assert.match(directionList, /stage === 'completed' \|\| round\.conclusion_file/, 'durable completed rounds do not depend on hydration timing for their badge')
assert.doesNotMatch(hydration, /Promise\.all/, 'a slow sibling cannot hold the whole preview batch')
assert.match(hydration, /controller\.abort\(\)/, 'in-flight reconnect retries cancel on unmount or file replacement')
assert.match(researchAdapter, /useTextArtifactContents\(entries/, 'Research uses the shared reconnecting hydration hook')
assert.match(flowAdapter, /projectTextArtifactView\(process\.bpmn_file/, 'Flow uses the shared text-artifact hydration semantics')
assert.match(flowAdapter, /useTextArtifactContents\(/, 'Flow uses the shared reconnecting hydration hook')
assert.match(flowPanel, /bpmn_loading[\s\S]*?flow_diagram_loading_artifact[\s\S]*?flow_generated_diagram_unavailable/, 'Flow distinguishes loading and unavailable published BPMN')
assert.match(pageAdapter, /projectTextArtifactView\(page\.artifact_file/, 'Page uses the shared text-artifact hydration semantics')
assert.match(pageAdapter, /useTextArtifactContents\(/, 'Page uses the shared reconnecting hydration hook')
assert.match(pagePreview, /artifactLoading[\s\S]*?page_design_preview_loading_artifact[\s\S]*?page_design_preview_unavailable/, 'Page distinguishes loading and unavailable published HTML')

console.log('WEB APP RESEARCH ARTIFACT RENDERING OK')
