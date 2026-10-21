#!/usr/bin/env node
/** Session behavior acceptance for the Design dock lifecycle. */
import assert from 'node:assert/strict'

import {
  activateDesignDockSession,
  currentDockSession,
  rail,
  setSessionDockOpen,
} from './lib/index.js'

const open = () => rail.getSnapshot().open

// A new session starts with the dock closed.
activateDesignDockSession('session-a')
assert.equal(currentDockSession(), 'session-a')
assert.equal(open(), false, 'a session starts with the dock closed')

// Manual open belongs to the session that triggered it.
setSessionDockOpen('session-a', true, { focus: { skill: 'research', nonce: 1 } })
assert.equal(open(), true, 'a manual open shows the dock for its own session')

// Creating a new session closes the dock instead of inheriting session A.
activateDesignDockSession('session-b')
assert.equal(open(), false, 'a new session must not inherit another session\'s open dock')
assert.equal(rail.getSnapshot().focus, undefined, 'transient focus never crosses a session switch')
assert.equal(rail.getSnapshot().activity, undefined, 'transient activity never crosses a session switch')

// Restoring session A shows its own state; session B stays closed on return.
setSessionDockOpen('session-b', true)
activateDesignDockSession('session-a')
assert.equal(open(), true, 'a restored session shows its own open state')
activateDesignDockSession('session-b')
assert.equal(open(), true, 'each session keeps its own open state')
setSessionDockOpen('session-b', false)
activateDesignDockSession('session-a')
assert.equal(open(), true, 'closing one session never closes another')

// A late event attributed to an inactive session is dropped entirely.
activateDesignDockSession('session-c')
setSessionDockOpen('session-a', true, {
  activity: { sessionId: 'session-a', seq: 9 },
  focus: { skill: 'page_design', nonce: 4 },
})
assert.equal(open(), false, 'a late event from another session must not reopen the current one')
assert.equal(rail.getSnapshot().activity, undefined, 'a dropped late event publishes no projection')

// Manual open still works for the current session after the dropped event.
setSessionDockOpen('session-c', true)
assert.equal(open(), true, 'the current session can still open the dock manually')

// Project selection alone never opens the dock; detaching the project still closes it.
const { readFile } = await import('node:fs/promises')
const source = await readFile(new URL('./src/client/index.tsx', import.meta.url), 'utf8')
assert.match(source, /isZh \? 'Yugoo设计' : 'Yugoo Design'/, 'the Design toggle title must follow the Host language')
const projectSelectionMarker = source.indexOf('// Selecting or creating a project only enables the Design button')
const effectStart = source.lastIndexOf('useEffect(() => {', projectSelectionMarker)
assert.ok(effectStart !== -1, 'the projectId effect must exist')
const effectEnd = source.indexOf('}, [workspace?.projectId, info.sessionId])', projectSelectionMarker)
assert.ok(effectEnd !== -1, 'the projectId effect boundary must exist')
const effectBody = source.slice(effectStart, effectEnd)
assert.match(
  effectBody,
  /projectId === null\)[\s\S]*closeDesignDock\(info\.sessionId\)/,
  'detaching the project must still close the dock',
)
assert.doesNotMatch(
  effectBody,
  /openDesignDock/,
  'a project selected with no design activity must remain closed',
)

console.log('DESIGN DOCK SESSION BEHAVIOR OK')
