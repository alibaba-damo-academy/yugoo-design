import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
// Companion source uses the shared Panel dependency graph, not a private install.
const panelRequire = createRequire(new URL('../../panel/package.json', import.meta.url))
const reactUrls = new Map(['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/server']
  .map(name => [name, pathToFileURL(panelRequire.resolve(name)).href]))
const hooks = registerHooks({ resolve(name, context, next) {
  return reactUrls.has(name) ? { url: reactUrls.get(name), shortCircuit: true } : next(name, context)
} })
test.after(() => hooks.deregister())
const { register } = await import('tsx/esm/api')
const loader = register({ namespace: 'companion-locale-presentation', tsconfig: new URL('./source-ui-tsconfig.json', import.meta.url).pathname })
const React = await import('react')
const { renderToStaticMarkup } = await import('react-dom/server')
const { Conversation } = await loader.import('../src/conversation.tsx', import.meta.url)
const { BackgroundReviewPanel } = await loader.import('../src/background-reviews.tsx', import.meta.url)
const { companionChromeText, companionChromeMessages } = await loader.import('../src/locale.ts', import.meta.url)
const { requireNotificationAccepted, notificationAutoDismiss } = await import('../src/notification-result.mjs')
const { transcriptRow } = await import('../src/codex-transcript.mjs')
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props))

test('native system activity labels follow the selected UI language without changing recorded text', () => {
  const rows = [
    transcriptRow({ payload: { type: 'item_completed', item: { type: 'FileChange', id: 'edit' } } }),
    transcriptRow({ payload: { type: 'item_completed', item: { type: 'CommandExecution', id: 'command',
      parsed_cmd: [{ type: 'read', path: '/private/人工说明.md' }, { type: 'unknown', cmd: 'secret' }] } } }),
    transcriptRow({ payload: { type: 'item_completed', item: { type: 'McpToolCall', id: 'tool', tool: '修改文件' } } }),
    { id: 'original', role: 'assistant', label: 'Codex', text: '原始消息：修改文件，已完成。', status: 'completed' },
  ]
  const before = JSON.stringify(rows)
  const show = locale => render(Conversation, { locale, hostLabel: 'Codex', thread: 'thread', visible: true,
    onClose() {}, send: async () => {}, value: { available: true, recordedStatus: 'completed', omitted: 0, rows } })
  const english = show('en-US')
  assert.match(english, /Edit files · Completed/)
  assert.match(english, /Read file: 人工说明.md; Run command · Completed/)
  assert.match(english, /修改文件 · Completed/, 'native tool names are never translated')
  assert.match(english, /原始消息：修改文件，已完成。/)
  assert.doesNotMatch(english, /修改文件 · 已完成|读取文件：|secret|\/private/)
  const chinese = show('zh-CN')
  assert.match(chinese, /修改文件 · 已完成/)
  assert.match(chinese, /读取文件：人工说明.md；运行命令/)
  assert.equal(JSON.stringify(rows), before, 'changing presentation never rewrites recorded rows')
  assert.match(show('en-US'), /Edit files · Completed/)
})

test('English conversation chrome preserves original native message content', () => {
  const original = '用户提供的原文：保留 {host} 与业务名称。'
  const html = render(Conversation, {
    locale: 'en-US', hostLabel: 'Codex', thread: 'thread', visible: true,
    onClose() {}, send: async () => {},
    value: { available: true, recordedStatus: 'completed', omitted: 0,
      rows: [{ id: 'native', role: 'assistant', label: 'Codex', status: 'completed', text: original }] },
  })
  assert.match(html, /Codex Conversation/)
  assert.match(html, /aria-label="Connection information"/)
  assert.match(html, /placeholder="Message Codex/)
  assert.match(html, />Send to Codex</)
  assert.match(html, /aria-label="More send options"/)
  assert.ok(html.includes(original))
  assert.doesNotMatch(html, /发送到|更多发送操作|关闭对话区域|原生 Agent/)
})

test('English review status uses localized known states while preserving unknown provider values', () => {
  const html = render(BackgroundReviewPanel, { locale: 'en-US', disconnected: true,
    value: { reviews: [{ profile: 'grounding', status: 'prepared', executionMode: 'foreground' },
      { profile: 'provider-profile', status: 'provider-status' }], rows: [] } })
  assert.match(html, /Consistency Review/)
  assert.match(html, /Waiting for review in the main conversation/)
  assert.match(html, /Status sync is disconnected/)
  assert.match(html, /provider-profile/)
  assert.match(html, /provider-status/)
  assert.doesNotMatch(html, /\p{Script=Han}/u)
})

test('notification locale does not change delivery admission or successful-result semantics', () => {
  const messages = companionChromeMessages('en-US')
  for (const status of ['busy', 'held', 'denied', 'expired', 'unavailable', 'unknown', 'future-status']) {
    assert.throws(() => requireNotificationAccepted({ accepted: false, status }, 'Codex', messages), error => {
      assert.equal(error.name, 'Error')
      assert.doesNotMatch(error.message, /\p{Script=Han}/u)
      return true
    })
    assert.throws(() => requireNotificationAccepted({ accepted: false, status }, 'Codex'))
  }
  for (const status of ['submitted_unverified', 'user_input_accepted', 'queued_for_resume', 'hook_received', 'queued']) {
    const result = { accepted: true, status }
    const copy = requireNotificationAccepted(result, 'Codex', messages)
    assert.match(copy, /Codex/)
    assert.doesNotMatch(copy, /\p{Script=Han}/u)
    assert.equal(notificationAutoDismiss(result), ['user_input_accepted', 'queued'].includes(status))
  }
  assert.match(requireNotificationAccepted({ accepted: true, status: 'queued' }, 'QwenWork', messages), /event notification, not a user message/)
})

test('locale interpolation never treats supplied host labels as another template', () => {
  const host = 'Agent {count} <custom>'
  const copy = companionChromeText('conversationRecent', 'en', { count: 2, host })
  assert.ok(copy.includes(host))
  assert.match(copy, /latest 2 messages/)
})
