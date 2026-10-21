#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = async (path) => readFile(new URL(path, import.meta.url), 'utf8')

const workspace = await read('./src/client/workspace.tsx')

assert.equal(
  workspace.match(/<DesignPanelSurface>/g)?.length,
  1,
  'SkillPanel must add the shared Surface exactly once',
)
assert.match(
  workspace,
  /if \(props\.presentation\.mode === 'declarative'\)[\s\S]*?content = <DslPanel[\s\S]*?else if \(props\.presentation\.mode === 'invalid'\)[\s\S]*?content = <div[\s\S]*?else \{[\s\S]*?content = definition\.render[\s\S]*?return <DesignPanelSurface>\{content\}<\/DesignPanelSurface>/,
  'declarative, invalid, missing-renderer, and native presentations must converge on the shared Surface',
)
assert.match(
  workspace,
  /PANEL_SAVE_VISIBLE_MESSAGE = \{ zh: '保存并继续设计', en: 'Save and continue designing' \}/,
  'panel save must send only a concise localized visible message',
)
assert.doesNotMatch(
  workspace,
  /Treat the injected <panel_save_context>|Do not rerun the saved Design skill/,
  'model-only panel save guidance must not be sent as visible chat text',
)
assert.doesNotMatch(
  workspace,
  /props\.skill\s*(?:===|!==)|switch\s*\(props\.skill\)/,
  'the shared Surface must not branch on panel names',
)
assert.match(
  workspace,
  /className='ai relative h-0 min-h-0 flex-1 overflow-hidden'[\s\S]*?style=\{\{ padding: 'var\(--ds-space-4\) 0 var\(--ds-space-4\) var\(--ds-space-4\)' \}\}/,
  'the workspace must preserve the top, left, and bottom frame inset while its panel surface reaches the dock right edge',
)
assert.match(
  workspace,
  /data-testid='dsh-design-workspace-readonly'/,
  'recovery and unconfigured projects must render an explicit read-only notice',
)
assert.match(
  workspace,
  /if \(!writable \|\| sessionId === undefined \|\| store\.saving\) return/g,
  'panel save and driver actions must both reject browser-side recovery writes',
)
assert.match(
  workspace,
  /addDisabled=\{!writable\}/,
  'recovery mode must disable new-skill engagement',
)
assert.match(
  workspace,
  /\{\.\.\.\(writable \? \{\} : \{ inert: '' \}\)\}/,
  'recovery mode must make projected panel controls inert while preserving their readable state',
)

console.log('GENERIC DESIGN PANEL SURFACE OK')
