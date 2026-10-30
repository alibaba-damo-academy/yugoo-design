/** React 18 + actual shared Studio navigation + real S2 storage; not a Mac browser claim. */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudioInstances } from '../src/studio-instances.mjs'
import { adapters, additions, pin, entry } from './fixtures/studio-changes-fixture.mjs'
import { studioConversationTarget } from '../src/studio-conversation.mjs'

const panelRequire = createRequire(new URL('../../panel/package.json', import.meta.url))
const { JSDOM, VirtualConsole } = panelRequire('jsdom')
const reactUrls = new Map(['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client', 'react-dom/test-utils']
  .map(specifier => [specifier, pathToFileURL(panelRequire.resolve(specifier)).href]))
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (reactUrls.has(specifier)) return { url: reactUrls.get(specifier), shortCircuit: true }
  return next(specifier, context)
} })
const virtualConsole = new VirtualConsole()
virtualConsole.on('jsdomError', error => { if (error.type !== 'css parsing') throw error })
const dom = new JSDOM('<div id="root"></div>', { url: 'https://studio.test/', virtualConsole, pretendToBeVisual: true })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { StudioConversationLayout } = await import('../src/studio-conversation.tsx')
const { StudioWorkspace } = await import('../../studio-ui/src/StudioWorkspace.tsx')
const { requestLivePoll } = await import('../../panel/src/client/live-poll.ts')
const { checkStudioTrialConnection } = await import('../../studio-ui/src/trial-controller.ts')
const probeCalls = new WeakMap()
const checkConnection = rpc => () => checkStudioTrialConnection({ checkConnection: () => { probeCalls.set(rpc, (probeCalls.get(rpc) ?? 0) + 1); return rpc('studioTrialAvailability') } })
after(() => { dom.window.close(); hooks.deregister() })
const h = React.createElement
const button = (label, parent = document) => [...parent.querySelectorAll('button')].find(node => node.textContent.trim() === label || node.getAttribute('aria-label') === label)
async function flush() { await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }) }
async function until(predicate) { const deadline = Date.now() + 5000; while (Date.now() < deadline) { if (predicate()) return; await flush() } assert.fail(`React navigation did not settle: ${[...document.querySelectorAll('dialog,.ygd-studio-error-entry')].map(node => node.textContent).join(' | ')}`) }
async function click(node) { assert.ok(node); assert.equal(node.disabled, false); await React.act(async () => { node.click() }); await flush() }
async function change(node, value) {
  assert.ok(node)
  await React.act(async () => { Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })) })
}

test('only explicit object editing observes a fresh history interval and keeps guarded inline review', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-review-navigation-'))
  const service = await createStudioInstances({ stateRoot: directory, ...adapters() })
  const a = await service.copy({ kind: 'bundle', bundle: pin, title: { zh: '导航 A', en: 'Navigation A' } })
  const b = await service.copy({ kind: 'bundle', bundle: pin, title: { zh: '导航 B', en: 'Navigation B' } })
  const prepared = { request: { id: a.id, expectedRevision: a.revision, changes: additions() } }
  prepared.candidate = await service.prepareChanges(prepared.request)
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await React.act(async () => root.unmount()); await rm(directory, { recursive: true, force: true }) })
  let confirms = 0, allowLeave = false, reads = 0, infos = 0
  window.confirm = () => { confirms++; return allowLeave }
  const sent = [], rows = [{ id: 'old', role: 'assistant', label: 'Codex', status: 'completed', text: 'Unrelated prior history' }]
  const rpc = async (method, params) => {
    if (method === 'studioTrialAvailability') return { status: 'available' }
    if (method === 'info') { infos++; return { host: 'codex', threadId: 'main-fixture', studioConversation: { bindingId: 'service-fixture', threadId: 'main-fixture' } } }
    if (method === 'sendPrompt') { sent.push(params); return { accepted: true, status: 'submitted_unverified', threadId: 'main-fixture' } }
    if (method === 'studioAuthoringCandidateList') return { candidates: [] }
    if (method === 'studioAuthoringCandidateRead') return { ...params, prepared: params.studio.id === a.id ? prepared : null }
    throw Error(`Unexpected fixture operation ${method}`)
  }
  const readConversation = async () => { reads++; return { conversation: { available: true, threadId: 'main-fixture', recordedStatus: 'completed', rows: [...rows], omitted: 0 } } }
  const management = { workspace: async () => ({ query: '', kits: [], bundles: [] }) }
  const instances = { ...service }
  const workspace = () => h(StudioConversationLayout, { rpc, checkConnection: checkConnection(rpc), readConversation }, (render, initialInstance, renderContent) => h(StudioWorkspace, {
    initialInstance, renderContent, locale: 'zh', client: management, instances, renderInstanceWorkbench: render,
    authoring: { renderPreview: () => h('div', {}, 'S2 preview fixture') },
  }))
  await React.act(async () => root.render(workspace()))
  await flush()
  assert.equal(document.querySelector('.companion-conversation'), null)
  assert.equal(reads, 0); assert.equal(infos, 0, 'browsing never connects a conversation'); assert.equal(probeCalls.get(rpc) ?? 0, 0)
  await click(button('技能包', document.querySelector('.ygd-studio-sidebar-nav')))
  const open = async title => { await until(() => [...document.querySelectorAll('article')].some(node => node.textContent.includes(title))); await click(button('编辑', [...document.querySelectorAll('article')].find(node => node.textContent.includes(title)))) }
  await open('导航 A')
  await until(() => reads > 0 && document.querySelector('textarea[aria-label="SKILL.md"]'))
  assert.ok(document.querySelector('[aria-label="Product navigation"]'))
  assert.ok(document.querySelector('.ygd-studio-topbar'))
  assert.equal(document.querySelector('.ygd-studio-file-info'), null, 'editing has no descriptive information pane')
  assert.doesNotMatch(document.querySelector('.companion-conversation').textContent, /Unrelated prior history/)
  rows.push({ id: 'a-new', role: 'assistant', label: 'Codex', status: 'completed', text: 'Current editing interval A' })
  await React.act(async () => requestLivePoll())
  await until(() => document.querySelector('.companion-conversation')?.textContent.includes('Current editing interval A'))
  const originalWorkbench = document.querySelector('.ygd-studio-instance')
  const composer = () => document.querySelector('.companion-conversation textarea')
  await change(composer(), 'Only prepare a candidate for A.')
  await until(() => !button('发送到 Codex')?.disabled)
  await click(button('发送到 Codex'))
  assert.deepEqual(sent[0].context, { intent: 'edit', currentFile: 'SKILL.md' })
  assert.deepEqual(Object.keys(sent[0].studio).sort(), ['bindingId', 'bundle', 'expectedRevision', 'id', 'threadId'])
  await until(() => document.querySelector('.ygd-studio-doc-footer')?.textContent.includes('待保存修改'))
  await click(button('对比'))
  await until(() => document.querySelector('.ygd-studio-inline-diff'))
  assert.equal(document.querySelector('.ygd-studio-instance'), originalWorkbench)
  assert.ok(document.querySelector('.companion-conversation')?.closest('.ygd-studio-stage'))
  await change(composer(), 'Keep this unsent intent when cancelling Back.')
  await React.act(async () => root.render(workspace()))
  await click(button('设计套件', document.querySelector('.ygd-studio-sidebar-nav')))
  assert.equal(confirms, 1); assert.ok(document.querySelector('.ygd-studio-inline-diff'))
  assert.equal(composer().value, 'Keep this unsent intent when cancelling Back.')
  allowLeave = true
  await click(button('返回'))
  assert.equal(document.querySelector('.companion-conversation'), null)
  const stopped = reads
  await React.act(async () => requestLivePoll()); await flush()
  assert.equal(reads, stopped, 'history polling ends on exit')
  await open('导航 B')
  await until(() => reads > stopped && document.querySelector('.companion-studio-context')?.textContent.includes('导航 B'))
  assert.equal(document.querySelector('.ygd-studio-inline-diff'), null)
  assert.equal(composer().value, '', 'confirmed exit discards only this authoring input')
  assert.doesNotMatch(document.querySelector('.companion-conversation').textContent, /Unrelated prior history|Current editing interval A/)
  await change(composer(), 'Prepare B.')
  await until(() => !button('发送到 Codex')?.disabled)
  await click(button('发送到 Codex'))
  assert.equal(sent.length, 2); assert.equal(sent[1].studio.id, b.id)
  assert.equal(sent[1].studio.threadId, sent[0].studio.threadId, 'objects reuse the existing bound native conversation')
  assert.equal((await service.read({ id: a.id })).revision, 0, 'leaving review never saves')
})


