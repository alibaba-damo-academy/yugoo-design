import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { installSelectDom } from './select-interaction.mjs'
const dom = new JSDOM('<style></style><div id="root"></div>', { url: 'https://panel.test/', pretendToBeVisual:true })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLFormElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
installSelectDom(dom.window)
globalThis.ResizeObserver=class{observe(){} unobserve(){} disconnect(){}}
globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window)
document.querySelector('style').textContent = readFileSync(new URL('../src/visual-components.css', import.meta.url), 'utf8')
  // JSDOM does not resolve padding shorthand variables; actual browser checks
  // use the untouched stylesheet. Resolve the existing default for this fixture.
  .replaceAll('var(--ygd-panel-content-gutter, 16px)', '16px')
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { renderNode } = await import('../src/interpreter.ts')
const { applyDesignEditToDraft } = await import('../src/record-state.ts')
const { parsePanelManifest, localizePanelManifest } = await import('../../core/src/panel-dsl.ts')

test('workspace examples keep one shared page-header owner instead of scene-specific frames', async () => {
  const { createPanelComponentExample } = await import('../src/component-examples.ts')
  const { renderToStaticMarkup } = await import('react-dom/server')
  for (const kind of ['record_board', 'question_workspace', 'document_workspace', 'artifact_workspace', 'diagram_workspace', 'canvas_workspace', 'preview_workspace']) {
    const example = createPanelComponentExample(kind, 'en')
    assert.ok(example, kind)
    const manifest = parsePanelManifest(example.panelYaml)
    const surface = document.createElement('div')
    surface.className = 'dsh-design-panel'
    surface.innerHTML = renderToStaticMarkup(renderNode(manifest.ui, manifest, example.sample, { locale: 'en-US', skill: 'component_example' }))
    document.body.append(surface)
    try {
      const header = surface.querySelector('.dsh-design-record-header.is-detail')
      assert.ok(Boolean(header), `${kind} uses the common page-header frame`)
      if (kind === 'record_board') assert.equal(surface.querySelector('.dsh-record-board-overview > header')?.classList.contains('dsh-design-record-header'), true, 'the full-workspace map overview uses the same page title bar')
      const css = getComputedStyle(header)
      assert.equal(css.minHeight, '44px', kind)
      assert.equal(css.paddingLeft, '16px', kind)
      assert.equal(css.paddingRight, '16px', kind)
      assert.equal(header.dataset.panelTitleRole, 'workspace', kind)
      assert.equal(css.getPropertyValue('--ygd-panel-action-height'), '32px', kind)
      const navigationHeader = surface.querySelector('.dsh-panel-workspace-tree > header')
      if (navigationHeader) {
        assert.equal(getComputedStyle(navigationHeader).minHeight, css.minHeight, `${kind} navigation and page titles share the same vertical frame`)
        assert.equal(getComputedStyle(navigationHeader.parentElement).paddingTop, '0px', `${kind} sidebar has no additional offset above its title`)
      }
      for (const action of header.querySelectorAll(':scope > button, :scope > .dsh-artifact-toolbar-actions > button')) {
        assert.equal(getComputedStyle(action).height, 'var(--ygd-panel-action-height, 1.75rem)', `${kind} actions consume the shared page-control size`)
      }
      const title = header.querySelector(':scope > strong')
      if (title) assert.equal(getComputedStyle(title).whiteSpace, 'normal', 'long readonly page titles remain readable')
      if (header.classList.contains('has-context')) assert.equal(css.rowGap, '4px', 'supporting context has one compact shared gap')
      if (kind === 'record_board' || kind === 'question_workspace') {
        const count = surface.querySelector(kind === 'record_board'
          ? '.dsh-record-board .dsh-panel-workspace-main > header .dsh-panel-collection-count'
          : '.dsh-question-workspace-content > header .dsh-panel-header-meta')
        assert.ok(count, `${kind} retains the current scope count`)
        assert.ok(count.previousElementSibling, `${kind} count follows its title`)
        assert.equal(count.parentElement.parentElement.tagName, 'HEADER', `${kind} title and count share one row group`)
        assert.equal(getComputedStyle(count).marginInlineStart, '0px', `${kind} count does not consume the space reserved for actions`)
      }
    } finally { surface.remove() }
  }
  // A plain navigation-map example has no page-title toolbar. The actual page
  // map/specification switch uses this shared toolbar composition instead.
  const { PanelCanvasToolbar } = await import('../src/panel-workspace.tsx')
  const surface = document.createElement('div')
  surface.className = 'dsh-design-panel'
  surface.innerHTML = renderToStaticMarkup(React.createElement(PanelCanvasToolbar, { placement: 'workspace', title: 'Pages', counts: '2 pages' }, React.createElement('button', null, 'Add page')))
  document.body.append(surface)
  try {
    const header = surface.querySelector('.dsh-canvas-toolbar.is-workspace')
    assert.equal(header.classList.contains('dsh-design-record-header'), true)
    assert.equal(getComputedStyle(header).minHeight, '44px')
    assert.equal(getComputedStyle(header).getPropertyValue('--ygd-panel-action-height'), '32px')
    const count = header.querySelector('.dsh-canvas-toolbar-counts')
    assert.equal(count.previousElementSibling.textContent, 'Pages')
    assert.equal(count.parentElement.parentElement, header)
    assert.equal(header.querySelector('button').closest('.dsh-panel-header-title-group'), null, 'actions remain outside the title/count group')
  } finally { surface.remove() }
})

