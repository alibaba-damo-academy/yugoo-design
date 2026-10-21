import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { register } from 'tsx/esm/api'
const registration = register({ namespace: 'workspace-tree-lines' })
const tree = await registration.import('../src/panel-workspace.tsx', import.meta.url)
registration.unregister()
globalThis.React = React
const { PanelWorkspace: Workspace, PanelWorkspaceTree: Tree, PanelWorkspaceTreeGroup: Group, PanelWorkspaceTreeRecord: Record, PanelWorkspaceTreeSubgroup: Subgroup, PanelWorkspaceTreeItem: Item, PanelWorkspaceTreeAdd: Add } = tree
const css = await readFile(new URL('../src/visual-components.css', import.meta.url), 'utf8')
const treeCss = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match => match[1].includes('dsh-panel-workspace-tree') || match[1].includes('.dsh-record-workspace button')).map(match => match[0]).join('\n')
const h = React.createElement
const noop = () => {}

test('workspace bounds long sidebars without clipping the canvas-edge entry', () => {
  for (const className of ['', 'dsh-record-workspace-frame is-canvas-switch', 'dsh-record-board']) {
    const sidebar = h(React.Fragment, null,
      h(Tree, { title: 'Long navigation' }, ...Array.from({ length: 30 }, (_, i) =>
        h(Item, { key: i, onSelect: noop }, `Record ${i + 1}`))),
      h('button', { className: 'dsh-panel-workspace-map-toggle' }, 'Canvas'))
    const dom = new JSDOM(`<style>${css}</style>${renderToStaticMarkup(
      h(Workspace, { className, sidebar }, h('div', null, 'Independent details')))}`)
    try {
      const d = dom.window.document, style = e => dom.window.getComputedStyle(e)
      const workspace = d.querySelector('.dsh-panel-workspace')
      const aside = workspace.querySelector('aside')
      assert.equal(style(workspace).gridTemplateRows, 'minmax(0, 1fr)', 'the grid row must shrink below navigation content height')
      assert.equal(style(aside).minHeight, '0px', 'the sidebar must not impose its min-content height on the row')
      assert.equal(style(workspace.querySelector('main')).minHeight, '0px')
      assert.ok(aside.contains(d.querySelector('.dsh-panel-workspace-map-toggle')))
      if (className) {
        assert.equal(style(aside).overflow, 'visible', 'the canvas-edge entry remains outside the nav scroll owner')
        const nav = aside.querySelector('nav')
        assert.equal(style(nav).height, '100%')
        assert.equal(style(nav).overflow, 'auto', 'only the bounded navigation scrolls')
      } else {
        assert.equal(style(aside).overflow, 'auto', 'ordinary workspace sidebars retain their scroll owner')
      }
    } finally { dom.window.close() }
  }
})

test('structure headers use a neutral fallback, not inferred domain icons or per-node decoration', () => {
  for (const title of ['System integrations', '业务对象', 'Unfamiliar domain']) {
    const dom = new JSDOM(renderToStaticMarkup(h(Tree, { title }, h(Item, { onSelect: noop }, 'Record'))))
    try {
      const header = dom.window.document.querySelector('header')
      assert.equal(header.querySelectorAll('svg').length, 1)
      assert.ok(header.querySelector('svg').classList.contains('lucide-panels-top-left'))
      assert.equal(header.querySelector('svg').getAttribute('aria-hidden'), 'true')
      assert.equal(header.querySelector('svg').getAttribute('width'), '16')
      assert.equal(dom.window.document.querySelector('.dsh-panel-workspace-tree-item svg'), null)
    } finally { dom.window.close() }
  }
  const dom = new JSDOM(renderToStaticMarkup(h(Tree, { title: 'Explicit semantic icon', icon: h('svg', { 'data-explicit-icon': true }) }, 'Content')))
  try {
    assert.ok(dom.window.document.querySelector('[data-explicit-icon]'))
    assert.equal(dom.window.document.querySelector('.lucide-panels-top-left'), null, 'a trusted explicit icon is preserved')
  } finally { dom.window.close() }
})
function fixture(expanded = true) {
  return h('div', { className: 'dsh-record-workspace dsh-panel-workspace-tree' }, h('div', { className: 'dsh-panel-workspace-tree-body' },
    h(Item, { onSelect: noop }, 'Flat root'),
    h(Group, { label: 'Group', expanded, onToggle: noop },
      h(Item, { onSelect: noop }, 'Sibling'),
      h(Record, { label: 'Record', selected: true, expanded, onSelect: noop, onToggle: noop },
        h(Subgroup, { label: 'First collection', count: 1, expanded, onToggle: noop }, h(Item, { onSelect: noop }, 'First leaf')),
        h(Subgroup, { label: 'Last collection', count: 2, expanded, onToggle: noop },
          h(Item, { onSelect: noop }, 'Last leaf'), h(Add, { onAdd: noop }, 'Add'))))))
}
function matchingRules(document, element, pseudo) {
  return [...document.styleSheets[0].cssRules].filter(rule => rule.selectorText?.includes(pseudo))
    .filter(rule => element.matches(rule.selectorText.replaceAll(pseudo, '')))
}

