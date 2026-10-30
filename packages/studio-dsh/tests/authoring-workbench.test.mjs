/** Actual React 18/shared UI/Panel + temporary S2 storage. Native RPC outcomes are explicit fixtures. */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createStudioInstances } from '../../companion/src/studio-instances.mjs'
import { controlStyleGaps, feedbackStyleGaps } from '../../studio-ui/tests/control-style-coverage.mjs'
import { adapters, additions, pin, entry } from '../../companion/test/fixtures/studio-changes-fixture.mjs'

const built = process.env.STUDIO_AUTHORING_WORKBENCH_BUILT === '1'
const panelRequire = createRequire(new URL('../../panel/package.json', import.meta.url))
const { JSDOM, VirtualConsole } = panelRequire('jsdom')
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (/^react(?:-dom)?(?:\/|$)/u.test(specifier)) return { url: pathToFileURL(panelRequire.resolve(specifier)).href, shortCircuit: true }
    if (specifier === 'dsh-design-studio-ui') return { url: new URL(built ? '../../studio-ui/lib/index.js' : '../../studio-ui/src/index.ts', import.meta.url).href, format: 'module', shortCircuit: true }
    if (specifier === 'dsh-design-panel/sample-preview') return { url: new URL(built ? '../../panel/lib/sample-preview.js' : '../../panel/src/sample-preview.tsx', import.meta.url).href, format: 'module', shortCircuit: true }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.endsWith('.css?inline')) return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(readFileSync(new URL(url.slice(0, -7)), 'utf8'))}` }
    return next(url, context)
  },
})
const virtualConsole = new VirtualConsole()
virtualConsole.on('jsdomError', error => { if (error.type !== 'css parsing') throw error })
const dom = new JSDOM('<div id="root"></div>', { url: 'https://studio.test/', virtualConsole })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.confirm = () => true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { StudioAuthoringWorkbench } = await import(new URL(built ? '../lib/authoring-workbench.js' : '../src/authoring-workbench.tsx', import.meta.url).href)
after(() => { dom.window.close(); hooks.deregister() })
const h = React.createElement
const button = label => [...document.querySelectorAll('button')].find(value => value.textContent.trim() === label || value.getAttribute('aria-label') === label)
const intent = () => document.querySelector('section[aria-label="AI changes"] textarea')
const source = () => document.querySelector('textarea[aria-label="SKILL.md"], textarea[aria-label="mindset.md"]')
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
async function flush() { await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }) }
async function until(predicate) { const deadline = Date.now() + 5000; while (Date.now() < deadline) { if (predicate()) return; await flush() } assert.fail('Rendered condition did not settle') }
async function change(node, value) {
  assert.ok(node)
  await React.act(async () => {
    const proto = node.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function click(label) { const node = button(label); assert.ok(node, label); assert.equal(node.disabled, false, `${label} is enabled`); await React.act(async () => node.click()); await flush() }

async function fixture(t, options = {}) {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-authoring-workbench-'))
  const kit = { name: 'observations_kit', version: '1.0' }
  const captureKit = options.kit ? async () => ({ files: [
    entry('mindset.md', '---\nname: observations_kit\nversion: "1.0"\ndescription: Review observations with the team.\n---\n\nKeep supplied evidence.\n<design_skills>\n## observations\nRecord supplied observations.\n</design_skills>\n'),
    entry('kit.yaml', 'version: 1\nmounts:\n  - {bindingKey: observations, name: observations, version: "1.0"}\n'),
  ] }) : undefined
  const storage = { stateRoot, ...adapters({ captureKit }) }, service = await createStudioInstances(storage)
  let record = options.blankBundle ? await service.create({ kind: 'bundle', title: { zh: '新观察', en: 'New observations' } })
    : await service.copy(options.kit ? { kind: 'kit', kit } : { kind: 'bundle', bundle: pin })
  if (options.extraFiles) {
    const files = Array.from({ length: options.extraFiles }, (_, n) => ({ path: `extra/${n}.md`, content: `# Source ${n}\n` }))
    for (let offset = 0; offset < files.length; offset += 64) record = await service.saveChanges({
      id: record.id, expectedRevision: record.revision, changes: files.slice(offset, offset + 64), mode: 'draft',
    })
  }
  if (options.blankDraft) {
    const method = await service.readFile({ id: record.id, path: 'SKILL.md' })
    record = await service.saveFile({ id: record.id, expectedRevision: record.revision, path: method.path, content: method.content + '\nSaved user draft.\n' })
  }
  const changes = options.blankBundle ? [{ path: 'SKILL.md', content: (await service.readFile({ id: record.id, path: 'SKILL.md' })).content + '\nProposed method draft.\n' }]
    : options.kit ? [{ path: 'mindset.md', content: (await service.readFile({ id: record.id, path: 'mindset.md' })).content.replace('Keep supplied evidence.', 'Keep supplied evidence and ask before filling unknown facts.') }] : additions()
  const request = { id: record.id, expectedRevision: record.revision, changes,
    ...(options.kit && !options.noKitPreview ? { bundle: { name: record.mounts[0].bundle.name, version: record.mounts[0].bundle.version } } : {}) }
  const prepared = { request, candidate: await service.prepareChanges(request) }
  const calls = { start: [], resume: [], cancel: [], save: [], saveSettled: [], changed: [], dirty: [], observe: [], prepared: [], preview: [] }
  let locator = options.content || options.hostCandidate ? { requestId: 'host-request-1', id: record.id, expectedRevision: record.revision,
    bundle: options.kit ? request.bundle : record.bundle, digest: prepared.candidate.digest } : undefined
  let references = [], candidate = options.noCandidate ? undefined : prepared, terminal = options.running ? false : true, turn = 7
  let currentRef, owned = true, previewGate, startGate, saveGate, readGate, preparedGate, cancelGate, lostResponse = false, saveLost = false
  let consumed = options.consumed ?? true, nativeStatus = options.nativeStatus
  const reference = input => ({ sessionId: 'native-child', parentSessionId: 'native-parent', invocationId: input.invocationId,
    epoch: input.invocationId, messageId: 'native-message:' + input.invocationId, afterSeq: 4,
    scope: { id: input.id, expectedRevision: input.expectedRevision, allowedPaths: [...input.paths], bundle: input.bundle } })
  const observation = ref => ({ reference: structuredClone(ref), status: nativeStatus ?? (terminal ? 'completed' : consumed ? 'running' : 'queued'), terminal,
    consumed, turn: consumed ? turn : null, throughSeq: 14, source: 'live', durable: false, pendingInput: !consumed, conversation: options.conversation })
  const instances = {
    ...service,
    read: async input => { if (readGate) await readGate.promise; const value = await service.read(input); return options.record ? options.record(value) : value },
    preview: async input => { calls.preview.push(input); if (previewGate) return previewGate.promise; return service.preview(input) },
    saveChanges: async input => { calls.save.push(input); try { if (saveGate) await saveGate.promise; const value = await service.saveChanges(input); if (saveLost) throw new Error('Save response lost'); return value } finally { calls.saveSettled.push(input) } },
  }
  const dispatch = async input => {
    currentRef = reference(input); references.push(currentRef)
    if (startGate) await startGate.promise
    if (lostResponse) throw new Error('Start response lost')
    return structuredClone(currentRef)
  }
  const client = { instances: Object.freeze(instances),
    start: input => { calls.start.push(input); return dispatch(input) },
    resume: input => { calls.resume.push(input); return dispatch(input) },
    observe: async ref => { calls.observe.push(ref); return observation(currentRef ?? ref) },
    readPrepared: async input => { calls.prepared.push(input); if (!owned) throw new Error('Cold references permit observation only'); const selected = candidate; if (preparedGate) await preparedGate.promise; return selected },
    cancel: async (ref, input) => { calls.cancel.push({ ref, input }); if (cancelGate) await cancelGate.promise; return { ...observation(currentRef), status: 'cancelled', terminal: true } },
    listReferences: async () => structuredClone(references),
  }
  const root = createRoot(document.getElementById('root'))
  let mounted = true
  const render = async (selected = client, nextLocator = locator) => {
    locator = nextLocator
    await React.act(async () => root.render(h(StudioAuthoringWorkbench, { client: selected, id: record.id, locale: 'en', onBack() {},
      initialPrompt: options.initialPrompt,
      presentation: options.content ? 'content-only' : undefined, preparedLocator: locator,
      initialSelection: !calls.changed.length ? locator ? { expectedRevision: locator.expectedRevision, bundle: locator.bundle }
        : options.kit && !options.noKitPreview ? { expectedRevision: record.revision, bundle: { name: pin.name, version: pin.version } } : undefined : undefined,
      onChanged: value => calls.changed.push(value), onDirtyChange: value => calls.dirty.push(value) })))
  }
  const unmount = async () => { if (mounted) { mounted = false; await React.act(async () => root.unmount()) } }
  t.after(async () => { await unmount(); await rm(stateRoot, { recursive: true, force: true }) })
  await render()
  let reviewedOnEntry = false
  if (options.content || options.hostCandidate) {
    await until(() => button('Save') && !button('Save').disabled)
    reviewedOnEntry = document.body.textContent.includes('Proposed changes · not saved')
    assert.equal(calls.save.length, 0, 'opening an exact link reviews without saving')
    await click('Revert')
  }
  await until(() => button('Source Files')); await click('Source Files');
  await click(options.kit ? 'mindset.md' : 'SKILL.md')
  await until(() => source())
  return { service, storage, record, prepared, calls, client, render, unmount, reviewedOnEntry, locator: () => locator,
    candidate(value) { candidate = value }, terminal(value) { terminal = value }, owned(value) { owned = value }, turn(value) { turn = value },
    consumed(value) { consumed = value }, nativeStatus(value) { nativeStatus = value }, cancelGate(value) { cancelGate = value },
    poll: async () => {
      if (button('Check request status')) { await click('Check request status'); return }
      const before = calls.observe.length
      await until(() => calls.observe.length > before)
      await flush()
    },
    references(value) { references = value }, ref: () => currentRef,
    previewGate(value) { previewGate = value }, startGate(value) { startGate = value }, saveGate(value) { saveGate = value }, readGate(value) { readGate = value },
    preparedGate(value) { preparedGate = value },
    lostResponse(value) { lostResponse = value }, saveLost(value) { saveLost = value },
    ask: async () => { await change(intent(), 'Add an explicit Needs review status.'); await click('Send'); await until(() => button('Save') || document.body.textContent.includes('Changes available for review') || document.querySelector('dialog[open]')) },
  }
}

