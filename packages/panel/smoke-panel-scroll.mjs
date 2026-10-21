#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = async (path) => readFile(new URL(path, import.meta.url), 'utf8')
const workspace = await read('./src/client/workspace.tsx')
const styles = await read('./src/client/styles.ts')
const dsl = await read('./src/client/panels/dsl-panel.tsx')

assert.match(
  workspace,
  /data-scroll-owner=\{scrollOwner\}[^]*?scrollOwner === 'workspace' \? 'overflow-y-auto' : 'overflow-hidden'/,
  'the active tab applies the renderer-declared scroll owner',
)
assert.match(styles, /\.dsh-advisory-summary\{max-height:84px;min-height:0;overflow-y:auto;/)
assert.match(styles, /\.dsh-advisory-items\{max-height:[^}]*overflow-y:auto;/)
assert.match(dsl, /dsh-design-dock-panel-body/)
assert.match(styles, /\.dsh-design-dock-panel-body\{[^}]*min-height:0;overflow-y:auto;/)
assert.match(dsl, /declarativePanelOwnsWorkspace/)
assert.match(styles, /\.dsh-design-dock-panel-body\.dsh-design-dock-panel-workspace\{height:100%;overflow:hidden;padding:0\}/)

console.log('GENERIC PANEL SCROLL CONTRACT OK')
