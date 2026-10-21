import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver']) globalThis[key] = dom.window[key]
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { renderManifest, applyDesignEditToDraft } = await import('../src/interpreter.ts')
const base = new URL('../../skills-web-app/bundles/ai_agent_capabilities/', import.meta.url)
const manifest = parse(readFileSync(new URL('panel.yaml', base), 'utf8'))
manifest.i18n.messages = Object.fromEntries(Object.entries(manifest.i18n.locales)
  .map(([locale, path]) => [locale, JSON.parse(readFileSync(new URL(path, base), 'utf8'))]))
const original = JSON.parse(readFileSync(new URL('reference/preview.json', base), 'utf8'))

test('knowledge/memory forms differ, preserve hidden edits and legacy text, localize labels only and obey readonly', async () => {
  const root = createRoot(document.getElementById('root'))
  let data = structuredClone(original), locale = 'zh-CN', editable = true
  const writes = []
  // Existing broad descriptions are not migrated merely by opening the new form.
  data.knowledge_resources['K-material'].description = 'Original user content\n完整保留，不自动拆分。'
  const show = () => root.render(renderManifest(manifest, data, {
    editable, locale, onEdit: edit => { writes.push(edit); data = applyDesignEditToDraft(data, manifest, edit); show() },
    onPanelUpdate: updates => { writes.push(updates); data = { ...data, ...updates }; show() },
  }))
  const select = async name => React.act(async () => {
    const item = [...document.querySelectorAll('.dsh-panel-workspace-tree-item')].find(el => el.textContent === name)
    assert.ok(item, name); item.click()
  })
  const field = key => document.querySelector(`[data-field="${key}"]`)
  const textarea = key => field(key)?.querySelector('textarea')
  const change = async (key, value) => React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(textarea(key), value)
    textarea(key).dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  const kind = async value => React.act(async () => {
    const index = ['knowledge_base', 'long_term_memory'].indexOf(value)
    assert.ok(index >= 0)
    field('kind').querySelectorAll('input')[index].click()
  })
  try {
    const beforeOpen = structuredClone(data)
    await React.act(show); await select(original.knowledge_resources['K-material'].name)
    assert.equal(textarea('description').getAttribute('aria-label'), '资料内容')
    assert.equal(textarea('description').value, beforeOpen.knowledge_resources['K-material'].description)
    assert.ok(textarea('source_and_maintenance'))
    assert.equal(field('formation_and_update'), null); assert.equal(field('user_management'), null)
    assert.deepEqual(data, beforeOpen); assert.equal(writes.length, 0)
    for (const key of ['description', 'source_and_maintenance', 'access_scope', 'notes'])
      assert.notEqual(textarea(key).getAttribute('aria-required'), 'true', key)
    await change('source_and_maintenance', '用户自己的来源维护计划\n不联网补充。')
    const library = structuredClone(data.knowledge_resources['K-material'])
    await kind('long_term_memory')
    assert.equal(field('source_and_maintenance'), null)
    assert.equal(textarea('description').getAttribute('aria-label'), '记住什么')
    assert.equal(textarea('description').value, library.description)
    await change('formation_and_update', '用户确认才形成；发生冲突时询问。')
    await change('user_management', '用户可查看、纠正和清除；清除后不自动恢复。')
    const memory = structuredClone(data.knowledge_resources['K-material'])
    await kind('knowledge_base')
    assert.equal(field('formation_and_update'), null); assert.equal(field('user_management'), null)
    assert.equal(textarea('source_and_maintenance').value, library.source_and_maintenance)
    assert.equal(data.knowledge_resources['K-material'].user_management, memory.user_management)
    await kind('long_term_memory')
    assert.equal(textarea('formation_and_update').value, memory.formation_and_update)
    const beforeLocale = structuredClone(data), count = writes.length
    locale = 'en-US'; await React.act(show)
    assert.equal(textarea('description').getAttribute('aria-label'), 'What to remember')
    assert.equal(textarea('user_management').getAttribute('aria-label'), 'User control')
    assert.equal(textarea('formation_and_update').value, memory.formation_and_update)
    assert.deepEqual(data, beforeLocale); assert.equal(writes.length, count)
    editable = false; await React.act(show)
    assert.equal(textarea('description'), null)
    for (const input of field('kind').querySelectorAll('input')) assert.equal(input.disabled, true)
    assert.deepEqual(data, beforeLocale); assert.equal(writes.length, count)
    editable = true; locale = 'zh-CN'; await React.act(show)
    await select(original.knowledge_resources['K-memory'].name)
    assert.equal(textarea('description').getAttribute('aria-label'), '记住什么')
    assert.equal(field('source_and_maintenance'), null)
    assert.deepEqual(data.knowledge_resources['K-memory'], original.knowledge_resources['K-memory'])
    await select('阅读整理助手')
    assert.equal(textarea('description').getAttribute('aria-label'), manifest.i18n.messages['zh-CN'].description,
      'kind-specific labels must not change the existing localized Agent description')
    assert.deepEqual(data.agents, original.agents)
  } finally { await React.act(() => root.unmount()) }
})