async function dismissProposal() {
  await until(() => button('Save') && !button('Save').disabled)
  await click('Source Files'); await click('Revert'); await click('SKILL.md'); await until(() => source())
}

async function nextProposal(f, marker, extra = []) {
  const path = f.record.kind === 'kit' ? 'mindset.md' : 'SKILL.md'
  const saved = await f.service.readFile({ id: f.record.id, path })
  const request = { ...f.prepared.request, changes: [{ path, content: saved.content + '\n' + marker + '\n' }, ...extra] }
  return { request, candidate: await f.service.prepareChanges(request) }
}

test('same running request refreshes invalid then valid candidates, diagnostics and exact saved source', async t => {
  const f = await fixture(t, { running: true })
  const invalid = await nextProposal(f, 'First invalid proposal', [{ path: 'schema.yaml', content: 'type: unsupported\n' }])
  assert.equal(invalid.candidate.valid, false); f.candidate(invalid); await f.ask()
  await until(() => source()?.value.includes('First invalid proposal'))
  await until(() => !button('Save').disabled)
  assert.equal(document.querySelector('dialog[open]'), null, 'intermediate validation stays noninterrupting')
  await click('Save')
  assert.ok(document.querySelector('dialog[open]'))
  assert.equal(f.calls.save.length, 0)
  await click('Close error dialog')
  await click('schema.yaml'); await until(() => document.querySelector('textarea[aria-label="schema.yaml"]'))
  await click('Diff')
  const next = await nextProposal(f, 'Complete corrected proposal')
  assert.equal(next.candidate.valid, true); f.candidate(next); await f.poll()
  await until(() => button('Save') && !button('Save').disabled)
  assert.equal(button('Diff').getAttribute('aria-pressed'), 'true', 'refresh retains the selected view')
  assert.match(document.querySelector('.ygd-studio-document-name').textContent, /schema.yaml/, 'a saved file excluded from the new proposal stays selected')
  assert.doesNotMatch(document.body.textContent, /Validation needed before saving/)
  await click('SKILL.md'); await click('Edit'); await until(() => source()?.value.includes('Complete corrected proposal'))
  f.candidate(invalid); await f.poll()
  await until(() => source()?.value.includes('First invalid proposal'))
  await until(() => !button('Save').disabled)
  await click('Save')
  assert.ok(document.querySelector('dialog[open]'), 'the returned invalid digest explains its validation instead of writing')
  assert.equal(f.calls.save.length, 0)
  await click('Close error dialog')
  f.candidate(next); await f.poll()
  await until(() => source()?.value.includes('Complete corrected proposal') && !button('Save').disabled)
  assert.equal(f.calls.save.length, 0); assert.equal(f.calls.start.length, 1)
  assert.match(document.body.textContent, /Working/, 'a candidate does not imply native completion')
  await click('Save'); await until(() => f.calls.changed.length === 1)
  assert.equal(f.calls.save[0].digest, next.candidate.digest)
  const reopened = await createStudioInstances(f.storage)
  assert.equal((await reopened.readFile({ id: f.record.id, path: 'SKILL.md' })).content, next.request.changes[0].content)
  assert.doesNotMatch((await reopened.readFile({ id: f.record.id, path: 'schema.yaml' })).content, /unsupported/)
})

test('new proposal retains all manual file drafts and prompt until explicit latest-choice confirmation', async t => {
  const f = await fixture(t, { running: true }); await f.ask(); await until(() => button('Save') && !button('Save').disabled)
  await click('SKILL.md'); await until(() => source())
  await change(source(), source().value + '\nHuman method wording')
  await click('panel.yaml'); await until(() => document.querySelector('textarea[aria-label="panel.yaml"]'))
  const panel = document.querySelector('textarea[aria-label="panel.yaml"]')
  const humanPanel = panel.value + '\n# Human Panel wording\n'; await change(panel, humanPanel)
  await change(intent(), 'Keep my next unsent request')
  const next = await nextProposal(f, 'Newest complete proposal'); f.candidate(next); await f.poll()
  assert.equal(document.querySelector('textarea[aria-label="panel.yaml"]'), panel); assert.equal(panel.value, humanPanel)
  await click('SKILL.md'); await until(() => source()?.value.includes('Human method wording'))
  await until(() => button('Review latest changes') && !button('Review latest changes').disabled)
  let confirms = 0; window.confirm = () => { confirms++; return false }; t.after(() => { window.confirm = () => true })
  await click('Review latest changes')
  assert.equal(confirms, 1); assert.match(source().value, /Human method wording/)
  await click('panel.yaml'); await until(() => document.querySelector('textarea[aria-label="panel.yaml"]'))
  assert.equal(document.querySelector('textarea[aria-label="panel.yaml"]').value, humanPanel)
  window.confirm = () => { confirms++; return true }
  await click('Review latest changes'); await click('SKILL.md'); await until(() => source()?.value.includes('Newest complete proposal'))
  assert.equal(confirms, 2); assert.doesNotMatch(source().value, /Human method wording/)
  assert.equal(intent().value, 'Keep my next unsent request')
  assert.equal(f.calls.save.length, 0); assert.equal(f.calls.start.length, 1)
})

test('title edits made while AI runs survive candidates until explicitly discarded', async t => {
  const f = await fixture(t, { running: true, noCandidate: true }); await f.ask()
  await React.act(async () => document.querySelector('button[aria-label="Rename"]').click())
  const title = document.querySelector('input[aria-label="Copy title"]'); await change(title, 'My unsaved copy name')
  f.candidate(f.prepared); await f.poll()
  const next = await nextProposal(f, 'Latest after title edit'); f.candidate(next); await f.poll()
  assert.equal(document.querySelector('input[aria-label="Copy title"]'), title); assert.equal(title.value, 'My unsaved copy name')
  window.confirm = () => false; t.after(() => { window.confirm = () => true })
  await click('Review latest changes'); assert.equal(title.value, 'My unsaved copy name')
  window.confirm = () => true; await click('Review latest changes')
  await until(() => source()?.value.includes('Latest after title edit'))
  assert.equal(document.querySelector('input[aria-label="Copy title"]'), null)
  assert.equal((await f.service.read({ id: f.record.id })).revision, 0)
})

