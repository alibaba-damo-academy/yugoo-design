/**
 * Workspace emission equality contract: the poll dedupe must treat the
 * clarity view as listener-visible state, so an authority-only repair (same
 * checkpoint and journal revision) still reaches workspace listeners.
 */
import assert from 'node:assert/strict'
import { equalWorkspaceEmission } from './src/client/types.ts'
import { equalClarityViews } from './src/client/clarity.ts'
import { workspacePollAdmission } from './src/client/workspace-poll-policy.ts'

const clarity = {
  assessment: { kit: 'web_app', version: '1.0', u: 60, s: 50, t: 40 },
  needsReassessment: false,
}
const snapshot = {
  projectId: 'project-1',
  projectName: 'Demo',
  projectPath: '/home/user/.dsh/design-projects/demo',
  checkpoint: 'checkpoint-1',
  worktreeRevision: 'worktree:one',
  access: { mode: 'writable', writable: true, kit: { name: 'web_app', version: '1.0' } },
  journalRevision: 7,
  design: {},
  continuations: [],
  mustEditHandoffs: [],
  activeMainBundles: [],
  clarity,
}

assert.equal(equalWorkspaceEmission(snapshot, structuredClone(snapshot)), true, 'identical emissions dedupe')
assert.equal(equalWorkspaceEmission(snapshot, { ...snapshot, access: { mode: 'unconfigured', writable: false } }), false,
  'permission changes must emit even when files and checkpoints do not change')
assert.equal(equalWorkspaceEmission(snapshot, { ...snapshot, publicationError: 'Git is unavailable' }), false,
  'publication diagnostics must not be suppressed by poll dedupe')
const presentation = { ...snapshot, design: { demo: { state: {}, panelYaml: 'old', origin: 'agent' } } }
assert.equal(equalWorkspaceEmission(presentation, { ...presentation, design: { demo: { ...presentation.design.demo, panelYaml: 'new' } } }), false,
  'same-version Kit presentation changes must emit without a file edit')
assert.equal(
  equalClarityViews(clarity, structuredClone(clarity)),
  true,
  'identical clarity views compare equal',
)

const onlyStalenessFlipped = structuredClone(snapshot)
onlyStalenessFlipped.clarity.needsReassessment = true
assert.equal(equalWorkspaceEmission(snapshot, onlyStalenessFlipped), false, 'a staleness-only repair must emit')

const onlyAssessmentChanged = structuredClone(snapshot)
onlyAssessmentChanged.clarity.assessment.u = 61
assert.equal(equalWorkspaceEmission(snapshot, onlyAssessmentChanged), false, 'an assessment-only repair must emit')

const assessmentAppeared = structuredClone(snapshot)
assessmentAppeared.clarity = { assessment: clarity.assessment, needsReassessment: false }
const assessmentAbsent = structuredClone(snapshot)
assessmentAbsent.clarity = { assessment: null, needsReassessment: false }
assert.equal(equalWorkspaceEmission(assessmentAbsent, assessmentAppeared), false, 'a first assessment must emit')
assert.equal(
  equalClarityViews(assessmentAbsent.clarity, assessmentAbsent.clarity),
  true,
  'two absent assessments compare equal',
)

const checkpointMoved = structuredClone(snapshot)
checkpointMoved.checkpoint = 'checkpoint-2'
assert.equal(equalWorkspaceEmission(snapshot, checkpointMoved), false, 'a checkpoint change still emits')

const artifactLanded = structuredClone(snapshot)
artifactLanded.worktreeRevision = 'worktree:two'
assert.equal(equalWorkspaceEmission(snapshot, artifactLanded), false, 'a current-file artifact change must emit without a Git checkpoint')

const generatedPanelLanded = structuredClone(snapshot)
generatedPanelLanded.autoPanelManifests = { decision_brief: '{"version":1}' }
assert.equal(equalWorkspaceEmission(snapshot, generatedPanelLanded), false, 'a derived auto Panel publication must emit without a Design File commit')

const autoPanelQueued = structuredClone(snapshot)
autoPanelQueued.autoPanelStates = { decision_brief: { phase: 'queued', target: 'r1' } }
assert.equal(equalWorkspaceEmission(snapshot, autoPanelQueued), false, 'auto Panel generation progress must emit without a Design File commit')

const gateAppeared = structuredClone(snapshot)
gateAppeared.continuations = [{
  skill: 'research', invocationId: 'research-run-1', routeId: 'execute_plan',
  label: { zh: '继续', en: 'Continue' }, journalRevision: 7,
}]
assert.equal(equalWorkspaceEmission(snapshot, gateAppeared), false, 'a gate-only projection change must emit across refresh polling')

const editGateAppeared = structuredClone(snapshot)
editGateAppeared.mustEditHandoffs = [{ skill: 'example', pin: { projectId: snapshot.projectId, stateRevision: snapshot.checkpoint, invocationId: 'edit-run' } }]
assert.equal(equalWorkspaceEmission(snapshot, editGateAppeared), false, 'an edit handoff change must reach the workspace')
assert.equal(equalWorkspaceEmission(editGateAppeared, structuredClone(editGateAppeared)), true)
assert.equal(equalWorkspaceEmission(editGateAppeared, snapshot), false, 'consumption must remove the edit instruction')

const mainStarted = structuredClone(editGateAppeared)
mainStarted.activeMainBundles = [{ skill: 'example', invocationId: 'main-run' }]
assert.equal(equalWorkspaceEmission(editGateAppeared, mainStarted), false, 'main start must hide edit guidance even before any file changes')
assert.equal(equalWorkspaceEmission(mainStarted, editGateAppeared), false, 'main settlement must re-enable current edit guidance')
const anotherMain = structuredClone(mainStarted)
anotherMain.activeMainBundles[0].invocationId = 'next-run'
assert.equal(equalWorkspaceEmission(mainStarted, anotherMain), false, 'a different running invocation must emit')
assert.equal(equalWorkspaceEmission(mainStarted, structuredClone(mainStarted)), true)

assert.equal(workspacePollAdmission(1, 2, 1, true), 'stop', 'an old generation cannot resubscribe itself')
assert.equal(
  workspacePollAdmission(3, 3, 1, true),
  'defer',
  'a new subscriber arriving during the prior in-flight read keeps a future poll armed',
)
assert.equal(workspacePollAdmission(3, 3, 1, false), 'start', 'the deferred generation starts after the in-flight read settles')

console.log('PANEL WORKSPACE CLARITY EMIT OK')

const explained = structuredClone(snapshot)
explained.clarity.explanation = { summary: '项目评分', u: '意图依据', s: '结构依据', t: '验收依据', assessedCheckpoint: 'checkpoint-1' }
assert.equal(equalWorkspaceEmission(snapshot, explained), false, 'new score explanations must reach listeners')
assert.equal(equalWorkspaceEmission(explained, structuredClone(explained)), true)
const changedReason = structuredClone(explained)
changedReason.clarity.explanation.s = '同分但依据已变化'
assert.equal(equalWorkspaceEmission(explained, changedReason), false, 'same scores with changed evidence must emit')
