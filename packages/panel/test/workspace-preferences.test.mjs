import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

test('two native icon buttons toggle actual values, retain drafts, and retry the original failed write', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://preferences.test/', pretendToBeVisual: true })
  const names = ['window', 'document', 'HTMLElement', 'Element', 'Node', 'React', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  for (const name of names.slice(0, 5)) globalThis[name] = dom.window[name]
  const React = await import('react'); globalThis.React = React; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const { DesignWorkspacePreferenceControls } = await import('../src/client/workspace-preferences.tsx')
  const root = createRoot(document.getElementById('root')), calls = []
  const authored = { title: '原有用户内容', notes: 'Keep this unsaved draft.' }, before = structuredClone(authored)
  let completeLanguage
  let preferences = {
    language: 'en', effectiveAppearance: 'light',
    onLanguageChange: value => {
      calls.push(['language', value])
      return new Promise(resolve => { completeLanguage = () => {
        preferences = { ...preferences, language: value }; show(); resolve()
      } })
    },
    onAppearanceChange: async value => {
      calls.push(['appearance-failed', value]); preferences = { ...preferences, effectiveAppearance: value }; show()
      throw new Error('Storage unavailable; the current appearance is not saved')
    },
  }
  const show = () => root.render(React.createElement(React.Fragment, null,
    React.createElement('input', { 'aria-label': 'Existing draft', defaultValue: authored.notes }),
    React.createElement(DesignWorkspacePreferenceControls, { preferences })))
  const control = kind => document.querySelector(`[data-workspace-preference="${kind}"]`)
  const click = button => React.act(async () => { button.focus(); button.click() })
  try {
    await React.act(show)
    const draft = document.querySelector('[aria-label="Existing draft"]'); draft.value = 'Still editing; do not replace.'
    const language = control('language'), appearance = control('appearance')
    assert.equal(document.querySelectorAll('[data-workspace-preference]').length, 2)
    assert.equal(document.querySelector('[role="combobox"], [role="listbox"], [role="option"]'), null)
    for (const button of [language, appearance]) {
      assert.equal(button.tagName, 'BUTTON'); assert.equal(button.type, 'button'); assert.equal(button.tabIndex, 0)
      assert.equal(button.textContent, '', 'the visible control is an icon, without another label or menu')
      assert.equal(button.getAttribute('aria-haspopup'), null)
      assert.equal(button.title, button.getAttribute('aria-label'))
      assert.ok(button.querySelector('svg[aria-hidden="true"]'))
    }
    assert.equal(language.title, 'Switch to Chinese'); assert.equal(appearance.title, 'Switch to dark appearance')
    assert.equal(calls.length, 0, 'rendering does not write preferences')
    await click(language)
    assert.deepEqual(calls, [['language', 'zh']], 'one activation switches directly to the opposite language')
    assert.equal(document.querySelector('[role="group"]').getAttribute('aria-busy'), 'true')
    assert.match(document.querySelector('[role="status"]').textContent, /Saving/)
    assert.ok([language, appearance].every(item => item.disabled))
    await click(language); assert.equal(calls.length, 1, 'a pending operation cannot write twice')
    await React.act(async () => completeLanguage())
    assert.equal(control('language') === language, true)
    assert.equal(language.title, '切换为英文')
    assert.equal(document.activeElement === language, true, 'settlement keeps the reachable keyboard target')
    assert.equal(document.querySelector('[aria-label="Existing draft"]') === draft, true); assert.equal(draft.value, 'Still editing; do not replace.')
    await click(appearance)
    assert.match(document.querySelector('[role="alert"]').textContent, /Storage unavailable/)
    assert.equal(document.querySelector('[role="alert"] button').textContent, '重试')
    assert.equal(appearance.title, '切换为浅色', 'the next action follows the current resolved appearance')
    assert.ok(appearance.querySelector('.lucide-sun'))
    assert.ok([language, appearance].every(item => !item.disabled))
    preferences = { ...preferences, onAppearanceChange: async value => {
      calls.push(['appearance', value]); preferences = { ...preferences, effectiveAppearance: value }; show()
    } }
    await React.act(show)
    await click(document.querySelector('[role="alert"] button'))
    assert.equal(document.querySelector('[role="alert"]'), null)
    assert.equal(appearance.title, '切换为浅色', 'retry saves the original dark request, instead of toggling back')
    await click(appearance)
    assert.equal(appearance.title, '切换为深色'); assert.ok(appearance.querySelector('.lucide-moon'))
    assert.deepEqual(calls, [['language', 'zh'], ['appearance-failed', 'dark'], ['appearance', 'dark'], ['appearance', 'light']])
    await click(language); draft.focus()
    await React.act(async () => completeLanguage())
    assert.equal(document.activeElement === draft, true, 'settlement does not steal focus after deliberate navigation')
    assert.deepEqual(calls.at(-1), ['language', 'en']); assert.equal(language.title, 'Switch to Chinese')
    preferences = { ...preferences, effectiveAppearance: 'dark' }; await React.act(show)
    await click(appearance)
    assert.deepEqual(calls.at(-1), ['appearance', 'light'], 'a resolved dark Host appearance switches light on the first click')
    assert.deepEqual(authored, before); assert.equal(draft.value, 'Still editing; do not replace.')
    assert.equal(document.querySelector('[role="combobox"], [role="listbox"], [role="option"]'), null)
  } finally {
    await React.act(() => root.unmount()); dom.window.close()
    for (const name of names) { if (previous[name]) Object.defineProperty(globalThis, name, previous[name]); else delete globalThis[name] }
  }
})