test('mount edits retain the current Kit proposal until an explicit latest choice', async t => {
  const f = await fixture(t, { kit: true, noKitPreview: true, noCandidate: true, running: true }); await f.ask()
  await click('Mount management'); await until(() => button('Remove')); await click('Remove')
  f.candidate(f.prepared); await f.poll()
  const next = await nextProposal(f, 'Latest Kit method'); f.candidate(next); await f.poll()
  assert.equal(button('Remove'), undefined); assert.ok(button('Add'))
  window.confirm = () => false; t.after(() => { window.confirm = () => true })
  await click('Review latest changes'); assert.equal(button('Remove'), undefined)
  window.confirm = () => true; await click('Review latest changes')
  await until(() => source()?.value.includes('Latest Kit method'))
  assert.equal((await f.service.read({ id: f.record.id })).mounts.length, 1)
  assert.equal(f.calls.save.length, 0)
  await click('Revert'); await click('Mount management'); await until(() => button('Remove'))
})

test('later candidates cannot replace an in-flight or unknown save or relax its receipt fence', async t => {
  const f = await fixture(t, { running: true }), gate = deferred(); t.after(() => gate.resolve())
  await f.ask(); await until(() => button('Save') && !button('Save').disabled)
  f.saveLost(true); f.saveGate(gate); await click('Save'); await until(() => f.calls.save.length === 1)
  const next = await nextProposal(f, 'Must wait for save verification'); f.candidate(next); await f.poll()
  assert.equal(button('Review latest changes').disabled, true)
  assert.equal(button('Saving…').disabled, true); assert.equal(button('Revert').disabled, true)
  await React.act(async () => gate.resolve()); await until(() => document.body.textContent.includes('Verify the save result')); await click('View issues'); assert.match(document.body.textContent, /Save response lost/)
  await f.poll()
  assert.equal(button('Review latest changes').disabled, true); assert.equal(button('Revert').disabled, true)
  assert.equal(f.calls.save.length, 1); assert.equal(f.calls.save[0].digest, f.prepared.candidate.digest)
  assert.equal(f.calls.changed.length, 0)
  assert.doesNotMatch((await f.service.readFile({ id: f.record.id, path: 'SKILL.md' })).content, /Must wait/)
})

test('an older delayed read and a mismatched source revision cannot rewind the displayed proposal', async t => {
  const f = await fixture(t, { running: true }), gate = deferred(); t.after(() => gate.resolve())
  await f.ask(); await until(() => button('Save') && !button('Save').disabled)
  f.owned(false); await f.poll(); f.owned(true)
  f.preparedGate(gate); await f.poll()
  f.preparedGate(undefined)
  const next = await nextProposal(f, 'Latest exact contents'); f.candidate(next); await f.poll()
  await click('SKILL.md'); await until(() => source()?.value.includes('Latest exact contents'))
  await React.act(async () => gate.resolve()); await flush()
  assert.match(source().value, /Latest exact contents/)
  f.candidate({ ...next, request: { ...next.request, expectedRevision: 1 } }); await f.poll()
  assert.match(source().value, /Latest exact contents/)
  await click('View issues'); assert.match(document.body.textContent, /different source revision or request/)
  assert.equal(f.calls.save.length, 0); assert.equal(f.calls.start.length, 1)
})

test('a successful save of the displayed proposal does not credit a newer waiting proposal', async t => {
  const f = await fixture(t, { running: true }), gate = deferred(); t.after(() => gate.resolve())
  await f.ask(); await until(() => button('Save') && !button('Save').disabled)
  f.saveGate(gate); await click('Save'); await until(() => f.calls.save.length === 1)
  const next = await nextProposal(f, 'Not the saved candidate'); f.candidate(next); await f.poll()
  assert.equal(button('Review latest changes').disabled, true)
  await React.act(async () => gate.resolve()); await until(() => f.calls.changed.length === 1)
  assert.doesNotMatch(document.body.textContent, /Changes saved to the working copy/)
  assert.match(document.body.textContent, /source has changed since this candidate/)
  assert.equal(intent().value, '')
  assert.equal(f.calls.save.length, 1); assert.equal(f.calls.save[0].digest, f.prepared.candidate.digest)
  assert.doesNotMatch((await f.service.readFile({ id: f.record.id, path: 'SKILL.md' })).content, /Not the saved/)
})

test('Revert dismisses a newer waiting proposal as well as the manually edited current proposal', async t => {
  const f = await fixture(t, { running: true }); await f.ask(); await until(() => button('Save') && !button('Save').disabled)
  await click('SKILL.md'); await until(() => source()); await change(source(), source().value + '\nHuman input')
  const next = await nextProposal(f, 'Waiting latest proposal'); f.candidate(next); await f.poll()
  assert.ok(button('Review latest changes')); await click('Revert'); await f.poll()
  assert.doesNotMatch(document.body.textContent, /Proposed changes · not saved/)
  assert.equal(button('Review proposed changes').disabled, false)
  assert.equal(f.calls.save.length, 0); assert.equal(f.calls.start.length, 1)
})

test('explicit content-only compatibility reviews exact host candidates through explicit S2 saves and fresh reopen', async t => {
  const f = await fixture(t, { content: true })
  assert.equal(f.reviewedOnEntry, true, 'an exact link directly shows inline changes in the current source view')
  await until(() => button('Review proposed changes'))
  assert.equal(document.querySelector('.ygd-studio-conversation'), null)
  assert.equal(document.querySelector('.ygd-studio-authoring-layout'), null)
  assert.equal(intent(), null)
  assert.equal(f.calls.start.length + f.calls.resume.length + f.calls.observe.length + f.calls.save.length, 0)
  assert.deepEqual(f.calls.prepared, [f.locator()])
  assert.ok(button('Review proposed changes').closest('.ygd-studio-bundle-main'), 'the shared workbench owns candidate controls')
  const workplane = document.querySelector('.ygd-studio-instance')
  const originalTree = workplane.querySelector('.ygd-studio-file-tree-pane')
  await change(source(), source().value + '\nUnsent local draft.\n')
  assert.equal(button('Review proposed changes').disabled, true)
  await click('Revert')
  await click('Review proposed changes')
  await until(() => button('Save') && !button('Save').disabled)
  assert.equal(document.querySelector('.ygd-studio-instance'), workplane)
  assert.equal(workplane.querySelector('.ygd-studio-file-tree-pane'), originalTree)
  assert.ok(button('SKILL.md'), 'the complete file tree remains available alongside changed files')
  await click('Diff')
  assert.ok(document.querySelector('.ygd-studio-inline-diff'))
  await click('Panel Preview'); await until(() => document.querySelector('.dsh-panel-sample-preview'))
  await click('Source Files'); await click('Revert'); await until(() => button('Review proposed changes') && !button('Review proposed changes').disabled)
  assert.equal(f.calls.save.length, 0, 'dismissing suggestions never saves')
  await click('Review proposed changes'); await until(() => button('Save') && !button('Save').disabled)
  await click('Save'); await until(() => f.calls.changed.length === 1)
  assert.equal(document.querySelector('.ygd-studio-instance'), workplane, 'verified save keeps the same workbench')
  await f.render(); await until(() => button('Source Files'))
  assert.equal(button('Review proposed changes'), undefined)
  assert.equal((await createStudioInstances(f.storage).then(s => s.read(f.record.id))).revision, 1)

  const first = await f.service.readFile({ id: f.record.id, path: 'SKILL.md' })
  const request = { id: f.record.id, expectedRevision: 1, changes: [{ path: 'SKILL.md', content: first.content + '\nConfirm the evidence with the user.\n' }] }
  const second = { request, candidate: await f.service.prepareChanges(request) }
  f.candidate(second)
  const locator = { ...f.locator(), requestId: 'host-request-2', expectedRevision: 1, digest: second.candidate.digest }
  await f.render(f.client, locator); await until(() => button('Save') && !button('Save').disabled)
  assert.equal(f.calls.save.length, 1, 'new candidate arrival does not save')
  await click('Save'); await until(() => f.calls.changed.length === 2)
  assert.deepEqual(f.calls.save[1], { ...request, mode: 'validated', digest: second.candidate.digest })
  const reopened = await createStudioInstances(f.storage)
  assert.equal((await reopened.read(f.record.id)).revision, 2)
  assert.match((await reopened.readFile({ id: f.record.id, path: 'SKILL.md' })).content, /Confirm the evidence/)
  assert.equal(f.calls.start.length + f.calls.resume.length + f.calls.cancel.length + f.calls.observe.length, 0)
})

