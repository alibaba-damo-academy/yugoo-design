import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRequire, registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { register } from 'tsx/esm/api'
const require = createRequire(import.meta.url)
register()
const hook = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes('/companion/src/') && (specifier === 'react' || specifier.startsWith('react/'))) return next(pathToFileURL(require.resolve(specifier)).href, context)
  return next(specifier, context)
} })
globalThis.React = React
const { Conversation } = await import('../../companion/src/conversation.tsx')
hook.deregister()

test('send dropdown owns the optional notification and sync status uses the styled hint', () => {
  const markup = renderToStaticMarkup(React.createElement(Conversation, {
    visible: true, thread: 'test-thread', onClose() {}, send: async () => {},
    value: { available: true, catchingUp: true, recordedStatus: 'unknown', omitted: 0, rows: [] },
  }))
  const dom = new JSDOM(markup)
  try {
    const doc = dom.window.document
    const actions = doc.querySelector('form .companion-composer-actions')
    assert.ok(actions)
    const shell = doc.querySelector('form .companion-input-shell')
    assert.ok(shell.contains(doc.querySelector('textarea')))
    assert.ok(shell.contains(actions), 'send controls share the input border, not a separate outer row')
    assert.equal(actions.querySelector('.companion-notify').type, 'button', 'notify does not submit the draft')
    assert.equal(actions.querySelector('button[type=submit]').disabled, true, 'empty draft remains disabled')
    assert.equal(actions.querySelectorAll('button').length, 2)
    const menu = actions.querySelector('details.companion-send-menu')
    assert.ok(menu.contains(actions.querySelector('.companion-notify')))
    assert.equal(menu.hasAttribute('open'), false, 'optional notification is initially collapsed')
    assert.equal(menu.querySelector('summary').getAttribute('aria-label'), '更多发送操作')
    assert.equal(doc.querySelector('.companion-conversation > .companion-notify'), null)
    assert.equal(doc.querySelector('.companion-conversation > .companion-connection'), null)
    assert.ok(doc.querySelector('header .companion-connection button[aria-label="连接信息"]'))
    assert.equal(doc.querySelector('.companion-connection button').getAttribute('aria-expanded'), 'false')
    assert.equal(doc.querySelector('details .companion-connection-popover'), null, 'native closed details must not suppress hover/focus content')
    assert.equal(doc.querySelector('header [role=status]'), null, 'unknown is not falsely presented as active progress')
    assert.match(doc.querySelector('.companion-connection-popover').textContent, /不表示正在运行/)
    const hint = doc.querySelector('.companion-sync-status')
    assert.equal(hint.getAttribute('role'), 'status')
    assert.ok(hint.classList.contains('companion-conversation-hint'))
    assert.ok(hint.querySelector('[aria-hidden=true]'))
  } finally { dom.window.close() }
})

test('composer actions keep a horizontal flex layout with keyboard focus styles', async () => {
  const client = await readFile(new URL('../../companion/src/client.tsx', import.meta.url), 'utf8')
  const css = client.match(/\.companion-composer-actions\{([^}]+)\}/)[1]
  assert.match(css, /display:flex/)
  assert.match(css, /align-items:center/)
  assert.doesNotMatch(css, /flex-direction:column|flex-wrap:wrap/)
  assert.match(client, /\.companion-composer-actions button:focus-visible/)
  assert.match(client, /\.companion-input-shell:focus-within/)
  assert.match(client, /\.companion-conversation textarea\{[^}]*border:0/)
})

test('header prioritizes actionable states and keeps completed/background details in the icon', () => {
  for (const status of ['running', 'waiting', 'failed', 'interrupted', 'completed', 'unknown']) {
    const dom = new JSDOM(renderToStaticMarkup(React.createElement(Conversation, {
      visible: true, thread: 'test-thread', onClose() {}, send: async () => {},
      value: { available: true, recordedStatus: status, omitted: 0, rows: [] },
    })))
    try {
      assert.equal(!!dom.window.document.querySelector('header [role=status]'), ['running', 'waiting', 'failed', 'interrupted'].includes(status), status)
    } finally { dom.window.close() }
  }
})

test('user messages use the Yugoo reference bubble with a separate label, without styling work records as chat bubbles', async () => {
  const value = { available: true, recordedStatus: 'completed', omitted: 0, rows: [
    { id: 'user-1', role: 'user', label: '你', text: '测试消息', status: 'completed' },
    { id: 'assistant-1', role: 'assistant', label: 'Codex', text: '已收到', status: 'completed' },
    { id: 'tool-1', role: 'tool', label: '读取文件', text: '已完成读取', status: 'completed' },
  ] }
  const markup = renderToStaticMarkup(React.createElement(Conversation, {
    visible: true, thread: 'test-thread', onClose() {}, send: async () => {}, value,
  }))
  const client = await readFile(new URL('../../companion/src/client.tsx', import.meta.url), 'utf8')
  const css = client.slice(client.indexOf('.companion-conversation{'), client.indexOf('.companion-activity{'))
  const dom = new JSDOM(`<style>${css}</style>${markup}`)
  try {
    const doc = dom.window.document
    const user = doc.querySelector('.companion-message[data-role=user]')
    const content = user.querySelector('.companion-message-content')
    assert.equal(content.textContent, '测试消息')
    assert.equal(content.contains(user.querySelector('.companion-message-label')), false)
    const style = dom.window.getComputedStyle(content)
    assert.equal(style.backgroundColor, 'rgb(246, 246, 246)')
    assert.equal(style.borderRadius, '8px')
    assert.equal(style.padding, '10px 12px')
    assert.equal(style.fontSize, '16px')
    assert.equal(style.lineHeight, '24px')
    assert.equal(dom.window.getComputedStyle(user).alignItems, 'flex-end')
    const assistant = doc.querySelector('.companion-message[data-role=assistant] .companion-message-content')
    assert.equal(assistant.textContent, '已收到')
    assert.notEqual(dom.window.getComputedStyle(assistant).backgroundColor, 'rgb(246, 246, 246)')
    assert.ok(doc.querySelector('.companion-activity article[data-role=tool]'), 'assertion exercises a real rendered work record')
    assert.equal(doc.querySelector('.companion-activity .companion-message-content'), null)
  } finally { dom.window.close() }
})

test('session scope explanation requires an established boundary, not an assumed host type', () => {
  for (const established of [false, true]) {
    const dom = new JSDOM(renderToStaticMarkup(React.createElement(Conversation, {
      visible: true, thread: 'test-thread', onClose() {}, send: async () => {},
      value: { available: true, recordedStatus: 'unknown', omitted: 0, rows: [],
        ...(established ? { designSessionStartedAt: '2026-10-04T13:00:00.000Z' } : {}) },
    })))
    try {
      assert.equal(dom.window.document.querySelector('.companion-connection-popover').textContent.includes('仅同步本项目本次设计会话'), established)
    } finally { dom.window.close() }
  }
})
