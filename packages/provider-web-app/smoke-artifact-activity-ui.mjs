#!/usr/bin/env node
/** Native execution + durable artifact regression for the shared five-state projection. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const { register } = await import('tsx/esm/api')
register()

const { projectFlowDesignPanelState, projectPageDesignPanelState } = await import('./src/client/panels/artifact-activity-projection.ts')
const { projectResearchPanelState } = await import('./src/client/panels/research-panel-projection.ts')
const { projectArtifactExecutionLogRunId } = await import('./src/client/panels/artifact-status-projection.ts')
const { projectPrdAssemblyStatus } = await import('./src/client/panels/prd-assembly.tsx')
const nativePack = await readFile(new URL('./src/client/packs/web-app.tsx', import.meta.url), 'utf8')
assert.match(nativePack, /<PageDesignPanel\s+\{\.\.\.props\}/u,
  'Page Design must receive the same native execution attempts and transcript reader as Research and Flow')

const prdWorkingAttempt = [
  { invocationId: 'prd-run', skill: 'web_app_prd_assembly', artifactId: 'web_app_prd_assembly', attemptId: 'root', role: 'producer', phase: 'working', sequence: 1, timestamp: 1 },
]
assert.equal(projectPrdAssemblyStatus(false, prdWorkingAttempt), 'assembling', 'PRD working state comes from the native Producer attempt')
assert.equal(projectPrdAssemblyStatus(true, prdWorkingAttempt), 'completed', 'readable PRD bytes are the durable completed fact')
assert.equal(projectPrdAssemblyStatus(false, [{ ...prdWorkingAttempt[0], phase: 'failed' }]), 'failed', 'PRD failure comes from the native Producer attempt')

const pages = projectPageDesignPanelState({
  pages: {
    pending: { id: 'pending', generation_status: 'pending' },
    queued: { id: 'queued', generation_status: 'queued' },
    working: { id: 'working', generation_status: 'working' },
    failed: { id: 'failed', generation_status: 'failed' },
    completedWithoutFile: { id: 'completedWithoutFile', generation_status: 'completed' },
    completed: { id: 'completed', generation_status: 'completed', artifact_file: 'page_design/pages/completed.html' },
    legacyRunning: { id: 'legacyRunning', generation_status: 'generating' },
  },
}, [], { 'page_design/pages/completed.html': 'completed-bytes' })
assert.equal(pages.pages?.pending?.generation_status, 'pending')
assert.equal(pages.pages?.queued?.generation_status, 'pending', 'transient queued is no longer read from canonical JSON')
assert.equal(pages.pages?.working?.generation_status, 'pending', 'transient working is no longer read from canonical JSON')
assert.equal(pages.pages?.failed?.generation_status, 'pending')
assert.equal(pages.pages?.completedWithoutFile?.generation_status, 'pending', 'legacy status cannot claim completion without an artifact ref')
assert.equal(pages.pages?.completed?.generation_status, 'completed')
assert.equal(pages.pages?.legacyRunning?.generation_status, 'pending', 'legacy transient spellings do not drive live UI state')

const attempts = [
  { invocationId: 'run-active', skill: 'page_design', artifactId: 'page_design', attemptId: 'root', role: 'producer', phase: 'working', sequence: 10, timestamp: 10, runId: 'producer-run' },
  { invocationId: 'run-active', skill: 'page_design', artifactId: 'fallback', artifactKind: 'page_html', attemptId: 'worker-1', role: 'worker', phase: 'failed', sequence: 11, timestamp: 11 },
  { invocationId: 'run-active', skill: 'page_design', artifactId: 'fallback', artifactKind: 'page_html', attemptId: 'producer-1', role: 'producer', phase: 'working', sequence: 12, timestamp: 12 },
  { invocationId: 'run-active', skill: 'page_design', artifactId: 'queued-native', artifactKind: 'page_html', attemptId: 'worker-2', role: 'worker', phase: 'queued', sequence: 13, timestamp: 13 },
  { invocationId: 'run-active', skill: 'page_design', artifactId: 'landed-first', artifactKind: 'page_html', attemptId: 'worker-4', role: 'worker', phase: 'completed', sequence: 14, timestamp: 14, receipt: { path: 'page_design/pages/landed-first.html', sha256: 'a'.repeat(64), bytes: 100 } },
]
const nativePages = projectPageDesignPanelState({
  pages: {
    fallback: { id: 'fallback', generation_status: 'pending' },
    'queued-native': { id: 'queued-native', generation_status: 'pending' },
    'landed-first': { id: 'landed-first', generation_status: 'pending' },
  },
}, attempts, { 'page_design/pages/landed-first.html': 'a'.repeat(64) })
assert.equal(nativePages.pages?.fallback?.generation_status, 'working', 'Producer fallback keeps the artifact active after Worker failure')
assert.equal(nativePages.pages?.['queued-native']?.generation_status, 'queued')
assert.equal(nativePages.pages?.['landed-first']?.generation_status, 'completed', 'a Host-verified Worker receipt is immediately visible while Producer integrates it')
assert.equal(nativePages.pages?.['landed-first']?.artifact_file, 'page_design/pages/landed-first.html')

const pathBoundPages = projectPageDesignPanelState({
  pages: {
    reused: { id: 'reused', artifact_file: 'page_design/pages/reused.html' },
  },
}, [
  { invocationId: 'path-bound', skill: 'page_design', artifactId: 'reused', artifactKind: 'page_html', artifactFile: 'page_design/pages/other.html', attemptId: 'wrong-path', role: 'worker', phase: 'working', sequence: 20, timestamp: 20 },
  { invocationId: 'path-bound', skill: 'page_design', artifactId: 'page_design', attemptId: 'root', role: 'producer', phase: 'working', sequence: 21, timestamp: 21 },
], { 'page_design/pages/reused.html': 'existing' })
assert.equal(pathBoundPages.pages?.reused?.generation_status, 'completed', 'a reused artifact id bound to another file cannot activate this Page')

const fallbackLogs = [
  { invocationId: 'run-fallback', skill: 'research', artifactId: 'D-001', artifactKind: 'research_direction', attemptId: 'worker', role: 'worker', phase: 'failed', sequence: 30, timestamp: 30, runId: 'worker-run' },
  { invocationId: 'run-fallback', skill: 'research', artifactId: 'D-001', artifactKind: 'research_direction', attemptId: 'producer', role: 'producer', phase: 'working', sequence: 31, timestamp: 31, runId: 'producer-run' },
  { invocationId: 'run-fallback', skill: 'research', artifactId: 'research', attemptId: 'root', role: 'producer', phase: 'working', sequence: 32, timestamp: 32, runId: 'producer-run' },
]
assert.equal(
  projectArtifactExecutionLogRunId('D-001', fallbackLogs, 'research_direction'),
  'producer-run',
  'explicit Producer takeover binds logs to the actual current executor',
)

const landedResearch = projectResearchPanelState({
  rounds: {
    'R-live': {
      round_id: 'R-live',
      topic: 'Live receipt',
      stage: 'researching',
      directions: { 'D-live': { direction_id: 'D-live', title: 'Live', status: 'pending' } },
      direction_order: ['D-live'],
      conclusion_file: null,
    },
  },
  round_order: ['R-live'],
  current_round_id: 'R-live',
}, [
  { invocationId: 'research-live', skill: 'research', artifactId: 'research', attemptId: 'root', role: 'producer', phase: 'working', sequence: 40, timestamp: 40, runId: 'producer-live' },
  { invocationId: 'research-live', skill: 'research', artifactId: 'D-live', artifactKind: 'research_direction', attemptId: 'worker-live', role: 'worker', phase: 'completed', sequence: 41, timestamp: 41, runId: 'worker-live', receipt: { path: 'research/R-live/D-live.md', sha256: 'd'.repeat(64), bytes: 100 } },
], { 'research/R-live/D-live.md': 'd'.repeat(64) })
assert.equal(landedResearch.rounds['R-live'].directions['D-live'].status, 'completed', 'Research retains the root attempt while projecting a direction receipt')
assert.equal(landedResearch.rounds['R-live'].directions['D-live'].findings_file, 'research/R-live/D-live.md')

const landedConclusion = projectResearchPanelState({
  rounds: {
    'R-done': {
      round_id: 'R-done',
      topic: 'Live conclusion',
      stage: 'researching',
      directions: {},
      direction_order: [],
      conclusion_file: null,
    },
  },
  round_order: ['R-done'],
  current_round_id: 'R-done',
}, [
  { invocationId: 'conclusion-live', skill: 'research', artifactId: 'research', attemptId: 'root', role: 'producer', phase: 'working', sequence: 50, timestamp: 50, runId: 'producer-live' },
  { invocationId: 'conclusion-live', skill: 'research', artifactId: 'R-done', artifactKind: 'research_conclusion', attemptId: 'conclusion-worker', role: 'worker', phase: 'completed', sequence: 51, timestamp: 51, runId: 'conclusion-worker', receipt: { path: 'research/R-done/conclusion.html', sha256: 'e'.repeat(64), bytes: 200 } },
], { 'research/R-done/conclusion.html': 'e'.repeat(64) })
assert.equal(landedConclusion.rounds['R-done'].stage, 'researching', 'the root stays active while the Producer is still integrating a verified conclusion receipt')
assert.equal(landedConclusion.rounds['R-done'].conclusion_file, 'research/R-done/conclusion.html')

const twoRoundResearch = projectResearchPanelState({
  rounds: {
    'R-001': {
      round_id: 'R-001',
      topic: 'Historical round',
      stage: 'completed',
      directions: {
        'D-001': { direction_id: 'D-001', title: 'Old direction', status: 'completed', findings_file: 'research/R-001/D-001.md' },
      },
      direction_order: ['D-001'],
      conclusion_file: 'research/R-001/conclusion.html',
    },
    'R-002': {
      round_id: 'R-002',
      topic: 'Current round',
      stage: 'identified',
      directions: {
        'D-001': { direction_id: 'D-001', title: 'New direction', status: 'pending' },
      },
      direction_order: ['D-001'],
      conclusion_file: null,
    },
  },
  round_order: ['R-001', 'R-002'],
  current_round_id: 'R-002',
}, [
  { invocationId: 'research-round-2', skill: 'research', artifactId: 'research', attemptId: 'root', role: 'producer', phase: 'working', sequence: 60, timestamp: 60, runId: 'producer-r2' },
  { invocationId: 'research-round-2', skill: 'research', artifactId: 'D-001', artifactKind: 'research_direction', attemptId: 'worker', role: 'worker', phase: 'working', sequence: 61, timestamp: 61, runId: 'worker-r2' },
], { 'research/R-001/D-001.md': 'old-md', 'research/R-001/conclusion.html': 'old-html' })
assert.equal(twoRoundResearch.rounds['R-001'].directions['D-001'].status, 'completed', 'a reused direction id cannot make a historical round active')
assert.equal(twoRoundResearch.rounds['R-001'].directions['D-001'].findings_file, 'research/R-001/D-001.md')
assert.equal(twoRoundResearch.rounds['R-002'].directions['D-001'].status, 'working', 'the current round receives the current invocation')

const staleCurrentRound = projectResearchPanelState({
  rounds: {
    'R-002': {
      round_id: 'R-002', topic: 'Actually executing', stage: 'identified',
      directions: { 'D-001': { direction_id: 'D-001', title: 'R2 direction' } },
      direction_order: ['D-001'], conclusion_file: null,
    },
    'R-003': {
      round_id: 'R-003', topic: 'Newest but idle', stage: 'identified',
      directions: { 'D-001': { direction_id: 'D-001', title: 'R3 direction' } },
      direction_order: ['D-001'], conclusion_file: null,
    },
  },
  round_order: ['R-002', 'R-003'],
  current_round_id: 'R-003',
}, [
  { invocationId: 'execute-r2', skill: 'research', artifactId: 'research', attemptId: 'root', role: 'producer', phase: 'working', sequence: 70, timestamp: 70, runId: 'producer-r2' },
  { invocationId: 'execute-r2', skill: 'research', artifactId: 'D-001', artifactKind: 'research_direction', artifactFile: 'research/R-002/D-001.md', attemptId: 'worker', role: 'worker', phase: 'working', sequence: 71, timestamp: 71, runId: 'worker-r2' },
])
assert.equal(staleCurrentRound.current_round_id, 'R-002', 'the explicitly scoped Worker binding identifies the round actually executing')
assert.equal(staleCurrentRound.rounds['R-002'].directions['D-001'].status, 'working')
assert.equal(staleCurrentRound.rounds['R-002'].stage, 'researching')
assert.equal(staleCurrentRound.rounds['R-003'].directions['D-001'].status, 'pending')
assert.equal(staleCurrentRound.rounds['R-003'].stage, 'identified')

const failedPages = projectPageDesignPanelState({
  pages: { 'failed-new': { id: 'failed-new', artifact_file: 'page_design/pages/old.html' } },
}, [
  { invocationId: 'run-failed', skill: 'page_design', artifactId: 'failed-new', artifactKind: 'page_html', attemptId: 'worker-orphan', role: 'worker', phase: 'working', sequence: 20, timestamp: 20 },
  { invocationId: 'run-failed', skill: 'page_design', artifactId: 'page_design', attemptId: 'root-failed', role: 'producer', phase: 'failed', sequence: 21, timestamp: 21 },
], { 'page_design/pages/old.html': 'old' })
assert.equal(failedPages.pages?.['failed-new']?.generation_status, 'failed', 'a readable old file does not disguise an interrupted revision as success')
assert.equal(failedPages.pages?.['failed-new']?.artifact_file, 'page_design/pages/old.html')

const newerWins = projectPageDesignPanelState({
  pages: { current: { id: 'current', artifact_file: 'page_design/pages/current.html' } },
}, [
  { invocationId: 'old', skill: 'page_design', artifactId: 'current', artifactKind: 'page_html', attemptId: 'old-worker', role: 'worker', phase: 'working', sequence: 1, timestamp: 1 },
  { invocationId: 'new', skill: 'page_design', artifactId: 'current', artifactKind: 'page_html', attemptId: 'new-worker', role: 'worker', phase: 'completed', sequence: 2, timestamp: 2, receipt: { path: 'page_design/pages/current.html', sha256: 'b'.repeat(64), bytes: 100 } },
  { invocationId: 'new', skill: 'page_design', artifactId: 'page_design', attemptId: 'new-root', role: 'producer', phase: 'completed', sequence: 3, timestamp: 3 },
], { 'page_design/pages/current.html': 'b'.repeat(64) })
assert.equal(newerWins.pages?.current?.generation_status, 'completed', 'an orphan active attempt from an older invocation cannot override a newer result')

const flow = projectFlowDesignPanelState({
  processes: {
    pending: { process_id: 'pending', generation_status: 'pending' },
    working: { process_id: 'working', generation_status: 'working' },
    completed: { process_id: 'completed', generation_status: 'completed', bpmn_file: 'flow_design/completed.bpmn' },
  },
  process_order: ['pending', 'working', 'completed'],
}, [], { 'flow_design/completed.bpmn': 'existing' })
assert.deepEqual(flow.process_order, ['pending', 'working', 'completed'])
assert.equal(flow.processes?.working?.generation_status, 'pending')
assert.equal(flow.processes?.completed?.generation_status, 'completed')

const progressiveFlow = projectFlowDesignPanelState({
  processes: {
    'P-001': { process_id: 'P-001', bpmn_file: null },
    'P-002': { process_id: 'P-002', bpmn_file: null },
  },
  process_order: ['P-001', 'P-002'],
}, [
  { invocationId: 'flow-live', skill: 'flow_design', artifactId: 'flow_design', attemptId: 'root', role: 'producer', phase: 'working', sequence: 70, timestamp: 70, runId: 'producer-live' },
  { invocationId: 'flow-live', skill: 'flow_design', artifactId: 'P-001', artifactKind: 'flow_bpmn', attemptId: 'worker-1', role: 'worker', phase: 'completed', sequence: 71, timestamp: 71, runId: 'worker-1', receipt: { path: 'flow_design/P-001.bpmn', sha256: 'f'.repeat(64), bytes: 100 } },
  { invocationId: 'flow-live', skill: 'flow_design', artifactId: 'P-002', artifactKind: 'flow_bpmn', attemptId: 'worker-2', role: 'worker', phase: 'working', sequence: 72, timestamp: 72, runId: 'worker-2' },
], { 'flow_design/P-001.bpmn': 'f'.repeat(64) })
assert.equal(progressiveFlow.processes?.['P-001']?.generation_status, 'completed')
assert.equal(progressiveFlow.processes?.['P-001']?.bpmn_file, 'flow_design/P-001.bpmn')
assert.equal(progressiveFlow.processes?.['P-001']?.bpmn_generated, true, 'a verified receipt renders the first BPMN before sibling Workers finish')
assert.equal(progressiveFlow.processes?.['P-002']?.generation_status, 'working')
assert.equal(progressiveFlow.processes?.['P-002']?.bpmn_generated, false)

const research = projectResearchPanelState({
  rounds: {
    'R-001': {
      round_id: 'R-001',
      topic: 'File truth',
      stage: 'researching',
      directions: {
        queued: { direction_id: 'queued', title: 'Queued', status: 'queued' },
        working: { direction_id: 'working', title: 'Working', status: 'working' },
        failed: { direction_id: 'failed', title: 'Failed', status: 'failed' },
        completed: { direction_id: 'completed', title: 'Completed', status: 'completed', findings_file: 'research/R-001/completed.md' },
      },
      direction_order: ['queued', 'working', 'failed', 'completed'],
      conclusion_file: null,
    },
  },
  round_order: ['R-001'],
  current_round_id: 'R-001',
}, [], { 'research/R-001/completed.md': 'existing' })
assert.equal(research.rounds?.['R-001']?.directions?.queued?.status, 'pending')
assert.equal(research.rounds?.['R-001']?.directions?.working?.status, 'pending')
assert.equal(research.rounds?.['R-001']?.directions?.failed?.status, 'pending')
assert.equal(research.rounds?.['R-001']?.directions?.completed?.status, 'completed')

const partialResearch = projectResearchPanelState({
  rounds: {
    'R-partial': {
      round_id: 'R-partial',
      topic: 'Derived partial result',
      stage: 'confirmed',
      directions: {
        landed: { direction_id: 'landed', title: 'Landed', findings_file: 'research/R-partial/landed.md' },
        missing: { direction_id: 'missing', title: 'Missing', findings_file: null },
      },
      direction_order: ['landed', 'missing'],
      conclusion_file: 'research/R-partial/conclusion.html',
    },
  },
  round_order: ['R-partial'],
  current_round_id: 'R-partial',
}, [], { 'research/R-partial/landed.md': 'md', 'research/R-partial/conclusion.html': 'html' })
assert.equal(partialResearch.rounds['R-partial'].stage, 'partial', 'Research partial status is derived from settled files, not persisted execution state')

console.log('WEB APP NATIVE EXECUTION ARTIFACT UI OK')