for (const mode of ['content', 'hostCandidate']) test(`${mode} rejects wrong digest, pin, stale source and a changed parent connection without saving`, async t => {
  const f = await fixture(t, { [mode]: true })
  await until(() => button('Review proposed changes'))
  const locator = f.locator()
  await f.render(f.client, { ...locator, digest: 'f'.repeat(64) })
  await until(() => document.querySelector('.ygd-studio-error-entry'))
  assert.equal(button('Review proposed changes'), undefined)
  await f.render(f.client, { ...locator, bundle: { ...pin, version: 'other' } })
  await until(() => document.querySelector('.ygd-studio-error-entry'))
  assert.equal(button('Review proposed changes'), undefined)
  await f.render(f.client, locator); await until(() => button('Review proposed changes'))
  const before = await f.service.readFile({ id: f.record.id, path: 'SKILL.md' })
  await f.service.saveFile({ id: f.record.id, expectedRevision: 0, path: 'SKILL.md', content: before.content + '\nExternal source edit.\n' })
  await click('Review proposed changes'); await until(() => document.querySelector('.ygd-studio-error-entry'))
  assert.equal(button('Save').disabled, true, 'shared review rechecks the current revision')
  await click('Revert'); await until(() => button('Source Files'))
  await f.render({ ...f.client }); await until(() => document.body.textContent.includes('connection changed'))
  assert.equal(button('Review proposed changes')?.disabled ?? true, true)
  assert.equal(f.calls.save.length, 0)
})

test('the default full editor keeps Host proposals, intent and subsequent native results in the same workplane', async t => {
  const f = await fixture(t, { hostCandidate: true })
  assert.equal(f.reviewedOnEntry, true)
  const conversation = document.querySelector('.ygd-studio-conversation'), workplane = document.querySelector('.ygd-studio-instance')
  assert.ok(conversation); assert.ok(document.querySelector('.ygd-studio-authoring-layout'))
  assert.equal(f.calls.start.length + f.calls.save.length, 0, 'opening the exact Host proposal neither dispatches nor saves')
  await change(intent(), 'Refine the explanation in this same editor.')
  await click('Review proposed changes'); await until(() => button('Save') && !button('Save').disabled)
  assert.equal(document.querySelector('.ygd-studio-conversation'), conversation)
  assert.equal(intent().value, 'Refine the explanation in this same editor.')
  await click('Save'); await until(() => f.calls.changed.length === 1)
  assert.equal(document.querySelector('.ygd-studio-instance'), workplane)
  assert.equal(intent().value, 'Refine the explanation in this same editor.')
  const saved = await f.service.readFile({ id: f.record.id, path: 'SKILL.md' })
  const request = { id: f.record.id, expectedRevision: 1, changes: [{ path: 'SKILL.md', content: saved.content + '\nConfirm the explanation with the user.\n' }] }
  f.candidate({ request, candidate: await f.service.prepareChanges(request) })
  await click('Send'); await until(() => button('Save') && !button('Save').disabled)
  assert.equal(f.calls.start[0].expectedRevision, 1)
  assert.equal(document.querySelector('.ygd-studio-instance'), workplane)
  assert.equal(document.querySelector('.ygd-studio-conversation'), conversation)
  await click('Save'); await until(() => f.calls.changed.length === 2)
  assert.equal((await createStudioInstances(f.storage).then(service => service.read(f.record.id))).revision, 2)
})

test('nonempty source → one intent → explicit actual shared Panel review → S2 save and reopen', async t => {
  const f = await fixture(t)
  assert.match(source().value, /Record supplied observations/)
  await click('Panel Preview'); await until(() => document.querySelector('.dsh-panel-sample-preview'))
  assert.equal(document.querySelector('.dsh-panel-sample-preview input,.dsh-panel-sample-preview textarea,.dsh-panel-sample-preview select'), null)
  await click('Source Files'); await click('SKILL.md'); await until(() => source())
  await f.ask()
  assert.equal(f.calls.start.length, 1); assert.equal(f.calls.save.length, 0)
  assert.deepEqual(f.calls.start[0].paths, f.record.files.filter(file => file.editable).map(file => file.path))
  assert.equal(f.calls.start[0].expectedRevision, f.record.revision); assert.deepEqual(f.calls.start[0].bundle, f.record.bundle)
  assert.equal(button('Review proposed changes'), undefined, 'the first clean owned result has no review gate')
  await click('Diff')
  assert.ok(document.querySelector('.ygd-studio-inline-diff'), 'the clean result appears directly in the source workplane')
  const conversation = document.querySelector('.ygd-studio-conversation'), composer = intent()
  assert.equal(conversation.querySelector('[role=log]').textContent.includes('Add an explicit Needs review status.'), true)
  await until(() => button('Save') && !button('Save').disabled)
  assert.ok(document.querySelector('.ygd-studio-inline-diff'))
  await click('Panel Preview'); await until(() => document.querySelector('.dsh-panel-sample-preview'))
  assert.match(document.getElementById('root').textContent, /Needs review/)
  assert.equal(document.querySelector('.ygd-studio-conversation'), conversation, 'review preserves the conversation DOM and input')
  assert.equal(intent(), composer)
  await change(intent(), 'Keep this follow-up draft while I review')
  assert.equal(button('Send').disabled, false, 'a new intent may explicitly refine a pristine terminal candidate'); assert.equal(f.calls.resume.length, 0, 'typing never dispatches')
  assert.equal(document.querySelector('.dsh-panel-sample-preview input,.dsh-panel-sample-preview textarea'), null)
  assert.equal(f.calls.save.length, 0)
  await click('Save'); await until(() => f.calls.changed.length === 1)
  assert.deepEqual(f.calls.save[0], { ...f.prepared.request, mode: 'validated', digest: f.prepared.candidate.digest })
  const reopened = await createStudioInstances(f.storage)
  assert.equal((await reopened.read({ id: f.record.id })).revision, f.record.revision + 1)
  assert.match((await reopened.readFile({ id: f.record.id, path: 'schema.yaml' })).content, /review/)
  await until(() => button('Source Files')); await click('Source Files'); await click('SKILL.md'); await click('Edit'); await until(() => source())
  assert.equal(intent(), composer)
  assert.equal(intent().value, 'Keep this follow-up draft while I review')
  assert.match(document.getElementById('root').textContent, /Changes saved to the working copy/)
  assert.equal(button('Review proposed changes'), undefined)
  assert.ok(f.calls.dirty.includes(true))
})

test('native consumption clears the submitted composer before saving and verified saving clears outer dirty state', async t => {
  const f = await fixture(t); await f.ask()
  assert.equal(intent().value, '')
  await until(() => button('Save') && !button('Save').disabled); await click('Save')
  await until(() => f.calls.changed.length === 1 && intent().value === '' && f.calls.dirty.at(-1) === false)
  assert.match(document.querySelector('[role="log"]').textContent, /Add an explicit Needs review status/)
  assert.match(document.getElementById('root').textContent, /Changes saved to the working copy/)
})

for (const restoreOriginal of [false, true]) {
  test(`saving a native candidate preserves later composer input${restoreOriginal ? ' even when restored to the same text' : ''}`, async t => {
    const f = await fixture(t), gate = deferred(); t.after(() => gate.resolve())
    await f.ask(); f.saveGate(gate)
    await until(() => button('Save') && !button('Save').disabled); await click('Save')
    await until(() => f.calls.save.length === 1)
    await change(intent(), 'A later unsent request.')
    if (restoreOriginal) await change(intent(), f.calls.start[0].prompt)
    await React.act(async () => gate.resolve())
    await until(() => f.calls.changed.length === 1)
    assert.equal(intent().value, restoreOriginal ? f.calls.start[0].prompt : 'A later unsent request.')
    assert.equal(f.calls.dirty.at(-1), true, 'the later draft still protects navigation and export')
  })
}

test('Kit authoring reuses the selected mounted Bundle preview and saves its own Mindset source', async t => {
  const f = await fixture(t, { kit: true })
  assert.equal(f.record.kind, 'kit')
  await f.ask()
  assert.equal(f.calls.start.length, 1)
  assert.deepEqual(f.calls.start[0].bundle, { name: f.record.mounts[0].bundle.name, version: f.record.mounts[0].bundle.version }, 'native requests carry only the strict protocol pin')
  assert.ok(f.calls.start[0].paths.includes('mindset.md'))
  await assert.rejects(f.service.prepareChanges({ id: f.record.id, expectedRevision: 0,
    bundle: f.record.mounts[0].bundle, changes: [{ path: 'kit.yaml', content: 'version: 1\nmounts: []\n' }] }),
  /mount management/, 'reading generated declarations never grants text edits to their mounts')
  await until(() => button('Save') && !button('Save').disabled)
  await click('Save')
  await until(() => f.calls.saveSettled.length === 1)
  const reopened = await createStudioInstances(f.storage)
  assert.equal((await reopened.read(f.record.id)).revision, 1)
  assert.match((await reopened.readFile({ id: f.record.id, path: 'mindset.md' })).content, /ask before filling unknown facts/)
})

