#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = async (path) => readFile(new URL(path, import.meta.url), 'utf8')

const frame = await read('./src/client/ported/design/OfficialWebAppPanels/NativeDesignPanelFrame.tsx')

assert.doesNotMatch(frame, /DesignPanelSurface/, 'the provider must not implement the generic Panel surface')
assert.match(frame, /return content/, 'the Web App frame must render inside the surface supplied by Panel')
assert.match(frame, /className='relative h-full min-h-0 overflow-hidden'/, 'nested Web App frames must retain only layout and clipping')
assert.doesNotMatch(frame, /pt-4/, 'the Web App frame must not add a blank top strip')

const handAuthoredRoots = [
  './src/client/ported/design/FunctionModules/FunctionModules.tsx',
  './src/client/ported/design/FlowDesignPanel/FlowDesignPanel.tsx',
  './src/client/ported/design/ResearchPanel/ResearchPanel.tsx',
  './src/client/ported/design/DesignStylePanel/DesignStylePanel.tsx',
]
for (const file of handAuthoredRoots) {
  const source = await read(file)
  assert.doesNotMatch(source, /className='[^']*h-full[^']*pt-4/, `${file} must not restore the removed top strip`)
  assert.doesNotMatch(
    source,
    /className='[^']*rounded-2xl[^']*border[^']*ds-divider-default|className='[^']*border[^']*ds-divider-default[^']*rounded-2xl/,
    `${file} must not duplicate the whole-panel surface chrome`,
  )
}

const pageDesign = await read('./src/client/ported/design/PageDesignPanel/PageDesignPanel.tsx')
assert.match(
  pageDesign,
  /className='h-full overflow-hidden bg-white'/,
  'the Page preview must fill the detail pane without a second card frame',
)
assert.doesNotMatch(
  pageDesign,
  /className='h-full bg-\[var\(--ds-fill-2\)\] p-4'/,
  'the Page preview must not add whitespace around the generated full-page prototype',
)

const flowDesign = await read('./src/client/ported/design/FlowDesignPanel/FlowDesignPanel.tsx')
assert.match(flowDesign, /const FlowProcessSummary/, 'Flow must use the compact upstream two-row summary')
assert.match(flowDesign, /grid-cols-\[4\.5rem_minmax\(0,1fr\)\]/, 'Flow summary labels and values must stay scan-aligned')
assert.doesNotMatch(flowDesign, /maxHeight: '40%'/, 'Flow must not reserve a large scrolling footer below the BPMN canvas')
assert.match(flowDesign, /disabled=\{expanded \|\| disabled\}/, 'Flow editing must be disabled while the Producer is attached')

const executionStatusIcon = await read('./src/client/ported/design/OfficialWebAppPanels/DesignExecutionStatusIcon.tsx')
assert.match(executionStatusIcon, /inline-flex shrink-0 items-center justify-center/, 'every execution marker must share one centered layout box')
assert.match(executionStatusIcon, /<LoaderCircle[\s\S]*?animate-spin/, 'the shared execution marker must render an explicit rotating spinner')
assert.match(
  executionStatusIcon,
  /status === 'working'[\s\S]*?animate-spin[\s\S]*?status === 'queued'[\s\S]*?Clock3[\s\S]*?status === 'completed'[\s\S]*?bg-emerald-500/,
  'the shared marker must implement the five file-backed lifecycle states',
)
for (const file of [
  './src/client/ported/design/ResearchPanel/ResearchDirectionList.tsx',
  './src/client/ported/design/ResearchPanel/ResearchRoundDashboard.tsx',
  './src/client/ported/design/FlowDesignPanel/FlowProcessNav.tsx',
  './src/client/ported/design/PageDesignPanel/PageDesignPanel.tsx',
  './src/client/ported/design/PageDesignPanel/PageMapCanvas.tsx',
  './src/client/ported/design/PageDesignPanel/PagePreview.tsx',
]) {
  const source = await read(file)
  assert.match(source, /DesignExecutionStatusIcon/, `${file} must use the shared execution status marker`)
  assert.doesNotMatch(source, /animate-spin/, `${file} must not define its own spinner`)
}

for (const file of [
  './src/client/ported/design/PageDesignPanel/PageDesignPanel.tsx',
  './src/client/ported/design/PageDesignPanel/PageMapCanvas.tsx',
]) {
  const source = await read(file)
  assert.doesNotMatch(
    source,
    /<DesignExecutionStatusIcon[\s\S]*?\/>(?:\s*)\{pageStatusLabel\(/,
    `${file} must not render visible lifecycle text after the shared status marker`,
  )
  assert.match(
    source,
    /title=\{pageStatusLabel\(/,
    `${file} must preserve the full lifecycle label as a tooltip`,
  )
}

const researchProjection = await read('./src/client/panels/research-panel-projection.ts')
assert.doesNotMatch(researchProjection, /\blive(?:Artifact|Status|Round|\?)?\b/, 'Research must not retain an in-memory activity overlay')
assert.doesNotMatch(researchProjection, /value\.status/, 'legacy canonical status must not drive Research activity')
const researchDashboard = await read('./src/client/ported/design/ResearchPanel/ResearchRoundDashboard.tsx')
assert.match(
  researchDashboard,
  /round\.stage === 'researching'[\s\S]*?<DesignExecutionStatusIcon[\s\S]*?status='working'/,
  'Research must show a spinner when the Host-projected round activity is working',
)

console.log('WEB APP PANEL SURFACE CONFORMANCE OK')