test('content-only handoff applies two native proposals inline in the same durable copy without reading conversation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-native-content-'))
  const service = await createStudioInstances({ stateRoot: directory, ...adapters() })
  const a = await service.copy({ kind: 'bundle', bundle: pin, title: { zh: '原对话定制', en: 'Native customization' } })
  const binding = { bindingId: 'native-content', threadId: 'native-main' }
  const store = new Map()
  const prepare = async (record, requestId, changes) => {
    const exactPin = record.bundle ?? record.source.bundle
    const request = { id: record.id, expectedRevision: record.revision, bundle: exactPin, changes }
    const candidate = await service.prepareChanges(request)
    assert.equal(candidate.valid, true, JSON.stringify(candidate.diagnostics))
    const locator = { requestId, studio: { ...binding, id: record.id, expectedRevision: record.revision, bundle: exactPin } }
    store.set(requestId, { ...locator, prepared: { request, candidate } })
    return locator
  }
  const entry = await prepare(a, 'native-first', additions())
  let conversationReads = 0, saveCalls = 0, candidateUnavailable = true
  const instances = { ...service, saveChanges: async input => { saveCalls++; return service.saveChanges(input) } }
  const rpc = async (method, params) => {
    if (method === 'studioTrialAvailability') return { status: 'available' }
    if (method === 'info') return { host: 'codex', threadId: binding.threadId, studioConversation: binding }
    if (method === 'studioAuthoringCandidateList') return { candidates: [...store.values()].filter(value => JSON.stringify(value.studio) === JSON.stringify(params.studio)).map(value => ({ requestId: value.requestId, studio: value.studio, digest: value.prepared.candidate.digest, changedFiles: value.prepared.candidate.diff.map(file => file.path) })) }
    if (method === 'studioAuthoringCandidateRead') {
      if (candidateUnavailable) throw Error('Fixture candidate read unavailable')
      const value = store.get(params.requestId)
      assert.deepEqual(value.studio, params.studio)
      return value
    }
    throw Error(`Unexpected native content operation ${method}`)
  }
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await React.act(async () => root.unmount()); await rm(directory, { recursive: true, force: true }) })
  const management = { workspace: async () => ({ query: '', kits: [], bundles: [] }) }
  await React.act(async () => root.render(h(StudioConversationLayout, { rpc, checkConnection: checkConnection(rpc), presentation: 'content-only', initialRequest: entry,
    readConversation: async () => { conversationReads++; throw Error('Content view must use the host conversation.') },
  }, (render, initialInstance, renderContent) => h(StudioWorkspace, { renderContent, locale: 'zh', client: management, instances, initialInstance, renderInstanceWorkbench: render, authoring: { renderPreview: () => h('div', {}, 'Real S2 candidate preview') } }))))
  await until(() => button('重新读取建议'))
  assert.equal(document.querySelector('dialog'), null, 'candidate read failure remains contextual')
  assert.equal(saveCalls, 0)
  candidateUnavailable = false
  await click(button('重新读取建议'))
  await until(() => button('保存') && !button('保存').disabled)
  assert.equal(document.querySelector('.companion-conversation'), null)
  assert.equal(conversationReads, 0); assert.equal(probeCalls.get(rpc) ?? 0, 0)
  assert.equal(saveCalls, 0, 'opening a host candidate never auto-saves')
  assert.equal(button('审阅修改建议'), undefined, 'an exact request opens its result directly without a second gate')
  const sameWorkbench = document.querySelector('.ygd-studio-instance')
  await click(button('对比'))
  assert.ok(document.querySelector('.ygd-studio-inline-diff'))
  assert.equal(button('原始文件').getAttribute('aria-pressed'), 'true')
  await click(button('编辑'))
  await click(document.querySelector('.ygd-studio-file-tree button[title="panel.yaml"]'))
  await until(() => document.querySelector('textarea[aria-label="panel.yaml"]'))
  const correctedPanel = document.querySelector('textarea[aria-label="panel.yaml"]').value.replaceAll('$t:records', '人工修订的标题')
  await change(document.querySelector('textarea[aria-label="panel.yaml"]'), correctedPanel)
  await until(() => button('保存') && !button('保存').disabled)
  if (button('编辑')) await click(button('编辑'))
  await click(button('保存'))
  await until(() => !document.querySelector('.ygd-studio-inline-diff') && button('保存'))
  assert.equal(document.querySelector('.ygd-studio-instance'), sameWorkbench)
  let saved
  await React.act(async () => {
    saved = await service.read({ id: a.id })
    assert.equal(saved.revision, 1)
    assert.equal((await service.readFile({ id: a.id, path: 'panel.yaml' })).content, correctedPanel, 'the exact native binding also accepts an S2-verified human refinement')
    await prepare(saved, 'native-second', [{ path: 'locales/zh-CN.json', content: JSON.stringify({ records: '观察记录', title: '记录名称', status: '状态', open: '待处理', review: '请复核', closed: '已关闭' }) }])
    requestLivePoll()
  })
  await until(() => button('保存') && !button('保存').disabled)
  assert.equal([...document.querySelectorAll('button')].some(node => /审阅修改建议|查看待保存修改/.test(node.textContent)), false)
  assert.equal(document.querySelector('.ygd-studio-instance'), sameWorkbench)
  if (button('编辑')) await click(button('编辑'))
  await click(button('保存'))
  await until(() => !document.querySelector('.ygd-studio-inline-diff') && button('保存'))
  await React.act(async () => {
    const reopened = await createStudioInstances({ stateRoot: directory, ...adapters() })
    assert.equal((await reopened.read({ id: a.id })).revision, 2)
    assert.match((await reopened.readFile({ id: a.id, path: 'locales/zh-CN.json' })).content, /请复核/)
  })
  assert.equal(saveCalls, 2)
  assert.equal(conversationReads, 0); assert.equal(probeCalls.get(rpc) ?? 0, 0)
  await React.act(async () => {
    const current = await service.read({ id: a.id })
    await prepare(current, 'native-alternative-a', [{ path: 'locales/en-US.json', content: JSON.stringify({ records: 'Observations A', title: 'Title', status: 'Status', open: 'Open', review: 'Review', closed: 'Closed' }) }])
    await prepare(current, 'native-alternative-b', [{ path: 'locales/en-US.json', content: JSON.stringify({ records: 'Observations B', title: 'Title', status: 'Status', open: 'Open', review: 'Review', closed: 'Closed' }) }])
    requestLivePoll()
  })
  await until(() => document.querySelector('select[aria-label="待保存修改版本"]'))
  assert.equal(document.querySelector('.ygd-studio-inline-diff'), null, 'several exact same-base proposals require a meaningful version selection')
  const versions = document.querySelector('select[aria-label="待保存修改版本"]')
  await React.act(async () => { versions.value = 'native-alternative-b'; versions.dispatchEvent(new Event('change', { bubbles: true })) })
  await until(() => document.querySelector('textarea[aria-label="locales/en-US.json"]')?.value.includes('Observations B'))
  await click(button('对比'))
  assert.match(document.querySelector('.ygd-studio-inline-diff').textContent, /Observations B/)
  assert.equal(document.querySelector('.ygd-studio-instance'), sameWorkbench)
  assert.equal(saveCalls, 2, 'choosing a source version only changes its in-place preview')
  assert.equal(conversationReads, 0); assert.equal(probeCalls.get(rpc) ?? 0, 0)
})

