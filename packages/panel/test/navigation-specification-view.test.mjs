import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

test('shared specification switches in place while the edge control retains page-detail navigation and drafts', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const keys = ['window', 'document', 'DOMParser', 'HTMLElement', 'Element', 'getComputedStyle', 'ResizeObserver',
    'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'React']
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, getComputedStyle: dom.window.getComputedStyle,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout,
    IS_REACT_ACT_ENVIRONMENT: true })
  const { default: React, act } = await import('react'); globalThis.React = React
  const { createRoot } = await import('react-dom/client')
  const { NavigationWorkspace } = await import('../src/navigation-workspace.tsx')
  const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')
  const binding = {
    nodes: { path: 'screens', order: 'order', label: 'name', position: 'point', artifact: 'file', artifact_kind: 'page_html' },
    edges: { path: 'links', order: 'link_order', source: 'from', target: 'to', label: 'name' },
    frames: { path: 'groups', label: 'name', members: 'screens', position: 'point', size: 'size' },
  }
  const data = { screens: { list: { name: 'List', file: 'bundle/list.html' }, detail: { name: 'Detail', file: 'bundle/detail.html' } },
    groups: {}, links: {}, common: { layout: 'Shared shell' } }
  const initial = structuredClone(data)
  let writes = 0, mounts = 0, locale = 'en-US', includeSpecification = true
  const options = { editable: true, skill: 'bundle', sourceRevision: 'r1',
    readArtifact: async () => ({ found: true, content: '<h1>Page</h1>' }),
    onPanelUpdate: () => { writes++ } }
  function Specification() {
    React.useEffect(() => { mounts++ }, [])
    return React.createElement('label', null, 'Layout', React.createElement('textarea', { 'data-specification-draft': true, defaultValue: data.common.layout }))
  }
  const root = createRoot(document.getElementById('root'))
  const show = () => root.render(React.createElement(PanelLocaleContext.Provider, { value: locale },
    React.createElement(NavigationWorkspace, {
      node: { id: 'map', component: 'navigation_workspace', navigation_map: binding },
      manifest: { sections: ['screens', 'links', 'groups'].map(id => ({ id, title: id })) }, data,
      specificationTitle: locale === 'en-US' ? 'Shared page specification' : '公共样式',
      options,
      render: (section, id) => React.createElement('output', { 'data-selection': true }, `${section}:${id}`),
      children: includeSpecification ? React.createElement(Specification) : undefined,
    })))
  const click = async node => { assert.ok(node); await act(async () => node.click()) }
  const tabs = () => [...document.querySelectorAll('#root > .dsh-component-tabs > .dsh-canvas-toolbar .dsh-component-tabs-list > [role=tab]')]
  const openButton = () => tabs()[1]
  const specification = () => document.querySelector('.dsh-navigation-spec-page')
  const returnFrom = view => view.parentElement.querySelector(':scope > .dsh-workspace-cover-return')
  try {
    await act(async () => show())
    const map = document.querySelector('.dsh-navigation-map-cover .react-flow')
    assert.ok(map)
    assert.equal(document.querySelector('.dsh-navigation-map-spec'), null, 'long specification content does not occupy the map')
    assert.equal(document.querySelectorAll('[data-specification-draft]').length, 1, 'one retained content surface owns its draft')
    assert.equal(tabs().length, 2)
    assert.equal(document.querySelectorAll('.dsh-canvas-toolbar').length, 1, 'the view switch shares one existing toolbar')
    assert.ok(tabs()[0].closest('.dsh-canvas-toolbar-actions').querySelector(':scope > button'), 'view controls sit beside the add-frame action')
    assert.equal(document.querySelector('#root > .dsh-component-tabs > .dsh-component-tabs-list'), null, 'no additional navigation row')
    assert.equal(document.querySelectorAll('.dsh-workspace-cover-return').length, 1, 'only the canvas/page-detail edge control remains')
    assert.equal(document.querySelector('.dsh-navigation-spec-open'), null, 'the superseded one-way toolbar entry is removed')
    const mapHeading = document.querySelector('.dsh-canvas-toolbar-heading').innerHTML
    const entry = openButton()
    assert.equal(entry.textContent, 'Shared page specification')
    await act(async () => entry.focus())
    await click(entry)
    const outer = document.getElementById('root').firstElementChild
    assert.equal(outer.querySelector(':scope > .dsh-component-tabs-panel').hidden, true)
    assert.equal(specification().parentElement.hidden, false)
    assert.equal(openButton().getAttribute('aria-selected'), 'true')
    const mapAction = document.querySelector('.dsh-canvas-toolbar-actions > button')
    assert.equal(mapAction.getAttribute('aria-hidden'), 'true', 'shared styles do not expose an unrelated map mutation')
    assert.equal(mapAction.disabled, true, 'the reserved map action cannot be focused or triggered')
    assert.equal(document.querySelectorAll('.dsh-canvas-toolbar').length, 1)
    assert.equal(document.querySelector('.dsh-canvas-toolbar-heading').innerHTML, mapHeading, 'switching content retains the map icon, title and counts')
    assert.equal(specification().querySelector('.dsh-workspace-cover-return'), null, 'shared content cannot repurpose the page-detail edge control')
    const draft = document.querySelector('[data-specification-draft]')
    draft.value = 'Unsubmitted wording'
    await act(async () => entry.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })))
    assert.ok(document.activeElement === tabs()[0], 'keyboard switching retains focus in the shared segmented control')
    assert.equal(specification().parentElement.hidden, true)
    assert.equal(mapAction.getAttribute('aria-hidden'), null, 'returning to the map restores its action')
    assert.ok(document.querySelector('.dsh-navigation-map-cover .react-flow') === map, 'the map remains mounted')
    assert.equal(draft.value, 'Unsubmitted wording')
    assert.equal(mounts, 1)

    await click([...document.querySelectorAll('.dsh-panel-workspace-tree-item')].find(node => node.textContent === 'Detail'))
    const iframe = document.querySelector('.dsh-navigation-preview iframe')
    assert.equal(iframe.title, 'Detail')
    await click(document.querySelector('.dsh-panel-workspace-map-toggle'))
    await click(openButton())
    locale = 'zh-CN'
    await act(async () => show())
    assert.equal(openButton().textContent, '公共样式')
    assert.ok(document.querySelector('[data-specification-draft]') === draft, 'the specification editor is retained across locale changes')
    await click(tabs()[0])
    await click(returnFrom(document.querySelector('.dsh-navigation-map-cover')))
    assert.equal(document.querySelector('.dsh-canvas-toolbar'), null, 'concrete Page detail retains its own header without a second map toolbar')
    assert.ok(document.querySelector('.dsh-panel-workspace-map-toggle'), 'the existing detail-to-map entry remains available')
    for (const panel of document.querySelectorAll('.dsh-component-tabs-panel')) {
      const label = document.getElementById(panel.getAttribute('aria-labelledby'))
      assert.ok(label, 'retained tabpanels keep a valid accessible name in Page detail')
      assert.ok(label.closest('[hidden]'), 'detail view navigation adds no visible or focusable toolbar')
    }
    assert.ok(document.querySelector('.dsh-navigation-preview iframe') === iframe, 'the selected preview document is retained across both view switches')
    assert.equal(iframe.title, 'Detail')
    assert.equal(mounts, 1)
    assert.equal(writes, 0, 'navigation never writes design data')
    assert.deepEqual(data, initial)

    const inspector = document.querySelector('.dsh-navigation-inspector')
    await click(document.querySelector('.dsh-navigation-preview-actions button'))
    assert.equal(inspector.hidden, false, 'the declared record form is reachable from an existing preview')
    assert.equal(inspector.querySelector('[data-selection]').textContent, 'screens:detail')
    assert.ok(iframe.closest('[hidden]'), 'details hide the preview without discarding its document')
    await click(inspector.querySelector('.dsh-navigation-actions button'))
    assert.equal(inspector.hidden, true)
    assert.equal(document.querySelector('.dsh-navigation-preview iframe'), iframe, 'returning from details retains the same preview')

    data.screens.detail.file = null
    await act(async () => show())
    assert.equal(inspector.hidden, false, 'a plan without an artifact shows the existing record renderer immediately')
    assert.equal(inspector.querySelector('[data-selection]').textContent, 'screens:detail')
    assert.equal(inspector.querySelector('.dsh-navigation-actions button'), null, 'no empty preview choice is added to an unfinished plan')
    assert.equal(writes, 0, 'view selection and artifact availability never modify the plan')
    options.executionAttempts = [{ invocationId: 'pages', attemptId: 'detail-run', runId: 'worker',
      artifactId: 'detail', artifactKind: 'page_html', artifactFile: 'bundle/detail.html', role: 'worker', phase: 'working', sequence: 1 }]
    options.artifactFiles = { 'bundle/detail.html': 'landed-worker-file' }
    await act(async () => show())
    assert.equal(inspector.hidden, true, 'a landed native Worker preview remains available before canonical integration')
    assert.equal(document.querySelector('.dsh-navigation-preview iframe').title, 'Detail')
    delete options.executionAttempts
    delete options.artifactFiles
    data.screens.detail.file = initial.screens.detail.file
    await act(async () => show())

    includeSpecification = false
    await act(async () => show())
    assert.equal(document.querySelector('.dsh-navigation-spec-open'), null, 'no entry is invented when the workspace has no shared content')
    assert.equal(document.querySelector('.dsh-navigation-spec-page'), null)
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
