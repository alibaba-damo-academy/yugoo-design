import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { installSelectDom } from './select-interaction.mjs'
const dom = new JSDOM('<style></style><div id="root"></div>', { url: 'https://panel.test/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLFormElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
installSelectDom(dom.window)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
document.querySelector('style').textContent = readFileSync(new URL('../src/visual-components.css', import.meta.url), 'utf8')
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { renderNode } = await import('../src/interpreter.ts')
const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')
const { parsePanelManifest } = await import('../../core/src/panel-dsl.ts')

test('ordinary record forms own one gutter and stacks without changing related edits or other workspace layouts', async () => {
  const root = createRoot(document.getElementById('root'))
  const role = parsePanelManifest(readFileSync(new URL('../../skills-web-app/bundles/role_access/panel.yaml', import.meta.url), 'utf8'))
  // This regression owns ordinary card-form spacing. The current Kit table
  // presentation has its own interaction and narrow-browser regressions.
  delete role.ui.children.find(node => node.component === 'record_inspector').children[0].record_table
  let data = { schema_version: 5, roles: { a: { id: 'a', title: 'First role', assignment_rule: '注册后自动拥有' },
    b: { id: 'b', title: 'Second role', assignment_rule: '由管理员授予' } }, role_order: ['a', 'b'],
    policies: { p: { id: 'p', title: 'Permission', role_ref: 'a', effect: 'allow', capability: 'Submit', applies_when: 'Own request', requirements: ['custom'], custom_requirement: 'Confirm manually' } }, policy_order: ['p'] }
  let updates
  const show = (manifest, editable = false, node = manifest.ui) => React.act(async () => root.render(
    React.createElement(PanelLocaleContext.Provider, { value: 'en-US' },
      React.createElement('div', { className: 'dsh-design-panel' }, renderNode(node, manifest, data,
        { locale: 'en-US', editable, onPanelUpdate: next => { updates = next } })))))
  const style = selector => window.getComputedStyle(document.querySelector(selector))
  const assertFormSpacing = () => {
    assert.equal(style('.dsh-record-workspace-frame .dsh-panel-workspace-main').paddingLeft, '0px')
    assert.equal(style('.dsh-record-inspector').paddingLeft, '16px')
    assert.equal(style('.dsh-record-inspector').paddingRight, '16px')
    // JSDOM exposes the specified variable; real-browser acceptance checks its
    // resolved 16px value under both Panel and Studio token scopes.
    assert.equal(style('.dsh-design-record-fields').gap, 'var(--ygd-panel-detail-section-gap, 16px)')
    assert.equal(style('.dsh-design-record-fields .dsh-design-field').marginBottom, '0px')
    assert.equal(style('.dsh-design-record-title').marginBottom, '0px')
    assert.equal(style('.dsh-record-related-editor').marginTop, 'var(--ygd-panel-detail-section-gap, 16px)')
    assert.equal(style('.dsh-record-related-editor').paddingTop, '0px', 'one 16px boundary, not margin plus padding around a decorative line')
    assert.equal(style('.dsh-record-related-editor').borderTopWidth, '0px')
    assert.equal(style('.dsh-record-related-editor').gap, 'var(--ygd-panel-detail-control-gap, 8px)')
    assert.equal(style('.dsh-record-related-editor > .dsh-design-record-form').gap, 'var(--ygd-panel-detail-section-gap, 16px)')
    assert.equal(style('.dsh-record-related-editor .dsh-design-record').paddingLeft, '12px')
    assert.equal(style('.dsh-record-related-editor .dsh-design-record').marginTop, '0px')
  }
  try {
    const before = structuredClone(data)
    await show(role, true)
    assertFormSpacing()
    assert.equal(style('.dsh-design-record-actions > button').width, '32px', 'action hitboxes unaffected')
    assert.ok(document.querySelector('[data-field="custom_requirement"]'))
    await React.act(async () => document.querySelector('[data-field="requirements"] input[value="custom"]').click())
    assert.deepEqual(updates.policies.p.requirements, [])
    assert.equal(updates.policies.p.custom_requirement, '')
    assert.deepEqual(data, before, 'only host-applied updates alter facts')
    data = { ...data, ...updates }; updates = undefined
    await show(role, true)
    assert.equal(document.querySelector('[data-field="custom_requirement"]'), null)
    const lastField = document.querySelector('.dsh-record-related-editor .dsh-design-record-fields').lastElementChild
    assert.equal(window.getComputedStyle(lastField).marginBottom, '0px')
    const second = [...document.querySelectorAll('nav button')].find(button => button.textContent === 'Second role')
    await React.act(async () => second.click())
    assert.equal(document.querySelector('.dsh-record-related-editor [data-record="p"]'), null)
    const add = document.querySelector('.dsh-record-related-add')
    assert.equal(add.textContent, 'Add')
    assert.equal(add.parentElement.lastElementChild, add)
    assert.equal(add.parentElement.querySelector('header button'), null)
    await React.act(async () => add.click())
    const added = Object.keys(updates.policies).find(id => id !== 'p')
    assert.equal(updates.policies[added].role_ref, 'b', 'tail action binds the currently selected role')
    assert.deepEqual(updates.policies.p, data.policies.p, 'other roles and permissions remain unchanged')
    assert.deepEqual(updates.policy_order, ['p', added])
    await show(role, false)
    assert.equal(document.querySelector('.dsh-design-record-actions'), null)
    assert.equal(document.querySelector('.dsh-record-related-editor header button'), null)
    assert.equal(document.querySelector('.dsh-record-related-add'), null)

    const neutral = { version: 1, panel_kind: 'document', sections: [
      { id: 'groups', title: 'Groups' }, { id: 'notes', title: 'Notes', navigation: 'contextual' },
    ], fields: [
      { key: 'title', control: 'text', description: 'A neutral field description', applies_to: ['groups', 'notes'] },
      { key: 'owner', control: 'record_select', options_from_section: 'groups', hidden: true, applies_to: ['notes'] },
    ], ui: { id: 'neutral', component: 'record_workspace', sources: ['groups', 'notes'], children: [
      { id: 'inspector', component: 'record_inspector', children: [
        { id: 'related', component: 'record_related_editor', source: 'notes', bindings: { reference: 'owner' } },
      ] },
    ] } }
    data = { groups: { g: { title: 'Group' } }, notes: { n: { title: 'Note', owner: 'g' } } }
    const neutralBefore = structuredClone(data)
    await show(neutral)
    assertFormSpacing()
    assert.equal(style('.dsh-record-inspector').paddingTop, '16px', 'untitled content keeps its reading inset')
    assert.equal(style('.dsh-design-field-description').marginBottom, '0px')
    assert.equal(document.querySelectorAll('.dsh-panel-workspace-tree-group').length, 0, 'one real collection needs no duplicate navigation root')
    assert.ok(document.querySelector('.dsh-record-related-editor [data-record="n"]'))
    assert.deepEqual(data, neutralBefore)

    // Role now declares real inheritance. Test the flat-layout contract with
    // an explicitly flat neutral workspace rather than its old declaration.
    await show(neutral, false, { ...neutral.ui, navigation_layout: 'list' })
    assert.equal(document.querySelectorAll('nav [aria-expanded]').length, 0, 'explicit flat navigation stays flat')
    assertFormSpacing()

    const multi = { ...neutral.ui, children: [...neutral.ui.children, { id: 'text', component: 'text_block', text: 'Independent content' }] }
    await show(neutral, false, multi)
    assert.equal(document.querySelector('.is-record-form'), null)
    assert.equal(style('.dsh-record-workspace-frame .dsh-panel-workspace-main').paddingLeft, '0px', 'multiple panes use the same unpadded frame; each content surface owns its gutter')
    assert.equal(style('.dsh-design-record-fields').display, 'contents')
    const switched = { ...neutral.ui, workspace_view: 'switch', children: [{ id: 'canvas', component: 'text_block', text: 'Canvas' }, ...neutral.ui.children] }
    await show(neutral, false, switched)
    assert.ok(document.querySelector('.is-canvas-switch.is-record-form'), 'the detail-only side of a switch shares the same form rhythm')
    assert.equal(style('.dsh-record-workspace-frame .dsh-panel-workspace-main').paddingLeft, '0px', 'cover detail owns its one gutter')
    assert.equal(style('.dsh-record-inspector').paddingLeft, '16px')
    assert.equal(document.querySelector('.dsh-workspace-cover-surface .is-record-form'), null, 'canvas keeps its separate full-size layout')
    assert.equal(style('.dsh-design-record-fields').gap, 'var(--ygd-panel-detail-section-gap, 16px)')
    assert.equal(document.querySelector('.dsh-panel-workspace-map-toggle').parentElement.className, 'dsh-panel-workspace-sidebar')
    assert.deepEqual(data, neutralBefore)
  } finally { await React.act(async () => root.unmount()); dom.window.close() }
})