test('real nested record structure uses native row geometry and first-row branch anchors', () => {
  const dom = new JSDOM(`<style>${treeCss}</style>${renderToStaticMarkup(fixture())}`)
  try {
    const d = dom.window.document
    const root = d.querySelector('.dsh-panel-workspace-tree-body > .dsh-panel-workspace-tree-branch')
    assert.equal(matchingRules(d, root, '::before').length, 0, 'Flat root has no incoming line')
    assert.equal(matchingRules(d, root, '::after').length, 0)
    for (const selector of ['.dsh-panel-workspace-tree-children', '.dsh-panel-workspace-tree-record-children', '.dsh-panel-workspace-tree-subgroup-children']) {
      const container = d.querySelector(selector)
      const style = dom.window.getComputedStyle(container)
      assert.equal(style.paddingLeft, '16px')
      assert.equal(style.marginLeft, '16px')
      const last = container.lastElementChild
      const before = matchingRules(d, last, '::before')
      const after = matchingRules(d, last, '::after')
      assert.ok(before.length >= 2)
      assert.equal(before.at(-1).style.height, '18px', 'Native final spine starts at -10 and ends at 8px')
      assert.equal(before[0].style.top, '-10px')
      assert.equal(before[0].style.getPropertyValue('pointer-events'), 'none')
      assert.match(before[0].style.background, /--ds-border-default/)
      assert.equal(before[0].style.width, '1px', 'Native spine width is retained')
      assert.match(after.at(-1).style.getPropertyValue('border-bottom'), /1px solid var\(--ds-border-default/)
      assert.equal(after.at(-1).style.left, '-16px')
      assert.equal(after.at(-1).style.width, '16px')
      assert.equal(after.at(-1).style.height, '12px')
      assert.equal(after.at(-1).style.getPropertyValue('border-radius'), '0 0 0 12px')
      assert.equal(after.at(-1).style.top, 'calc(var(--dsh-tree-row-height) * .35 - 6px)', '35% belongs to the first row, never the expanded subtree')
      assert.equal(after.at(-1).style.getPropertyValue('pointer-events'), 'none')
      assert.equal(dom.window.getComputedStyle(last).getPropertyValue('--dsh-tree-row-height'), '36px')
    }
    for (const button of d.querySelectorAll('.dsh-panel-workspace-tree-group-toggle, .dsh-panel-workspace-tree-item, .dsh-panel-workspace-tree-add, .dsh-panel-workspace-tree-subgroup-toggle')) {
      const style = dom.window.getComputedStyle(button)
      assert.equal(style.height, 'auto', 'wrapped labels can grow the row')
      assert.equal(style.minHeight, '36px')
      assert.equal(style.fontSize, '14px')
      assert.equal(style.lineHeight, '20px')
      assert.equal(style.gap, '8px')
      assert.equal(style.paddingTop, '8px', 'native tree scope wins over generic record button padding')
    }
    assert.equal(dom.window.getComputedStyle(d.querySelector('.dsh-panel-workspace-tree-record-toggle')).width, '32px', 'toggle center shares the 16px child spine axis')
    assert.equal(d.querySelectorAll('[aria-current=page]').length, 1, 'Selection stays on the record')
  } finally { dom.window.close() }
})

test('structure navigation shares labels and optional trailing slots across workspace shells', () => {
  const sample = shell => h('div', { className: shell }, h(Tree, { title: 'Records' },
    h(Item, { onSelect: noop, selected: true, trailing: h('span', { role: 'status' }, 'Working') }, 'Long record title'),
    h(Item, { onSelect: noop }, 'No status'),
    h(Record, { label: 'Parent', expanded: true, onSelect: noop, onToggle: noop }, h(Item, { onSelect: noop }, 'Child'))))
  const dom = new JSDOM(`<style>${css}</style>${renderToStaticMarkup(h(React.Fragment, null,
    ...['dsh-record-workspace', 'dsh-record-board', 'dsh-artifact-workspace'].map(sample)))}`)
  try {
    const d = dom.window.document, style = e => dom.window.getComputedStyle(e)
    for (const nav of d.querySelectorAll('nav')) {
      assert.equal(style(nav.querySelector('h2')).fontWeight, '400')
      const rows = nav.querySelectorAll('.dsh-panel-workspace-tree-item')
      assert.equal(style(rows[0]).fontWeight, '500')
      const label = rows[0].querySelector('.dsh-panel-workspace-tree-label')
      assert.equal(style(label).whiteSpace, 'normal')
      assert.equal(style(label).overflowWrap, 'anywhere')
      assert.equal(style(label).minWidth, '0px')
      const trailing = rows[0].lastElementChild
      assert.ok(trailing.classList.contains('dsh-panel-workspace-tree-trailing'))
      assert.equal(style(trailing).flex, '0 0 auto')
      assert.equal(style(trailing).minHeight, '20px')
      assert.equal(rows[1].querySelector('.dsh-panel-workspace-tree-trailing'), null, 'absent status has no empty slot')
      const child = nav.querySelector('.dsh-panel-workspace-tree-record-children > .dsh-panel-workspace-tree-branch')
      assert.ok(matchingRules(d, child, '::before').length, 'direct children use the same branch spine as grouped children')
    }
  } finally { dom.window.close() }
})

test('folded collections unmount descendants and leave no orphan branches', () => {
  const dom = new JSDOM(`<style>${treeCss}</style>${renderToStaticMarkup(fixture(false))}`)
  try {
    const d = dom.window.document
    assert.equal(d.querySelector('[aria-expanded]').getAttribute('aria-expanded'), 'false')
    assert.equal(d.querySelectorAll('.dsh-panel-workspace-tree-children, .dsh-panel-workspace-tree-record-children, .dsh-panel-workspace-tree-subgroup-children').length, 0)
    assert.equal(d.querySelectorAll('.dsh-panel-workspace-tree-branch').length, 1)
    assert.equal(matchingRules(d, d.querySelector('.dsh-panel-workspace-tree-branch'), '::before').length, 0)
  } finally { dom.window.close() }
})