test('Kit authoring without a preview selection uses its definition candidate and explicit save/reopen', async t => {
  const f = await fixture(t, { kit: true, noKitPreview: true })
  assert.match(document.body.textContent, /What would make this Kit work better for you\?/)
  assert.equal(f.prepared.candidate.valid, true); assert.equal(f.prepared.candidate.preview, undefined)
  await f.ask()
  assert.equal(f.calls.start.length, 1); assert.equal(f.calls.start[0].bundle, undefined)
  assert.equal(f.ref().scope.bundle, undefined)
  assert.equal(f.calls.preview.length, 0, 'Kit definition-only authoring does not require a Panel preflight')
  assert.ok(f.calls.start[0].paths.includes('mindset.md'))
  await until(() => button('Save') && !button('Save').disabled); await click('Save')
  await until(() => f.calls.changed.length === 1)
  const reopened = await createStudioInstances(f.storage)
  assert.equal((await reopened.read(f.record.id)).revision, 1)
  assert.match((await reopened.readFile({ id: f.record.id, path: 'mindset.md' })).content, /ask before filling unknown facts/)
  assert.equal(f.calls.save[0].mode, 'validated'); assert.equal(f.calls.save[0].bundle, undefined)
  await change(source(), source().value + '\nHuman amendment after saving the proposal.\n')
  await flush()
  assert.equal(!!button('Review latest changes'), false, 'an already saved proposal is not a newer candidate for later human edits')
  assert.doesNotMatch(document.body.textContent, /Newer proposed changes are available/)
  assert.match(source().value, /Human amendment after saving the proposal/)
  assert.equal(f.calls.save.length, 1, 'checking the old request must not save or replace the human draft')
})

test('refresh reads Host-side changes into the same editor without sending or losing unsent intent', async t => {
  const f = await fixture(t)
  await change(intent(), 'Retain this unsent customization request.')
  const before = (await f.service.readFile({ id: f.record.id, path: 'SKILL.md' })).content
  await f.service.saveFile({ id: f.record.id, expectedRevision: 0, path: 'SKILL.md', content: before + '\nHost-side amendment.\n' })
  await click('Refresh working copy')
  await until(() => source()?.value.includes('Host-side amendment.'))
  assert.equal(intent().value, 'Retain this unsent customization request.')
  assert.equal(f.calls.start.length, 0)
  assert.equal(f.calls.changed.at(-1).revision, 1)
})

test('refresh keeps local source until the user accepts discarding it', async t => {
  const f = await fixture(t), confirm = window.confirm
  t.after(() => { window.confirm = confirm })
  await change(source(), 'Unsubmitted local edits.')
  const next = (await f.service.readFile({ id: f.record.id, path: 'SKILL.md' })).content + '\nSaved from the Host conversation.\n'
  await f.service.saveFile({ id: f.record.id, expectedRevision: 0, path: 'SKILL.md', content: next })
  window.confirm = () => false
  await click('Refresh working copy')
  assert.equal(source().value, 'Unsubmitted local edits.')
  window.confirm = () => true
  await click('Refresh working copy')
  await until(() => source()?.value === next)
  assert.equal(f.calls.start.length, 0)
})

test('dirty edits block dispatch; late candidates keep the editor and permit observed-turn cancellation', async t => {
  const f = await fixture(t, { noCandidate: true, running: true })
  await change(intent(), 'Keep my wording')
  const node = source(), original = node.value
  await change(node, original + '\nHuman draft')
  assert.equal(button('Send').disabled, true); assert.equal(f.calls.start.length, 0)
  await change(node, original); await click('Send')
  await until(() => button('Stop') && !button('Stop').disabled)
  await change(node, original + '\nHuman draft while AI runs')
  f.candidate(f.prepared); f.turn(11)
  await f.poll(); await until(() => document.body.textContent.includes('Changes available for review'))
  assert.equal(source(), node); assert.match(source().value, /Human draft while AI runs/)
  assert.equal(document.body.textContent.includes('Proposed changes · not saved'), false, 'dirty source blocks automatic projection while its ordinary manual Save remains available')
  await click('Stop'); await until(() => f.calls.cancel.length === 1)
  assert.equal(f.calls.cancel[0].input.expectedTurn, 11)
  assert.equal(f.calls.save.length, 0); assert.equal(source(), node)
})

test('dirty source blocks native dispatch and preserves the unsent input', async t => {
  const f = await fixture(t)
  const node = source(); await change(node, node.value + '\nNew human text')
  await change(intent(), 'Preserve my terminology')
  assert.equal(button('Send').disabled, true)
  assert.equal(f.calls.start.length, 0); assert.match(node.value, /New human text/)
  assert.equal(intent().value, 'Preserve my terminology')
})

test('connection changes retain dirty source and intent, fence ports and never rebind or dispatch', async t => {
  const f = await fixture(t)
  await f.ask(); await dismissProposal()
  const node = source(); await change(node, node.value + '\nUnsaved retained wording')
  await f.render({ ...f.client, instances: { ...f.client.instances } })
  assert.equal(source(), node); assert.match(node.value, /Unsaved retained wording/)
  assert.equal(intent().value, '')
  assert.equal(button('Review latest changes').disabled, true)
  assert.equal(button('Send').disabled, true)
  assert.match(document.getElementById('root').textContent, /connection changed/i)
  assert.equal(f.calls.start.length, 1); assert.equal(f.calls.resume.length, 0)
  assert.equal(button('Save').disabled, true, 'the disconnected port cannot prepare or save a manual draft')
  await React.act(async () => button('Save').click())
  assert.equal(f.calls.save.length, 0)
  assert.equal((await f.service.read({ id: f.record.id })).revision, f.record.revision)
})

test('lost start response recovers only its invocation, never the newest retained reference', async t => {
  const f = await fixture(t)
  f.lostResponse(true)
  const originalList = f.client.listReferences
  f.client.listReferences = async () => { const refs = await originalList(); return [...refs, { ...refs[0], invocationId: 'other-newer-invocation', epoch: 'newer' }] }
  await f.ask(); await until(() => button('Save') && !button('Save').disabled)
  assert.equal(f.calls.start.length, 1)
  assert.ok(f.calls.observe.length > 0); assert.ok(f.calls.observe.every(value => value.epoch === f.calls.start[0].invocationId))
  assert.equal(f.calls.resume.length, 0); assert.equal(f.calls.save.length, 0)
})

test('unknown response and cold references retain intent without granting control, candidate or automatic retry', async t => {
  const f = await fixture(t, { running: true })
  f.lostResponse(true); f.owned(false)
  await f.ask(); await until(() => document.querySelector('.ygd-studio-error-entry'))
  assert.match(document.getElementById('root').textContent, /outcome needs checking/)
  assert.equal(button('Review proposed changes'), undefined)
  assert.equal(button('Stop'), undefined, 'an unowned or uncertain run offers no fake stop control')
  await change(intent(), 'A new intention must not retry unknown input')
  await f.poll()
  assert.equal(button('Send').disabled, true)
  assert.equal(f.calls.start.length, 1); assert.equal(f.calls.resume.length, 0); assert.equal(f.calls.cancel.length, 0)
})

test('an actual prepared candidate remains reviewable when execution observation is unavailable', async t => {
  const f = await fixture(t)
  f.client.observe = async () => { throw new Error('Observation unavailable') }
  await f.ask(); await until(() => button('Save') && !button('Save').disabled)
  await click('View issues'); assert.match(document.getElementById('root').textContent, /Execution status could not be checked/)
  assert.equal(button('Send').disabled, true)
  await until(() => button('Save') && !button('Save').disabled)
  await click('Diff')
  assert.ok(document.querySelector('.ygd-studio-inline-diff'))
  await click('Panel Preview'); await until(() => document.querySelector('.dsh-panel-sample-preview')); assert.equal(f.calls.save.length, 0)
})

