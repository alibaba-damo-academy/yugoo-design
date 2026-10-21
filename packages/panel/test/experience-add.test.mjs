import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'DOMParser']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { ExperiencePanel } = await import('../src/client/experience-panel.tsx')

test('adding another scene uses the empty-state discussion and retains the published scene on failure', async () => {
  const root = createRoot(document.getElementById('root'))
  const source = 'intent/intent.json', hash = 'a'.repeat(64)
  const indexPath = '_experiences/demo/view.json', htmlPath = '_experiences/demo/v1/overview.html'
  const view = { id: 'demo', version: 'v1', title: 'Existing scene', purpose: 'Keep the saved view',
    sourceVersions: { [source]: hash }, sections: [
      { id: 'overview', title: 'Overview', htmlFile: htmlPath, sources: [source], assumptions: [] },
    ] }
  const prompts = []
  let finish
  const props = { artifactFiles: { [source]: hash }, experienceFiles: {}, writable: true,
    readArtifact: async path => ({ found: true, content: path === indexPath ? JSON.stringify(view) : '<h1>Existing scene</h1>' }),
    readBinaryArtifact: async () => ({ found: false, mediaType: 'image/png', base64: '', byteLength: 0 }),
    sendPrompt: async text => { prompts.push(text) },
  }
  const render = async () => React.act(async () => root.render(React.createElement(ExperiencePanel, props)))
  const button = text => [...document.querySelectorAll('button')].find(e => e.textContent.includes(text))
  try {
    await render()
    await React.act(async () => button('让 AI 推荐').click())
    assert.equal(prompts.length, 1)
    props.experienceFiles = { [indexPath]: 'published', [htmlPath]: 'published' }
    await render()
    const frame = document.querySelector('iframe')
    assert.ok(frame)
    assert.ok(document.querySelector('nav[aria-label="场景目录"]').contains(button('新增场景')))
    props.sendPrompt = text => { prompts.push(text); return new Promise((_, reject) => { finish = reject }) }
    await render()
    await React.act(async () => button('新增场景').click())
    assert.equal(prompts[1], prompts[0], 'exact same recommendation, no immediate generation')
    assert.equal(button('新增场景').disabled, true)
    await React.act(async () => button('新增场景').click())
    assert.equal(prompts.length, 2, 'pending send cannot duplicate requests')
    await React.act(async () => finish(new Error('offline')))
    assert.match(document.querySelector('[role="alert"]').textContent, /当前体验已保留.*offline/)
    assert.equal(document.querySelector('iframe'), frame, 'recommendation does not replace the saved document')
    assert.equal(button('新增场景').disabled, false)
    props.writable = false
    await render()
    assert.equal(button('新增场景').disabled, true)
    await React.act(async () => button('新增场景').click())
    assert.equal(prompts.length, 2, 'read-only host cannot send')
  } finally { await React.act(async () => root.unmount()); dom.window.close() }
})