test('a content-only link from another native binding cannot open a working copy', async t => {
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await React.act(async () => root.unmount()) })
  let presented = 0
  await React.act(async () => root.render(h(StudioConversationLayout, {
    presentation: 'content-only', initialRequest: { requestId: 'foreign', studio: { bindingId: 'foreign-binding', threadId: 'main', id: 'copy', expectedRevision: 0 } },
    rpc: async () => ({ host: 'codex', threadId: 'main', studioConversation: { bindingId: 'current-binding', threadId: 'main' } }),
    readConversation: async () => { throw Error('Must not read conversation') },
  }, () => { presented++; return h('div', {}, 'Unexpected copy') })))
  await until(() => document.querySelector('.ygd-studio-error-entry'))
  assert.equal(document.querySelector('dialog'), null, 'connection failures do not interrupt the user automatically')
  await click(button('查看问题'))
  assert.match(document.querySelector('dialog').textContent, /原对话连接不匹配或暂不可用/)
  assert.equal(presented, 0)
  assert.equal(document.querySelector('.companion-conversation'), null)
})


test('a real copied Kit projects its retained mount to a strict stable preview pin before rendering or sending', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-retained-mount-pin-'))
  const kit = { name: 'observations_kit', version: '1.0' }
  const service = await createStudioInstances({ stateRoot: directory, ...adapters({ captureKit: async () => ({ files: [
    entry('mindset.md', '---\nname: observations_kit\nversion: "1.0"\ndescription: Review observations with the team.\n---\n\nKeep supplied evidence.\n<design_skills>\n## observations\nRecord supplied observations.\n</design_skills>\n'),
    entry('kit.yaml', 'version: 1\nmounts:\n  - {bindingKey: observations, name: observations, version: "1.0"}\n'),
  ] }) }) })
  const copy = await service.copy({ kind: 'kit', kit })
  assert.ok(copy.mounts[0].bundle.source?.snapshot, 'actual retained S2 mounts carry source provenance')
  const source = structuredClone(copy.mounts[0].bundle.source), selected = { name: copy.mounts[0].bundle.name, version: copy.mounts[0].bundle.version }
  const sent = [], previewed = [], binding = { bindingId: 'retained-mount', threadId: 'native-main' }
  assert.throws(() => studioConversationTarget({ ...binding, id: copy.id, expectedRevision: copy.revision, bundle: copy.mounts[0].bundle }), /Invalid Studio preview Bundle pin/, 'storage provenance cannot become extra host-target authority')
  const instances = { ...service, preview: async input => { previewed.push(input); return service.preview(input) } }
  const rpc = async (method, params) => {
    if (method === 'studioTrialAvailability') return { status: 'available' }
    if (method === 'info') return { host: 'codex', threadId: binding.threadId, studioConversation: binding }
    if (method === 'studioAuthoringCandidateList') { assert.deepEqual(params.studio.bundle, selected); return { candidates: [] } }
    if (method === 'sendPrompt') { sent.push(params); return { accepted: true, status: 'submitted_unverified', threadId: binding.threadId } }
    throw Error(`Unexpected pin projection operation ${method}`)
  }
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await React.act(async () => root.unmount()); await rm(directory, { recursive: true, force: true }) })
  await React.act(async () => root.render(h(StudioConversationLayout, { rpc, checkConnection: checkConnection(rpc),
    readConversation: async () => ({ conversation: { available: true, threadId: binding.threadId, recordedStatus: 'unknown', rows: [], omitted: 0 } }),
  }, (render, initialInstance, renderContent) => h(StudioWorkspace, { renderContent, locale: 'zh',
    client: { workspace: async () => ({ query: '', kits: [], bundles: [] }) }, instances,
    initialInstance: { id: copy.id, expectedRevision: copy.revision, bundle: selected }, renderInstanceWorkbench: render,
    authoring: { renderPreview: () => h('div', {}, 'Retained Kit preview') },
  }))))
  await until(() => document.querySelector('.companion-conversation textarea') && document.querySelector('.companion-studio-context')?.textContent.includes(copy.title.zh))
  await change(document.querySelector('.companion-conversation textarea'), 'Adjust this Kit without losing its retained source.')
  await until(() => !button('发送到 Codex')?.disabled)
  await click(button('发送到 Codex'))
  assert.equal(sent.length, 1); assert.deepEqual(sent[0].studio.bundle, selected)
  assert.equal(previewed.length, 0)
  assert.equal(button('面板预览'), undefined, 'Kit authoring offers source and mounts, not a Bundle Panel preview')
  assert.deepEqual(sent[0].context, { intent: 'edit', currentFile: 'mindset.md' })
  await click(document.querySelector('button[title="kit.yaml"]'))
  await until(() => document.querySelector('textarea[aria-label="kit.yaml"]'))
  await change(document.querySelector('.companion-conversation textarea'), 'Review the Kit mount declarations.')
  await until(() => !button('发送到 Codex')?.disabled)
  await click(button('发送到 Codex'))
  assert.deepEqual(sent[1].context, { intent: 'edit', currentFile: 'kit.yaml' })
  assert.deepEqual(sent[1].studio.bundle, selected, 'an explicit legacy handoff retains its verified exact pin')
  assert.equal(previewed.length, 0, 'changing source files cannot start a Kit Panel preview')
  assert.deepEqual((await service.read({ id: copy.id })).mounts[0].bundle.source, source, 'normalizing a view must preserve retained source ownership')
})

