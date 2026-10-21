import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ComponentLibrary, componentExtensionPrompt } from '../src/ComponentLibrary.tsx'
import { StudioWorkspace } from '../src/StudioWorkspace.tsx'
import { StudioWorkspaceController } from '../src/controller.ts'

const skill = '---\nname: design-component\ndescription: Extend compiled components.\n---\n\nPreserve <user> facts.'
const entries = [
  { id: 'schema_field', title: 'Single Field', category: 'data', description: 'A scalar editor', generated: true, panelYaml: 'version: 1\n' },
  { id: 'execution_log', title: 'Execution Log', category: 'data', description: 'Host-owned log', generated: false },
]
const library = { entries: () => entries, skillSource: skill, renderExample: id => createElement('output', { 'data-example': 'fixed' }, id) }

test('component view is host-neutral, catalog-driven and uses accessible shared navigation', () => {
  const html = renderToStaticMarkup(createElement(ComponentLibrary, { library, locale: 'en' }))
  assert.match(html, /2 registered components/)
  assert.match(html, /data-example="fixed">schema_field/)
  assert.match(html, /Copy extension guide/)
  assert.match(html, /Copy declaration/)
  assert.match(html, /role="tab" tabindex="0" aria-selected="true"/)
  assert.match(html, /role="tab" tabindex="-1" aria-selected="false"/)
  assert.match(html, /Fixed example preview/)
  assert.match(html, /ygd-studio-component-preview-inline/)
  assert.doesNotMatch(html, /<code>schema_field<\/code>/, 'preview names are localized labels, not duplicate machine identifiers')
  assert.doesNotMatch(html, /Save|Install|Publish/)
  assert.doesNotMatch(html, /Example state|Empty data|Reset|Read-only<\/button>/, 'component documents do not expose a draft or state-testing workbench')
  assert.match(html, /<details class="ygd-studio-component-directory-group" open="">/, 'host-neutral fallback uses expandable groups')
})

test('optional backing-library metadata has a separate accessible catalog; missing metadata adds no inert tab', () => {
  const libraries = [{ packageName: 'example-ui', title: 'Example UI', version: '1.2.3', group: 'controls', purpose: { zh: '控件用途', en: 'Control purpose' } }]
  const html = renderToStaticMarkup(createElement(ComponentLibrary, { library: { ...library, libraries }, locale: 'zh' }))
  assert.match(html, /id="catalog-components"[^>]*aria-selected="true"/)
  assert.match(html, /id="catalog-libraries"[^>]*aria-selected="false"/)
  assert.match(html, /第三方库/)
  assert.match(html, /aria-labelledby="catalog-components"/)
  assert.doesNotMatch(renderToStaticMarkup(createElement(ComponentLibrary, { library, locale: 'en' })), /catalog-libraries/)
})

test('UI component library is a bottom sidebar utility rather than another primary content section', async () => {
  const client = { workspace: async () => ({ query: '', kits: [], bundles: [] }) }
  const controller = new StudioWorkspaceController(client)
  await controller.load()
  const html = renderToStaticMarkup(createElement(StudioWorkspace, { client, controller, componentLibrary: library, locale: 'zh' }))
  const footer = html.slice(html.indexOf('<div class="ygd-studio-sidebar-footer">'))
  assert.match(footer, /ygd-studio-sidebar-utilities[\s\S]*>面板组件库<\/button>/)
  assert.doesNotMatch(html.slice(html.indexOf('<aside'), html.indexOf('<div class="ygd-studio-sidebar-footer">')), />面板组件库<\/button>/)
  assert.ok(footer.indexOf('面板组件库') < footer.indexOf('ygd-studio-language'), 'utility sits above the existing bottom locale switch')
})

test('unpreviewed entries remain browsable without invented samples or execution claims', () => {
  const html = renderToStaticMarkup(createElement(ComponentLibrary, { library: { ...library, entries: () => entries.slice(1) }, locale: 'zh' }))
  assert.match(html, /需要完整工作区或宿主数据/)
  assert.match(html, /暂未提供独立交互样例/)
  assert.doesNotMatch(html, /data-example=|复制声明|AI 生成可用/)
  assert.equal(renderToStaticMarkup(createElement(ComponentLibrary, { library: { ...library, entries: () => [] }, locale: 'en' })).includes('This host supplies no component catalog.'), true)
})

test('copyable extension prompt carries the exact bundled method and clear source-only boundaries', () => {
  for (const locale of ['zh', 'en']) {
    const prompt = componentExtensionPrompt(skill, locale)
    assert.equal(prompt.slice(-skill.length), skill)
    assert.match(prompt, /design-component/)
  }
  assert.match(componentExtensionPrompt(skill, 'en'), /Do not modify installed plugins/)
  assert.match(componentExtensionPrompt(skill, 'en'), /prefer existing components/)
})
