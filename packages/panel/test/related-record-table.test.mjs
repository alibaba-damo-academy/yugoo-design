import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { JSDOM } from 'jsdom'
import { installSelectDom, chooseSelectValue, inspectSelectOption } from './select-interaction.mjs'
import { parsePanelManifest } from '../../core/src/panel-dsl.ts'

test('permission table cells edit the same canonical map, preserve source inheritance and roundtrips the shared store', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://panel.test/', pretendToBeVisual: true })
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
  installSelectDom(dom.window)
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const React = await import('react'); globalThis.React = React
  const { createRoot } = await import('react-dom/client')
  const { renderManifest, applyPanelUpdatesToDraft } = await import('../src/interpreter.ts')
  const { DesignFilesStore, GitVersioning, validatorFromSchemaYaml } = await import('../../core/lib/index.js')
  const manifest = parsePanelManifest(await readFile(new URL('../../skills-web-app/bundles/role_access/panel.yaml', import.meta.url), 'utf8'))
  manifest.i18n.messages = Object.fromEntries(await Promise.all(['zh-CN', 'en-US'].map(async locale => [locale,
    JSON.parse(await readFile(new URL(`../../skills-web-app/bundles/role_access/locales/${locale}.json`, import.meta.url), 'utf8'))])))
  let data = JSON.parse(await readFile(new URL('../../skills-web-app/bundles/role_access/reference/preview.json', import.meta.url), 'utf8'))
  data.roles['ROLE-002'].assignment_rule = 'Assigned by the project owner'
  const before = structuredClone(data), writes = []
  const root = createRoot(document.getElementById('root'))
  const show = async (editable = true, locale = 'en-US') => React.act(async () => root.render(renderManifest(manifest, data, { locale, editable,
    onPanelUpdate: updates => { writes.push(updates); data = applyPanelUpdatesToDraft(data, updates) } })))
  const click = async selector => React.act(async () => document.querySelector(selector).click())
  const input = async (selector, value) => React.act(async () => {
    const el = document.querySelector(selector)
    Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  const path = await mkdtemp(join(tmpdir(), 'related-table-save-'))
  try {
    await show()
    assert.equal(writes.length, 0, 'viewing does not initialize or migrate data')
    await click('.dsh-panel-workspace-tree [aria-label="审核人"]')
    await click('.dsh-panel-workspace-tree [aria-label="主审核人"]')
    assert.equal(document.querySelectorAll('.dsh-record-inherited-related tr[data-record]').length, 2)
    assert.equal(document.querySelectorAll('.dsh-record-inherited-related :is(input:not([readonly]),textarea:not([readonly]),button[role=combobox],input[type=checkbox]:not([disabled]),[data-testid^=record-remove])').length, 0)
    assert.ok(document.querySelector('.dsh-design-record-header .dsh-record-parent-inline [role=combobox]'), 'source is inside the original form title row')
    assert.equal(document.querySelector('.dsh-record-inspector > .dsh-record-parent-select'), null)
    assert.equal(await inspectSelectOption(React, document.querySelector('[aria-label="Source role"]'), 'ROLE-003'), undefined, 'self is not a source')
    await chooseSelectValue(React, document.querySelector('[aria-label="Source role"]'), 'ROLE-001')
    assert.equal(data.inheritances[Object.keys(data.inheritances).find(key => data.inheritances[key].source === 'ROLE-003')].target, 'ROLE-001')
    assert.deepEqual(data.policies, before.policies, 'changing source edits the edge, never copies policies')
    await show()
    await click('.dsh-panel-workspace-tree [aria-label="申请人"]')
    assert.equal((await inspectSelectOption(React, document.querySelector('[aria-label="Source role"]'), 'ROLE-003')).disabled, true, 'descendants cannot form a cycle')
    const row = '.dsh-record-related-collection tr[data-record="AP-001"]'
    assert.ok(document.querySelector(`${row} [data-field=capability] textarea`), 'capability is editable directly in its table cell')
    assert.ok(document.querySelector(`${row} [data-field=effect] [role=combobox]`), 'Allow/Deny is editable in the same row')
    assert.equal(document.querySelector(`${row} .dsh-panel-disclosure`), null, 'ordinary permissions need no second whole-record editor')
    assert.equal(document.querySelector('.dsh-related-record-detail'), null)
    assert.ok(document.querySelector(`${row} [data-field=capability].has-inline-required > .dsh-design-required-mark`), 'requiredness stays visibly marked beside its editor, not only in the hidden caption')
    await input(`${row} [data-field=capability] textarea`, 'Submit revised request')
    await show()
    assert.equal(data.policies['AP-001'].capability, 'Submit revised request')
    assert.equal(data.policies['AP-001'].title, 'Submit revised request')
    assert.deepEqual(data.policies['AP-002'], before.policies['AP-002'])
    await chooseSelectValue(React, document.querySelector(`${row} [data-field=effect] [role=combobox]`), 'deny')
    await show()
    assert.equal(data.policies['AP-001'].effect, 'deny')
    assert.equal(data.policies['AP-001'].title, 'Submit revised request', 'effect edits preserve the operation title in its authoring language')
    assert.match(document.querySelector(`${row} [data-field=effect]`).textContent, /Denies/, 'the separate decision remains visible without a title prefix')
    await input(`${row} [data-field=applies_when] textarea`, 'Only synthetic owned records')
    await show()
    await click(`${row} [data-field=requirements] input[value=custom]`)
    await show()
    assert.equal(data.policies['AP-001'].custom_requirement, '')
    assert.equal(document.querySelector(`${row} [data-field=custom_requirement]`), null)
    await click(`${row} [data-field=requirements] input[value=custom]`)
    await show()
    await input(`${row} [data-field=custom_requirement] input`, 'Ask the synthetic owner')
    await show()
    assert.equal(data.policies['AP-001'].custom_requirement, 'Ask the synthetic owner')
    await click('.dsh-record-related-add'); await show()
    const added = Object.keys(data.policies).find(id => !Object.hasOwn(before.policies, id))
    assert.equal(data.policies[added].role_ref, 'ROLE-001')
    assert.ok(document.querySelector(`tr[data-record="${added}"] [data-field=capability] textarea`), 'a new rule is immediately editable in its own cells')
    await click(`[data-testid="record-remove-${added}"]`); await show()
    assert.equal(Object.hasOwn(data.policies, added), false)
    assert.deepEqual(data.policy_order, before.policy_order)
    await show(false)
    assert.equal(document.querySelectorAll('.dsh-record-inspector :is(input:not([readonly]),textarea:not([readonly]),button[role=combobox],[data-testid^=record-remove],.dsh-record-related-add)').length, 0)
    assert.match(document.querySelector(row).textContent, /Submit revised request/)
    assert.match(document.querySelector(`${row} [data-field=effect]`).textContent, /Denies/, 'read-only table cells retain the decision')
    const beforeLocaleChange = structuredClone(data)
    await show(false, 'zh-CN')
    assert.deepEqual(data, beforeLocaleChange, 'switching UI language preserves saved text and preset values')
    assert.match(document.querySelector(row).textContent, /Submit revised request/)
    await show(false)
    assert.match(document.querySelector(`${row} [data-field=effect]`).textContent, /Denies/)
    const run = promisify(execFile)
    const git = new GitVersioning(async ({ argv, cwd, stdinData, env }) => {
      const child = await run(argv[0], argv.slice(1), { cwd, env: { ...process.env, ...env }, input: stdinData })
      return { exitCode: 0, stdout: child.stdout, stderr: child.stderr }
    }, path)
    await git.ensureRepo()
    const store = new DesignFilesStore({ readText: async path => { try { return await readFile(path, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error } },
      writeText: writeFile, ensureDir: path => mkdir(path, { recursive: true }) }, git, path)
    const validate = validatorFromSchemaYaml(await readFile(new URL('../../skills-web-app/bundles/role_access/schema.yaml', import.meta.url), 'utf8'))
    await store.write('role_access', data, { validate, origin: 'panel', settleEvent: async () => {} })
    const saved = await store.read('role_access')
    assert.deepEqual(saved, data)
    data = saved
    await show(true)
    assert.equal(document.querySelector(`${row} [data-field=capability] textarea`).value, 'Submit revised request')
    assert.equal(data.policies['AP-001'].title, 'Submit revised request')
    assert.deepEqual(data.roles, before.roles, 'rendering, permission edits and save/reopen preserve assignment presets and custom wording')
    assert.equal(document.querySelector(`${row} [data-field=custom_requirement] input`).value, 'Ask the synthetic owner')
  } finally { await React.act(async () => root.unmount()); dom.window.close(); await rm(path, { recursive: true, force: true }) }
})
