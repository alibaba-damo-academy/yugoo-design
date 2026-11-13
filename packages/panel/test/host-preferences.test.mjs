import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api')
register()
const { JSDOM } = await import('jsdom')
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node']) {
  if (globalThis[key] === undefined) globalThis[key] = dom.window[key]
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { bindDesignHostLocale } = await import('../src/client/ported/host.ts')

test('late Host preference capabilities appear without remounting drafts and call the actual owners', async () => {
  const { bindDesignHostTheme, useDesignHostPreferences } = await import('../src/client/ported/host.ts')
  const target = document.createElement('div')
  document.body.append(target)
  const root = createRoot(target)
  const localeListeners = new Set(), themeListeners = new Set(), calls = []
  let localeSnapshot = { active: 'en' }, themeSnapshot = { preference: 'light', active: { colorScheme: 'light' } }, current
  let rejectTheme = false
  const locale = {
    getSnapshot: () => localeSnapshot,
    subscribe: fn => { localeListeners.add(fn); return () => localeListeners.delete(fn) },
    setLocale(value) { calls.push(['locale', value]); localeSnapshot = { active: value }; for (const fn of localeListeners) fn() },
  }
  const theme = {
    getSnapshot: () => themeSnapshot,
    subscribe: fn => { themeListeners.add(fn); return () => themeListeners.delete(fn) },
    setTheme(value) {
      if (rejectTheme) throw new Error('Host rejected theme')
      calls.push(['theme', value]); themeSnapshot = { preference: value, active: { colorScheme: value === 'dark' ? 'dark' : 'light' } }
      for (const fn of themeListeners) fn()
    },
  }
  function Probe() {
    current = useDesignHostPreferences()
    return React.createElement('input', { defaultValue: 'authored data', 'data-ready': Boolean(current) })
  }
  let releaseLocale, releaseTheme
  try {
    await React.act(async () => root.render(React.createElement(Probe)))
    const input = target.querySelector('input')
    input.value = 'unsaved user draft'
    await React.act(async () => { releaseLocale = bindDesignHostLocale(locale); releaseTheme = bindDesignHostTheme(theme) })
    assert.equal(input.dataset.ready, 'true', 'readiness must update even when the initial en/light values match fallback')
    await React.act(async () => { current.onLanguageChange('zh'); current.onAppearanceChange('dark') })
    assert.deepEqual(calls, [['locale', 'zh'], ['theme', 'dark']])
    assert.equal(current.language, 'zh')
    assert.equal(current.effectiveAppearance, 'dark')
    await React.act(async () => {
      themeSnapshot = { preference: 'system', active: { colorScheme: 'dark' } }
      for (const listener of themeListeners) listener()
    })
    assert.equal(current.effectiveAppearance, 'dark')
    await React.act(async () => {
      themeSnapshot = { preference: 'system', active: { colorScheme: 'light' } }
      for (const listener of themeListeners) listener()
    })
    assert.equal(current.effectiveAppearance, 'light', 'system mode must react to resolved scheme changes')
    assert.equal(themeSnapshot.preference, 'system', 'reading the resolved scheme must not change the Host preference')
    assert.deepEqual(calls, [['locale', 'zh'], ['theme', 'dark']])
    assert.equal(target.querySelector('input'), input)
    assert.equal(input.value, 'unsaved user draft')
    rejectTheme = true
    assert.throws(() => current.onAppearanceChange('system'), /Host rejected theme/)
    await React.act(async () => { releaseTheme(); releaseTheme = undefined })
    assert.equal(input.dataset.ready, 'false')
  } finally {
    await React.act(async () => { releaseTheme?.(); releaseLocale?.(); root.unmount() })
    target.remove()
  }
})
