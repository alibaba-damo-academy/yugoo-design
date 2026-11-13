import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

test('continuous node details anchor within one process and legacy migration is a recoverable scoped Agent request', async () => {
  const dom = new JSDOM('<style></style><div id="root" class="dsh-design-panel"></div>', { url: 'https://panel.test/' })
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
  globalThis.getComputedStyle = dom.window.getComputedStyle
  document.querySelector('style').textContent = readFileSync(new URL('../src/visual-components.css', import.meta.url), 'utf8')
  globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
  globalThis.cancelAnimationFrame = clearTimeout
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const React = await import('react'); globalThis.React = React
  const { createRoot } = await import('react-dom/client')
  const { DiagramWorkspace } = await import('../src/diagram-workspace.tsx')
  const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'process', sections: [{ id: 'processes', title: 'Processes' }, { id: 'steps', title: 'Steps' }], fields: [] }
  const node = { component: 'diagram_workspace', id: 'flows', source: 'processes', diagram: {
    format: 'bpmn', file_field: 'file', label_field: 'title', artifact_kind: 'diagram',
    inspector: { presentation: 'document', process_sections: ['processes'],
      nodes: { source: 'steps', process_field: 'process', element_field: 'element', label_field: 'title', sections: ['steps'] },
      migration: { message: 'Add details to this saved flow.', action_label: 'Migrate this flow', prompt: 'Supplement only this flow; preserve other designs.' } },
  } }
  let data = { processes: { first: { title: 'First process' }, second: { title: 'Second process', file: 'neutral/second.bpmn' } },
    steps: { a: { title: 'First step', process: 'first', element: 'BPMN-TECHNICAL-ELEMENT' }, b: { title: 'Second step', process: 'first' } }, unrelated: { preserve: true } }
  const before = structuredClone(data), prompts = [], updates = []
  let reject = true
  const show = (locale = 'en-US') => React.act(async () => root.render(React.createElement(PanelLocaleContext.Provider, { value: locale }, React.createElement(DiagramWorkspace, {
    manifest, node, data, options: { skill: 'neutral', editable: true, onPanelUpdate: update => updates.push(update), sendPrompt: async prompt => {
      prompts.push(prompt); if (reject) throw Error('Agent unavailable')
    } }, render: (id, section) => React.createElement('textarea', { 'data-reading': `${section}:${id}`, defaultValue: `${section}:${id}` }),
  }))))
  const item = label => [...document.querySelectorAll('nav .dsh-panel-workspace-tree-item')].find(element => element.textContent.trim() === label)
  const click = element => React.act(async () => { assert.ok(element); element.click(); await new Promise(resolve => setTimeout(resolve, 10)) })
  const details = () => document.querySelector('.dsh-diagram-heading button[aria-expanded]')
  try {
    await show(); await click(item('First step'))
    assert.deepEqual([...document.querySelectorAll('[data-diagram-record]')].map(element => element.dataset.diagramRecord), ['', 'a', 'b'])
    assert.equal(item('First step').getAttribute('aria-current'), 'page')
    assert.equal(document.querySelector('.dsh-diagram-body').hidden, true)
    assert.equal(document.querySelector('.dsh-diagram-inspector'), null)
    const nodesHeading = () => document.querySelector('.dsh-diagram-document-nodes > summary')
    assert.match(nodesHeading().textContent, /Process nodes\(2\)/)
    assert.equal(nodesHeading().querySelector('.dsh-panel-collection-count').getAttribute('aria-label'), '2 items')
    await show('zh-CN')
    assert.match(nodesHeading().textContent, /流程节点\(2\)/)
    assert.equal(document.querySelector('.dsh-diagram-document-overview > summary').textContent, '流程信息')
    await show()
    assert.equal(document.querySelector('details.dsh-diagram-document-process'), null, 'the selected process has no duplicate whole-process wrapper')
    assert.equal(document.querySelector('.dsh-diagram-heading > .dsh-record-board-id').textContent, 'first', 'the process identity remains in the single workspace title')
    assert.equal(document.querySelectorAll('.dsh-diagram-heading strong').length, 1)
    const overviewGroup = document.querySelector('.dsh-diagram-document-overview')
    const nodesGroup = document.querySelector('.dsh-diagram-document-nodes')
    assert.equal(document.querySelectorAll('.dsh-diagram-document > .dsh-panel-content-group').length, 2, 'overview and nodes are the only first-level semantic groups')
    assert.equal(overviewGroup.querySelector('summary').textContent, 'Flow information')
    assert.equal(document.querySelector('[data-diagram-record=""]').closest('details'), overviewGroup)
    for (const id of ['a', 'b']) {
      const card = document.querySelector(`[data-diagram-record="${id}"]`)
      assert.ok(card.classList.contains('dsh-panel-content-card'), 'each node remains a distinct record card')
      assert.equal(card.closest('details'), nodesGroup, 'white node cards belong to the grey nodes collection')
      assert.equal(card.querySelector('.dsh-panel-content-group'), null, 'node content has no nested grey frame')
      const heading = card.querySelector(':scope > [data-panel-title-role="record"]')
      assert.equal(heading.firstElementChild.textContent, id, 'the canonical business node key precedes its name')
      assert.equal(getComputedStyle(heading).marginBottom, '0px', 'the card owns title-to-body spacing without a second title margin')
      assert.equal(getComputedStyle(heading).fontWeight, '500')
      assert.equal(Boolean(heading.querySelector('strong')), false, 'node text inherits the shared record-title weight')
    }
    const content = document.querySelector('.dsh-diagram-document')
    let scrollHeight = 800
    Object.defineProperties(content, { clientHeight: { value: 1000 }, scrollHeight: { get: () => scrollHeight } })
    content.getClientRects = () => [{}]
    content.getBoundingClientRect = () => ({ top: 0, bottom: 1000 })
    document.querySelectorAll('[data-diagram-record]').forEach((element, index) => { element.getBoundingClientRect = () => ({ top: index * 200, bottom: (index + 1) * 200 }) })
    await React.act(async () => { content.dispatchEvent(new window.Event('scroll')); await new Promise(resolve => setTimeout(resolve, 10)) })
    assert.equal(item('First step').getAttribute('aria-current'), 'page', 'when all details fit, a resize or scroll attempt preserves the explicit selection')
    const positions = []
    content.scrollTo = ({ top }) => positions.push(top)
    content.style.paddingTop = '16px'
    overviewGroup.getBoundingClientRect = () => ({ top: 16, bottom: 180 })
    document.querySelector('[data-diagram-record=""]').getBoundingClientRect = () => ({ top: 64, bottom: 180 })
    await click(item('First process'))
    assert.equal(positions.at(-1), 0, 'opening the process keeps the overview section heading visible instead of anchoring past it to the white body')
    await click(item('First step'))
    document.querySelector('[data-reading="steps:a"]').value = 'Unsaved user text'
    await React.act(async () => { nodesGroup.open = false; await new Promise(resolve => setTimeout(resolve, 10)) })
    assert.equal(nodesGroup.open, false)
    assert.equal(document.querySelector('[data-reading="steps:a"]').value, 'Unsaved user text', 'section collapse preserves mounted drafts')
    scrollHeight = 1400
    content.scrollTop = 400
    await React.act(async () => { content.dispatchEvent(new window.Event('scroll')); await new Promise(resolve => setTimeout(resolve, 10)) })
    assert.notEqual(item('Second step').getAttribute('aria-current'), 'page', 'collapsed node records do not become current through scroll tracking')
    await click(item('Second step'))
    assert.equal(nodesGroup.open, true, 'sidebar anchoring reveals the shared nodes group')
    assert.equal(document.querySelector('[data-reading="steps:a"]').value, 'Unsaved user text', 'anchor navigation retains mounted inputs')
    await click(item('Second process'))
    assert.equal(document.querySelector('.dsh-diagram-document'), null, 'an existing flow without step details stays readable on its canvas')
    assert.equal(document.querySelector('.dsh-diagram-body').hidden, false)
    assert.equal(details().disabled, true)
    assert.equal(details().title, 'No step details yet')
    assert.doesNotMatch(document.querySelector('.dsh-diagram-workspace').textContent, /Add details to this saved flow/)
    await click(details())
    assert.equal(document.querySelector('.dsh-diagram-document'), null, 'disabled Details does not open an empty form')
    const migration = () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Migrate this flow')
    await click(migration())
    assert.match(document.querySelector('[role="alert"]').textContent, /Agent unavailable/)
    reject = false; await click(migration())
    assert.equal(document.querySelector('[role="alert"]'), null)
    assert.match(prompts.at(-1), /Process: second\nDiagram: neutral\/second.bpmn/)
    assert.deepEqual(data, before); assert.equal(updates.length, 0)
    data = { ...data, steps: { ...data.steps, c: { title: 'Migrated step', process: 'second' } } }; await show()
    assert.equal(migration(), undefined, 'completed node supplements remove the migration notice')
    assert.equal(details().disabled, false)
    assert.ok(item('Migrated step'))
    await click(item('Migrated step'))
    assert.match(nodesHeading().textContent, /Process nodes\(1\)/, 'the count belongs to the current process, not all flows')
  } finally { await React.act(async () => root.unmount()); dom.window.close() }
})
