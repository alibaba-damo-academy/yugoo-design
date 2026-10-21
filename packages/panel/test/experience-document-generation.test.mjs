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

test('image hydration mounts a new experience document while unchanged polling retains it', async () => {
  const root = createRoot(document.getElementById('root'))
  const image = 'visual/logo.png', hash = 'a'.repeat(64)
  const htmlPath = '_experiences/demo/v1/overview.html'
  const view = { id: 'demo', version: 'v1', title: 'Saved scene', purpose: 'Check frozen image hydration',
    sourceVersions: { [image]: hash }, sections: [
      { id: 'overview', title: 'Overview', htmlFile: htmlPath, sources: [image], assumptions: [] },
    ] }
  const indexPath = '_experiences/demo/view.json'
  const frozenImage = '_experiences/demo/v1/resources/visual/logo.png'
  const html = '<html><body><h1>Saved scene</h1><img src="../../../visual/logo.png" alt="Frozen logo"></body></html>'
  let resolveImage
  const binaryCalls = []
  const props = {
    artifactFiles: { [image]: hash },
    experienceFiles: { [indexPath]: 'published', [htmlPath]: 'published', [frozenImage]: 'published' },
    readArtifact: async path => ({ found: true, content: path === indexPath ? JSON.stringify(view) : html }),
    readBinaryArtifact: path => { binaryCalls.push(path); return new Promise(resolve => { resolveImage = resolve }) },
    sendPrompt: async () => {}, writable: true,
  }
  const show = () => React.act(async () => root.render(React.createElement(ExperiencePanel, {
    ...props, experienceFiles: { ...props.experienceFiles }, artifactFiles: { ...props.artifactFiles },
  })))
  const frame = () => document.querySelector('iframe')
  const policy = element => new DOMParser().parseFromString(element.srcdoc, 'text/html')
    .querySelector('meta[http-equiv="Content-Security-Policy"]').content
  try {
    await show()
    const initial = frame()
    assert.ok(initial, 'HTML is readable before its image resolves')
    assert.match(initial.srcdoc, /Saved scene/)
    assert.doesNotMatch(initial.srcdoc, /data:image\/png;base64/)
    assert.deepEqual(binaryCalls, [frozenImage])
    const initialPolicy = policy(initial)
    await show()
    assert.equal(frame(), initial, 'unchanged poll before hydration retains document')
    await React.act(async () => resolveImage({ found: true, mediaType: 'image/png', base64: 'YQ==', byteLength: 1 }))
    const hydrated = frame()
    assert.notEqual(hydrated, initial, 'changed srcdoc mounts a fresh iframe')
    assert.match(hydrated.srcdoc, /data:image\/png;base64,YQ==/)
    assert.equal(hydrated.title, initial.title, 'semantic section remains selected')
    assert.equal(hydrated.getAttribute('sandbox'), 'allow-scripts')
    assert.equal(hydrated.getAttribute('referrerpolicy'), 'no-referrer')
    assert.equal(policy(hydrated), initialPolicy, 'hydration cannot loosen CSP')
    assert.match(initialPolicy, /connect-src 'none'/)
    assert.match(initialPolicy, /frame-src 'none'/)
    await show()
    assert.equal(frame(), hydrated, 'unchanged poll after hydration retains document')
    assert.deepEqual(binaryCalls, [frozenImage], 'unchanged polling does not reread resources')
  } finally { await React.act(async () => root.unmount()); dom.window.close() }
})
