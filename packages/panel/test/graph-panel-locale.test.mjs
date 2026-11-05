import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import React from 'react'
import { JSDOM } from 'jsdom'

test('Graph locale changes retain the transport, reading context and canvas input while transient notices recover', async () => {
  const require = createRequire(import.meta.url)
  const { build } = await import(pathToFileURL(createRequire(require.resolve('tsx')).resolve('esbuild')).href)
  const output = await mkdtemp(fileURLToPath(new URL('./.graph-panel-locale-', import.meta.url)))
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://graph-locale.test/', pretendToBeVisual: true })
  const keys = ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'React', 'IS_REACT_ACT_ENVIRONMENT', '__graphLocaleProbe', '__graphLocalePoll']
  const previous = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const key of keys.slice(0, 6)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] })
  globalThis.React = React; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const originalNow = Date.now
  let clock = originalNow(), root
  Date.now = () => clock
  try {
    // Exercise the real GraphPanel/model/i18n. A probe replaces only the canvas
    // engine and poll clock, proving their input identities and transport calls.
    // Actual pan/drag/WebGL acceptance remains a separate browser checkpoint.
    await build({ stdin: { contents: "export { GraphPanel } from './client/graph-panel.tsx'; export { GraphInspector } from './client/graph-inspector.tsx'; export { PanelLocaleContext } from './panel-i18n.tsx'", resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'tsx' },
      outfile: join(output, 'graph.mjs'), bundle: true, packages: 'external', external: ['react', 'react/jsx-runtime'], platform: 'node', format: 'esm', jsx: 'automatic',
      plugins: [{ name: 'graph-canvas-and-poll-probe', setup(b) {
        b.onResolve({ filter: /^\.\/graph-(?:canvas|exploration)\.js$/ }, () => ({ path: 'canvas', namespace: 'locale-probe' }))
        b.onResolve({ filter: /^\.\/live-poll\.js$/ }, () => ({ path: 'poll', namespace: 'locale-probe' }))
        b.onLoad({ filter: /.*/, namespace: 'locale-probe' }, args => ({ contents: args.path === 'poll'
          ? `export function subscribeLivePoll(listener) { globalThis.__graphLocalePoll = listener; return () => { if (globalThis.__graphLocalePoll === listener) delete globalThis.__graphLocalePoll } }`
          : `import React from 'react'; export const graphSourceColors = ['#4488aa'];
             export function GraphCanvas(props) {
               globalThis.__graphLocaleProbe = props;
               return React.createElement('div', { 'data-testid': 'canvas-probe' },
                 React.createElement('button', { 'data-testid': 'select-source', onClick: () => props.onNode('source') }, 'Select original source'),
                 React.createElement('button', { 'data-testid': 'select-relation', onClick: () => props.onEdge('original-edge') }, 'Select original relationship'));
             }
             export const GraphExploration = GraphCanvas;` }))
      } }] })
    const { GraphPanel, GraphInspector, PanelLocaleContext } = await import(pathToFileURL(join(output, 'graph.mjs')).href)
    const { createRoot } = await import('react-dom/client')
    const node = (id, label, context) => ({ id, label, context, owner: 'fixture', file: 'fixture/records.json', pointer: '/' + id, record: true })
    const base = { checkpoint: 'v1', projectId: 'fixture-project', knowledgeRevision: 'v1', knowledgeStatus: 'current', warnings: [],
      nodes: [node('source', '客户 Alpha — original', 'Original authored context / 原文'), node('target', 'Beta', 'Second source')],
      edges: [{ id: 'original-edge', from: 'source', to: 'target', kind: 'knowledge', label: 'Original authored relationship', evidence: 'Original evidence / 证据原文', reading: { relationType: 'supports', meaning: 'supports', origin: 'human', direction: 'forward', lifecycle: 'accepted' } }],
    }
    const original = structuredClone(base)
    let locale = 'zh-CN', statusMode = 'ready', revision = 'v1', failPublicationRead = false, reads = 0, statusReads = 0
    const read = async () => { reads++; if (failPublicationRead) throw new Error('raw-publication-error'); return { content: JSON.stringify({ ...base, checkpoint: revision, knowledgeRevision: revision }) } }
    const readStatus = async () => {
      statusReads++
      if (statusMode === 'throw') throw new Error('raw-transport-error')
      if (statusMode === 'missing') return undefined
      return { schemaVersion: 1, project: 'fixture-project', head: revision, state: 'current', freshness: 'matching', semanticLayer: 'enabled', latestComplete: { checkpoint: revision, revision, warningCount: 0 } }
    }
    const props = { read, readStatus, footer: null }
    const container = document.getElementById('root'); root = createRoot(container)
    const render = async () => React.act(async () => root.render(React.createElement(PanelLocaleContext.Provider, { value: locale }, React.createElement(GraphPanel, props))))
    const sample = async () => { clock += 3_000; await React.act(async () => globalThis.__graphLocalePoll()) }
    const alert = () => container.querySelector('.graph-notice[role="alert"]')?.textContent ?? ''
    await render()
    assert.equal(reads, 1, 'initial status sampling does not duplicate the initial graph read')
    const search = container.querySelector('.graph-search input')
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(search, 'Alpha')
      search.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    assert.ok(container.querySelector('.graph-search-results'), 'search exercises actual Panel state')
    await React.act(async () => container.querySelector('[data-testid="select-source"]').click())
    assert.equal(container.querySelector('.graph-inspector h4').textContent, base.nodes[0].label)
    assert.ok(container.querySelector('.graph-inspector').textContent.includes(base.nodes[0].context))
    const canvasGraph = globalThis.__graphLocaleProbe.graph, layoutEdges = globalThis.__graphLocaleProbe.layoutEdges
    const sampled = statusReads
    locale = 'en-US'; await render()
    assert.equal(reads, 1); assert.equal(statusReads, sampled, 'a locale change does not invoke either transport')
    assert.equal(globalThis.__graphLocaleProbe.graph, canvasGraph, 'translation alone must not rebuild the canvas graph and discard camera/pins')
    assert.equal(globalThis.__graphLocaleProbe.layoutEdges, layoutEdges, 'translation alone must not rebuild layout inputs')
    assert.equal(container.querySelector('.graph-search input'), search); assert.equal(search.value, 'Alpha')
    assert.equal(container.querySelector('.graph-inspector h4').textContent, base.nodes[0].label)
    assert.equal(container.querySelector('.graph-title').textContent, 'Design relationships')

    statusMode = 'throw'; await sample()
    assert.match(alert(), /Graph status is unavailable/)
    const disconnectedReads = reads, disconnectedStatusReads = statusReads
    locale = 'zh-CN'; await render()
    assert.match(alert(), /图谱状态暂不可确认/)
    assert.equal(reads, disconnectedReads); assert.equal(statusReads, disconnectedStatusReads)
    statusMode = 'ready'; await sample()
    assert.equal(alert(), '', 'reconnection clears the local notice without comparing translated copy')
    assert.equal(reads, disconnectedReads, 'unchanged publication is not re-read after reconnecting')
    statusMode = 'missing'; await sample(); assert.match(alert(), /图谱状态暂不可确认/)
    statusMode = 'ready'; await sample(); assert.equal(alert(), '')

    revision = 'v2'; failPublicationRead = true; await sample()
    assert.match(alert(), /新图谱已发布，但载入暂不可用/)
    const failedReads = reads, failedStatusReads = statusReads
    locale = 'en-US'; await render()
    assert.match(alert(), /A new graph is published but could not be loaded/)
    assert.equal(reads, failedReads); assert.equal(statusReads, failedStatusReads)
    assert.equal(globalThis.__graphLocaleProbe.graph, canvasGraph, 'failed loading retains the same complete graph')
    failPublicationRead = false; await sample()
    assert.equal(reads, failedReads + 1); assert.equal(alert(), '')
    assert.equal(container.querySelector('.graph-search input').value, 'Alpha')
    assert.equal(container.querySelector('.graph-inspector h4').textContent, base.nodes[0].label)
    assert.equal(globalThis.__graphLocaleProbe.graph.nodes.find(n => n.id === 'source').context, base.nodes[0].context)
    await React.act(async () => container.querySelector('[data-testid="select-relation"]').click())
    assert.equal(container.querySelector('.graph-inspector h4').textContent, base.edges[0].label)
    assert.match(container.querySelector('.graph-inspector .dsh-panel-header-meta').textContent, /Supports/i, 'a custom label must not hide the structured business meaning')
    assert.equal(container.querySelector('.graph-evidence pre').textContent, base.edges[0].evidence)
    assert.deepEqual(globalThis.__graphLocaleProbe.graph.edges.map(e => [e.id, e.from, e.to, e.label, e.evidence]), base.edges.map(e => [e.id, e.from, e.to, e.label, e.evidence]))
    const candidate = { ...base.edges[0].reading, relationType: 'semantic-similarity', meaning: 'similar', origin: 'embedding', direction: 'symmetric', lifecycle: 'proposed' }
    const members = [1, 2, 3].map(index => ({ ...base.edges[0], id: `member-${index}`, label: `Original label ${index}`, evidence: `Full raw evidence ${index} / 原文 <untouched>`, reading: candidate }))
    const aggregate = { ...base.edges[0], members, reading: candidate }
    let inspectionGraph = base
    const inspect = async () => React.act(async () => root.render(React.createElement(PanelLocaleContext.Provider, { value: locale }, React.createElement(GraphInspector, { graph: inspectionGraph, edge: aggregate, relations: [], sourceLabels: {}, onClose() {}, onNode() {}, onEdge() {}, onNeighborhood() {}, onExpandEndpoints() {} }))))
    await inspect()
    assert.equal(container.querySelectorAll('.dsh-panel-guidance-trigger').length, 1, 'one shared interpretation help, not repeated disclaimer paragraphs')
    assert.ok(container.querySelector('.graph-inspector-body > .dsh-design-record-header-label .dsh-panel-header-meta').textContent.includes('Proposed interpretation'), 'candidate status remains visible outside the collapsed technical details')
    assert.equal(container.querySelectorAll('.graph-relation-detail').length, 3)
    assert.equal(container.querySelectorAll('.graph-relation-detail[open]').length, 1, 'first original relationship is readable; other full evidence remains reachable')
    assert.deepEqual([...container.querySelectorAll('.graph-evidence pre')].map(item => item.textContent), members.map(member => member.evidence))
    const third = container.querySelectorAll('.graph-relation-detail')[2]
    await React.act(async () => { third.open = true; third.dispatchEvent(new dom.window.Event('toggle')) })
    locale = 'zh-CN'; await inspect()
    assert.equal(container.querySelectorAll('.graph-relation-detail')[2], third)
    assert.equal(third.open, true, 'locale changes retain the opened evidence section')
    assert.equal(container.querySelectorAll('.dsh-panel-guidance-trigger').length, 1)
    assert.deepEqual([...container.querySelectorAll('.graph-evidence pre')].map(item => item.textContent), members.map(member => member.evidence))
    aggregate.members = members.map((member, index) => index ? member : { ...member, reading: { ...candidate, origin: 'unknown', lifecycle: 'unknown' } })
    await inspect()
    assert.ok([...container.querySelectorAll('.graph-relation-detail .dsh-panel-header-meta')].some(item => item.textContent.includes('未知')), 'mixed or missing provenance remains in the original relationship, not only collapsed technical details')
    assert.equal(container.querySelectorAll('.dsh-panel-guidance-trigger').length, 3, 'mixed relationships retain their own interpretation help')
    const review = { ...base.edges[0], id: 'review', label: 'Review conclusion', evidence: JSON.stringify({ projection: 'review-v1', summary: 'Saved business reasoning', quotes: [{ source: 'a.json', locator: '/name', quote: 'Exact original <quote> / 原文' }], model: 'diagnostic-only-model' }), reading: { ...base.edges[0].reading, origin: 'agent', lifecycle: 'proposed' } }
    aggregate.members = [review]
    await inspect()
    const readable = container.querySelector('.graph-relation-detail').textContent
    assert.ok(readable.includes('Saved business reasoning'))
    assert.ok(readable.includes('Exact original <quote> / 原文'))
    assert.ok(!readable.includes('diagnostic-only-model'), 'technical JSON is not presented as business prose')
    assert.equal(container.querySelector('.graph-evidence pre').textContent, review.evidence, 'raw diagnostic bytes remain available')
    const complete = 'Inspect the page and saved result. This is a synthetic acceptance criterion, not an executed test result.\n保留完整业务限定。'
    inspectionGraph = { ...base, nodes: [{ ...base.nodes[0], label: complete.slice(0, 100), context: `/source: ${complete}` }, { ...base.nodes[1], context: '/target/child: Nested content must not replace the record title' }] }
    await inspect()
    const endpoints = container.querySelector('.graph-relation-detail .dsh-panel-reading-item').textContent
    assert.ok(endpoints.includes(complete), 'endpoint reading uses the complete published scalar, not a cut-off canvas label')
    assert.ok(endpoints.includes('Beta'))
    assert.ok(!endpoints.includes('/source:') && !endpoints.includes('Nested content'), 'pointer metadata and descendant fields do not become endpoint prose')
    inspectionGraph = { ...base, nodes: [{ ...base.nodes[0], context: '/source: ' }, base.nodes[1]] }
    await inspect()
    assert.ok(container.querySelector('.graph-relation-detail .dsh-panel-reading-item').textContent.includes(base.nodes[0].label), 'an exhausted excerpt budget must not hide an endpoint')
    assert.deepEqual(base, original, 'locale and transport transitions do not mutate authored facts')
  } finally {
    if (root) await React.act(async () => root.unmount())
    Date.now = originalNow
    dom.window.close()
    for (const key of keys) { if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else delete globalThis[key] }
    await rm(output, { recursive: true, force: true })
  }
})
