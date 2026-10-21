#!/usr/bin/env node
/** Design workspace tab-strip placement for empty and populated projections. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const workspace = await readFile(new URL('./src/client/workspace.tsx', import.meta.url), 'utf8')
const emptyStart = workspace.indexOf('if (store.skills.length === 0)')
const populatedStart = workspace.indexOf("return (\n    <div className='flex h-full min-h-0 flex-col'>", emptyStart)

assert.notEqual(emptyStart, -1, 'workspace must retain an explicit zero-tab branch')
assert.notEqual(populatedStart, -1, 'workspace must retain the populated tab branch')

const emptyWorkspace = workspace.slice(emptyStart, populatedStart)
const populatedWorkspace = workspace.slice(populatedStart)

assert.doesNotMatch(
  emptyWorkspace,
  /className='dsh-design-tabs/,
  'zero-tab workspaces must not render a tab-strip placeholder',
)
assert.match(
  emptyWorkspace,
  /dsh-design-dock-empty flex-1/,
  'the empty content, rather than a fake tab strip, must own the remaining height',
)
assert.match(
  populatedWorkspace,
  /grid shrink-0 grid-cols-\[minmax\(0,1fr\)_auto\][\s\S]*?<DesignTabsBar\n\s+options=/,
  'a real tab strip must remain a fixed-height row directly below the project header',
)
assert.doesNotMatch(
  populatedWorkspace,
  /<DesignTabsBar\n\s+className='flex-1'/,
  'the real tab strip must not use a flex-1 height/positioning placeholder',
)

console.log('DESIGN TAB STRIP PLACEMENT OK')