test('an ambiguous invocation match cannot choose a reference or dispatch another input', async t => {
  const f = await fixture(t); f.lostResponse(true)
  const list = f.client.listReferences
  f.client.listReferences = async () => { const refs = await list(); return [...refs, { ...refs[0], epoch: 'conflicting-epoch' }] }
  await f.ask(); await until(() => document.querySelector('.ygd-studio-error-entry'))
  assert.equal(f.calls.observe.length, 0); assert.equal(button('Review proposed changes'), undefined)
  assert.equal(f.calls.start.length, 1); assert.equal(f.calls.resume.length, 0)
  assert.equal(intent().value, 'Add an explicit Needs review status.')
})

test('candidate becomes stale after human save; only a new explicit intent may resume at current revision', async t => {
  const f = await fixture(t)
  await f.ask(); await dismissProposal(); const node = source(); await change(node, node.value + '\nPreserved professional method.')
  await until(() => !button('Save').disabled)
  await click('Save'); await until(() => document.getElementById('root').textContent.includes('source has changed since this candidate'))
  assert.equal(button('Review proposed changes').disabled, true)
  assert.equal(button('Send').disabled, true)
  await change(intent(), 'Work from the newly saved wording')
  assert.equal(f.calls.resume.length, 0)
  await click('Send'); await until(() => f.calls.resume.length === 1)
  assert.equal(f.calls.resume[0].expectedRevision, f.record.revision + 1)
  assert.deepEqual(f.calls.resume[0].previous, { sessionId: f.ref().sessionId, epoch: f.calls.start[0].invocationId })
  assert.equal(f.calls.resume[0].explicit, true)
  const messages = [...document.querySelectorAll('.companion-message[data-role=user] p')].map(node => node.textContent)
  assert.deepEqual(messages, ['Add an explicit Needs review status.', 'Work from the newly saved wording'], 'a new request retains the previous witnessed intent')
})

for (const blankDraft of [false, true]) {
  test(`an explicit blank Bundle${blankDraft ? ' reopened after a draft save' : ''} can request source authoring without validating its unfinished definition`, async t => {
    const f = await fixture(t, { blankBundle: true, blankDraft })
    assert.equal(f.record.createdBlank, true); assert.equal(f.record.revision, blankDraft ? 1 : 0)
    assert.equal(f.prepared.candidate.valid, false)
    const previews = f.calls.preview.length
    await f.ask(); await until(() => f.calls.start.length === 1)
    assert.equal(f.calls.preview.length, previews, 'no prerequisite preview was added by native dispatch')
    assert.deepEqual(f.calls.start[0].bundle, f.record.bundle)
    assert.equal(f.calls.start[0].expectedRevision, f.record.revision)
    assert.deepEqual(f.calls.start[0].paths, f.record.files.filter(file => file.editable).map(file => file.path))
    await until(() => document.body.textContent.includes('Proposed changes · not saved'))
    await until(() => !button('Save').disabled)
    if (button('Close error dialog')) await click('Close error dialog')
    await click('Save')
    assert.ok(document.querySelector('dialog[open]'), 'unfinished source explains the failed validation')
    assert.equal(f.calls.save.length, 0, 'draft provenance never grants a validated candidate save')
    await assert.rejects(f.service.saveChanges({ ...f.prepared.request, digest: f.prepared.candidate.digest, mode: 'validated' }), /failed Core preview/)
    assert.equal((await f.service.read(f.record.id)).revision, f.record.revision)
  })
}

test('a working copy over 64 editable files starts with a bounded initial read', async t => {
  const f = await fixture(t, { extraFiles: 65, noCandidate: true })
  const files = (await f.service.read(f.record.id)).files.filter(file => file.editable)
  assert.ok(files.length > 64)
  await f.ask()
  assert.equal(f.calls.start.length, 1)
  assert.equal(f.calls.start[0].paths.length, 64)
  assert.deepEqual(f.calls.start[0].paths, files.slice(0, 64).map(file => file.path))
  assert.equal((await f.service.read(f.record.id)).files.filter(file => file.editable).length, files.length)
})

test('unmount consumes a late start response without cancelling native work, saving or disposing the parent', async t => {
  const f = await fixture(t), gate = deferred(); f.startGate(gate)
  await change(intent(), 'Finish independently'); await click('Send'); await until(() => f.calls.start.length === 1)
  await f.unmount(); await React.act(async () => gate.resolve()); await flush()
  assert.equal(f.calls.cancel.length, 0); assert.equal(f.calls.save.length, 0); assert.equal(f.calls.changed.length, 0)
})

test('committed save with a lost response remains uncertain, keeps intent and cannot retry', async t => {
  const f = await fixture(t); await f.ask()
  await until(() => button('Save') && !button('Save').disabled)
  f.saveLost(true); await click('Save'); await until(() => document.body.textContent.includes('Verify the save result')); await click('View issues'); assert.match(document.body.textContent, /Save response lost/)
  assert.equal(button('Save').disabled, true)
  assert.equal(f.calls.changed.length, 0); assert.equal(f.calls.save.length, 1)
  assert.equal((await f.service.read({ id: f.record.id })).revision, f.record.revision + 1)
  assert.equal(button('Revert').disabled, true, 'an unknown save cannot discard its receipt guard')
  await click('Refresh working copy')
  await until(() => f.calls.changed.length === 1 && button('Source Files') && !button('Source Files').disabled)
  await click('Source Files'); await click('SKILL.md'); await until(() => source())
  assert.equal(f.calls.save.length, 1, 'refresh only observes the durable result')
  assert.doesNotMatch(document.getElementById('root').textContent, /Changes saved to the working copy/)
  assert.equal(intent().value, '')
  assert.equal(button('Review proposed changes').disabled, true)
})

test('connection replacement during review cannot redirect or repeat an in-flight save', async t => {
  const f = await fixture(t), gate = deferred(); await f.ask()
  await until(() => button('Save') && !button('Save').disabled)
  f.saveGate(gate); await click('Save'); await until(() => f.calls.save.length === 1)
  const replacementSaves = []
  await f.render({ ...f.client, instances: { ...f.client.instances, saveChanges: value => replacementSaves.push(value) } })
  await React.act(async () => gate.resolve()); await until(() => document.getElementById('root').textContent.includes('connection changed'))
  assert.equal(button('Save').disabled, true)
  assert.equal(f.calls.changed.length, 0); assert.equal(replacementSaves.length, 0); assert.equal(f.calls.save.length, 1)
  await until(() => f.calls.saveSettled.length === 1)
  assert.equal((await f.service.read({ id: f.record.id })).revision, f.record.revision + 1)
})

test('full projection presents each exact candidate once, preserves drafts and accepts a new digest', async t => {
  const f = await fixture(t, { running: true }), workplane = document.querySelector('.ygd-studio-instance')
  await f.ask(); await until(() => button('Save') && !button('Save').disabled)
  assert.equal(button('Review proposed changes'), undefined)
  assert.equal(document.querySelector('.ygd-studio-instance'), workplane)
  await dismissProposal()
  await f.poll()
  assert.equal(document.body.textContent.includes('Proposed changes · not saved'), false, 'the same candidate cannot reclaim the editor after Revert')
  const node = source(), current = node.value
  await change(node, current + '\nHuman wording stays here.')
  const request = { id: f.record.id, expectedRevision: 0, changes: [{ path: 'SKILL.md', content: current + '\nA new exact candidate.' }] }
  f.candidate({ request, candidate: await f.service.prepareChanges(request) })
  await f.poll()
  assert.equal(source(), node); assert.match(node.value, /Human wording stays here/)
  assert.equal(document.body.textContent.includes('Proposed changes · not saved'), false, 'a new candidate still waits for clean source')
  await click('Revert')
  await until(() => button('Save') && !button('Save').disabled)
  await click('Diff')
  assert.match(document.querySelector('.ygd-studio-inline-diff').textContent, /A new exact candidate/)
  assert.equal(document.querySelector('.ygd-studio-instance'), workplane)
  await click('Revert'); await f.poll()
  assert.equal(document.body.textContent.includes('Proposed changes · not saved'), false)
  assert.equal(f.calls.save.length, 0); assert.equal(f.calls.start.length, 1)
})