test('actual Role permission cells keep long capability and condition text readable and edit the same policy', async () => {
  const root = createRoot(document.getElementById('root'))
  let manifest = parsePanelManifest(readFileSync(new URL('../../skills-web-app/bundles/role_access/panel.yaml', import.meta.url), 'utf8'))
  manifest.i18n.messages = { 'en-US': JSON.parse(readFileSync(new URL('../../skills-web-app/bundles/role_access/locales/en-US.json', import.meta.url), 'utf8')) }
  manifest = localizePanelManifest(manifest, 'en-US')
  const capability = 'Confirm added scope after reading the complete request.\nKeep the original feedback and every prior return reason visible.'
  const condition = 'Only for requests that add a page or affect the delivery date.\nA resubmission must return to the same project lead.'
  let data = { roles: { lead: { id: 'lead', title: 'Project Lead', assignment_rule: 'Unknown' }, other: { id: 'other', title: 'Other role', assignment_rule: 'Unknown' } }, role_order: ['lead', 'other'],
    policies: { policy: { id: 'policy', title: capability, role_ref: 'lead', effect: 'allow', capability, applies_when: condition, requirements: [], custom_requirement: '' },
      other: { id: 'other', title: 'Unchanged policy', role_ref: 'other', effect: 'deny', capability: 'Delete', requirements: [] } }, policy_order: ['policy', 'other'], inheritances: {} }
  const initial = structuredClone(data)
  const show = editable => root.render(React.createElement('div', { className: 'dsh-design-panel' }, renderNode(manifest.ui, manifest, data, {
    locale: 'en-US', editable, onPanelUpdate: updates => { data = { ...data, ...updates }; show(editable) },
  })))
  const text = field => document.querySelector(`.dsh-record-related-editor [data-record="policy"] [data-field="${field}"] textarea`)
  try {
    await React.act(() => show(true))
    assert.equal(text('capability')?.value, capability)
    assert.equal(text('applies_when')?.value, condition)
    assert.equal(Boolean(document.querySelector('.dsh-record-related-editor [data-field="capability"] input')), false)
    const revised = `${capability}\nRecord the lead's explicit decision.`
    await React.act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(text('capability'), revised)
      text('capability').dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    assert.equal(data.policies.policy.capability, revised)
    assert.equal(data.policies.policy.title, revised, 'existing derived identity follows the canonical capability')
    assert.equal(data.policies.policy.applies_when, condition)
    assert.deepEqual(data.policies.policy.requirements, [])
    assert.deepEqual(data.policies.other, initial.policies.other)
    assert.deepEqual(data.roles, initial.roles)
    assert.deepEqual(data.policy_order, initial.policy_order)
    await React.act(() => show(false))
    assert.equal(Boolean(document.querySelector('.dsh-record-related-editor input, .dsh-record-related-editor textarea')), false)
    assert.ok(document.querySelector('.dsh-record-related-editor').textContent.includes(revised))
  } finally { await React.act(() => root.unmount()) }
})

