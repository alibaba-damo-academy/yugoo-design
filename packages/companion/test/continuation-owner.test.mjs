import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../src/client.tsx', import.meta.url), 'utf8')

test('Companion does not render or gate on the retired draft-observation owner', () => {
  assert.doesNotMatch(source, /drafts\.notice|usePanelDraftObservation|observePanelDraft/)
})

test('continuation keeps shared workspace draft, saving and readiness guards', () => {
  assert.match(source, /setPanelDirty\(value\?\.dirty \?\? false\)/)
  assert.match(source, /setPanelSaving\(value\?\.saving \?\? false\)/)
  assert.match(source, /setPanelControlsReady\(value !== undefined\)/)
  assert.match(source, /pollError \|\| !panelControlsReady/)
  assert.match(source, /: panelDirty\s*\? /)
  assert.match(source, /: panelSaving \|\| recoveringNotification/)
  assert.match(source, /: unresolvedSave/)
  assert.match(source, /onControlsChange=\{publishControls\}/)
})
