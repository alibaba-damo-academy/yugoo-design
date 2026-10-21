import test from 'node:test'
import assert from 'node:assert/strict'
const { JSDOM } = await import('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'DOMParser']) globalThis[key] = dom.window[key]
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
// The standalone tsx runner uses classic JSX; production is bundled with automatic JSX.
globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { NavigationPreview } = await import('../src/navigation-preview.tsx')

test('shared resources use host reader; hashes refresh CSS/images; obsolete reads cannot overwrite', async () => {
  const root = createRoot(document.getElementById('root'))
  const path = 'page_design/pages/a.html', css = 'design_style/tokens.css', image = 'design_style/assets/logo.png'
  const html = '<html><head></head><body><img src="../../design_style/assets/logo.png"><img src="../../../escape.png"><img src="/absolute.png"><img src="..\\escape.png"></body></html>'
  let color = 'red', resolveOld
  const calls = [], binaryCalls = [], messages = []
  const readArtifact = async file => {
    calls.push(file)
    if (file === path) return { found: true, content: html }
    if (color === 'pending') return new Promise(resolve => { resolveOld = resolve })
    return { found: true, content: `body{color:${color}}` }
  }
  const readBinaryArtifact = async file => {
    binaryCalls.push(file)
    return { found: true, mediaType: 'image/png', base64: 'YQ==', byteLength: 1 }
  }
  const render = async (cssHash, imageHash = 'image1') => {
    await React.act(async () => root.render(React.createElement(NavigationPreview, {
      artifactId: 'a', title: 'Page', path, stylesheet: css,
      options: { skill: 'page_design', readArtifact, readBinaryArtifact,
        artifactFiles: { [path]: 'html1', [css]: cssHash, [image]: imageHash } },
    })))
  }
  const source = () => document.querySelector('iframe').getAttribute('srcdoc')
  try {
    await render('css1')
    assert.ok(calls.includes(css))
    assert.deepEqual(binaryCalls, [image])
    assert.match(source(), /body\{color:red\}/)
    const frame = document.querySelector('iframe'), initial = source()
    frame.contentWindow.postMessage = message => { messages.push(message) }
    await render('css1', 'image2')
    assert.equal(document.querySelector('iframe'), frame)
    assert.equal(source(), initial, 'image hash must not reset srcdoc')
    assert.deepEqual(binaryCalls, [image, image])
    assert.ok(messages.some(message => message.images?.[0]?.url === 'data:image/png;base64,YQ=='))
    color = 'pending'; await render('css2', 'image2')
    assert.equal(typeof resolveOld, 'function')
    color = 'blue'; await render('css3', 'image2')
    assert.match(source(), /body\{color:blue\}/)
    await React.act(async () => resolveOld({ found: true, content: 'body{color:obsolete}' }))
    assert.match(source(), /body\{color:blue\}/)
    assert.doesNotMatch(source(), /obsolete/)
    await React.act(async () => root.render(null))
    await render('css3', 'image2')
    assert.match(source(), /body\{color:blue\}/, 'reopen reads current stylesheet')
  } finally { await React.act(async () => root.unmount()); dom.window.close() }
})
