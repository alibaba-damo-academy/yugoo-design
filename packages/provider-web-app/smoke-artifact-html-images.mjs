import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
const { register } = await import('tsx/esm/api')
register()
const { prepareHtmlImages, projectImagePath, useHtmlImageContents } = await import('./src/client/panels/artifact-html-images.ts')
const { useTextArtifactContents } = await import('./src/client/panels/artifact-text-hydration.ts')
const { secureDesignSrcDoc } = await import('./src/client/srcdoc-security.ts')
const pagePath = 'page_design/pages/home.html'
const stylePath = 'design_style/preview_home.html'
const assetPath = 'design_style/images/logo.png'
assert.equal(projectImagePath(pagePath, '../../design_style/images/logo.png'), assetPath)
assert.equal(projectImagePath(stylePath, './images/logo.png'), assetPath)
for (const ref of ['../../../outside.png', '/tmp/a.png', '//host/a.png', 'https://host/a.png', 'file:/tmp/a.png', '..\\a.png', '%2fetc/a.png', '%2e%2e/%2e%2e/%2e%2e/a.png', '%zz.png']) {
  assert.equal(projectImagePath(pagePath, ref), undefined, ref)
}
const html = `<!doctype html><html lang="zh" class="dark"><head><title>Original</title></head><body><img src="../../design_style/images/logo.png" width="48" alt="Original"><img src="../../design_style/images/logo.png"><img src="https://example.com/a.png"><script>window.example = '<img src="../../secret.png">'</script></body></html>`
const projection = prepareHtmlImages(pagePath, html)
assert.deepEqual(projection.paths, [assetPath], 'deduplicate actual local img references, not script text or remote URLs')
const rendered = projection.render({ [assetPath]: 'data:image/png;base64,YWJj' })
const doc = new JSDOM(secureDesignSrcDoc(rendered, 'interactive-preview')).window.document
assert.equal(doc.documentElement.lang, 'zh')
assert.equal(doc.documentElement.className, 'dark')
assert.equal(doc.querySelector('img').getAttribute('src'), 'data:image/png;base64,YWJj')
assert.equal(doc.querySelector('img').width, 48)
assert.equal(doc.querySelector('script').textContent, "window.example = '<img src=\"../../secret.png\">'")
assert.match(doc.querySelector('meta[http-equiv]').content, /img-src data: blob:/)
doc.defaultView.close()
assert.equal(html.includes('data:image'), false, 'the canonical source is not mutated')
assert.equal(projection.render({ [assetPath]: 'data:image/png;base64,YWJj' }), rendered)

const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const root = createRoot(document.getElementById('root'))
let snapshot
const pending = []
const readBinary = () => new Promise(resolve => pending.push(resolve))
let textReads = 0
const readText = async () => { textReads++; return { found: true, content: html } }
function Harness({ files, binary = readBinary }) {
  const entries = [{ id: 'home', path: pagePath }]
  const htmls = useTextArtifactContents(entries, readText, {}, files)
  snapshot = useHtmlImageContents(entries, htmls, binary, {}, files)
  return null
}
const render = files => act(async () => { root.render(React.createElement(Harness, { files })) })
const result = base64 => ({ found: true, mediaType: 'image/png', base64, byteLength: 3 })
try {
  await render({ [pagePath]: 'h1', [assetPath]: 'i1' })
  assert.equal(pending.length, 1)
  assert.match(snapshot.home, /<title>Original<\/title>/, 'HTML is visible while its image is still loading')
  const old = pending.shift()
  await render({ [pagePath]: 'h1', [assetPath]: 'i2' })
  await act(async () => { pending.shift()(result('bmV3')) })
  assert.match(snapshot.home, /base64,bmV3/)
  await act(async () => { old(result('b2xk')) })
  assert.doesNotMatch(snapshot.home, /base64,b2xk/, 'stale image fetch cannot overwrite a newer preview')
  await render({ [pagePath]: 'h1', [assetPath]: 'i2', 'research/research.json': 'r2' })
  assert.equal(pending.length, 0, 'unrelated polling changes do not refetch images')
  assert.equal(textReads, 1, 'image-only changes do not refetch or hide the valid HTML')
  await render({ [pagePath]: 'h1' })
  assert.doesNotMatch(snapshot.home, /data:image/, 'deletion removes the old image without a JSON/HTML change')
  assert.match(snapshot.home, /data-design-missing-image/)
  await render({ [pagePath]: 'h1', [assetPath]: 'i3' })
  await act(async () => { pending.shift()(result('YmFjaw==')) })
  assert.match(snapshot.home, /base64,YmFjaw==/, 'image arrival refreshes unchanged HTML')
  const switched = () => new Promise(resolve => pending.push(resolve))
  await act(async () => root.render(React.createElement(Harness, { files: { [pagePath]: 'h1', [assetPath]: 'i3' }, binary: switched })))
  assert.doesNotMatch(snapshot.home, /base64,YmFjaw==/, 'reader/project change must clear previous project images')
  await act(async () => pending.shift()(result('cHJvamVjdDI=')))
  assert.match(snapshot.home, /base64,cHJvamVjdDI=/)
  const offline = async () => { throw new Error('offline') }
  await act(async () => root.render(React.createElement(Harness, { files: { [pagePath]: 'h1', [assetPath]: 'i4' }, binary: offline })))
  assert.match(snapshot.home, /<title>Original<\/title>/, 'a failed image request cannot make the whole HTML unavailable')
  assert.doesNotMatch(snapshot.home, /data:image/, 'do not show a previous image after failure')
} finally {
  await act(async () => root.unmount())
  dom.window.close()
}
console.log('LOCAL HTML IMAGE PREVIEWS OK')