test('terminal invalid proposal continues the same native conversation without discarding the retained candidate', async t => {
  const f = await fixture(t)
  const invalid = await nextProposal(f, 'Retained invalid proposal', [{ path: 'schema.yaml', content: 'type: unsupported\n' }])
  f.candidate(invalid); await f.ask(); await until(() => source()?.value.includes('Retained invalid proposal'))
  await until(() => !button('Save').disabled)
  const notice = document.querySelector('.ygd-studio-conversation .ygd-studio-error-entry')
  assert.match(notice.textContent, /Changes need repair/)
  assert.equal(document.querySelectorAll('dialog[open]').length, 0, 'terminal failure stays in the conversation without interrupting editing')
  assert.doesNotMatch(document.querySelector('.ygd-studio-save-feedback').textContent, /Validation needed|View issues/)
  const { STUDIO_WORKSPACE_CSS } = await import('dsh-design-studio-ui')
  assert.deepEqual(feedbackStyleGaps(notice, STUDIO_WORKSPACE_CSS), [])
  assert.deepEqual(controlStyleGaps(notice, STUDIO_WORKSPACE_CSS), [])
  assert.equal(document.querySelector('.ygd-studio-instance > [role=alert]'), null)
  await click('Continue repair'); assert.ok(document.activeElement === intent(), 'repair returns focus to the existing composer')
  assert.match(intent().value, /Fix the issues/)
  assert.ok(intent().value.includes(invalid.candidate.diagnostics[0].message), 'repair carries the actual diagnostics into the existing conversation')
  assert.equal(button('Send').disabled, false, 'repair provides a sendable new request instead of selecting the already submitted prompt')
  assert.equal(f.calls.resume.length, 0, 'choosing repair only prepares the composer')
  const next = await nextProposal(f, 'Corrected complete proposal'), gate = deferred()
  f.candidate(next); f.startGate(gate)
  await click('Send'); await until(() => f.calls.resume.length === 1)
  assert.match(source().value, /Retained invalid proposal/, 'old candidate stays until the new owned candidate arrives')
  assert.equal(f.calls.start.length, 1); assert.equal(f.calls.save.length, 0)
  assert.equal(f.calls.resume[0].previous.sessionId, 'native-child')
  assert.notEqual(f.calls.resume[0].invocationId, f.calls.start[0].invocationId)
  await React.act(async () => gate.resolve()); await until(() => source()?.value.includes('Corrected complete proposal') && !button('Save').disabled)
  await click('Save'); await until(() => f.calls.changed.length === 1)
  const reopened = await createStudioInstances(f.storage)
  assert.equal((await reopened.readFile({ id: f.record.id, path: 'SKILL.md' })).content, next.request.changes[0].content)
})

test('choosing repair preserves an already composed follow-up without dispatching it', async t => {
  const f = await fixture(t)
  f.candidate(await nextProposal(f, 'Invalid draft', [{ path: 'schema.yaml', content: 'type: unsupported\n' }]))
  await f.ask(); await until(() => button('Continue repair'))
  await change(intent(), 'Keep the questions conversational; do not add an artificial Panel.')
  await click('Continue repair')
  assert.equal(intent().value, 'Keep the questions conversational; do not add an artificial Panel.')
  assert.equal(document.activeElement, intent())
  assert.equal(f.calls.resume.length, 0)
})

test('repair never replaces human source edits or starts while native execution is still running', async t => {
  const f = await fixture(t, { running: true })
  const invalid = await nextProposal(f, 'Invalid candidate', [{ path: 'schema.yaml', content: 'type: unsupported\n' }])
  f.candidate(invalid); await f.ask(); await until(() => source()?.value.includes('Invalid candidate'))
  await change(intent(), 'Fix this candidate')
  assert.equal(button('Continue repair'), undefined, 'running intermediate validation is not a terminal failure notice')
  assert.equal(button('Send'), undefined)
  assert.equal(button('Stop').disabled, false)
  await change(source(), source().value + '\nHuman retained edit')
  f.terminal(true); await f.poll(); await until(() => button('Continue repair'))
  assert.equal(button('Continue repair').disabled, true); assert.equal(button('Send').disabled, true)
  assert.match(source().value, /Human retained edit/); assert.equal(f.calls.resume.length, 0)
})

test('cancelled invalid proposal retains its files, exposes exact file details and resumes only after explicit Send', async t => {
  const f = await fixture(t, { running: true })
  const invalid = await nextProposal(f, 'Cancelled candidate remains', [{ path: 'schema.yaml', content: 'type: unsupported\n' }])
  // Real S2 diagnostic supplies its file location; an additional foreign location must stay inert.
  f.candidate({ ...invalid, candidate: { ...invalid.candidate, diagnostics: [
    ...invalid.candidate.diagnostics,
    { code: 'test.foreign', subject: '../../foreign.yaml', message: 'Unknown external location.' },
  ] } })
  await f.ask(); await until(() => source()?.value.includes('Cancelled candidate remains'))
  assert.equal(document.querySelector('dialog[open]'), null, 'intermediate validation does not interrupt editing')
  await until(() => button('Save') && !button('Save').disabled)
  await click('Save')
  assert.equal(f.calls.save.length, 0, 'an invalid candidate opens its explanation without attempting persistence')
  const blocker = document.querySelector('dialog[open]')
  await React.act(async () => blocker.querySelector('summary').click())
  const links = [...blocker.querySelectorAll('.ygd-studio-error-details button')]
  assert.equal(links.length, 1, 'arbitrary or absent locations are never navigable')
  assert.equal(links[0].textContent, 'schema.yaml')
  await React.act(async () => links[0].click())
  await until(() => document.querySelector('textarea[aria-label="schema.yaml"]')?.value.includes('unsupported'))
  await click('Stop'); await until(() => button('Continue repair'))
  assert.match(document.querySelector('.ygd-studio-conversation-log').textContent, /Execution cancelled/)
  assert.equal(f.calls.resume.length, 0); assert.equal(f.calls.save.length, 0)
  assert.equal(document.querySelector('textarea[aria-label="schema.yaml"]').value, 'type: unsupported\n')
  await click('Continue repair'); await change(intent(), 'Repair the retained invalid candidate after cancellation.')
  f.candidate(await nextProposal(f, 'Repaired after cancellation')); f.terminal(true)
  await click('Send'); await until(() => !button('Save').disabled)
  assert.equal(f.calls.start.length, 1); assert.equal(f.calls.resume.length, 1)
  await click('SKILL.md'); await until(() => source()?.value.includes('Repaired after cancellation'))
})


test('consumed prefill stays empty across source selection and changing scope suggestions', async t => {
  const options = { initialPrompt: 'Complete this imported Skill.', running: true }
  const f = await fixture(t, options)
  const composer = intent()
  await click('Send')
  await until(() => intent().value === '' && button('Stop') && !button('Stop').disabled)
  assert.equal(f.calls.start.length, 1); assert.equal(f.calls.save.length, 0)
  assert.ok(document.querySelector('.ygd-studio-conversation-log .companion-spinner'))
  assert.equal(document.querySelector('.ygd-studio-conversation-log button')?.textContent.includes('Stop') ?? false, false)
  assert.equal(button('Check request status'), undefined)
  await click('panel.yaml'); await until(() => document.querySelector('textarea[aria-label="panel.yaml"]'))
  options.initialPrompt = 'A regenerated suggestion for the next source revision'
  await f.render()
  assert.equal(intent(), composer); assert.equal(composer.value, '')
  assert.equal(f.calls.start.length, 1)
})

for (const restoreOriginal of [false, true]) test(`consumption preserves text changed during dispatch${restoreOriginal ? ' even when restored to the submitted wording' : ''}`, async t => {
  const f = await fixture(t, { initialPrompt: 'Complete the missing files.', running: true, noCandidate: true })
  const gate = deferred(); t.after(() => gate.resolve()); f.startGate(gate)
  await click('Send'); await until(() => f.calls.start.length === 1)
  await change(intent(), 'Keep this next unsent message')
  if (restoreOriginal) await change(intent(), f.calls.start[0].prompt)
  await React.act(async () => gate.resolve())
  await until(() => button('Stop') && !button('Stop').disabled)
  assert.equal(intent().value, restoreOriginal ? f.calls.start[0].prompt : 'Keep this next unsent message')
  assert.equal(f.calls.start.length, 1); assert.equal(f.calls.resume.length, 0)
})

test('unknown delivery retains the prefill and offers only an explicit status check until consumption is confirmed', async t => {
  const options = { initialPrompt: 'Complete the imported definition.', running: true, noCandidate: true, consumed: false, nativeStatus: 'unknown' }
  const f = await fixture(t, options)
  await click('Send'); await until(() => button('Check request status') && !button('Check request status').disabled)
  assert.equal(intent().value, options.initialPrompt)
  assert.equal(button('Stop'), undefined)
  assert.equal(document.querySelector('.ygd-studio-conversation-log .companion-spinner'), null)
  options.initialPrompt = 'Changed scope suggestion'; await f.render()
  assert.equal(intent().value, 'Complete the imported definition.')
  f.consumed(true); f.nativeStatus('running')
  await click('Check request status')
  await until(() => intent().value === '' && button('Stop') && !button('Stop').disabled)
  assert.equal(button('Check request status'), undefined)
  assert.equal(f.calls.start.length, 1); assert.equal(f.calls.resume.length, 0)
})

