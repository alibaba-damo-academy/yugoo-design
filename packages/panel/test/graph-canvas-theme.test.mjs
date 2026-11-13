import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import React from 'react'
import { JSDOM } from 'jsdom'

test('KAG follows the page, retains an independent theme, and can resume following without replacing its renderer', async () => {
  const require = createRequire(import.meta.url)
  const { build } = await import(pathToFileURL(createRequire(require.resolve('tsx')).resolve('esbuild')).href)
  const output = await mkdtemp(fileURLToPath(new URL('./.graph-theme-', import.meta.url)))
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true })
  const names = ['window', 'document', 'HTMLElement', 'Element', 'Node', 'React', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  for (const name of names.slice(0, 5)) globalThis[name] = dom.window[name]
  globalThis.React = React; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  // JSDOM has no inherited color-scheme resolution. Supply that browser result;
  // the real useColorScheme observer and GraphCanvas override state still run.
  const computed = dom.window.getComputedStyle.bind(dom.window)
  dom.window.getComputedStyle = element => new Proxy(computed(element), { get: (target, key) =>
    key === 'colorScheme' ? document.documentElement.style.colorScheme : Reflect.get(target, key) })
  let root
  try {
    // Only the WebGL renderer is replaced. This checks state/identity, not actual
    // camera pixels, WebGL behavior or browser color-scheme acceptance.
    await build({ stdin: { contents: "export { GraphCanvas } from './graph-canvas.tsx'", resolveDir: fileURLToPath(new URL('../src/client/', import.meta.url)), loader: 'tsx' },
      outfile: join(output, 'graph-theme.mjs'), bundle: true, packages: 'external', external: ['react', 'react/jsx-runtime'], platform: 'node', format: 'esm', jsx: 'automatic',
      plugins: [{ name: 'webgl-renderer-probe', setup(b) {
        b.onResolve({ filter: /^\.\/graph-spatial\.js$/ }, () => ({ path: 'spatial', namespace: 'theme-probe' }))
        b.onResolve({ filter: /^\.\/graph-layout-client\.js$/ }, () => ({ path: 'layout', namespace: 'theme-layout-probe' }))
        b.onLoad({ filter: /.*/, namespace: 'theme-layout-probe' }, () => ({ contents: 'export function createGraphLayoutJob() { throw new Error("Planar layout is not exercised by this theme state check") }' }))
        b.onLoad({ filter: /.*/, namespace: 'theme-probe' }, () => ({ contents: `
          import React from 'react';
          export function SpatialGraphCanvas(props) {
            const [camera, setCamera] = React.useState(1);
            return React.createElement('div', { 'data-theme': props.dark ? 'dark' : 'light', 'data-following': String(props.followingPage) },
              React.createElement('input', { 'aria-label': 'Renderer draft', defaultValue: 'Original' }),
              React.createElement('button', { 'data-action': 'camera', onClick: () => setCamera(value => value + 1) }, String(camera)),
              React.createElement('button', { 'data-action': 'theme', onClick: props.onToggleDark }, 'Theme'),
              React.createElement('button', { 'data-action': 'follow', onClick: props.onFollowPage }, 'Follow'));
          }` }))
      } }] })
    const { GraphCanvas } = await import(pathToFileURL(join(output, 'graph-theme.mjs')).href)
    const { createRoot } = await import('react-dom/client')
    const container = document.getElementById('root'); root = createRoot(container)
    const props = { graph: { nodes: [], edges: [] }, reach: new Map(), selected: 'retained-node', selectedEdge: '', matches: null,
      layout: 'stress3-original', onNode() {}, onEdge() {}, onClear() {} }
    const theme = () => container.querySelector('[data-theme]')
    const click = action => React.act(async () => container.querySelector(`[data-action="${action}"]`).click())
    const page = value => React.act(async () => { document.documentElement.style.colorScheme = value; await new Promise(resolve => setTimeout(resolve, 0)) })
    await page('light'); await React.act(async () => root.render(React.createElement(GraphCanvas, props)))
    assert.equal(theme().dataset.theme, 'light'); assert.equal(theme().dataset.following, 'true')
    const draft = container.querySelector('input'); draft.value = 'Keep the same input.'
    await click('camera'); await page('dark')
    assert.equal(theme().dataset.theme, 'dark'); assert.equal(theme().dataset.following, 'true')
    await click('theme')
    assert.equal(theme().dataset.theme, 'light'); assert.equal(theme().dataset.following, 'false')
    await page('light'); await page('dark')
    assert.equal(theme().dataset.theme, 'light', 'explicit canvas theme is independent of the page')
    await click('follow')
    assert.equal(theme().dataset.theme, 'dark'); assert.equal(theme().dataset.following, 'true')
    await page('light'); assert.equal(theme().dataset.theme, 'light')
    assert.equal(container.querySelector('input') === draft, true); assert.equal(draft.value, 'Keep the same input.')
    assert.equal(container.querySelector('[data-action="camera"]').textContent, '2', 'theme updates retain renderer state')
    assert.equal(props.selected, 'retained-node')
  } finally {
    if (root) await React.act(() => root.unmount()); dom.window.close(); await rm(output, { recursive: true, force: true })
    for (const name of names) { if (previous[name]) Object.defineProperty(globalThis, name, previous[name]); else delete globalThis[name] }
  }
})
