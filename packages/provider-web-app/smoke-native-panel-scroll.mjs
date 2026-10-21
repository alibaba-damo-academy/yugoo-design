#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { getDesignLeftPanelSizes } from './src/client/ported/design/panelSizing.ts'

const read = async (path) => readFile(new URL(path, import.meta.url), 'utf8')
const pack = await read('./src/client/packs/web-app.tsx')
for (const renderer of ['smart-questions', 'web-app-prd-assembly', 'page-design', 'research']) {
  assert.match(pack, new RegExp(`id: 'io\\.deepseek\\.design\\.web-app\\.${renderer}\\/v1',\\s*scrollOwner: 'panel'`))
}

const smartQuestions = await read('./src/client/panels/smart-questions.tsx')
assert.match(smartQuestions, /<DesignPanelSidebar[\s\S]*?<\/DesignPanelSidebar>/)
assert.match(smartQuestions, /<main className='min-h-0 min-w-0 flex-1 overflow-y-auto/)
const frame = await read('./src/client/ported/design/OfficialWebAppPanels/NativeDesignPanelFrame.tsx')
assert.equal(frame.match(/className='design-panel-pane-content'/g)?.length, 2)
assert.match(frame, /autoSaveId=\{autoSaveId\}/)
assert.doesNotMatch(frame, /key=\{`official-design-split-/)
const resizable = await read('./src/client/ported/ui/resizable.tsx')
assert.match(resizable, /group\.getLayout\(\)\.length !== 0/)
assert.match(resizable, /group\.setLayout\(defaultLayout\)/)
assert.match(resizable, /const defaultLayoutKey = Children\.toArray\(children\)/)
const sharedCss = await read('./src/client/ported/design/panel-shared.css')
assert.match(sharedCss, /\.design-panel-pane-content,\s*\.design-panel-pane-content > \* \{\s*height: 100%;\s*min-height: 0;/)
assert.match(sharedCss, /\.design-panel-pane-content \{\s*overflow: hidden;/)
const primitives = await read('./src/client/ported/design/OfficialWebAppPanels/panelPrimitives.tsx')
assert.match(primitives, /flex h-full min-h-0 flex-col overflow-hidden/)
assert.match(primitives, /export const DesignPanelSidebar[\s\S]*?'min-h-0 flex-1 space-y-1 overflow-y-auto pr-1'/)
assert.match(primitives, /data-panel-header-variant=\{variant\}/)
assert.match(primitives, /data-panel-title='editable'/)
assert.match(primitives, /data-panel-title='static'/)
assert.match(primitives, /compact && 'h-7 w-7 shrink-0', '\[&_svg\]:!h-4 \[&_svg\]:!w-4'/)
const prd = await read('./src/client/ported/design/PrdAssemblyPanel/PrdAssemblyPanel.tsx')
assert.match(prd, /h-full min-h-0 overflow-y-auto/)
const pagePreview = await read('./src/client/ported/design/PageDesignPanel/PagePreview.tsx')
assert.match(pagePreview, /body\{overflow:auto!important\}/)
const research = await read('./src/client/ported/design/ResearchPanel/ResearchPanel.tsx')
assert.match(research, /flex-1 min-h-0 overflow-y-auto/)
assert.match(research, /useDesignLeftPanelSizes\(splitContainerRef\)/)
const narrowSizes = getDesignLeftPanelSizes(160)
assert.ok(narrowSizes.minSize < narrowSizes.maxSize, 'narrow containers must retain a draggable size range')
assert.ok(narrowSizes.rightMinSize > 0, 'narrow containers must preserve visible right-panel space')
for (const file of [
  './src/client/ported/design/FlowDesignPanel/FlowDesignPanel.tsx',
  './src/client/ported/design/DesignStylePanel/DesignStylePanel.tsx',
  './src/client/ported/design/FunctionModules/FunctionModules.tsx',
]) {
  assert.doesNotMatch(await read(file), /key=\{`[^`]+defaultSize\.toFixed/)
}
for (const file of [
  './src/client/panels/business-data.tsx',
  './src/client/panels/business-rules.tsx',
  './src/client/panels/integration-design.tsx',
  './src/client/panels/role-access.tsx',
]) {
  assert.match(await read(file), /min-h-0 overflow-(?:y-)?auto/)
}

console.log('WEB APP NATIVE PANEL SCROLL CONTRACT OK')