for (const race of ['exit-before-dispatch', 'edit-before-dispatch', 'probe-before-dispatch', 'late-unknown']) {
  test(`bound conversation fences ${race} without changing another object`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'studio-bound-race-'))
    const service = await createStudioInstances({ stateRoot: directory, ...adapters() })
    const a = await service.copy({ kind: 'bundle', bundle: pin, title: { zh: '竞态 A', en: 'Race A' } })
    const b = await service.copy({ kind: 'bundle', bundle: pin, title: { zh: '竞态 B', en: 'Race B' } })
    const binding = { bindingId: 'bound-race', threadId: 'same-native-thread' }
    let hold = false, entered = false, release, probeUnavailable = false
    const sent = []
    const rpc = async (method, params) => {
      if (method === 'studioTrialAvailability') return { status: probeUnavailable ? 'unavailable' : 'available' }
    if (method === 'info') {
        if (hold && race !== 'late-unknown') { entered = true; hold = false; await new Promise(resolve => { release = resolve }) }
        return { host: 'codex', threadId: binding.threadId, studioConversation: binding }
      }
      if (method === 'sendPrompt') {
        sent.push(params)
        if (hold && race === 'late-unknown') { entered = true; hold = false; await new Promise(resolve => { release = resolve }); return { status: 'unknown' } }
        return { accepted: true, status: 'submitted_unverified', threadId: binding.threadId }
      }
      if (method === 'studioAuthoringCandidateList') return { candidates: [] }
      if (method === 'studioAuthoringCandidateRead') return { ...params, prepared: null }
      throw Error(`Unexpected operation ${method}`)
    }
    const management = { workspace: async () => ({ query: '', kits: [], bundles: [] }) }
    const readConversation = async () => ({ conversation: { available: true, threadId: binding.threadId, recordedStatus: 'unknown', rows: [], omitted: 0 } })
    const root = createRoot(document.getElementById('root'))
    t.after(async () => { release?.(); await React.act(async () => root.unmount()); await rm(directory, { recursive: true, force: true }) })
    window.confirm = () => true
    await React.act(async () => root.render(h(StudioConversationLayout, { rpc, checkConnection: checkConnection(rpc), readConversation }, (render, initialInstance, renderContent) => h(StudioWorkspace, {
      client: management, instances: service, locale: 'zh', initialInstance: { id: a.id, expectedRevision: 0 }, renderContent, renderInstanceWorkbench: render,
    }))))
    await until(() => document.querySelector('textarea[aria-label="SKILL.md"]') && document.querySelector('.companion-conversation textarea'))
    await change(document.querySelector('.companion-conversation textarea'), 'Request for A.')
    await until(() => !button('发送到 Codex')?.disabled)
    hold = true
    await click(button('发送到 Codex')); await until(() => entered)
    if (race === 'probe-before-dispatch') {
      probeUnavailable = true
      await click(button('重新检查宿主连接'))
      await until(() => document.querySelector('.companion-studio-context')?.textContent.includes('当前无法使用宿主消息通道'))
      await React.act(async () => release()); await flush()
      assert.equal(sent.length, 0, 'a new unavailable probe blocks dispatch after the info await')
      assert.equal(document.querySelector('.companion-conversation textarea').value, 'Request for A.')
      assert.equal(button('我已核对原对话'), undefined, 'a refused dispatch is not uncertain delivery')
    } else if (race === 'edit-before-dispatch') {
      const source = document.querySelector('textarea[aria-label="SKILL.md"]')
      await change(source, source.value + '\nHuman edit while checking binding.\n')
      await React.act(async () => release()); await flush()
      assert.equal(sent.length, 0, 'typing after binding lookup starts refuses dispatch')
      assert.equal(document.querySelector('.companion-conversation textarea').value, 'Request for A.')
      assert.match(document.querySelector('.companion-studio-context').textContent, /本条消息未提交/)
      assert.doesNotMatch(document.querySelector('.companion-studio-context').textContent, /送达尚未确认/)
      assert.equal(document.querySelectorAll('.ygd-studio-error-entry').length, 1, 'one failed request has one error card')
      await click(button('查看问题'))
      assert.match(document.querySelector('dialog').textContent, /编辑对象或内容已改变/)
      await click(button('继续编辑'))
    } else {
      await click(button('返回'))
      await until(() => [...document.querySelectorAll('article')].some(node => node.textContent.includes('竞态 B')))
      await click(button('编辑', [...document.querySelectorAll('article')].find(node => node.textContent.includes('竞态 B'))))
      await until(() => document.querySelector('.companion-studio-context')?.textContent.includes('竞态 B'))
      await React.act(async () => release()); await flush()
      assert.equal(sent.length, race === 'late-unknown' ? 1 : 0)
      assert.doesNotMatch(document.querySelector('.companion-studio-context').textContent, /未知|尚未确认|Request for A/)
      assert.equal(document.querySelector('.companion-conversation textarea').value, '')
      await change(document.querySelector('.companion-conversation textarea'), 'Independent request for B.')
      await until(() => !button('发送到 Codex')?.disabled)
      await click(button('发送到 Codex'))
      assert.equal(sent.at(-1).studio.id, b.id)
    }
    assert.equal((await service.read({ id: a.id })).revision, 0)
  })
}

