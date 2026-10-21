#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  PAGE_MAP_COLUMN_STEP,
  PAGE_MAP_SECTION_STEP,
  pageMapGroupedLayout,
} from './src/client/ported/design/PageDesignPanel/pageMapLayout.ts'

const labels = { primary: 'Main pages', other: 'Other pages', generic: 'Pages' }
const page = (id, extra = {}) => ({ id, name: `Page ${id}`, ...extra })
const overview = page('overview')
const detail = page('detail', { parent_id: 'overview' })
const settings = page('settings')
const records = { overview, detail, settings }
const commonSpec = {
  navigation: [
    { id: 'overview-nav', label: 'Overview', target_page_id: 'overview', group: 'Workspace' },
    { id: 'settings-nav', label: 'Settings', target_page_id: 'settings', group: 'Administration' },
  ],
}
const grouped = pageMapGroupedLayout(
  [overview, detail, settings],
  records,
  commonSpec,
  labels,
)
assert.deepEqual(grouped.sections.map(section => ({ label: section.label, pageIds: section.pageIds })), [
  { label: 'Workspace', pageIds: ['overview', 'detail'] },
  { label: 'Administration', pageIds: ['settings'] },
])
assert.deepEqual(grouped.positions.get('overview'), { x: 0, y: 0 })
assert.deepEqual(grouped.positions.get('detail'), { x: PAGE_MAP_COLUMN_STEP, y: 0 })
assert.deepEqual(grouped.positions.get('settings'), { x: 0, y: PAGE_MAP_SECTION_STEP })

const positioned = page('fixed', { canvas_position: { x: 999, y: 777 } })
const fixed = pageMapGroupedLayout([positioned], { fixed: positioned }, null, labels)
assert.equal(fixed.sections[0].label, labels.generic)
assert.deepEqual(fixed.positions.get('fixed'), { x: 999, y: 777 }, 'persisted positions remain user-owned')

const cycleA = page('cycle-a', { parent_id: 'cycle-b' })
const cycleB = page('cycle-b', { parent_id: 'cycle-a' })
const cycle = pageMapGroupedLayout(
  [cycleA, cycleB],
  { 'cycle-a': cycleA, 'cycle-b': cycleB },
  null,
  labels,
)
assert.equal(cycle.sections[0].label, labels.generic, 'cycles fall back without recursion')

const canvasSource = await readFile(
  new URL('./src/client/ported/design/PageDesignPanel/PageMapCanvas.tsx', import.meta.url),
  'utf8',
)
const panelSource = await readFile(
  new URL('./src/client/ported/design/PageDesignPanel/PageDesignPanel.tsx', import.meta.url),
  'utf8',
)
const schemaSource = await readFile(
  new URL('../skills-web-app/bundles/page_design/schema.yaml', import.meta.url),
  'utf8',
)

assert.match(canvasSource, /zIndexMode='manual'/, 'Page Map layering must use explicit manual z-index')
assert.match(canvasSource, /zIndex: 0/, 'functional sections must stay behind connections')
assert.match(canvasSource, /zIndex: 1/, 'connections must stay above functional sections')
assert.match(canvasSource, /zIndex: 2/, 'Page cards must stay above connections')
assert.match(canvasSource, /backgroundColor: '#F7F7F7'/,
  'Page Map must share the feature mind-map work-canvas background')
assert.match(canvasSource, /color='#94a3b8'[\s\S]*opacity-\[0\.15\]/,
  'Page Map dots must retain the feature mind-map contrast treatment')
assert.match(canvasSource, /PAGE_HANDLE_POSITIONS = \[[\s\S]*Position\.Top[\s\S]*Position\.Right[\s\S]*Position\.Bottom[\s\S]*Position\.Left/,
  'Page cards must expose connection anchors on all four sides')
assert.match(canvasSource, /sourceHandle: pageHandleId\('source', sourcePosition\)/)
assert.match(canvasSource, /targetHandle: pageHandleId\('target', targetPosition\)/)
assert.match(canvasSource, /<NodeResizer[\s\S]*?onResizeEnd=/,
  'a selected functional section must expose persisted resize controls')
assert.match(canvasSource, /onBlur=\{commitLabel\}/,
  'functional section titles must be directly editable')
assert.doesNotMatch(canvasSource, /hover:border-\[var\(--ds-border-default\)\]/,
  'editable section titles must not render a nested input border')
assert.match(canvasSource, /page_design_add_section/,
  'the Page Map must expose section creation')
assert.match(canvasSource, /onDelete: deleteSection/,
  'user-authored sections must be removable')
assert.match(canvasSource, /canvasSections === undefined[\s\S]*?automaticSections[\s\S]*?Object\.values\(canvasSections\)/,
  'absent sections must mean auto projection while an explicit empty record means no sections')
assert.match(canvasSource, /onNodeDragStart=[\s\S]*?onNodeDrag=[\s\S]*?onNodeDragStop=/,
  'dragging a section must translate its Page cards and settle their positions')
assert.match(canvasSource, /nodesConnectable=\{!disabled\}/,
  'Page Map connections must be directly authorable')
assert.match(canvasSource, /onConnect=\{\(connection\) =>/,
  'new Page Map connections must reach the panel state callback')
assert.match(panelSource, /canvas_sections: sections/,
  'section title and geometry edits must persist through the panel state')
assert.match(panelSource, /artifact_file: ''/,
  'navigation edits must invalidate the affected source Page by clearing its accepted ref')
assert.match(schemaSource, /canvas_sections:[\s\S]*?canvas_position:[\s\S]*?canvas_size:/,
  'the canonical Page Design schema must accept user-authored section geometry')
console.log('PAGE MAP PANEL LAYOUT OK')
