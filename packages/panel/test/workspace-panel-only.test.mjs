import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import React from 'react'
import { JSDOM } from 'jsdom'
import { createRoot } from 'react-dom/client'

test('panel-only hides workspace chrome and delegates dirty/save/retract to the unchanged workspace', async () => {
  const require = createRequire(import.meta.url)
  const { build } = await import(pathToFileURL(createRequire(require.resolve('tsx')).resolve('esbuild')).href)
  const output = await mkdtemp(fileURLToPath(new URL('./.workspace-controls-', import.meta.url)))
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:32123/', pretendToBeVisual: true })
  const keys = ['window', 'document', 'HTMLElement', 'Element', 'Node', 'React', 'IS_REACT_ACT_ENVIRONMENT', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver']
  const previous = Object.fromEntries(keys.map(key => [key, globalThis[key]]))
  for (const key of keys.slice(0, 5)) globalThis[key] = dom.window[key]
  globalThis.React = React; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  let root
  try {
    // Graph and browser-only canvas engines are not exercised by this control test.
    await build({ stdin: { contents: "export { DesignWorkspace } from './workspace.tsx'; export { editDraft, resetPanelStore, setSaving } from './store.ts'; export { bindDesignHostLocale } from './ported/host.ts'", resolveDir: fileURLToPath(new URL('../src/client/', import.meta.url)), loader: 'tsx' },
      outfile: join(output, 'workspace.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic',
      plugins: [{ name: 'unexercised-graph', setup(b) {
        b.onResolve({ filter: /bpmn-runtime\.ts$/ }, () => ({ path: 'bpmn', namespace: 'not-exercised' }))
        b.onResolve({ filter: /excalidraw-surface\.tsx$/ }, () => ({ path: 'canvas', namespace: 'not-exercised' }))
        b.onResolve({ filter: /\.css$/ }, () => ({ path: 'css', namespace: 'not-exercised' }))
        b.onResolve({ filter: /^\.\/graph-panel\.tsx$/ }, () => ({ path: 'graph', namespace: 'not-exercised' }))
        b.onLoad({ filter: /.*/, namespace: 'not-exercised' }, args => ({ contents: args.path === 'css' ? ''
          : args.path === 'bpmn' ? 'export class Modeler { constructor() { throw new Error("BPMN is not exercised") } }; export class NavigatedViewer extends Modeler {}'
          : args.path === 'canvas' ? 'export default function Canvas() { throw new Error("Canvas is not exercised") }'
          : 'export function GraphPanel() { throw new Error("Graph is not exercised") }' }))
      } }] })
    const { DesignWorkspace, editDraft, setSaving, bindDesignHostLocale } = await import(pathToFileURL(join(output, 'workspace.mjs')).href)
    const registry = { subscribe: () => () => {}, revision: () => 0, get: id => id === 'fixture' ? {
      scrollOwner: 'panel', equalsDraft: (a, b) => JSON.stringify(a) === JSON.stringify(b),
      render: () => React.createElement('div', { 'data-testid': 'original-renderer' }, 'Original panel'),
    } : undefined }
    const saved = [], prompts = [], cancels = []
    let controls
    const runtime = { nativePanels: registry, savePanel: async (...args) => { saved.push(args); return { commit: 'fixture-save' } },
      cancelPendingNextStepQuestion: async id => { cancels.push(id); return false }, sendPrompt: async (...args) => prompts.push(args), readGraph: async () => ({ content: '{}' }) }
    const props = { projectId: 'fixture-project', projectName: 'Fixture project', projectPath: '/isolated/fixture', checkpoint: 'fixture',
      worktreeRevision: null, sessionId: 'fixture-session', dockOpen: true, access: { mode: 'writable', writable: true, kit: { name: 'fixture', version: '1.0' } }, executionAttempts: [],
      design: { example: { state: { title: 'Original' }, skillManifest: { title: { en: 'Fixture bundle' }, presentation: { mode: 'native', renderer: 'fixture' } } } },
      runtime, onControlsChange: value => { controls = value } }
    const container = document.getElementById('root'); root = createRoot(container)
    const render = presentation => React.act(async () => root.render(React.createElement(DesignWorkspace, { ...props, presentation })))
    await render(undefined)
    assert.ok(container.querySelector('[data-testid="design-project-header"]'))
    assert.ok(container.querySelector('[data-testid="design-view-switcher"]'))
    const fullButtons = container.querySelectorAll('button').length
    const hint = () => container.querySelector('[data-testid="design-must-edit-hint"]')
    assert.equal(hint(), null, 'the workspace does not repeat the existing save action in a fixed hint')
    const handoff = { skill: 'example', pin: { projectId: props.projectId, kitName: 'fixture', kitVersion: '1.0',
      skillName: 'example', bundleVersion: '1.0', stateRevision: props.checkpoint, invocationId: 'fixture-run' } }
    props.mustEditHandoffs = [handoff]
    await render(undefined)
    assert.equal(hint(), null, 'a real matching must_edit handoff adds no redundant fixed hint')
    assert.match(container.querySelector('[data-testid="dsh-design-save"]').textContent, /Save and assess next step/)
    assert.equal(container.querySelectorAll('button').length, fullButtons, 'the handoff adds no second action')
    assert.equal(controls.saveDisabled, true, 'an unchanged draft does not release must_edit')
    assert.equal(saved.length, 0); assert.equal(prompts.length, 0)
    for (const pin of [{ ...handoff.pin, projectId: 'other' }, { ...handoff.pin, kitVersion: '2.0' },
      { ...handoff.pin, kitName: 'other' }, { ...handoff.pin, skillName: 'other' }, { ...handoff.pin, stateRevision: 'old' }]) {
      props.mustEditHandoffs = [{ ...handoff, pin }]; await render(undefined)
      assert.equal(hint(), null, 'a different owner or checkpoint cannot show this instruction')
    }
    props.mustEditHandoffs = [handoff]
    props.activeMainBundles = [{ skill: 'example', invocationId: 'fixture-run' }]
    await render(undefined); assert.equal(hint(), null, 'the active main Bundle is not waiting for user input')
    props.activeMainBundles = []
    props.executionAttempts = [{ skill: 'example', invocationId: 'fixture-run', attemptId: 'producer', role: 'producer', phase: 'working', sequence: 1 }]
    await render(undefined); assert.equal(hint(), null, 'running work must not be presented as editable')
    props.executionAttempts = []
    await React.act(async () => setSaving(true)); assert.equal(hint(), null)
    assert.equal(controls.saveDisabled, true, 'an active save keeps the existing save action disabled')
    await React.act(async () => setSaving(false, 'Save failed')); assert.equal(hint(), null, 'a failure retains its own recovery message')
    assert.ok(container.textContent.includes('Save failed'), 'removing the hint retains save error feedback')
    await React.act(async () => setSaving(false))
    const originalAccess = props.access
    props.access = { mode: 'recovery', writable: false, kit: { name: 'fixture', version: '1.0' } }
    await render(undefined); assert.equal(hint(), null)
    assert.equal(controls.saveDisabled, true, 'read-only recovery still prevents saving')
    assert.ok(container.querySelector('[data-testid="dsh-design-workspace-readonly"]'))
    props.access = originalAccess
    props.publicationError = 'Publication unavailable'
    await render(undefined); assert.equal(hint(), null)
    assert.equal(controls.saveDisabled, true, 'unavailable publication state still prevents saving')
    delete props.publicationError
    props.demonstrationSave = true
    await render(undefined); assert.equal(hint(), null, 'a Studio demonstration cannot advertise a real edit gate')
    delete props.demonstrationSave
    await render(undefined)
    let releaseLocale
    await React.act(async () => { releaseLocale = bindDesignHostLocale({ getSnapshot: () => ({ active: 'zh-CN' }), subscribe: () => () => {} }) })
    assert.equal(hint(), null, 'the Chinese locale does not restore the redundant hint')
    assert.match(container.querySelector('[data-testid="dsh-design-save"]').textContent, /保存并评估下一步/)
    await React.act(async () => releaseLocale())
    props.mustEditHandoffs = []
    await render(undefined); assert.equal(hint(), null, 'a consumed handoff adds no fixed hint')
    props.mustEditHandoffs = [handoff]
    await render('panel-only')
    assert.equal(hint(), null, 'panel-only presentation also omits the redundant hint')
    assert.equal(container.querySelector('[data-testid="design-project-header"]'), null)
    assert.equal(container.querySelector('[data-testid="design-view-switcher"]'), null)
    assert.ok(container.querySelector('[data-testid="original-renderer"]'))
    assert.ok(container.querySelectorAll('button').length < fullButtons)
    assert.equal(controls.saveDisabled, true)
    await React.act(async () => editDraft('example', { title: 'Edited' }))
    assert.equal(controls.dirty, true); assert.equal(controls.saveDisabled, false)
    await React.act(async () => { controls.retract() })
    assert.equal(controls.dirty, false)
    await React.act(async () => editDraft('example', { title: 'Saved through original control' }))
    await React.act(async () => { controls.save(); await new Promise(resolve => setTimeout(resolve, 0)) })
    assert.equal(saved.length, 1)
    assert.deepEqual(saved[0].slice(0, 3), ['fixture-session', 'example', { title: 'Saved through original control' }])
    assert.equal(prompts.length, 1); assert.deepEqual(cancels, ['fixture-session'])
    assert.equal(controls.dirty, true, 'only the authoritative host projection can confirm the saved baseline')
    assert.equal(controls.saving, false)
    await React.act(async () => root.render(React.createElement(DesignWorkspace, { ...props, presentation: 'panel-only',
      design: { example: { ...props.design.example, state: { title: 'Saved through original control' } } } })))
    assert.equal(controls.dirty, false)
    const demoProps = { ...props, presentation: 'panel-only', demonstrationSave: true }
    await React.act(async () => root.render(React.createElement(DesignWorkspace, demoProps)))
    await React.act(async () => editDraft('example', { title: 'Demonstration only' }))
    await React.act(async () => { controls.save(); await new Promise(resolve => setTimeout(resolve, 0)) })
    assert.equal(controls.dirty, false, 'demo save accepts a local UI baseline')
    assert.equal(saved.length, 1, 'demo must never call runtime.savePanel')
    assert.equal(prompts.length, 1, 'demo must never notify the Agent')
    assert.equal(cancels.length, 1, 'demo must not alter pending Agent work')
    await React.act(async () => root.render(React.createElement(DesignWorkspace, { ...demoProps, design: structuredClone(props.design) })))
    assert.equal(controls.dirty, false, 'polling the same source preserves demo baseline')
    await React.act(async () => editDraft('example', { title: 'Undo this' }))
    await React.act(async () => controls.retract())
    assert.equal(controls.dirty, false)
    let closes = 0
    const emptyProps = { ...props, design: {}, onClose: () => { closes++ } }
    await React.act(async () => root.render(React.createElement(DesignWorkspace, emptyProps)))
    assert.ok(container.querySelector('[data-testid="design-project-header"] [data-testid="dsh-design-dock-close"]'), 'empty dock closes from the compact project header')
    await React.act(async () => container.querySelector('[data-testid="dsh-design-dock-close"]').click())
    assert.equal(closes, 1)
    await React.act(async () => root.render(React.createElement(DesignWorkspace, { ...emptyProps, hideProjectHeader: true })))
    assert.equal(container.querySelector('[data-testid="design-project-header"]'), null)
    assert.ok(container.querySelector('[data-testid="dsh-design-dock-close"]'), 'a host that hides the project header must retain empty-dock close')
    await React.act(async () => container.querySelector('[data-testid="dsh-design-dock-close"]').click())
    assert.equal(closes, 2)
    await React.act(async () => root.unmount()); root = undefined
    assert.equal(controls, undefined, 'unmounted workspace withdraws its controls')
  } finally {
    if (root) await React.act(async () => root.unmount())
    dom.window.close()
    for (const key of keys) { if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key] }
    await rm(output, { recursive: true, force: true })
  }
})