test('blank Kit create uses the real S2 record, blocks invalid candidate saving with actionable issues, and reopens manual source save', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-blank-authoring-'))
  const service = await createStudioInstances({ stateRoot: directory, ...adapters() })
  const binding = { bindingId: 'blank-bound', threadId: 'native-main' }, sent = []
  let prepared, created
  const instances = { ...service, create: async input => { created = await service.create(input); return created } }
  const rpc = async (method, params) => {
    if (method === 'studioTrialAvailability') return { status: 'available' }
    if (method === 'info') return { host: 'codex', threadId: binding.threadId, studioConversation: binding }
    if (method === 'studioAuthoringCandidateList') return { candidates: [] }
    if (method === 'sendPrompt') {
      sent.push(params)
      const source = await service.readFile({ id: created.id, path: 'mindset.md' })
      const request = { id: created.id, expectedRevision: 0, changes: [{ path: 'mindset.md', content: source.content + '\nA proposed direction.\n' }] }
      prepared = { request, candidate: await service.prepareChanges(request) }
      return { accepted: true, status: 'submitted_unverified', threadId: binding.threadId }
    }
    if (method === 'studioAuthoringCandidateRead') return { ...params, prepared }
    throw Error(`Unexpected blank authoring operation ${method}`)
  }
  const management = { workspace: async () => ({ query: '', kits: [], bundles: [] }) }
  const readConversation = async () => ({ conversation: { available: true, threadId: binding.threadId, recordedStatus: 'unknown', rows: [], omitted: 0 } })
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await React.act(async () => root.unmount()); await rm(directory, { recursive: true, force: true }) })
  await React.act(async () => root.render(h(StudioConversationLayout, { rpc, checkConnection: checkConnection(rpc), readConversation }, (render, initialInstance, renderContent) => h(StudioWorkspace, {
    client: management, instances, locale: 'zh', renderContent, renderInstanceWorkbench: render,
    authoring: { renderPreview: () => h('div', {}, 'Preview fixture') },
  }))))
  await until(() => button('新建设计套件'))
  await click(button('新建设计套件'))
  await until(() => document.querySelector('textarea[aria-label="mindset.md"]'))
  assert.equal(created.kind, 'kit'); assert.equal(created.createdBlank, true)
  assert.equal(created.mounts.length, 0); assert.equal(created.files.length, 2)
  assert.ok(document.querySelector('[aria-label="Product navigation"]'))
  await change(document.querySelector('.companion-conversation textarea'), 'Help define this Kit.')
  await until(() => !button('发送到 Codex')?.disabled)
  await click(button('发送到 Codex'))
  assert.deepEqual(sent[0].context, { intent: 'create', currentFile: 'mindset.md' })
  await until(() => document.querySelector('.ygd-studio-doc-footer')?.textContent.includes('待保存修改'))
  await click(button('对比'))
  await until(() => document.querySelector('.ygd-studio-inline-diff'))
  await until(() => button('保存')?.disabled === false)
  assert.equal(button('保存').disabled, false, 'the explicit action explains validation failures')
  await click(button('保存'))
  assert.match(document.querySelector('dialog').textContent, /校验通过后可保存/)
  assert.match(document.querySelector('dialog').textContent, /kit\.yaml/)
  await React.act(async () => { assert.equal((await service.read({ id: created.id })).revision, 0) })
  await click(button('继续编辑'))
  await click(button('还原'))
  await click(button('编辑'))
  await until(() => document.querySelector('textarea[aria-label="mindset.md"]'))
  const source = document.querySelector('textarea[aria-label="mindset.md"]')
  const savedText = source.value + '\nHuman confirmed scope.\n'
  await change(source, savedText)
  await until(() => button('保存')?.disabled === false)
  await click(button('保存'))
  await until(() => button('保存')?.disabled === true)
  await React.act(async () => {
    const reopened = await createStudioInstances({ stateRoot: directory, ...adapters() })
    assert.equal((await reopened.read({ id: created.id })).revision, 1)
    assert.equal((await reopened.readFile({ id: created.id, path: 'mindset.md' })).content, savedText)
  })
})

