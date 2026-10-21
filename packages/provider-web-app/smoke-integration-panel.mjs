#!/usr/bin/env node
/** Runtime interaction regression for the new-Plugin-only integration panel. */
import assert from 'node:assert/strict'

const { register } = await import('tsx/esm/api')
register()

const { JSDOM } = await import('jsdom')
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true,
  url: 'https://panel.test/',
})
const { window } = dom
for (const key of [
  'window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement',
  'HTMLButtonElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent',
  'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'CustomEvent',
]) {
  if (globalThis[key] === undefined) globalThis[key] = window[key]
}
// react-resizable-panels adds listeners with an AbortSignal; jsdom only accepts
// signals from its own realm, so the window implementations must win.
globalThis.AbortController = window.AbortController
globalThis.AbortSignal = window.AbortSignal
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = React
const { IntegrationDesignPanel } = await import('./src/client/panels/integration-design.tsx')

const emissions = []
let draft = { schema_version: 8, integrations: {}, integration_order: [] }
const onChange = (next) => {
  emissions.push(next)
  draft = next
}

const container = window.document.getElementById('root')
const root = createRoot(container)
const render = async () => {
  await act(async () => {
    root.render(React.createElement(IntegrationDesignPanel, { draft, onChange, running: false }))
  })
}
const click = async (label) => {
  const button = [...container.querySelectorAll('button')].find((node) => node.textContent.includes(label))
  assert.ok(button !== undefined, `missing button ${JSON.stringify(label)}`)
  await act(async () => {
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
}
const setNativeValue = (element, value) => {
  const proto = element instanceof window.HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value)
  element.dispatchEvent(new window.Event('input', { bubbles: true }))
}
const edit = async (label, value) => {
  const element = container.querySelector(`[aria-label="${label}"]`)
  assert.ok(element !== null, `missing field ${JSON.stringify(label)}`)
  await act(async () => {
    setNativeValue(element, value)
  })
}
const lastEmission = () => {
  const state = emissions.at(-1)
  assert.ok(state !== undefined, 'the panel emitted no state')
  assert.equal(state.schema_version, 8, 'every emission keeps the locked schema version')
  assert.ok(Array.isArray(state.integration_order), 'every emission carries integration_order')
  return state
}
const soleIntegration = (state) => {
  assert.deepEqual(state.integration_order.length, 1, 'exactly one integration is authored')
  const [id] = state.integration_order
  return state.integrations[id]
}

// The schema-v8 empty state renders the add entry instead of crashing.
await render()
assert.match(window.document.body.textContent, /添加系统集成/, 'the empty state must offer the add entry')
assert.doesNotMatch(window.document.body.textContent, /平台|platform/i, 'no platform Plugin reuse surface may render')
assert.equal(container.querySelector('input[name="source"]'), null, 'no source selector may render')

// Adding one connection emits a complete v8 draft with an empty record.
await click('添加系统集成')
await render()
let integration = soleIntegration(lastEmission())
assert.deepEqual({ ...integration, id: integration.id }, {
  id: integration.id,
  title: integration.title,
  description: '',
  url: '',
  secrets: {},
  secret_order: [],
  prompt_content: '',
  business_rules: '',
}, 'a new integration starts as an empty record')

// Sequential edits keep every previously authored field.
const authored = {}
const editAndVerify = async (label, field, value) => {
  await edit(label, value)
  authored[field] = value
  await render()
  integration = soleIntegration(lastEmission())
  for (const [key, expected] of Object.entries(authored)) {
    assert.equal(integration[key], expected, `editing ${field} must preserve ${key}`)
  }
}
await editAndVerify('Plugin Description', 'description', '向 WMS 创建发货任务。')
await editAndVerify('Plugin URL', 'url', 'https://wms.example.test/docs')

await click('添加 Secret')
await render()
await edit('Secret 1 Name', 'WMS_API_KEY')
await render()
await edit('Secret 1 Description', '访问 WMS 的 API 凭据')
await render()
integration = soleIntegration(lastEmission())
assert.deepEqual(integration.secret_order.length, 1, 'the created secret is ordered')
const [secretId] = integration.secret_order
assert.deepEqual(integration.secrets[secretId], {
  id: secretId,
  name: 'WMS_API_KEY',
  description: '访问 WMS 的 API 凭据',
}, 'the secret keeps its authored name and description')
assert.equal(integration.description, authored.description, 'authoring a secret preserves the description')
assert.equal(integration.url, authored.url, 'authoring a secret preserves the URL')

await editAndVerify('Plugin 使用方法提示词', 'prompt_content', '订单通过后创建发货任务并返回任务编号。')
await editAndVerify('系统集成业务规则', 'business_rules', '- 失败时保留当前状态')

// The legacy platform Plugin entries stay absent from the shipped source.
const { readFile } = await import('node:fs/promises')
const source = await readFile(new URL('./src/client/panels/integration-design.tsx', import.meta.url), 'utf8')
assert.doesNotMatch(source, /listPlugins|PlatformPluginPicker|SOURCE_OPTIONS|plugin_id|plugin_name|plugin_description|platform_plugin|draft_plugin/, 'the panel source must not carry platform Plugin reuse entries')

console.log('INTEGRATION PANEL CONTRACT OK')
