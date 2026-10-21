import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { register } = await import('tsx/esm/api')
register()
const { JSDOM } = await import('jsdom')
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node']) {
  if (globalThis[key] === undefined) globalThis[key] = dom.window[key]
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { bindDesignHostLocale, currentLanguage, useCurrentLanguage, useLang } = await import('../src/client/ported/host.ts')
const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')
const { StandardQuestionWorkspace } = await import('../src/question-list.tsx')
const { DesignDockMeta } = await import('../src/client/dock-action-meta.tsx')

test('host locale updates mounted shared questions and footer without discarding draft; detach restores standalone fallback', async () => {
  let snapshot = { active: 'en', revision: 0 }
  const listeners = new Set()
  const source = { getSnapshot: () => snapshot, subscribe: listener => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  } }
  const fallback = currentLanguage()
  const release = bindDesignHostLocale(source)
  const root = createRoot(document.getElementById('root'))
  const container = document.getElementById('root')
  let mounts = 0
  function Panel() {
    const locale = useCurrentLanguage(), t = useLang()
    const [draft] = React.useState('姓名 / Name')
    React.useEffect(() => { mounts++ }, [])
    return React.createElement(PanelLocaleContext.Provider, { value: locale },
      React.createElement(StandardQuestionWorkspace, { editable: true,
        questions: [{ id: 'q', prompt: 'Preserved authored prompt', kind: 'text', answer: draft, round: 0 }] }),
      React.createElement(DesignDockMeta, { clarity: null, projectName: '合成项目 / Synthetic project', projectPath: '/synthetic/project' }),
      React.createElement('button', { id: 'save' }, t.button_save_and_continue),
      React.createElement('div', { id: 'empty' }, t.design_empty_panels),
      React.createElement('button', { id: 'new-panel' }, t.design_new_panel))
  }
  const switchTo = async active => React.act(async () => {
    snapshot = { active, revision: snapshot.revision + 1 }
    for (const listener of listeners) listener()
  })
  try {
    await React.act(async () => root.render(React.createElement(Panel)))
    assert.match(container.textContent, /Current questions/)
    assert.equal(container.querySelector('#save').textContent, 'Save and assess next step')
    assert.equal(container.querySelector('#empty').textContent, 'No design panels yet. Enable a design skill in the conversation first.')
    assert.equal(container.querySelector('#new-panel').textContent, 'New panel')
    assert.equal(container.querySelector('[data-testid="design-dock-meta-name"]').textContent, 'Design project: 合成项目 / Synthetic project')
    assert.equal(container.querySelector('[data-testid="design-dock-meta-path"]'), null)
    assert.ok(!container.innerHTML.includes('/synthetic/project'))
    await switchTo('zh')
    assert.equal(currentLanguage(), 'zh_CN')
    assert.doesNotMatch(container.textContent, /Current questions/)
    assert.match(container.textContent, /编辑/)
    assert.equal(container.querySelector('#save').textContent, '保存并评估下一步')
    assert.equal(container.querySelector('#empty').textContent, '暂无设计面板。请先在对话中启用一个设计技能。')
    assert.equal(container.querySelector('#new-panel').textContent, '新建面板')
    assert.equal(container.querySelector('[data-testid="design-dock-meta-name"]').textContent, '设计项目：合成项目 / Synthetic project')
    assert.equal(container.querySelector('[data-testid="design-dock-meta-path"]'), null)
    assert.match(container.textContent, /Preserved authored prompt/)
    assert.match(container.textContent, /姓名 \/ Name/)
    assert.equal(mounts, 1)
    await switchTo('en')
    assert.match(container.textContent, /Current questions/)
    assert.equal(container.querySelector('#save').textContent, 'Save and assess next step')
    assert.equal(container.querySelector('#new-panel').textContent, 'New panel')
    assert.equal(container.querySelector('[data-testid="design-dock-meta-name"]').textContent, 'Design project: 合成项目 / Synthetic project')
    assert.ok(!container.innerHTML.includes('/synthetic/project'))
  } finally {
    await React.act(async () => root.unmount())
    release()
    assert.equal(listeners.size, 0)
    assert.equal(currentLanguage(), fallback)
  }
})

test('folder icon opens the exact project directory, localizes, reports failure and clears on project switch', async () => {
  const container = document.getElementById('root')
  const root = createRoot(container)
  const path = 'D:\\设计项目\\project with spaces & (draft)'
  let opened = [], finish, fail = false
  const canOpenProjectFolder = async () => true
  const openProjectFolder = async value => {
    opened.push(value)
    if (fail) throw new Error('native opener refused')
    await new Promise(resolve => { finish = resolve })
  }
  const render = (projectPath = path, extra = {}) => root.render(React.createElement(DesignDockMeta, {
    clarity: { assessment: null, needsReassessment: false },
    projectName: '项目 / Project', projectPath, canOpenProjectFolder, openProjectFolder, ...extra,
  }))
  try {
    await React.act(async () => render())
    let button = container.querySelector('[data-testid="design-project-open-folder"]')
    assert.ok(button)
    assert.ok(button.getAttribute('aria-label'))
    assert.ok(!container.innerHTML.includes(path), 'no path string in visible or hidden markup')
    assert.equal(container.querySelectorAll('[data-testid="design-dock-meta"] > div').length, 2)
    await React.act(async () => button.click())
    assert.deepEqual(opened, [path])
    assert.equal(button.disabled, true)
    assert.equal(button.getAttribute('aria-busy'), 'true')
    await React.act(async () => button.click())
    assert.equal(opened.length, 1)
    await React.act(async () => finish())
    assert.equal(button.disabled, false)
    fail = true
    await React.act(async () => button.click())
    assert.ok(container.querySelector('[role="alert"]'))
    assert.equal(button.disabled, false, 'native opener failures remain retryable')
    await React.act(async () => render('/another/project'))
    assert.equal(container.querySelector('[role="alert"]'), null)
    button = container.querySelector('[data-testid="design-project-open-folder"]')
    fail = false
    await React.act(async () => button.click())
    assert.equal(opened.at(-1), '/another/project')
    await React.act(async () => render('/third/project'))
    await React.act(async () => finish())
    assert.equal(container.querySelector('[role="alert"]'), null, 'old operation completion cannot replace the new project state')
    await React.act(async () => render('/third/project', { canOpenProjectFolder: async () => false }))
    assert.equal(container.querySelector('[data-testid="design-project-open-folder"]'), null, 'no native desktop capability means no fake folder action')
    await React.act(async () => render(null))
    assert.equal(container.querySelector('[data-testid="design-project-open-folder"]'), null)
  } finally {
    await React.act(async () => root.unmount())
  }
})

test('workspace empty state and new panel tab use shared host translations', () => {
  const source = readFileSync(new URL('../src/client/workspace.tsx', import.meta.url), 'utf8')
  assert.match(source, /className='dsh-design-dock-empty flex-1'>\{t\.design_empty_panels\}/)
  assert.match(source, /value: NEW_PANEL_TAB,\s+label: t\.design_new_panel/)
  assert.doesNotMatch(source, /label: '新建面板'/)
})