test('installed Mindset edits its same-identity current S2 source', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-installed-edit-'))
  const kit = { name: 'observations_kit', version: '1.0' }
  const mindset = '---\nname: observations_kit\nversion: "1.0"\ndescription: Review observations.\n---\n\nKeep supplied evidence.\n<design_skills>\n## observations\nRecord supplied observations.\n</design_skills>\n'
  const service = await createStudioInstances({ stateRoot: directory, ...adapters({ captureKit: async () => ({ files: [
    entry('mindset.md', mindset), entry('kit.yaml', 'version: 1\nmounts:\n  - {bindingKey: observations, name: observations, version: "1.0"}\n'),
  ] }) }) })
  const management = {
    workspace: async () => ({ query: '', kits: [{ ...kit, description: 'Installed Kit' }], bundles: [] }),
    readKitWorkspace: async () => ({ diagnostics: [], workspace: { ...kit, description: 'Installed Kit', mindsetSource: mindset, mounts: [] } }),
  }
  let reads = 0
  const binding = { bindingId: 'installed-bound', threadId: 'native-main' }
  const rpc = async method => {
    if (method === 'studioTrialAvailability') return { status: 'available' }
    if (method === 'info') return { host: 'codex', threadId: binding.threadId, studioConversation: binding }
    if (method === 'studioAuthoringCandidateList') return { candidates: [] }
    throw Error(`Unexpected installed operation ${method}`)
  }
  const readConversation = async () => { reads++; return { conversation: { available: true, threadId: binding.threadId, recordedStatus: 'unknown', rows: [], omitted: 0 } } }
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await React.act(async () => root.unmount()); await rm(directory, { recursive: true, force: true }) })
  await React.act(async () => root.render(h(StudioConversationLayout, { rpc, checkConnection: checkConnection(rpc), readConversation }, (render, initialInstance, renderContent) => h(StudioWorkspace, {
    client: management, instances: service, locale: 'zh', renderContent, renderInstanceWorkbench: render,
  }))))
  await until(() => button('打开'))
  await click(button('打开'))
  await until(() => document.querySelector('.ygd-studio-doc-toolbar') && button('编辑'))
  assert.equal(document.querySelector('.companion-conversation'), null); assert.equal(reads, 0)
  await click(button('编辑'))
  await until(() => document.querySelector('textarea[aria-label="mindset.md"]') && reads > 0)
  const copies = await service.list()
  assert.equal(copies.length, 1); assert.equal(copies[0].kind, 'kit')
  assert.deepEqual(copies[0].source.kit, kit)
  await React.act(async () => {
    const copiedSource = await service.readFile({ id: copies[0].id, path: 'mindset.md' })
    assert.equal(document.querySelector('textarea[aria-label="mindset.md"]').value, copiedSource.content)
    assert.match(copiedSource.content, /Keep supplied evidence\./)
    assert.match(copiedSource.content, /<design_skills>/)
  })
  assert.equal(copies[0].current, true); assert.deepEqual(copies[0].kit, kit)
  assert.ok(document.querySelector('[aria-label="Product navigation"]'))
})

