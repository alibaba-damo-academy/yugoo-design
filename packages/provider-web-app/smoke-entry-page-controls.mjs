#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const panel = await readFile(
  new URL('./src/client/ported/design/PageDesignPanel/PageDesignPanel.tsx', import.meta.url),
  'utf8',
)

const sidebar = panel.slice(panel.indexOf('const sidebar = ('), panel.indexOf('const visualCheckSummary'))
assert.doesNotMatch(sidebar, /toggleEntryPage/, 'page rows must not repeat the entry-page action')
assert.doesNotMatch(sidebar, /<Home\b/, 'page rows must not show repeated home icons')
assert.match(sidebar, /data-testid='dsh-entry-page-marker'/, 'the current entry page must retain a non-button marker')
assert.doesNotMatch(panel, /<Home\b/, 'entry-page markers and actions must use text instead of an ambiguous house icon')
assert.match(panel, /data-testid='dsh-entry-page-action'/, 'the selected-page toolbar must own the single entry-page action')
assert.match(panel, /onClick=\{\(\) => toggleEntryPage\(selected\.id\)\}/, 'the single action must apply to the selected page')

console.log('WEB APP ENTRY PAGE CONTROLS OK')
