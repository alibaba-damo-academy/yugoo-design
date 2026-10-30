import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('conversation source reuses the shared project header without changing connection semantics', async () => {
  const source = await readFile(new URL('../src/conversation.tsx', import.meta.url), 'utf8')
  assert.match(source, /<header className="dsh-design-project-header">/)
  assert.match(source, /aria-label="连接信息" aria-expanded=\{connectionOpen\}/)
  assert.match(source, /aria-label="关闭对话区域"/)
  assert.match(source, /<strong>\{hostLabel\} 对话<\/strong>/)
  assert.match(source, /className="companion-conversation-title"/)
})

test('shared header supplies host-independent geometry and feedback uses native toast rather than a layout row', async () => {
  const styles = await readFile(new URL('../../panel/src/client/styles.ts', import.meta.url), 'utf8')
  const source = await readFile(new URL('../src/client.tsx', import.meta.url), 'utf8')
  assert.match(styles, /min-height:var\(--dsh-host-primary-header-height,76px\)/)
  assert.match(styles, /padding:4px var\(--ds-space-4,16px\)/)
  assert.match(source, /\.companion-conversation>header\{gap:8px;justify-content:space-between\}/)
  assert.match(source, /\.companion-conversation-heading\{display:flex;flex-direction:column;align-items:flex-start/)
  assert.match(source, /min-height:calc\(var\(--companion-top-header-height,76px\) - 24px\)/)
  assert.match(source, /\.companion-sidebar-heading>strong\{font-size:18px;line-height:24px/)
  assert.match(source, /\.companion-sidebar\{[^}]*gap:8px/)
  assert.match(source, /\.companion-sidebar-heading\{[^}]*margin-bottom:8px/)
  assert.match(source, /\.companion-sidebar-action\{[^}]*min-height:40px;padding:0 8px/)
  assert.match(source, /\.companion-sidebar \.dsh-project-sidebar-entry,\.companion-sidebar \.dsh-advisory-sidebar-entry\{margin:0\}/)
  assert.match(source, /className=\{`dsh-design-toast companion-feedback/)
  assert.doesNotMatch(source.match(/\.companion-feedback\{([^}]*)\}/)?.[1] ?? '', /border-top|flex-shrink|background|font-size/)
  assert.match(source, /aria-label="关闭提示"/)
  assert.match(source, /setNotificationError\(''\); onNotice\(''\)/)
})

test('conversation chrome does not override nested shared advisory cards', async () => {
  const source = await readFile(new URL('../src/client.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\.companion-conversation\s+article\s*\{/)
  assert.doesNotMatch(source, /\.companion-conversation\s+header\s+span/)
  assert.match(source, /\.companion-conversation-heading>span,\.companion-conversation-hint\{/)
  const shared = await readFile(new URL('../../studio-ui/src/ConversationActivity.tsx', import.meta.url), 'utf8')
  assert.match(source, /\$\{CONVERSATION_ACTIVITY_CSS\}/)
  assert.match(shared, /\.companion-message\{[^}]*overflow-wrap:anywhere/)
  assert.match(shared, /\.companion-activity article\{[^}]*overflow-wrap:anywhere/)
})

test('panel-only reuses one lightbulb-anchored inbox instead of a full-workspace cover', async () => {
  const source = await readFile(new URL('../src/client.tsx', import.meta.url), 'utf8')
  assert.match(source, /popoverContent=\{designOnly \? advisoryInbox : undefined\}/)
  assert.match(source, /beforeComposer=\{conversationVisible && advisoryInbox\}/)
  assert.doesNotMatch(source, /companion-design-advisories/)
  assert.match(source, /onClick=\{closeAdvisories\}>收起/)
  assert.match(source, /onDeferred=\{closeAdvisories\}/)
  assert.match(source, /if \(designOnly\) shellRoot\.current\?\.querySelector<HTMLButtonElement>\('\.companion-sidebar \.dsh-advisory-sidebar-trigger'\)\?\.focus\(\{ preventScroll: true \}\)/)
})