test('unavailable, unknown and missing logs retain manual S2 saving and explicit recovery without losing input', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-host-fallback-'))
  const service = await createStudioInstances({ stateRoot: directory, ...adapters() })
  const copy = await service.copy({ kind: 'bundle', bundle: pin })
  const binding = { bindingId: 'fallback-bound', threadId: 'native-main' }, sent = []
  let status = 'unavailable', logsAvailable = true, catchingUp = false, logsFail = false
  const rpc = async (method, params) => {
    if (method === 'studioTrialAvailability') return status === 'timeout' ? new Promise(() => {}) : { status }
    if (method === 'info') return { host: 'codex', threadId: binding.threadId, studioConversation: binding }
    if (method === 'studioAuthoringCandidateList') return { candidates: [] }
    if (method === 'studioAuthoringCandidateRead') return { ...params, prepared: null }
    if (method === 'sendPrompt') { sent.push(params); return { accepted: true, status: 'submitted_unverified', threadId: binding.threadId } }
    throw Error(`Unexpected fallback method ${method}`)
  }
  const management = { workspace: async () => ({ query: '', kits: [], bundles: [] }) }
  const readConversation = async () => {
    if (logsFail) throw Error('History reader unavailable')
    return { conversation: { available: logsAvailable, catchingUp, threadId: binding.threadId, recordedStatus: 'unknown', rows: [], omitted: 0 } }
  }
  const contentClient = { list: async () => [] }
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await React.act(async () => root.unmount()); await rm(directory, { recursive: true, force: true }) })
  window.confirm = () => true
  await React.act(async () => root.render(h(StudioConversationLayout, { rpc, readConversation,
    checkConnection: () => checkStudioTrialConnection({ checkConnection: () => rpc('studioTrialAvailability') }, 10),
  }, (render, initialInstance, renderContent) => h(StudioWorkspace, {
    client: management, instances: service, contentClient, locale: 'zh', initialInstance: { id: copy.id, expectedRevision: 0 }, renderContent, renderInstanceWorkbench: render,
  }))))
  const context = () => document.querySelector('.companion-studio-context')
  await until(() => context()?.textContent.includes('当前无法使用宿主消息通道') && document.querySelector('textarea[aria-label="SKILL.md"]'))
  assert.match(context().textContent, /手工编辑、保存或导入导出/)
  const composer = document.querySelector('.companion-conversation textarea')
  await change(composer, 'Keep this intent through connection checks.')
  assert.equal(button('发送到 Codex').disabled, true)
  const source = document.querySelector('textarea[aria-label="SKILL.md"]'), savedText = source.value + '\nManual edit while native Host is unavailable.\n'
  await change(source, savedText)
  await until(() => button('保存')?.disabled === false)
  await click(button('保存'))
  await until(() => button('保存')?.disabled === true)
  await React.act(async () => {
    const reopened = await createStudioInstances({ stateRoot: directory, ...adapters() })
    assert.equal((await reopened.read({ id: copy.id })).revision, 1)
    assert.equal((await reopened.readFile({ id: copy.id, path: 'SKILL.md' })).content, savedText)
  })
  assert.equal(button('导出').disabled, false, 'Host readiness cannot disable saved-copy export')
  assert.equal(document.querySelector('input[aria-label="选择导入文件"]').disabled, false, 'Host readiness cannot disable source import')
  for (const next of ['unknown', 'timeout']) {
    status = next
    await click(button('重新检查宿主连接'))
    await until(() => context()?.textContent.includes('尚未确认宿主消息通道是否可用'))
    assert.equal(document.querySelector('.companion-conversation textarea'), composer)
    assert.equal(composer.value, 'Keep this intent through connection checks.')
    assert.equal(button('发送到 Codex').disabled, true)
  }
  status = 'available'; logsAvailable = false
  await click(button('重新检查宿主连接'))
  await until(() => context()?.textContent.includes('当前无法读取宿主对话记录'))
  assert.equal(button('发送到 Codex').disabled, true)
  logsFail = true
  await click(button('重新检查宿主连接'))
  await until(() => context()?.textContent.includes('当前无法读取宿主对话记录，输入已保留'))
  assert.doesNotMatch(context().textContent, /无法核对原对话绑定/)
  logsFail = false; logsAvailable = true; catchingUp = true
  await click(button('重新检查宿主连接'))
  await until(() => context()?.textContent.includes('正在同步本次创作的对话起点') && !button('重新检查宿主连接').disabled)
  assert.equal(button('发送到 Codex').disabled, true)
  catchingUp = false
  await click(button('重新检查宿主连接'))
  await until(() => !button('发送到 Codex')?.disabled)
  assert.equal(sent.length, 0, 'neither probes nor manual saving dispatch AI messages')
  assert.equal(composer.value, 'Keep this intent through connection checks.')
  await click(button('发送到 Codex'))
  assert.equal(sent.length, 1); assert.equal(sent[0].studio.expectedRevision, 1)
  assert.equal(button('导出').disabled, false, 'the source ZIP export action stays available after recovery')
  assert.equal(document.querySelector('input[aria-label="选择导入文件"]').disabled, false)
  assert.equal(sent.length, 1)
})

for (const failureKind of ['not-submitted', 'unknown']) {
  test(`safe ${failureKind} receipt survives explicit recheck without automatic replay`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'studio-send-receipt-'))
    const service = await createStudioInstances({ stateRoot: directory, ...adapters() })
    const copy = await service.copy({ kind: 'bundle', bundle: pin })
    const binding = { bindingId: 'delivery-bound', threadId: 'native-main' }
    let sends = 0
    const rpc = async (method, params) => {
      if (method === 'studioTrialAvailability') return { status: 'available' }
      if (method === 'info') return { host: 'codex', threadId: binding.threadId, studioConversation: binding }
      if (method === 'studioAuthoringCandidateList') return { candidates: [] }
      if (method === 'studioAuthoringCandidateRead') return { ...params, prepared: null }
      if (method === 'sendPrompt') {
        sends++
        throw Object.assign(new Error(failureKind === 'not-submitted' ? 'Host setup unavailable; no message was submitted.' : 'Delivery unknown; inspect the original session.'),
          failureKind === 'not-submitted' ? { delivery: failureKind, notSubmitted: true, stage: 'initialize' } : { delivery: failureKind, notSubmitted: true })
      }
      throw Error(`Unexpected receipt method ${method}`)
    }
    const management = { workspace: async () => ({ query: '', kits: [], bundles: [] }) }
    const readConversation = async () => ({ conversation: { available: true, threadId: binding.threadId, recordedStatus: 'unknown', rows: [], omitted: 0 } })
    const root = createRoot(document.getElementById('root'))
    t.after(async () => { await React.act(async () => root.unmount()); await rm(directory, { recursive: true, force: true }) })
    await React.act(async () => root.render(h(StudioConversationLayout, { rpc, readConversation, checkConnection: checkConnection(rpc) }, (render, initialInstance, renderContent) => h(StudioWorkspace, {
      client: management, instances: service, locale: 'zh', initialInstance: { id: copy.id, expectedRevision: 0 }, renderContent, renderInstanceWorkbench: render,
    }))))
    await until(() => document.querySelector('.companion-conversation textarea'))
    const composer = document.querySelector('.companion-conversation textarea')
    await change(composer, 'Submit exactly once.')
    await until(() => !button('发送到 Codex')?.disabled)
    await click(button('发送到 Codex'))
    await until(() => document.querySelector('.companion-studio-context')?.textContent.includes(failureKind === 'not-submitted' ? '本条消息未提交' : '送达尚未确认'))
    assert.equal(document.querySelector('dialog'), null, 'transport failures wait for explicit detail inspection')
    const notice = [...document.querySelectorAll('.ygd-studio-error-entry')].find(node => node.textContent.includes(failureKind === 'not-submitted' ? '本条消息未提交' : '送达尚未确认'))
    await click(button('查看问题', notice))
    assert.match(document.querySelector('dialog').textContent, failureKind === 'not-submitted' ? /no message was submitted/ : /Delivery unknown/)
    await click(button('继续编辑'))
    assert.equal(composer.value, 'Submit exactly once.')
    assert.equal(button('发送到 Codex').disabled, true)
    assert.equal(!!button('我已核对原对话'), failureKind === 'unknown')
    await click(button('重新检查宿主连接'))
    await until(() => !button('重新检查宿主连接').disabled)
    assert.equal(sends, 1)
    assert.equal(composer.value, 'Submit exactly once.')
    assert.equal(button('发送到 Codex').disabled, failureKind === 'unknown', 'only known non-submission can be explicitly attempted after recheck')
    assert.equal(!!button('我已核对原对话'), failureKind === 'unknown')
    if (failureKind === 'unknown') {
      await click(button('我已核对原对话'))
      assert.equal(button('发送到 Codex').disabled, false)
      assert.match(document.querySelector('.ygd-studio-error-entry').textContent, /送达尚未确认/, 'acknowledging inspection cannot turn an unknown receipt into confirmed non-submission')
      assert.equal(sends, 1)
    }
  })
}