test('shared headers edit a single canonical title, retain readonly/delete semantics, and opt out of reordering without discarding order', async () => {
  const root = createRoot(document.getElementById('root'))
  let manifest = parsePanelManifest(readFileSync(new URL('../../skills-web-app/bundles/role_access/panel.yaml', import.meta.url), 'utf8'))
  manifest.i18n.messages = Object.fromEntries(['zh-CN', 'en-US'].map(locale => [locale,
    JSON.parse(readFileSync(new URL(`../../skills-web-app/bundles/role_access/locales/${locale}.json`, import.meta.url), 'utf8'))]))
  manifest = localizePanelManifest(manifest, 'en-US')
  let data = { schema_version: 5, roles: { a: { id: 'a', title: 'First role', assignment_rule: '注册后自动拥有' },
    b: { id: 'b', title: 'Second role', assignment_rule: '由管理员授予' } }, role_order: ['a', 'b'],
    policies: { p: { id: 'p', title: 'Derived title stays intact', role_ref: 'a', effect: 'allow', capability: 'Submit', applies_when: '', requirements: [], custom_requirement: '' },
      other: { id: 'other', title: 'Other role policy', role_ref: 'b', effect: 'deny', capability: 'Remove', requirements: [] } }, policy_order: ['p', 'other'] }
  let updates
  const show = (editable = true, node = manifest.ui, onEdit) => React.act(async () => root.render(React.createElement('div', { className: 'dsh-design-panel' },
    renderNode(node, manifest, data, { locale: 'en-US', editable, onEdit, onPanelUpdate: next => { updates = next } }))))
  const style = selector => window.getComputedStyle(document.querySelector(selector))
  const input = async (element, text) => React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(element, text)
    element.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  try {
    const before = structuredClone(data)
    await show()
    assert.ok(document.querySelector('.dsh-design-record-header-content > [data-panel-title="editable"][aria-required="true"]'))
    assert.equal(Boolean(document.querySelector('.dsh-design-record-header-content > .dsh-design-required-mark')), false, 'editable titles use a pencil, not a required asterisk')
    const pencil = document.querySelector('.dsh-design-record-header-content > .dsh-panel-title-edit')
    assert.ok(pencil)
    assert.equal(pencil.getAttribute('aria-label'), 'Edit title')
    await React.act(async () => pencil.click())
    assert.equal(document.activeElement, document.querySelector('[data-panel-title="editable"]'))
    assert.equal(updates, undefined, 'focusing a name never writes design facts')
    assert.ok(document.querySelector('[data-field="assignment_rule"] .dsh-design-required-mark'), 'ordinary required fields retain their indication')
    assert.equal(style('.dsh-design-record-header-content').gap, '4px')
    assert.equal(document.querySelectorAll('[data-panel-title="editable"]').length, 1)
    assert.equal(document.querySelector('[data-panel-title="editable"]').getAttribute('aria-label'), 'Role name')
    assert.equal(Boolean(document.querySelector('[data-section="roles"] [data-field="title"]')), false)
    assert.equal(Boolean(document.querySelector('[data-testid^="record-up-"]')), false)
    assert.equal(Boolean(document.querySelector('[data-testid^="record-down-"]')), false)
    assert.equal(style('.dsh-design-record-header.is-detail').minHeight, '44px')
    assert.ok(document.querySelector('.dsh-design-record-header > .dsh-record-parent-inline'), 'the accepted inline parent control stays in the shared header')
    assert.equal(style('.dsh-record-inspector').paddingTop, '0px', 'an inline parent control does not create an extra row above the header')
    assert.equal(style('.dsh-record-inspector').paddingLeft, '16px', 'body reading gutter remains intact')
    assert.equal(style('.dsh-design-record-header.is-detail').height, 'auto', 'an inline parent control can wrap without clipping')
    let detailLayout
    assert.equal(style('.dsh-design-record-header-input').height, '32px')
    assert.ok(document.querySelector('.dsh-related-record-table'), 'permission rules use the confirmed inline table')
    assert.equal(document.querySelectorAll('.dsh-record-related-editor .dsh-related-record-table tbody tr[data-record]').length, 1)
    assert.ok(document.querySelector('.dsh-record-related-editor [data-field=capability] textarea'))
    await input(document.querySelector('[data-panel-title="editable"]'), 'Renamed role')
    assert.equal(updates.roles.a.title, 'Renamed role')
    assert.deepEqual(updates.roles.b, data.roles.b)
    assert.equal(updates.role_order, undefined, 'rename does not rewrite order')
    assert.equal(updates.policies, undefined)
    assert.deepEqual(data, before, 'host owns application of updates')
    data = { ...data, ...updates }; updates = undefined
    await show()
    assert.equal(document.querySelector('[data-panel-title="editable"]').value, 'Renamed role')
    await show(false)
    assert.equal(Boolean(document.querySelector('[data-panel-title="editable"]')), false)
    assert.equal(Boolean(document.querySelector('.dsh-panel-title-edit')), false)
    assert.equal(Boolean(document.querySelector('.dsh-design-record-actions')), false)
    assert.match(document.querySelector('.dsh-design-record-header.is-detail').textContent, /Renamed role/)
    assert.equal(Boolean(document.querySelector('.dsh-design-record-header .dsh-design-required-mark')), false, 'readonly titles also have no misleading asterisk')
    await show()
    assert.match(document.querySelector('[data-testid="record-remove-p"]').getAttribute('aria-label'), /Derived title stays intact/,
      'static Permission caption must not replace record identity in actions')
    window.confirm = () => false
    await React.act(async () => document.querySelector('[data-testid="record-remove-a"]').click())
    assert.equal(updates, undefined)
    window.confirm = () => true
    await React.act(async () => document.querySelector('[data-testid="record-remove-a"]').click())
    assert.deepEqual(Object.keys(updates.roles), ['b'])
    assert.deepEqual(updates.role_order, ['b'])
    assert.deepEqual(Object.keys(updates.policies), ['other'])
    assert.deepEqual(updates.policy_order, ['other'])

    // Neutral nested binding: same shared header, no role field assumptions.
    manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'equipment', title: 'Equipment',
      records_path: 'model.equipment', fields_path: 'details', order: 'model.order',
      form: { reorder: false, header: { variant: 'detail', title: { field: 'caption', editable: true } }, body: [
        { kind: 'group', title: 'Duplicated title', items: [{ kind: 'field', field: 'caption' }] },
        { kind: 'field', field: 'note' }, { kind: 'field', field: 'aliases' },
      ] } }],
      fields: [{ key: 'caption', label: 'Equipment caption', control: 'text', applies_to: ['equipment'] },
        { key: 'note', label: 'Note', control: 'text', applies_to: ['equipment'] },
        { key: 'aliases', label: 'Aliases', control: 'record_map', item_fields: [{ key: 'caption', label: 'Alias caption', control: 'text' }], applies_to: ['equipment'] }],
      ui: { id: 'form', component: 'record_form', source: 'equipment' } }
    data = { model: { equipment: { x: { origin: 'Keep', details: { caption: 'Meter', note: 'Keep note', aliases: { child: { caption: 'Nested alias' } } } },
      y: { details: { caption: 'Gauge', note: '' } } }, order: ['y', 'x'] } }
    updates = undefined
    await show()
    const groups = [...document.querySelectorAll('[data-record="x"] > .dsh-design-record-fields > .dsh-design-form-group')]
    assert.equal(groups.some(group => group.querySelector(':scope > .dsh-design-form-group-title')?.textContent === 'Duplicated title'), false, 'title-only group does not leave an empty heading')
    assert.equal(groups.length, 1, 'the real aliases collection keeps its content group')
    assert.match(groups[0].textContent, /Aliases/)
    assert.equal(Boolean(document.querySelector('[data-record="x"] > .dsh-design-record-fields > [data-field="caption"]')), false)
    assert.equal(document.querySelectorAll('[data-panel-title="editable"]').length,2,'one header editor per actual record')
    assert.equal(document.querySelector('[data-child-record] [data-field="caption"] input').value,'Nested alias','same-key nested name is not deduplicated')
    assert.match(document.querySelector('[data-testid="record-remove-x"]').getAttribute('aria-label'), /Meter/)
    await input(document.querySelector('[data-record="x"] [data-panel-title="editable"]'), 'Renamed meter')
    assert.equal(updates['model.equipment'].x.details.caption, 'Renamed meter')
    assert.equal(updates['model.equipment'].x.origin, 'Keep')
    assert.equal(updates['model.equipment'].x.details.note, 'Keep note')
    assert.deepEqual(updates['model.equipment'].x.details.aliases,data.model.equipment.x.details.aliases)
    assert.deepEqual(updates['model.equipment'].y, data.model.equipment.y)
    assert.equal(updates['model.order'], undefined)
    assert.deepEqual(data.model.order, ['y', 'x'])
    data.model.equipment = updates['model.equipment']; updates = undefined
    const workspace = { id: 'equipment-workspace', component: 'record_workspace', sources: ['equipment'], children: [{ id: 'equipment-inspector', component: 'record_inspector' }] }
    for (const editable of [true, false]) {
      await show(editable, workspace)
      assert.equal(style('.dsh-record-inspector').paddingTop, '0px', 'a leading detail header meets guidance without an outer spacer')
      assert.equal(style('.dsh-record-inspector').paddingLeft, '16px', 'body reading gutter remains intact')
      assert.equal(style('.dsh-design-record-header.is-detail').minHeight, '44px')
      assert.equal(style('.dsh-design-record-header.is-detail').height, 'auto', 'the shared minimum remains 44px while authored context can expand naturally; Chromium checks actual geometry')
      detailLayout = Object.fromEntries(['display', 'alignItems', 'height'].map(key => [key, style('.dsh-design-record-header.is-detail')[key]]))
    }
    manifest.sections[0].confirm_delete = true
    manifest.sections[0].form.reorder = true
    await show()
    for (const action of ['remove', 'up', 'down']) {
      assert.match(document.querySelector(`[data-testid="record-${action}-x"]`).getAttribute('aria-label'), /Renamed meter/)
    }
    let confirmation
    window.confirm = text => { confirmation = text; return false }
    await React.act(async () => document.querySelector('[data-testid="record-remove-x"]').click())
    assert.match(confirmation, /Renamed meter/)
    assert.equal(updates, undefined, 'cancel confirmation leaves canonical state intact')
    manifest.sections[0].form.header.title.editable=false
    await show()
    assert.equal(document.querySelector('[data-record="x"] > .dsh-design-record-fields > .dsh-design-form-group input').value,'Renamed meter','non-editable header keeps the explicitly declared body entrance')
    manifest.sections[0].form.header.title={text:'Equipment'}
    await show()
    assert.equal(document.querySelector('[data-record="x"] > .dsh-design-record-fields > .dsh-design-form-group input').value,'Renamed meter','static collection caption must not remove the record name')
    delete manifest.sections[0].form
    await show()
    assert.equal(Boolean(document.querySelector('[data-panel-title="editable"]')), false)
    assert.match(document.querySelector('[data-testid="record-remove-x"]').getAttribute('aria-label'), /x$/,
      'undeclared title keeps the legacy fallback')
    assert.equal(document.querySelectorAll('.dsh-design-record-form > [data-record] > .dsh-design-record-fields > [data-field="caption"]').length, 2)
    assert.ok(document.querySelector('[data-testid="record-up-x"]'), 'legacy order controls remain')
    manifest.sections[0].form = { reorder: true }
    delete manifest.sections[0].order
    await show()
    assert.equal(Boolean(document.querySelector('[data-testid="record-up-x"]')), false, 'true cannot invent durable order')

    // Actual Page declaration: frame and edge identity is label, not the UUID.
    manifest = parsePanelManifest(readFileSync(new URL('../../skills-web-app/bundles/page_design/panel.yaml', import.meta.url), 'utf8'))
    data = { pages: {}, page_order: [], connections: { edge: { id: 'edge', label: 'Read chosen record' } },
      connection_order: ['edge'], canvas_sections: { frame: { id: 'frame', label: 'Reading group', page_ids: [] } } }
    for (const [section, id, label] of [['connections', 'edge', 'Read chosen record'], ['canvas_sections', 'frame', 'Reading group']]) {
      await show(true, { component: 'record_form', id: 'form', source: section })
      assert.equal(document.querySelector('[data-panel-title="editable"]').value, label)
      assert.equal(Boolean(document.querySelector('[data-field="label"]')), false, 'title has only one editor')
      assert.match(document.querySelector(`[data-testid="record-remove-${id}"]`).getAttribute('aria-label'), new RegExp(label))
      const before = structuredClone(data)
      updates = undefined
      await input(document.querySelector('[data-panel-title="editable"]'), label + ' renamed')
      assert.deepEqual(updates[section], { ...before[section], [id]: { ...before[section][id], label: label + ' renamed' } })
      assert.deepEqual(data, before, 'header edit cannot mutate source facts')
      assert.equal(updates[section === 'connections' ? 'canvas_sections' : 'connections'], undefined)
    }

    // The math reader shares the ordinary detail header and grid stack. A
    // block substitute lets the negative header margin collapse through it.
    manifest = parsePanelManifest(readFileSync(new URL('../../skills-decision-modeling/bundles/decision_model/panel.yaml', import.meta.url), 'utf8'))
    data = JSON.parse(readFileSync(new URL('../../skills-decision-modeling/bundles/decision_model/reference/preview.json', import.meta.url), 'utf8'))
    updates = undefined
    const modelBefore = structuredClone(data)
    await show(true, manifest.ui, edit => { updates = applyDesignEditToDraft(data, manifest, edit) })
    assert.deepEqual(Object.fromEntries(['display', 'alignItems', 'height'].map(key => [key, style('.dsh-math-document > header')[key]])), detailLayout)
    assert.equal(style('.dsh-math-document').display, 'grid')
    assert.equal(style('.dsh-math-document').paddingTop, '0px', 'the inspector remains the sole gutter owner')
    assert.equal(style('.dsh-math-document').gap, 'var(--ygd-panel-detail-section-gap, 16px)')
    assert.equal(style('.dsh-math-document .dsh-design-record-header-input').height, '32px')
    await React.act(async () => document.querySelector('.dsh-math-document .dsh-panel-title-edit').click())
    assert.equal(document.activeElement, document.querySelector('.dsh-math-document [data-panel-title="editable"]'))
    assert.equal(updates, undefined, 'header focus does not write a model')
    await input(document.activeElement, 'Renamed mathematical model')
    assert.equal(updates.models.example.title, 'Renamed mathematical model')
    assert.deepEqual(data, modelBefore)
    await show(false)
    assert.equal(Boolean(document.querySelector('.dsh-math-document .dsh-panel-title-edit')), false)
    assert.equal(document.querySelector('.dsh-math-document [data-panel-title="readonly"]').readOnly, true)
  } finally { await React.act(async () => root.unmount()); dom.window.close() }
})
