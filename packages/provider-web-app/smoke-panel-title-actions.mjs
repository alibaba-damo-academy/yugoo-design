#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = async (path) => readFile(new URL(path, import.meta.url), 'utf8')

const primitives = await read('./src/client/ported/design/OfficialWebAppPanels/panelPrimitives.tsx')
const collapsiblePanel = await read('./src/client/ported/design/collapsible-panel.tsx')
const compiledCss = await read('./src/client/generated/design.tw.css')
assert.match(primitives, /data-panel-header-variant=\{variant\}/, 'the shared header must expose its detail/workspace variant')
assert.match(primitives, /data-panel-title='editable'/, 'editable titles must use the shared title treatment')
assert.match(primitives, /data-panel-title='static'/, 'static titles must use the shared title treatment')
assert.match(primitives, /\[&_svg\]:!h-4 \[&_svg\]:!w-4/, 'all shared delete icons must render at 16px')
assert.match(
  collapsiblePanel,
  /px-\[var\(--ds-space-4\)\]/,
  'shared collapsible titles must align to the 16px panel-edge spacing token',
)
assert.doesNotMatch(collapsiblePanel, /px-\[12px\]/, 'shared collapsible titles must not restore the cramped 12px inset')
assert.match(
  compiledCss,
  /padding-left:var\(--ds-space-4\);padding-right:var\(--ds-space-4\)/,
  'the built provider stylesheet must include the shared collapsible-title inset',
)

const detailPanels = [
  './src/client/panels/business-data.tsx',
  './src/client/panels/business-rules.tsx',
  './src/client/panels/role-access.tsx',
  './src/client/panels/integration-design.tsx',
  './src/client/ported/design/OfficialWebAppPanels/NotificationDesignPanel.tsx',
  './src/client/ported/design/OfficialWebAppPanels/QualityAcceptancePanel.tsx',
]

for (const file of detailPanels) {
  const source = await read(file)
  assert.match(source, /<DesignPanelHeader>/, `${file} must use the shared detail title bar`)
  assert.match(source, /<EditablePanelTitle\b/, `${file} must use the shared editable title`)
  assert.match(source, /<DeleteButton\b/, `${file} must use the shared delete action`)
  assert.doesNotMatch(source, /\bTrash2\b/, `${file} must not restore a panel-local delete icon`)
}

for (const file of [
  './src/client/panels/business-data.tsx',
  './src/client/panels/role-access.tsx',
  './src/client/ported/design/OfficialWebAppPanels/QualityAcceptancePanel.tsx',
]) {
  const source = await read(file)
  assert.match(source, /<Section\b/, `${file} must use the shared section title treatment`)
}

console.log('WEB APP PANEL TITLE AND ACTION CONFORMANCE OK')