test('saving reviewable changes cannot clear a draft whose native delivery remains unconfirmed', async t => {
  const f = await fixture(t, { initialPrompt: 'Keep this request until native consumption is confirmed.' })
  f.client.observe = async () => { throw Error('Observation unavailable') }
  await click('Send'); await until(() => button('Save') && !button('Save').disabled && button('Check request status') && !button('Check request status').disabled)
  assert.equal(intent().value, 'Keep this request until native consumption is confirmed.')
  await click('Save'); await until(() => f.calls.changed.length === 1)
  assert.equal(intent().value, 'Keep this request until native consumption is confirmed.')
  assert.equal(button('Stop'), undefined)
  assert.equal(f.calls.start.length, 1)
})

test('queued and running turns share one real composer Stop action, disable it during cancellation, and stop progress at the terminal result', async t => {
  const f = await fixture(t, { initialPrompt: 'Prepare these changes.', running: true, noCandidate: true, consumed: false })
  await click('Send'); await until(() => button('Stop') && !button('Stop').disabled)
  assert.equal(intent().value, 'Prepare these changes.', 'a retained reference alone does not prove native consumption')
  assert.match(document.querySelector('[role=log]').textContent, /Queued/)
  assert.ok(document.querySelector('[role=log] .companion-spinner'))
  f.consumed(true); await f.poll()
  await until(() => intent().value === '')
  await change(intent(), 'Keep my next message after stopping')
  const gate = deferred(); t.after(() => gate.resolve()); f.cancelGate(gate)
  await click('Stop'); await until(() => f.calls.cancel.length === 1)
  assert.equal(button('Stop').disabled, true)
  await React.act(async () => button('Stop').click())
  assert.equal(f.calls.cancel.length, 1)
  assert.equal(f.calls.cancel[0].input.expectedTurn, 7)
  await React.act(async () => gate.resolve())
  await until(() => button('Send') && !button('Send').disabled)
  assert.equal(button('Stop'), undefined)
  assert.equal(document.querySelector('[role=log] .companion-spinner'), null)
  assert.match(document.querySelector('[role=log]').textContent, /Execution cancelled/)
  assert.equal(intent().value, 'Keep my next message after stopping')
  assert.equal(f.calls.start.length, 1); assert.equal(f.calls.resume.length, 0)
})

test('initial authoring prompt prefills once without sending or replacing user input', { timeout: 15000 }, async t => {
  const options = { initialPrompt: 'Complete the missing definition files.' }
  const f = await fixture(t, options)
  await until(() => intent()?.value === options.initialPrompt)
  assert.equal(f.calls.start.length, 0)
  await change(intent(), 'My unsent request')
  options.initialPrompt = 'A second requested prompt'
  await f.render()
  assert.equal(intent().value, 'My unsent request')
  await change(intent(), '')
  await f.render()
  assert.equal(intent().value, '', 'rerender does not restore a consumed prefill')
  options.initialPrompt = 'New prompt while the composer is empty'
  await f.render()
  assert.equal(intent().value, '', 'scope changes cannot reapply the prefill in this editor')
  assert.equal(f.calls.start.length, 0, 'only the user sends a prefilled request')
})

test('an imported incomplete source can enter existing authoring without a complete preview', { timeout: 15000 }, async t => {
  const f = await fixture(t, { record: value => ({ ...value, readiness: { ready: false, diagnostics: [{ code: 'source.missing', message: 'Missing panel' }] } }) })
  const previewsBeforeSend = f.calls.preview.length
  await f.ask()
  assert.equal(f.calls.start.length, 1)
  assert.equal(f.calls.preview.length, previewsBeforeSend)
})


test('a new file outside the initial read list reaches candidate review and explicit save', { timeout: 15000 }, async t => {
  const f = await fixture(t)
  const path = 'reference/generated.md', content = '# Generated source\n'
  const request = { id: f.record.id, expectedRevision: f.record.revision, changes: [{ path, content }], bundle: f.record.bundle }
  const candidate = await f.service.prepareChanges(request)
  assert.equal(candidate.valid, true)
  f.candidate({ request, candidate })
  await f.ask()
  await until(() => button('Save') && !button('Save').disabled)
  assert.equal(f.calls.start.length, 1)
  assert.equal(f.calls.start[0].paths.includes(path), false)
  assert.equal(f.calls.save.length, 0)
  await click('Save')
  await until(() => f.calls.changed.length === 1)
  assert.equal((await f.service.readFile({ id: f.record.id, path })).content, content)
})

test('complete source authoring starts without a preview prerequisite', { timeout: 15000 }, async t => {
  const f = await fixture(t)
  const previewsBeforeSend = f.calls.preview.length
  f.previewGate({ promise: new Promise(() => {}) })
  await f.ask()
  assert.equal(f.calls.start.length, 1)
  assert.equal(f.calls.preview.length, previewsBeforeSend)
})

test('Companion composer prefill preserves user text and only sends on explicit submission', async () => {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  const { Conversation } = await import('../../companion/src/conversation.tsx')
  const root = createRoot(document.getElementById('root'))
  const sent = []
  const render = async initialDraft => { await React.act(async () => root.render(h(Conversation, {
    initialDraft, hostLabel: 'Host', thread: 'parent-one', visible: true, onClose() {}, send: async value => { sent.push(value) },
  }))) }
  try {
    await render('Complete the missing source files')
    const composer = () => document.querySelector('textarea')
    assert.equal(composer().value, 'Complete the missing source files')
    await change(composer(), 'My own unsent request')
    await render('Another suggested prompt')
    assert.equal(composer().value, 'My own unsent request')
    await change(composer(), '')
    await render('Another suggested prompt')
    assert.equal(composer().value, '')
    assert.deepEqual(sent, [])
    await render('A fresh prompt while empty')
    await until(() => composer()?.value === 'A fresh prompt while empty')
    await React.act(async () => composer().form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
    assert.deepEqual(sent, ['A fresh prompt while empty'])
  } finally { await React.act(async () => root.unmount()) }
})


test('leaving a prefilled authoring editor clears its dirty notification', async t => {
  const f = await fixture(t, { initialPrompt: 'Complete the missing source files' })
  await until(() => f.calls.dirty.at(-1) === true)
  await f.unmount(); await flush()
  assert.equal(f.calls.dirty.at(-1), false)
})


test('native replies and tool records replace generic progress and preserve manual disclosure while polling', async t => {
  const options = { initialPrompt: 'Complete this Skill.', running: true, noCandidate: true, conversation: { omitted: 0, rows: [
    { id: 'reply-1', role: 'assistant', label: 'Agent', text: 'I am reading the existing method.', status: 'completed' },
    { id: 'read-1', role: 'tool', label: 'studio_authoring_read', text: '', status: 'completed' },
    { id: 'prepare-1', role: 'tool', label: 'studio_authoring_prepare', text: '', status: 'running' },
  ] } }
  const f = await fixture(t, options)
  await click('Send'); await until(() => document.querySelector('.companion-activity'))
  const log = document.querySelector('[role=log]'), activity = log.querySelector('.companion-activity')
  assert.match(log.textContent, /I am reading the existing method/)
  assert.equal(activity.querySelectorAll('[data-role=tool]').length, 2)
  assert.equal(activity.open, true); assert.ok(activity.querySelector('.companion-spinner'))
  assert.equal(log.querySelector('.ygd-studio-spinner'), null)
  await React.act(async () => { activity.open = false; activity.dispatchEvent(new Event('toggle')) })
  options.conversation.rows.push({ id: 'read-2', role: 'tool', label: 'studio_authoring_read', text: '', status: 'running' })
  await f.poll(); assert.equal(activity.open, false, 'polling does not override manual collapse')
  assert.equal(activity.querySelectorAll('[data-role=tool]').length, 3)
  options.conversation.rows.forEach(row => { row.status = 'completed' }); f.terminal(true)
  await f.poll(); await until(() => button('Send'))
  assert.equal(activity.querySelector('.companion-spinner'), null)
  assert.equal(activity.open, false)
  assert.equal(f.calls.start.length, 1); assert.equal(f.calls.save.length, 0)
})
