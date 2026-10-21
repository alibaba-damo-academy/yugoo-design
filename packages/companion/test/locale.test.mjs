import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api')
register()
const { createCompanionLocale, COMPANION_LANGUAGE_KEY, companionChromeText, companionDocumentLanguage } = await import('../src/locale.ts')

test('trial-bound locale updates UI without overwriting browser preference', () => {
  const writes = []
  const storage = { getItem: () => 'en', setItem: (...args) => writes.push(args) }
  const locale = createCompanionLocale(storage, 'en-US')
  locale.setPreference('zh', false)
  assert.equal(locale.getSnapshot().active, 'zh')
  assert.deepEqual(writes, [])
  assert.equal(createCompanionLocale(storage, 'en-US').getSnapshot().active, 'en')
})

test('Companion explicit language persists independently of browser and publishes reactive snapshots', () => {
  const data = new Map(), writes = []
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); writes.push(key) } }
  const locale = createCompanionLocale(storage, 'en-US')
  assert.equal(locale.getSnapshot().active, 'en')
  const before = locale.getSnapshot()
  assert.equal(locale.getSnapshot(), before)
  let changes = 0
  const unsubscribe = locale.subscribe(() => changes++)
  locale.setPreference('zh')
  assert.equal(locale.getSnapshot().active, 'zh')
  assert.notEqual(locale.getSnapshot(), before)
  assert.equal(createCompanionLocale(storage, 'en-US').getSnapshot().active, 'zh')
  locale.setPreference('en')
  assert.equal(createCompanionLocale(storage, 'zh-CN').getSnapshot().active, 'en')
  locale.setPreference('auto')
  assert.equal(createCompanionLocale(storage, 'zh-CN').getSnapshot().active, 'zh')
  assert.equal(changes, 3)
  assert.deepEqual(writes, [COMPANION_LANGUAGE_KEY, COMPANION_LANGUAGE_KEY, COMPANION_LANGUAGE_KEY])
  assert.throws(() => locale.setPreference('unsupported'), /Unsupported/)
  unsubscribe()
})

test('Companion can change language when browser storage is unavailable', () => {
  const denied = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  const locale = createCompanionLocale(denied, 'en-US')
  locale.setPreference('zh')
  assert.equal(locale.getSnapshot().active, 'zh')
})

test('Companion chrome and document language follow the same live preference', () => {
  const locale = createCompanionLocale(undefined, 'en-US')
  const read = () => ({ settings: companionChromeText('settings', locale.getSnapshot().active),
    language: companionDocumentLanguage(locale.getSnapshot().active) })
  assert.deepEqual(read(), { settings: 'Settings', language: 'en' })
  const emissions = []
  const dispose = locale.subscribe(() => emissions.push(read()))
  locale.setPreference('zh')
  locale.setPreference('en')
  assert.deepEqual(emissions, [{ settings: '设置', language: 'zh-CN' }, { settings: 'Settings', language: 'en' }])
  assert.equal(companionChromeText('collapseConversation', 'zh_CN'), '收起对话')
  assert.equal(companionChromeText('backgroundReviews', 'en_US'), 'Background reviews')
  assert.equal(companionChromeText('closeSettings', 'en'), 'Close settings')
  assert.equal(companionChromeText('expandSidebar', 'zh'), '展开侧边栏')
  dispose()
})

test('Settings and Studio text follows language changes and preserves the native host name', () => {
  const locale = createCompanionLocale(undefined, 'en-US')
  const read = () => {
    const active = locale.getSnapshot().active
    return {
      maximum: companionChromeText('maxSuggestions', active),
      save: companionChromeText('saveSettings', active),
      closeStudio: companionChromeText('closeStudio', active),
      connection: companionChromeText('nativeConnectionDescription', active, { host: 'Claude Code' }),
    }
  }
  const english = read()
  assert.equal(english.maximum, 'Maximum suggestions')
  assert.equal(english.save, 'Save settings')
  assert.equal(english.closeStudio, 'Close Studio')
  assert.match(english.connection, /handled in Claude Code/)
  const changes = []
  const unsubscribe = locale.subscribe(() => changes.push(read()))
  locale.setPreference('zh')
  assert.equal(changes[0].maximum, '最大建议数')
  assert.equal(changes[0].save, '保存设置')
  assert.equal(changes[0].closeStudio, '关闭 Studio')
  assert.match(changes[0].connection, /仍在 Claude Code 中处理/)
  locale.setPreference('en')
  assert.deepEqual(changes[1], english)
  assert.equal(companionChromeText('language', 'zh'), '语言')
  assert.equal(companionChromeText('browserDefault', 'zh_CN'), '跟随浏览器')
  assert.match(companionChromeText('studioDescription', 'en'), /Read-only/)
  assert.equal(companionChromeText('connecting', 'en'), 'Connecting')
  assert.equal(companionChromeText('settingsSaved', 'en'), 'Settings saved')
  unsubscribe()
})
