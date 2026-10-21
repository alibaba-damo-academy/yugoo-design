import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { handleProbeRequest, probeHtml, resourceUri } from '../src/workbuddy-message-probe.mjs'

function widget(capabilities = { message: {} }) {
  const posted = [], button = { disabled: true }, status = {}, timers = new Map()
  let listener, tick = 0
  const parent = { postMessage: message => posted.push(message) }
  runInNewContext(probeHtml.match(/<script>([\s\S]*)<\/script>/)[1], {
    document: { getElementById: id => id === 'send' ? button : status }, parent,
    window: { addEventListener: (event, callback) => { listener = callback } },
    setTimeout: callback => { timers.set(++tick, callback); return tick }, clearTimeout: id => timers.delete(id),
  })
  const deliver = (data, source = parent) => listener({ source, origin: 'https://host.example', data: { jsonrpc: '2.0', ...data } })
  deliver({ id: posted[0].id, result: { hostCapabilities: capabilities } })
  return { posted, button, status, deliver, timers }
}

test('MCP tool advertises its exact UI resource and does not send a message', () => {
  const call = (method, params) => handleProbeRequest({ id: 1, method, params })
  const tool = call('tools/list').result.tools[0]
  assert.equal(tool._meta.ui.resourceUri, resourceUri)
  assert.equal(call('tools/call', { name: tool.name, arguments: {} }).result._meta.ui.resourceUri, resourceUri)
  assert.equal(call('resources/read', { uri: resourceUri }).result.contents[0].text, probeHtml)
  assert.equal(call('tools/call', { name: 'design_command' }).error.code, -32602)
  assert.equal(call('tools/call', { name: tool.name, arguments: { message: 'unexpected' } }).error.code, -32602)
  assert.equal(call('resources/read', { uri: 'file:///private' }).error.code, -32602)
  assert.equal(handleProbeRequest({ method: 'notifications/initialized' }), undefined)
})

test('widget sends only on click, ignores wrong window, and does not equate receipt to reply', async () => {
  const w = widget()
  await Promise.resolve()
  assert.equal(w.button.disabled, false)
  assert.equal(w.posted.filter(x => x.method === 'ui/message').length, 0)
  const click = w.button.onclick()
  const message = w.posted.find(x => x.method === 'ui/message')
  assert.equal(message.params.role, 'user')
  w.deliver({ id: message.id, result: {} }, {})
  assert.equal(w.timers.size, 1)
  w.deliver({ id: message.id, result: {} })
  await click
  assert.match(w.status.textContent, /不代表模型已回复/)
  await w.button.onclick()
  assert.equal(w.posted.filter(x => x.method === 'ui/message').length, 1)
})

test('missing host capability fails closed; timed-out delivery never retries', async () => {
  const unsupported = widget({})
  await Promise.resolve()
  assert.equal(unsupported.button.disabled, true)
  assert.match(unsupported.status.textContent, /未声明/)
  const w = widget()
  await Promise.resolve()
  const click = w.button.onclick()
  for (const timer of [...w.timers.values()]) timer()
  await click
  assert.match(w.status.textContent, /超时/)
  await w.button.onclick()
  assert.equal(w.posted.filter(x => x.method === 'ui/message').length, 1)
})
