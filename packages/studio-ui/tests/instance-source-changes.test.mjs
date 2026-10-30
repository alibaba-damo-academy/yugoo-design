/** Same workbench/DOM + real S2 saves. No native model or installed-host claim. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import React from 'react'
import { register } from 'tsx/esm/api'
import { createStudioInstances } from '../../companion/src/studio-instances.mjs'
import { adapters, additions, pin, originalFiles, textOf } from '../../companion/test/fixtures/studio-changes-fixture.mjs'

const { JSDOM } = createRequire(new URL('../../panel/package.json', import.meta.url))('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'https://studio.test/' })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'MouseEvent']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const { Simulate } = await import('react-dom/test-utils')
const loader = register({ namespace: 'instance-source-changes', tsconfig: new URL('./source-tsconfig.json', import.meta.url).pathname })
const { InstanceWorkbench } = process.env.STUDIO_SOURCE_CANDIDATE_REVIEW_BUILT === '1'
  ? await import('../lib/index.js')
  : await loader.import(new URL('../src/InstanceWorkbench.tsx', import.meta.url).href, import.meta.url)
const button = label => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === label)
async function until(predicate) { for (let i = 0; i < 300; i++) { if (predicate()) return; await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }) } assert.fail('Working copy did not settle') }
async function click(label) { assert.ok(button(label), label); assert.equal(button(label).disabled, false); await React.act(async () => button(label).click()) }

async function fixture(t, options = {}) {
  const stateRoot = await mkdtemp(join(tmpdir(), 'inline-source-change-'))
  const serviceOptions = { stateRoot, ...adapters() }, service = await createStudioInstances(serviceOptions)
  const record = await service.copy({ kind: 'bundle', bundle: pin })
  const request = { id: record.id, expectedRevision: record.revision, changes: [...additions(),
    ...(options.extraFile ? [{ path: 'reference/custom-note.md', content: 'Retained custom source note.\n' }] : []),
  ] }
  const prepared = { request, candidate: await service.prepareChanges(request) }
  const saved = [], exported = [], dirty = [], manualSaves = []
  let sourceChanges, failRead = false, saveCalls = 0, displayedId = record.id
  let releaseSave, saveCommitted
  const committed = new Promise(resolve => { saveCommitted = resolve })
  const saveGate = new Promise(resolve => { releaseSave = resolve })
  const root = createRoot(document.getElementById('root'))
  const client = { ...service, read: input => failRead ? Promise.reject(Error('Reopen unavailable')) : service.read(input).then(record => options.noPanel ? { ...record, files: record.files.filter(file => file.path !== 'panel.yaml') } : record), saveChanges: async input => {
    manualSaves.push(input); const value = await service.saveChanges(input)
    if (options.manualUncertain) throw Error('Manual save response lost')
    return value
  } }
  const candidateClient = { read: input => service.read(input), saveChanges: async input => {
    saveCalls++; const value = await service.saveChanges(input)
    saveCommitted(); if (options.pending) await saveGate
    if (options.uncertain) throw Error('Save response lost')
    return value
  } }
  const render = () => root.render(React.createElement(InstanceWorkbench, { client, id: displayedId, locale: 'en', sourceChanges, initialView: options.initialView,
    renderPreview: options.noRenderer ? undefined : preview => React.createElement('pre', { 'data-testid': 'live-source-preview' }, preview.panelYaml), onBack: () => {}, onDirtyChange: value => dirty.push(value),
    onExport: value => exported.push(value), onChanged: value => { saved.push(value); sourceChanges = undefined; render() },
  }))
  await React.act(async () => render())
  await until(() => document.querySelector('textarea[aria-label="SKILL.md"]'))
  t.after(async () => { await React.act(async () => root.unmount()); await rm(stateRoot, { recursive: true, force: true }) })
  return { service, client, serviceOptions, record, prepared, saved, exported, dirty, manualSaves, committed, releaseSave: () => releaseSave(), saves: () => saveCalls,
    failRead(value) { failRead = value },
    async select(id) { displayedId = id; await React.act(async () => render()) },
    async present(value = prepared) { sourceChanges = { prepared: value, client: candidateClient, onDismiss: () => { sourceChanges = undefined; render() } }; await React.act(async () => render()) },
  }
}

test('a Bundle without a Panel opens its editable sources even when the host prefers preview', async t => {
  await fixture(t, { noPanel: true, initialView: 'preview' })
  assert.equal(button('Source Files').getAttribute('aria-pressed'), 'true')
  assert.ok(document.querySelector('textarea[aria-label="SKILL.md"]'))
  assert.ok(button('New file'))
  assert.equal(document.querySelector('[role=alert]'), null)
})

test('native changes keep the same complete file tree, save explicitly and export the new saved revision', async t => {
  const f = await fixture(t, { extraFile: true }), workbench = document.querySelector('.ygd-studio-instance')
  await f.present(); await until(() => button('Save') && !button('Save').disabled)
  assert.equal(document.querySelector('.ygd-studio-instance'), workbench)
  assert.equal(document.querySelector('[aria-label="File changes"]'), null)
  assert.equal(button('Source Files').getAttribute('aria-pressed'), 'true')
  assert.equal(document.querySelectorAll('.ygd-studio-file-tree button[title]').length, f.record.files.length + 1)
  assert.ok(document.querySelector('.ygd-studio-file-tree button[title="SKILL.md"]'), 'unchanged source stays in the same tree')
  await click('Diff')
  assert.ok(document.querySelector('.ygd-studio-inline-diff [data-change=added]'))
  assert.equal(f.saves(), 0); assert.equal((await f.service.read({ id: f.record.id })).revision, 0)
  assert.equal(button('Export').disabled, true)
  const addedFile = document.querySelector('.ygd-studio-file-tree button[title="reference/custom-note.md"]')
  await React.act(async () => addedFile.click())
  assert.match(document.querySelector('.ygd-studio-inline-diff').textContent, /Retained custom source note/)
  await click('Edit')
  await click('Save'); await until(() => button('Save') && !document.querySelector('.ygd-studio-inline-diff') && document.querySelector('.ygd-studio-document-body textarea'))
  assert.equal(document.querySelector('.ygd-studio-instance'), workbench)
  assert.equal(button('Source Files').getAttribute('aria-pressed'), 'true', 'saving does not reset the selected source view')
  const reopened = await createStudioInstances(f.serviceOptions)
  for (const change of f.prepared.request.changes) assert.equal((await reopened.readFile({ id: f.record.id, path: change.path })).content, change.content)
  await click('Export')
  assert.equal(f.exported[0].id, f.record.id); assert.equal(f.exported[0].revision, 1)
  assert.equal(f.saves(), 1)
})

test('a late proposal preserves unsaved human source and refuses its stale base after the human saves', async t => {
  const f = await fixture(t), editor = document.querySelector('textarea[aria-label="SKILL.md"]')
  const text = textOf(originalFiles, 'SKILL.md') + '\nHuman correction.\n'
  await React.act(async () => { Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(editor, text); Simulate.change(editor) })
  await until(() => !button('Save').disabled)
  assert.equal(button('Save').disabled, false, 'human source editing is dirty before the proposal arrives')
  await f.present()
  assert.equal(document.querySelector('textarea[aria-label="SKILL.md"]').value, text)
  assert.equal(document.querySelector('.ygd-studio-inline-diff'), null)
  assert.equal(f.saves(), 0)
  await click('Save'); await until(() => f.saved.length === 1 && document.querySelector('textarea[aria-label="SKILL.md"]')?.value === text && button('Save').disabled)
  assert.equal((await f.service.readFile({ id: f.record.id, path: 'SKILL.md' })).content, text)
  await f.present(); await until(() => document.querySelector('dialog[open]'))
  assert.equal(button('Save').disabled, true)
  assert.equal(f.saves(), 0)
})

test('uncertain save remains blocked through a failed reopen and recovers without resubmitting', async t => {
  const f = await fixture(t, { uncertain: true })
  await f.present(); await until(() => button('Save') && !button('Save').disabled)
  await click('Save'); await until(() => document.body.textContent.includes('Verify the save result'))
  assert.equal(f.saves(), 1); assert.equal(button('Save').disabled, true); assert.equal(button('Export').disabled, true)
  f.failRead(true); await click('Refresh content')
  await until(() => [...document.querySelectorAll('.ygd-studio-error-entry')].some(entry => entry.textContent.includes('The operation could not be completed')))
  const failureEntry = [...document.querySelectorAll('.ygd-studio-error-entry')].find(entry => entry.textContent.includes('The operation could not be completed'))
  await React.act(async () => [...failureEntry.querySelectorAll('button')].find(node => node.textContent === 'View issues').click())
  assert.match(failureEntry.textContent, /Reopen unavailable/)
  assert.equal(button('Save').disabled, true, 'a failed read cannot reset an uncertain save lifetime')
  assert.equal(f.saves(), 1)
  f.failRead(false); await click('Refresh content'); await until(() => button('Save') && !document.querySelector('.ygd-studio-inline-diff') && document.querySelector('.ygd-studio-document-body textarea'))
  assert.equal((await f.service.read({ id: f.record.id })).revision, 1)
  assert.equal(f.saves(), 1)
})


test('a late source-save receipt cannot adopt the previous copy when the same workbench changes ID', async t => {
  const f = await fixture(t, { pending: true })
  const other = await f.service.copy({ kind: 'bundle', bundle: pin, title: { zh: '另一副本', en: 'Other copy' } })
  await f.present(); await until(() => button('Save') && !button('Save').disabled)
  await React.act(async () => { button('Save').click(); await f.committed })
  await f.select(other.id)
  await until(() => document.querySelector('h1')?.textContent === 'Other copy')
  await React.act(async () => { f.releaseSave(); await new Promise(resolve => setTimeout(resolve, 5)) })
  assert.equal(f.saved.length, 0, 'the completed write cannot invoke the new selection callback')
  assert.equal(document.querySelector('h1').textContent, 'Other copy')
  assert.equal((await f.service.read({ id: f.record.id })).revision, 1)
  assert.equal((await f.service.read({ id: other.id })).revision, 0)
})

async function editFile(path, transform) {
  await React.act(async () => document.querySelector(`.ygd-studio-file-tree button[title="${path}"]`).click())
  await until(() => document.querySelector(`textarea[aria-label="${path}"]`))
  const editor = document.querySelector(`textarea[aria-label="${path}"]`), text = transform(editor.value)
  await React.act(async () => { Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(editor, text); Simulate.change(editor) })
  return text
}

test('manual source, diff and live preview share unsaved files and the same global Save/Revert controls', async t => {
  const f = await fixture(t), saveButton = button('Save'), revertButton = button('Revert')
  assert.ok(saveButton.closest('.ygd-studio-content-header'))
  assert.ok(revertButton.closest('.ygd-studio-content-header'))
  const text = await editFile('panel.yaml', value => value.replaceAll('$t:records', 'Human preview title'))
  await until(() => !button('Save').disabled)
  await click('Diff')
  assert.match(document.querySelector('.ygd-studio-inline-diff [data-change=added]').textContent, /Human preview title/)
  await click('Panel Preview')
  await until(() => document.querySelector('[data-testid=live-source-preview]'))
  assert.match(document.querySelector('[data-testid=live-source-preview]').textContent, /Human preview title/)
  assert.equal(button('Save'), saveButton); assert.equal(button('Revert'), revertButton)
  assert.equal([...document.querySelectorAll('button')].filter(value => value.textContent === 'Save').length, 1)
  assert.equal((await f.service.read({ id: f.record.id })).revision, 0, 'preparing a live preview never saves')
  await click('Source Files'); await click('Edit')
  assert.equal(document.querySelector('textarea[aria-label="panel.yaml"]').value, text)
  await click('Panel Preview'); await click('Save')
  await until(() => button('Save')?.disabled && f.saved.length === 1)
  assert.equal((await f.service.readFile({ id: f.record.id, path: 'panel.yaml' })).content, text)
  assert.equal(f.manualSaves[0].mode, 'draft', 'ordinary source saving keeps draft semantics')
  assert.equal(button('Panel Preview').getAttribute('aria-pressed'), 'true')
})

test('Preview opens panel.yaml from another file and edits the same draft alongside its live Panel', async t => {
  const f = await fixture(t), saveButton = button('Save')
  const method = await editFile('SKILL.md', value => value + '\nKeep this method edit.\n')
  await click('Panel Preview')
  await until(() => document.querySelector('textarea[aria-label="panel.yaml"]'))
  const editor = document.querySelector('textarea[aria-label="panel.yaml"]')
  assert.ok(editor.closest('[aria-label="Panel source"]'))
  const text = editor.value.replaceAll('$t:records', 'Edited beside the live Panel')
  await React.act(async () => { Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(editor, text); Simulate.change(editor) })
  await until(() => document.querySelector('[data-testid=live-source-preview]')?.textContent.includes('Edited beside the live Panel'))
  assert.ok(document.querySelector('[data-testid=live-source-preview]').closest('[aria-label="Live Panel preview"]'))
  assert.equal(button('Save'), saveButton)
  assert.equal((await f.service.read({ id: f.record.id })).revision, 0)
  await click('Diff')
  assert.match(document.querySelector('.ygd-studio-inline-diff [data-change=added]').textContent, /Edited beside the live Panel/)
  assert.ok(document.querySelector('[data-testid=live-source-preview]'), 'diff and live Panel coexist')
  await click('Source Files'); await click('Edit')
  assert.equal(document.querySelector('textarea[aria-label="panel.yaml"]').value, text)
  await editFile('SKILL.md', value => { assert.equal(value, method); return value })
  await click('Panel Preview'); await until(() => document.querySelector('textarea[aria-label="panel.yaml"]'))
  window.confirm = () => true
  await click('Revert')
  await until(() => document.querySelector('[data-testid=live-source-preview]'))
  assert.doesNotMatch(document.querySelector('[data-testid=live-source-preview]').textContent, /Edited beside the live Panel/)
  assert.match(document.querySelector('[data-testid=live-source-preview]').textContent, /\$t:records/)
  assert.equal(document.querySelector('textarea[aria-label="panel.yaml"]').value, textOf(originalFiles, 'panel.yaml'))
  assert.equal(button('Save').disabled, true)
  await click('Source Files')
  await editFile('SKILL.md', value => { assert.equal(value, textOf(originalFiles, 'SKILL.md')); return value })
})

test('AI proposals remain manually editable across files and save the freshly prepared digest', async t => {
  const f = await fixture(t)
  await f.present(); await until(() => !button('Save').disabled)
  const text = await editFile('panel.yaml', value => value.replaceAll('$t:records', 'Human refinement of AI proposal'))
  await until(() => !button('Save').disabled)
  await editFile('SKILL.md', value => value + '\nHuman method note.\n')
  await until(() => !button('Save').disabled)
  await React.act(async () => document.querySelector('.ygd-studio-file-tree button[title="panel.yaml"]').click())
  await until(() => document.querySelector('textarea[aria-label="panel.yaml"]'))
  assert.equal(document.querySelector('textarea[aria-label="panel.yaml"]').value, text, 'file navigation retains manual corrections')
  await click('Diff'); assert.match(document.querySelector('.ygd-studio-inline-diff').textContent, /Human refinement/)
  await click('Panel Preview'); await until(() => document.querySelector('[data-testid=live-source-preview]'))
  assert.match(document.querySelector('[data-testid=live-source-preview]').textContent, /Human refinement/)
  assert.equal(f.saves(), 0)
  await click('Save'); await until(() => f.saved.length === 1)
  assert.equal(f.saves(), 1)
  assert.equal((await f.service.readFile({ id: f.record.id, path: 'panel.yaml' })).content, text)
  assert.match((await f.service.readFile({ id: f.record.id, path: 'SKILL.md' })).content, /Human method note/)
  assert.match((await f.service.readFile({ id: f.record.id, path: 'locales/en-US.json' })).content, /Needs review/, 'unaffected AI changes survive human correction')
})

test('invalid current YAML clears the previous preview and Revert restores the saved source', async t => {
  const f = await fixture(t)
  await editFile('panel.yaml', value => value.replaceAll('$t:records', 'Unsaved title'))
  await until(() => !button('Save').disabled)
  await click('Panel Preview'); await until(() => document.querySelector('[data-testid=live-source-preview]'))
  await click('Source Files')
  await editFile('panel.yaml', () => 'version: [invalid YAML\n')
  await click('Panel Preview')
  await until(() => !document.querySelector('[role=status]')?.textContent.includes('Updating preview') && button('View issues'))
  assert.equal(document.querySelector('dialog'), null, 'intermediate preview validation does not automatically interrupt editing')
  await click('View issues'); assert.ok(document.querySelector('dialog[open]'))
  await click('Continue editing')
  assert.equal(document.querySelector('[data-testid=live-source-preview]'), null, 'old success must not describe invalid current source')
  window.confirm = () => true
  await click('Revert'); await click('Source Files')
  await until(() => document.querySelector('textarea[aria-label="panel.yaml"]'))
  assert.equal(document.querySelector('textarea[aria-label="panel.yaml"]').value, textOf(originalFiles, 'panel.yaml'))
  assert.equal((await f.service.read({ id: f.record.id })).revision, 0)
})

test('an uncertain manual batch save locks editing and survives a failed verification without resubmission', async t => {
  const f = await fixture(t, { manualUncertain: true })
  const text = await editFile('panel.yaml', value => value.replaceAll('$t:records', 'Saved despite lost response'))
  await until(() => !button('Save').disabled)
  await click('Save'); await until(() => document.body.textContent.includes('Verify the save result'))
  assert.equal(f.manualSaves.length, 1)
  assert.equal(button('Save').disabled, true); assert.equal(button('Revert').disabled, true)
  assert.equal(document.querySelector('textarea[aria-label="panel.yaml"]').readOnly, true)
  window.confirm = () => true
  f.failRead(true); await click('Refresh content')
  await until(() => [...document.querySelectorAll('.ygd-studio-error-entry')].some(entry => entry.textContent.includes('The operation could not be completed')))
  const failureEntry = [...document.querySelectorAll('.ygd-studio-error-entry')].find(entry => entry.textContent.includes('The operation could not be completed'))
  await React.act(async () => [...failureEntry.querySelectorAll('button')].find(node => node.textContent === 'View issues').click())
  assert.match(failureEntry.textContent, /Reopen unavailable/)
  assert.equal(button('Save').disabled, true); assert.equal(f.manualSaves.length, 1)
  f.failRead(false); await click('Refresh content')
  await until(() => document.querySelector('textarea[aria-label="panel.yaml"]')?.readOnly === false)
  assert.equal(document.querySelector('textarea[aria-label="panel.yaml"]').value, text)
  assert.equal((await f.service.read({ id: f.record.id })).revision, 1)
  assert.equal(f.manualSaves.length, 1)
})

test('a late prepared preview cannot replace the latest human source', async t => {
  const f = await fixture(t), pending = []
  f.client.prepareChanges = request => new Promise(resolve => { pending.push({ request, resolve }) })
  await editFile('panel.yaml', value => value.replaceAll('$t:records', 'First unsaved title'))
  await until(() => pending.length === 1)
  const latest = await editFile('panel.yaml', value => value.replaceAll('First unsaved title', 'Latest unsaved title'))
  await until(() => pending.length === 2)
  await React.act(async () => pending[1].resolve(await f.service.prepareChanges(pending[1].request)))
  await until(() => !button('Save').disabled)
  await React.act(async () => pending[0].resolve(await f.service.prepareChanges(pending[0].request)))
  await click('Panel Preview'); await until(() => document.querySelector('[data-testid=live-source-preview]'))
  assert.match(document.querySelector('[data-testid=live-source-preview]').textContent, /Latest unsaved title/)
  assert.doesNotMatch(document.querySelector('[data-testid=live-source-preview]').textContent, /First unsaved title/)
  await click('Source Files')
  assert.equal(document.querySelector('textarea[aria-label="panel.yaml"]').value, latest)
  assert.equal((await f.service.read({ id: f.record.id })).revision, 0)
})

test('a late refresh for another copy cannot restore over the current human draft', async t => {
  const f = await fixture(t)
  const other = await f.service.copy({ kind: 'bundle', bundle: pin, title: { zh: '另一副本', en: 'Other copy' } })
  const read = f.client.read
  let releaseRefresh
  f.client.read = input => input.id === f.record.id ? new Promise(resolve => { releaseRefresh = async () => resolve(await read(input)) }) : read(input)
  await click('Refresh content')
  assert.equal(typeof releaseRefresh, 'function')
  await f.select(other.id)
  await until(() => document.querySelector('h1')?.textContent === 'Other copy' && document.querySelector('textarea[aria-label="SKILL.md"]'))
  const draft = await editFile('SKILL.md', value => value + '\nKeep this current draft.\n')
  await until(() => !button('Save').disabled)
  await React.act(async () => releaseRefresh())
  assert.equal(document.querySelector('textarea[aria-label="SKILL.md"]').value, draft)
  assert.equal(button('Save').disabled, false)
  assert.equal((await f.service.read({ id: other.id })).revision, 0)
})

test('manual new files share the file tree, diff and global save and survive reopen', async t => {
  const f = await fixture(t)
  await click('New file')
  await React.act(async () => Simulate.change(document.querySelector('[aria-label="Filename"]'), { target: { value: 'reference/manual-notes.md' } }))
  await click('Create')
  await until(() => document.querySelector('textarea[aria-label="reference/manual-notes.md"]'))
  await React.act(async () => Simulate.change(document.querySelector('textarea[aria-label="reference/manual-notes.md"]'), { target: { value: '# User notes\nKeep this content.\n' } }))
  await click('Diff'); assert.match(document.querySelector('.ygd-studio-content-pane').textContent, /User notes/)
  await until(() => button('Save') && !button('Save').disabled)
  await click('Save'); await until(() => f.saved.length > 0)
  const saved = await f.service.readFile({ id: f.record.id, path: 'reference/manual-notes.md' })
  assert.equal(saved.content, '# User notes\nKeep this content.\n')
  assert.equal(f.manualSaves[0].mode, 'draft')
  const reopened = await createStudioInstances(f.serviceOptions)
  assert.equal((await reopened.readFile({ id: f.record.id, path: 'reference/manual-notes.md' })).content, saved.content)
})

test('new-file form prevents overwriting existing paths and global revert removes an unsaved file', async t => {
  const f = await fixture(t), previous = window.confirm; window.confirm = () => true
  t.after(() => { window.confirm = previous })
  await click('New file')
  await React.act(async () => Simulate.change(document.querySelector('[aria-label="Filename"]'), { target: { value: 'skill.md' } }))
  await click('Create'); assert.match(document.querySelector('.ygd-studio-new-file').textContent, /already in use/)
  const filename = document.querySelector('[aria-label=Filename]')
  assert.equal(filename.getAttribute('aria-invalid'), 'true')
  assert.ok(document.getElementById(filename.getAttribute('aria-describedby')))
  assert.equal(document.querySelector('dialog'), null, 'field errors remain local and preserve the input')
  await React.act(async () => Simulate.change(document.querySelector('[aria-label="Filename"]'), { target: { value: 'reference/temporary.md' } }))
  await click('Create'); await until(() => document.querySelector('textarea[aria-label="reference/temporary.md"]'))
  await click('Revert')
  assert.equal(document.querySelector('[title="reference/temporary.md"]'), null)
  assert.equal((await f.service.read({ id: f.record.id })).files.some(file => file.path === 'reference/temporary.md'), false)
  await until(() => document.querySelector('textarea[aria-label="SKILL.md"]'))
})


test('incomplete AI proposals save current files without requiring a valid preview', async t => {
  const f = await fixture(t)
  const request = { id: f.record.id, expectedRevision: 0, changes: [{ path: 'schema.yaml', content: 'type: object\nproperties: []\n' }] }
  const prepared = { request, candidate: await f.service.prepareChanges(request) }
  assert.equal(prepared.candidate.valid, false)
  await f.present(prepared); await until(() => button('Save') && !button('Save').disabled)
  assert.equal(document.querySelector('dialog'), null)
  await click('Save'); await until(() => f.saved.length === 1)
  assert.equal(document.querySelector('dialog'), null)
  assert.equal(f.saved[0].changeReceipt.validation, 'not_requested')
  assert.equal((await f.service.readFile({ id: f.record.id, path: 'schema.yaml' })).content, request.changes[0].content)
  assert.equal((await f.service.preview({ id: f.record.id, expectedRevision: 1 })).preview, undefined, 'saving does not claim the invalid preview works')
})

test('a valid no-panel proposal and its saved result show a neutral preview state', async t => {
  const f = await fixture(t)
  const manifest = await f.service.readFile({ id: f.record.id, path: 'skill.yaml' })
  const request = { id: f.record.id, expectedRevision: f.record.revision,
    changes: [{ path: 'skill.yaml', content: manifest.content.replace('mode: declarative', 'mode: none') }, { path: 'panel.yaml', content: null }] }
  const candidate = await f.service.prepareChanges(request)
  assert.equal(candidate.valid, true)
  assert.equal(candidate.preview, undefined)
  await f.present({ request, candidate }); await until(() => !button('Save').disabled)
  await click('Panel Preview')
  assert.match(document.querySelector('.ygd-studio-live-pane-body').textContent, /No Panel preview is needed/)
  assert.equal(document.querySelector('dialog'), null)
  await click('Save'); await until(() => f.saved.length === 1)
  assert.equal(f.saved[0].changeReceipt.validation, 'not_requested')
  await until(() => document.querySelector('.ygd-studio-live-pane-body')?.textContent.includes('No Panel preview is needed'))
  assert.equal((await f.service.read(f.record.id)).revision, 1)
})


test('AI source saves do not require a preview renderer', async t => {
  const f = await fixture(t, { noRenderer: true })
  await f.present(); await until(() => button('Save') && !button('Save').disabled)
  await click('Save'); await until(() => f.saved.length === 1)
  assert.equal(f.saved[0].changeReceipt.validation, 'not_requested')
  assert.equal((await f.service.read(f.record.id)).revision, 1)
})

test('mismatched candidate identity cannot overwrite current files', async t => {
  const f = await fixture(t)
  await f.present({ ...f.prepared, candidate: { ...f.prepared.candidate, id: 'another-object' } })
  await until(() => document.body.textContent.includes('does not match'))
  assert.equal(button('Save').disabled, true)
  assert.equal(f.saves(), 0)
})

test('a concurrent saved edit cannot be overwritten by an older AI proposal', async t => {
  const f = await fixture(t)
  await f.service.saveFile({ id: f.record.id, expectedRevision: 0, path: 'SKILL.md', content: '# Human edit' })
  await f.present()
  await until(() => document.body.textContent.includes('The working copy changed'))
  assert.equal(button('Save').disabled, true)
  assert.equal((await f.service.readFile({ id: f.record.id, path: 'SKILL.md' })).content, '# Human edit')
})