test('late connection probe from a departed object cannot disable the next object', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-late-probe-'))
  const service = await createStudioInstances({ stateRoot: directory, ...adapters() })
  const a = await service.copy({ kind: 'bundle', bundle: pin, title: { zh: '延迟 A', en: 'Late A' } })
  await service.copy({ kind: 'bundle', bundle: pin, title: { zh: '延迟 B', en: 'Late B' } })
  const binding = { bindingId: 'late-bound', threadId: 'native-main' }
  let calls = 0, release
  const rpc = async (method, params) => {
    if (method === 'studioTrialAvailability') {
      if (++calls === 1) return new Promise(resolve => { release = resolve })
      return { status: 'available' }
    }
    if (method === 'info') return { host: 'codex', threadId: binding.threadId, studioConversation: binding }
    if (method === 'studioAuthoringCandidateList') return { candidates: [] }
    if (method === 'studioAuthoringCandidateRead') return { ...params, prepared: null }
    throw Error(`Probe must never dispatch ${method}`)
  }
  const management = { workspace: async () => ({ query: '', kits: [], bundles: [] }) }
  const readConversation = async () => ({ conversation: { available: true, threadId: binding.threadId, recordedStatus: 'unknown', rows: [], omitted: 0 } })
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { release?.({ status: 'unknown' }); await React.act(async () => root.unmount()); await rm(directory, { recursive: true, force: true }) })
  window.confirm = () => true
  await React.act(async () => root.render(h(StudioConversationLayout, { rpc, readConversation, checkConnection: checkConnection(rpc) }, (render, initialInstance, renderContent) => h(StudioWorkspace, {
    client: management, instances: service, locale: 'zh', initialInstance: { id: a.id, expectedRevision: 0 }, renderContent, renderInstanceWorkbench: render,
  }))))
  await until(() => calls === 1 && document.querySelector('textarea[aria-label="SKILL.md"]'))
  await change(document.querySelector('.companion-conversation textarea'), 'A input to discard explicitly.')
  await click(button('返回'))
  await until(() => [...document.querySelectorAll('article')].some(node => node.textContent.includes('延迟 B')))
  await click(button('编辑', [...document.querySelectorAll('article')].find(node => node.textContent.includes('延迟 B'))))
  await until(() => calls === 2 && document.querySelector('.companion-studio-context')?.textContent.includes('延迟 B'))
  const composer = document.querySelector('.companion-conversation textarea')
  await change(composer, 'Keep B input.')
  await until(() => !button('发送到 Codex')?.disabled)
  await React.act(async () => release({ status: 'unavailable' })); await flush()
  assert.equal(composer.value, 'Keep B input.')
  assert.equal(button('发送到 Codex').disabled, false)
  assert.doesNotMatch(document.querySelector('.companion-studio-context').textContent, /当前无法使用宿主消息通道/)
})

test('browser RPC preserves only the canonical safe delivery receipt', async () => {
  const ts = panelRequire('typescript')
  const source = await readFile(new URL('../src/client.tsx', import.meta.url), 'utf8')
  const parsed = ts.createSourceFile('client.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const rpcNode = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'rpc')
  assert.ok(rpcNode, 'exercise the actual browser RPC function without mounting the complete host')
  const compiled = ts.transpileModule(rpcNode.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const { notificationDeliveryReceipt } = await import('../src/notification-delivery.mjs')
  let body
  const rpc = new Function('fetch', 'transport', 'notificationDeliveryReceipt', `${compiled}; return rpc`)(
    async () => ({ ok: false, json: async () => body }), { endpoint: 'https://fixture.invalid', headers: {} }, notificationDeliveryReceipt)
  body = { error: 'Safe setup failure', delivery: 'not-submitted', notSubmitted: true, status: 'unavailable', stage: 'initialize', transportCategory: 'timeout', rpcCode: -1,
    token: 'never copy', rawError: 'never copy', text: 'never copy' }
  await assert.rejects(rpc('sendPrompt'), error => {
    assert.equal(error.message, 'Safe setup failure'); assert.equal(error.notSubmitted, true); assert.equal(error.delivery, 'not-submitted')
    assert.equal(error.stage, 'initialize'); assert.equal(error.rpcCode, -1)
    assert.equal(error.token, undefined); assert.equal(error.rawError, undefined); assert.equal(error.text, undefined)
    return true
  })
  body = { error: 'Unknown delivery', delivery: 'unknown', stage: 'queue-add', notSubmitted: true, token: 'never copy' }
  await assert.rejects(rpc('sendPrompt'), error => {
    assert.equal(error.delivery, 'unknown'); assert.equal(error.notSubmitted, undefined); assert.equal(error.token, undefined)
    return true
  })
})
