import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ExecutionRollingLog,
  isNewConversationLogTerminal,
  mergeExecutionLogRead,
  reconcileConversationLogExpanded,
} from './src/client/execution-rolling-log.tsx'
import { producerExecutionForCall } from './src/client/design-activity.ts'
import { DOCK_CSS } from './src/client/styles.ts'

assert.equal(
  reconcileConversationLogExpanded(false, undefined, 'run-1', false, true),
  true,
  'a newly bound active Producer opens its log',
)
assert.equal(
  reconcileConversationLogExpanded(true, 'run-1', 'run-1', true, false),
  false,
  'a Producer that just completed folds its log',
)
assert.equal(
  reconcileConversationLogExpanded(false, 'run-1', 'run-1', true, true),
  false,
  'manual collapse is preserved while the Producer remains active',
)
assert.equal(
  reconcileConversationLogExpanded(true, 'run-1', 'run-1', false, false),
  true,
  'manual expansion is preserved after completion',
)
assert.equal(
  reconcileConversationLogExpanded(true, 'run-1', 'run-2', false, false),
  false,
  'a completed historical run starts folded when the row is rebound',
)

const workingRoot = {
  projectId: 'project-1', invocationId: 'invocation-1', rootCallId: 'call-1', skill: 'research',
  artifactId: 'research', attemptId: 'attempt-1', runId: 'run-1', parentRunId: 'session-1',
  role: 'producer', phase: 'working', sequence: 1, timestamp: 1,
}
const completedRoot = { ...workingRoot, phase: 'completed', sequence: 2, timestamp: 2 }
assert.equal(
  producerExecutionForCall([workingRoot, completedRoot], 'research', 'call-1', true)?.sequence,
  2,
  'the conversation row observes the exact root Producer terminal sequence even while the parent tool is running',
)
assert.equal(isNewConversationLogTerminal(undefined, completedRoot.sequence), true)
assert.equal(isNewConversationLogTerminal(completedRoot.sequence, completedRoot.sequence), false)
assert.match(DOCK_CSS, /\.dsh-execution-log-toggle\{appearance:none;outline:none\}/)
assert.match(DOCK_CSS, /\.dsh-execution-log-toggle:focus-visible\{outline:none;[^}]*box-shadow:inset 0 0 0 2px/)
const collapsedMarkup = renderToStaticMarkup(createElement(ExecutionRollingLog, {
  runId: 'run-1',
  active: false,
  presentation: 'conversation',
  readExecutionLog: async () => ({ found: true, revision: 'run-1:1', reset: false, entries: [] }),
}))
assert.match(collapsedMarkup, /class="dsh-execution-log-toggle"/)
assert.match(collapsedMarkup, /aria-expanded="false"/)
const toggleStyle = collapsedMarkup.match(/<button[^>]*style="([^"]*)"/)[1]
assert.match(toggleStyle, /border-bottom:0/)
assert.doesNotMatch(toggleStyle, /(?:^|;)border:/, 'do not mix border shorthand with the dynamic bottom edge')

const first = {
  found: true,
  revision: 'run-1:1',
  reset: false,
  entries: [{ seq: 1, timestamp: 1, eventType: 'message', message: 'first' }],
}
const appended = mergeExecutionLogRead(first, {
  found: true,
  revision: 'run-1:2',
  reset: false,
  entries: [{ seq: 2, timestamp: 2, eventType: 'search', message: 'second' }],
})
assert.deepEqual(appended?.entries.map(entry => entry.seq), [1, 2], 'cursor deltas append to the visible transcript')
const replaced = mergeExecutionLogRead(appended, {
  found: true,
  revision: 'run-1:3',
  reset: true,
  entries: [{ seq: 3, timestamp: 3, eventType: 'message', message: 'reset snapshot' }],
})
assert.deepEqual(replaced?.entries.map(entry => entry.seq), [3], 'a reset snapshot replaces stale accumulated entries')

console.log('execution log lifecycle smoke test passed')
