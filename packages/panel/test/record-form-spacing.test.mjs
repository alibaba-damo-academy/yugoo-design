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
  // JSDOM cannot resolve variables in padding shorthands. Browser evidence
  // checks the untouched CSS and its resolved gutter; this fixture uses its default.
  .replaceAll('var(--ygd-panel-content-gutter, 16px)', '16px')
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
    assert.equal(style('.dsh-record-workspace-frame .dsh-panel-workspace-main').paddingLeft, '0px')
    assertFormSpacing()
    const switched = { ...neutral.ui, workspace_view: 'switch', children: [{ id: 'canvas', component: 'text_block', text: 'Canvas' }, ...neutral.ui.children] }
    await show(neutral, false, switched)
    assert.ok(document.querySelector('.is-canvas-switch.is-record-form'), 'the detail-only side of a switch shares the same form rhythm')
    assert.equal(style('.dsh-record-workspace-frame .dsh-panel-workspace-main').paddingLeft, '0px', 'cover detail owns its one gutter')
    assert.equal(style('.dsh-record-inspector').paddingLeft, '16px')
    assert.equal(document.querySelector('.dsh-workspace-cover-surface .is-record-form'), null, 'canvas keeps its separate full-size layout')
    assert.equal(style('.dsh-design-record-fields').gap, 'var(--ygd-panel-detail-section-gap, 16px)')
    assert.equal(document.querySelector('.dsh-panel-workspace-map-toggle').parentElement.className, 'dsh-panel-workspace-sidebar')
    assert.deepEqual(data, neutralBefore)

    // A single tabs body is a layout slot, not a whitelist of sibling types.
    const slot = '.dsh-record-workspace-frame > .dsh-panel-workspace-main > .dsh-record-workspace-body > .dsh-component-tabs'
    for (const bundle of ['decision_results', 'decision_comparison']) {
      const base = new URL(`../../skills-decision-modeling/bundles/${bundle}/`, import.meta.url)
      const declaration = parsePanelManifest(readFileSync(new URL('panel.yaml', base), 'utf8'))
      data = JSON.parse(readFileSync(new URL('reference/preview.json', base), 'utf8'))
      const saved = structuredClone(data)
      if (bundle === 'decision_results') {
        // The authorized result redesign has two sibling views. Keep the
        // generic mixed-tab regression as an explicit synthetic composition.
        await show(declaration, true)
        assert.ok(document.querySelector('.dsh-record-workspace-frame.is-record-tabs'))
        assert.equal(document.querySelectorAll('.dsh-record-workspace [role="tab"]').length, 2)
        assert.equal(document.querySelector('.dsh-design-record-form [role="tab"]'), null, 'no nested result tabs')
        declaration.ui = { ...declaration.ui, children: [{ component: 'tabs', id: 'mixed-tabs-fixture', children: [
          { component: 'record_inspector', id: 'mixed-details', title: 'Details' },
          { component: 'record_artifact', id: 'mixed-artifact', title: 'Artifact', source: 'views', artifact: { field: 'artifact_file' } },
        ] }] }
      }
      await show(declaration, true)
      assert.ok(document.querySelector('.dsh-record-workspace-frame.is-record-tabs'))
      assert.equal(document.querySelector('.dsh-record-workspace-frame.is-record-form'), null, 'mixed tabs must not make every view a form')
      assert.equal(style('.dsh-panel-workspace-main').paddingLeft, '0px')
      assert.ok(['', '0', '0px'].includes(style(slot).paddingLeft))
      assert.ok(['', '0', '0px'].includes(style('.dsh-record-workspace-body').paddingTop))
      assert.equal(style('.dsh-record-inspector').paddingLeft, '16px')
      assert.equal(style('.dsh-record-inspector').paddingRight, '16px')
      assert.equal(style('.dsh-record-inspector .dsh-design-record').paddingLeft, '0px')
      assert.equal(document.querySelector('.dsh-record-workspace-header .dsh-design-record'), null, 'title does not borrow a padded record shell')
      assert.equal(style('.dsh-record-workspace-header .dsh-design-record-header').marginLeft, '0px', 'shared workspace header owns its full-width placement')
      assert.equal(style('.dsh-design-record-fields').display, 'grid')
      const inspector = document.querySelector('.dsh-record-inspector')
      const firstInput = inspector.querySelector('textarea')
      const originalValue = firstInput?.value
      const outerTabs = document.querySelector(`${slot} > .dsh-component-tabs-list`).children
      await React.act(async () => outerTabs[1].click())
      assert.equal(inspector.closest('[role="tabpanel"]').hidden, true)
      assert.equal(style('.dsh-record-artifact').paddingLeft, '16px')
      assert.ok(document.querySelector('.dsh-record-artifact [role="status"]'), 'missing artifact stays an explicit empty state')
      await React.act(async () => outerTabs[0].click())
      assert.equal(document.querySelector('.dsh-record-inspector'), inspector, 'switching views preserves mounted drafts')
      assert.equal(firstInput?.value, originalValue)
      assert.deepEqual(data, saved)
    }

    data = structuredClone(neutralBefore)
    const nested = { ...multi, id: 'nested-multi-pane', title: 'Nested canvas/detail layout' }
    const tabbed = { ...neutral.ui, children: [{ id: 'mixed-tabs', component: 'tabs', children: [
      ...neutral.ui.children, nested,
      { id: 'matrix', component: 'record_matrix', source: 'groups', matrix: { field: 'cells', row: 'r', column: 'c', value: 'v' } },
    ] }] }
    // Supported composition must not change spacing or write design facts.
    const resultDeclaration = parsePanelManifest(readFileSync(new URL('../../skills-decision-modeling/bundles/decision_results/panel.yaml', import.meta.url), 'utf8'))
    const resultData = JSON.parse(readFileSync(new URL('../../skills-decision-modeling/bundles/decision_results/reference/preview.json', import.meta.url), 'utf8'))
    const tabs = resultDeclaration.ui.children[0]
    const wrap = child => ({ component: 'stack', id: `wrap-${child.id}`, children: [child] })
    const [inspection, artifact] = tabs.children
    const variants = [
      [inspection], [wrap(inspection)],
      [inspection, { component: 'text_block', id: 'auxiliary', text: 'Supporting explanation' }],
      [tabs], [{ ...tabs, children: tabs.children.map(wrap) }], [wrap(tabs)],
      [wrap({ ...tabs, children: tabs.children.map(wrap) })],
    ]
    const oldData = data
    for (const [index, children] of variants.entries()) {
      const declaration = parsePanelManifest(JSON.stringify({ ...resultDeclaration, ui: { ...resultDeclaration.ui, children } }))
      data = resultData; updates = undefined
      await show(declaration)
      assert.equal(style('.dsh-record-inspector').paddingLeft, '16px', `composition ${index} gutter`)
      assert.equal(style('.dsh-design-record-fields').display, 'grid', `composition ${index} rhythm`)
      assert.equal(style('.dsh-design-record-header').height, '44px')
      assert.equal(style('.dsh-design-record-header').fontSize, '14px')
      if (index === 2) assert.ok(document.querySelector('[data-node=auxiliary].is-workspace-content'), 'bare prose owns its gutter through a shared flow context')
      assert.equal(document.querySelectorAll('.dsh-design-record-header.is-detail').length, 1, 'one canonical title bar')
      assert.equal(document.querySelector('.dsh-design-record-actions'), null, 'readonly remains readonly')
      if (index >= 3) {
        assert.ok(document.querySelector('.dsh-record-workspace-header'), `composition ${index} title precedes views`)
        const inspector = document.querySelector('.dsh-record-inspector')
        const tab = document.querySelectorAll('.dsh-component-tabs-list > button')[1]
        await React.act(async () => tab.click())
        assert.equal(inspector.closest('[role=tabpanel]').hidden, true)
        await React.act(async () => document.querySelector('.dsh-component-tabs-list > button').click())
        assert.equal(document.querySelector('.dsh-record-inspector'), inspector, 'views stay mounted')
      }
      assert.equal(updates, undefined, 'layout and navigation cannot write canonical data')
      assert.deepEqual(data, resultData)
    }
    data = oldData

    const matrixManifest = { ...neutral, fields: [...neutral.fields, { key: 'cells', control: 'rows', applies_to: ['groups'],
      columns: ['r', 'c', 'v'].map(key => ({ key, control: 'text' })) }] }
    await show(matrixManifest, false, tabbed)
    assert.ok(document.querySelector('.is-record-tabs'))
    assert.equal(style(`${slot} > .dsh-component-tabs-panel > .dsh-record-inspector`).paddingLeft, '16px')
    const nestedFrame = document.querySelector('.dsh-component-tabs-panel .dsh-record-workspace-frame')
    assert.equal(nestedFrame.classList.contains('is-record-form'), false)
    assert.equal(window.getComputedStyle(nestedFrame).getPropertyValue('--ygd-panel-tabs-gutter'), '16px', 'a nested workspace resets outer inspector tab insets')
    assert.equal(window.getComputedStyle(nestedFrame.querySelector('.dsh-panel-workspace-main')).paddingLeft, '0px', 'nested workspace owns its own unpadded shell')
    assert.equal(window.getComputedStyle(nestedFrame.querySelector('.dsh-record-inspector')).paddingLeft, '16px', 'nested surface supplies exactly its own gutter')
    assert.equal(window.getComputedStyle(nestedFrame.querySelector('.dsh-design-record-fields')).display, 'grid', 'nested inspector supplies its own form rhythm')
    assert.equal(style('.dsh-record-matrix').paddingLeft, '16px')
    const switchTabs = { ...tabbed, workspace_view: 'switch', children: [{ id: 'cover', component: 'text_block', text: 'Canvas' }, ...tabbed.children] }
    await show(matrixManifest, false, switchTabs)
    assert.ok(document.querySelector('.is-canvas-switch.is-record-tabs'))
    assert.ok(['', '0', '0px'].includes(style(slot).paddingLeft))
    assert.deepEqual(data, neutralBefore)

  } finally { await React.act(async () => root.unmount()); dom.window.close() }
})
