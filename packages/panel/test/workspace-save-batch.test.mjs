import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import React from 'react'
import { JSDOM } from 'jsdom'
import { createRoot } from 'react-dom/client'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function eventually(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  }
  assert.ok(predicate(), message)
}

test('mounted Workspace hands off only its fully saved, current batch', async t => {
  const require = createRequire(import.meta.url)
  const { build } = await import(pathToFileURL(createRequire(require.resolve('tsx')).resolve('esbuild')).href)
  const output = await mkdtemp(fileURLToPath(new URL('./.workspace-save-batch-', import.meta.url)))
  // An isolated review worktree may explicitly build a fixed candidate's source;
  // normal repository runs exercise this worktree's own implementation.
  const clientRoot = resolve(process.env.YUGOO_PANEL_TEST_CLIENT_ROOT
    ?? fileURLToPath(new URL('../src/client/', import.meta.url)))
  try {
    await build({
      stdin: {
        contents: "export { DesignWorkspace } from './workspace.tsx'; export { editDraft, resetPanelStore } from './store.ts'",
        resolveDir: clientRoot, loader: 'tsx',
      },
      outfile: join(output, 'workspace.mjs'), bundle: true, packages: 'external',
      platform: 'node', format: 'esm', jsx: 'automatic',
      // These browser-only engines are unrelated to save/admission behavior.
      plugins: [{ name: 'unexercised-graph', setup(b) {
        b.onResolve({ filter: /bpmn-runtime\.ts$/ }, () => ({ path: 'bpmn', namespace: 'not-exercised' }))
        b.onResolve({ filter: /excalidraw-surface\.tsx$/ }, () => ({ path: 'canvas', namespace: 'not-exercised' }))
        b.onResolve({ filter: /\.css$/ }, () => ({ path: 'css', namespace: 'not-exercised' }))
        b.onResolve({ filter: /^\.\/graph-panel\.tsx$/ }, () => ({ path: 'graph', namespace: 'not-exercised' }))
        b.onLoad({ filter: /.*/, namespace: 'not-exercised' }, args => ({
          contents: args.path === 'css' ? ''
            : args.path === 'bpmn' ? 'export class Modeler { constructor() { throw new Error("BPMN is not exercised") } }; export class NavigatedViewer extends Modeler {}'
            : args.path === 'canvas' ? 'export default function Canvas() { throw new Error("Canvas is not exercised") }'
            : 'export function GraphPanel() { throw new Error("Graph is not exercised") }',
        }))
      } }],
    })
    const api = await import(pathToFileURL(join(output, 'workspace.mjs')).href)

    async function withWorkspace(run, overrides = {}) {
      const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:32124/', pretendToBeVisual: true })
      const keys = ['window', 'document', 'HTMLElement', 'Element', 'Node', 'React', 'IS_REACT_ACT_ENVIRONMENT', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver']
      const previous = Object.fromEntries(keys.map(key => [key, globalThis[key]]))
      for (const key of keys.slice(0, 5)) globalThis[key] = dom.window[key]
      globalThis.React = React
      globalThis.IS_REACT_ACT_ENVIRONMENT = true
      globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
      globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
      globalThis.ResizeObserver = class { observe() {} disconnect() {} }
      const calls = { saves: [], prompts: [], cancels: [] }
      let controls
      const definition = {
        scrollOwner: 'panel', equalsDraft: (a, b) => JSON.stringify(a) === JSON.stringify(b),
        action: ({ saveAndRegenerate }) => saveAndRegenerate(),
        render: props => React.createElement('button', {
          'data-testid': `regenerate-${props.skill}`, disabled: props.running,
          onClick: props.onAction,
        }, `Regenerate ${props.skill}`),
      }
      const registry = {
        subscribe: () => () => {}, revision: () => 0,
        get: id => id === 'fixture' ? definition : undefined,
      }
      const runtime = {
        nativePanels: registry,
        savePanel: async (...args) => {
          calls.saves.push(args)
          return overrides.savePanel ? overrides.savePanel(...args) : { commit: `checkpoint-${args[1]}` }
        },
        cancelPendingNextStepQuestion: async (...args) => {
          calls.cancels.push(args)
          return overrides.cancel ? overrides.cancel(...args) : false
        },
        sendPrompt: async (...args) => { calls.prompts.push(args) },
        readGraph: async () => ({ content: '{}' }),
      }
      const bundle = title => ({ state: { title }, skillManifest: {
        title: { en: title }, presentation: { mode: 'native', renderer: 'fixture' },
      } })
      let props = {
        projectId: 'project-a', projectName: 'Project A', projectPath: '/isolated/a',
        checkpoint: 'before-save', worktreeRevision: null, sessionId: 'session-a',
        dockOpen: true, presentation: 'panel-only', executionAttempts: [],
        access: { mode: 'writable', writable: true, kit: { name: 'fixture', version: '1.0' } },
        design: { alpha: bundle('Alpha'), beta: bundle('Beta') }, runtime,
        onControlsChange: value => { controls = value },
        ...overrides.props,
      }
      const container = document.getElementById('root')
      const root = createRoot(container)
      const render = async patch => {
        props = { ...props, ...patch }
        await React.act(async () => root.render(React.createElement(api.DesignWorkspace, props)))
      }
      const edit = async (skill, title) => React.act(async () => api.editDraft(skill, { title }))
      const save = async () => React.act(async () => { controls.save() })
      try {
        await render({})
        assert.ok(container.querySelector('[data-testid="regenerate-alpha"]'), 'the actual Workspace renders its provider panel')
        await run({ calls, container, render, edit, save, get controls() { return controls } })
      } finally {
        await React.act(async () => root.unmount())
        api.resetPanelStore()
        dom.window.close()
        for (const key of keys) {
          if (previous[key] === undefined) delete globalThis[key]
          else globalThis[key] = previous[key]
        }
      }
    }

    await t.test('two dirty Panels yield one prompt containing each actual save receipt', async () => {
      const second = deferred()
      await withWorkspace(async fixture => {
        await fixture.edit('alpha', 'Edited Alpha')
        await fixture.edit('beta', 'Edited Beta')
        await fixture.save()
        await eventually(() => fixture.calls.saves.length === 2, 'both sequential saves should start')
        assert.equal(fixture.calls.prompts.length, 0, 'a partial batch must not submit its handoff')
        assert.equal(fixture.calls.cancels.length, 0, 'recommendation cancellation follows the complete batch')
        await React.act(async () => { second.resolve({ commit: 'checkpoint-beta' }) })
        await eventually(() => fixture.calls.prompts.length === 1 && !fixture.controls.saving, 'the complete batch should hand off once')
        assert.deepEqual(fixture.calls.saves.map(args => args.slice(0, 3)), [
          ['session-a', 'alpha', { title: 'Edited Alpha' }],
          ['session-a', 'beta', { title: 'Edited Beta' }],
        ])
        const eventIds = fixture.calls.saves.map(args => args[4])
        assert.ok(eventIds.every(id => typeof id === 'string' && id.length > 0))
        assert.equal(new Set(eventIds).size, 2, 'the correlation uses distinct actual operation ids')
        const [session, text, requestId, receipts] = fixture.calls.prompts[0]
        assert.equal(session, 'session-a')
        assert.match(text, /Save and continue designing/)
        assert.equal(requestId, undefined, 'Workspace does not invent a native Host request id')
        assert.deepEqual(receipts, [
          { eventId: eventIds[0], commit: 'checkpoint-alpha' },
          { eventId: eventIds[1], commit: 'checkpoint-beta' },
        ])
        assert.deepEqual(fixture.calls.cancels, [['session-a']])
      }, { savePanel: async (_session, skill) => skill === 'beta' ? second.promise : { commit: 'checkpoint-alpha' } })
    })

    await t.test('a second Panel failure never submits a completed-batch prompt', async () => {
      await withWorkspace(async fixture => {
        await fixture.edit('alpha', 'Edited Alpha')
        await fixture.edit('beta', 'Edited Beta')
        await fixture.save()
        await eventually(() => fixture.controls.error === 'Beta save failed' && !fixture.controls.saving, 'the actual Workspace should expose save failure')
        assert.equal(fixture.calls.saves.length, 2)
        assert.deepEqual(fixture.calls.prompts, [], 'a successful first receipt cannot become a complete batch')
        assert.deepEqual(fixture.calls.cancels, [])
        assert.equal(fixture.controls.dirty, true, 'failed edits remain pending')
      }, { savePanel: async (_session, skill) => {
        if (skill === 'beta') throw new Error('Beta save failed')
        return { commit: 'checkpoint-alpha' }
      } })
    })

    await t.test('demonstration save accepts both drafts locally without runtime mutations', async () => {
      await withWorkspace(async fixture => {
        await fixture.edit('alpha', 'Demo Alpha')
        await fixture.edit('beta', 'Demo Beta')
        await fixture.save()
        await eventually(() => !fixture.controls.dirty && !fixture.controls.saving, 'demo should settle its local baseline')
        assert.deepEqual(fixture.calls, { saves: [], prompts: [], cancels: [] })
      }, { props: { demonstrationSave: true } })
    })

    for (const [name, patch] of [
      ['project changes', { projectId: 'project-b', projectPath: '/isolated/b' }],
      ['session changes', { sessionId: 'session-b' }],
      ['write access is revoked', { access: { mode: 'recovery', writable: false, kit: { name: 'fixture', version: '1.0' } } }],
    ]) {
      await t.test(`${name} while saving prevents the remaining batch and prompt`, async () => {
        const first = deferred()
        await withWorkspace(async fixture => {
          await fixture.edit('alpha', 'Edited Alpha')
          await fixture.edit('beta', 'Edited Beta')
          await fixture.save()
          await eventually(() => fixture.calls.saves.length === 1, 'the first save should be in flight')
          await fixture.render(patch)
          await React.act(async () => { first.resolve({ commit: 'old-owner-checkpoint' }) })
          await eventually(() => !fixture.controls.saving, 'the current Workspace should leave the old save scope')
          assert.equal(fixture.calls.saves.length, 1, 'the obsolete save cannot write the next Panel')
          assert.deepEqual(fixture.calls.prompts, [])
          assert.deepEqual(fixture.calls.cancels, [])
        }, { savePanel: () => first.promise })
      })
    }

    await t.test('a project switch during recommendation cancellation cannot submit an old receipt batch', async () => {
      const cancellation = deferred()
      await withWorkspace(async fixture => {
        await fixture.edit('alpha', 'Edited Alpha')
        await fixture.save()
        await eventually(() => fixture.calls.cancels.length === 1, 'cancellation should follow the completed save')
        assert.equal(fixture.calls.saves.length, 1)
        await fixture.render({ projectId: 'project-b', projectPath: '/isolated/b' })
        await React.act(async () => { cancellation.resolve(false) })
        await eventually(() => !fixture.controls.saving, 'the new project should not stay locked')
        assert.deepEqual(fixture.calls.prompts, [])
      }, { cancel: () => cancellation.promise })
    })

    await t.test('provider regeneration preserves its explicit target and only attaches the saved target receipt', async () => {
      await withWorkspace(async fixture => {
        await fixture.edit('alpha', 'Regenerate Alpha')
        await fixture.edit('beta', 'Leave Beta pending')
        await React.act(async () => { fixture.container.querySelector('[data-testid="regenerate-alpha"]').click() })
        await eventually(() => fixture.calls.prompts.length === 1 && !fixture.controls.saving, 'provider action should hand off its explicit regeneration')
        assert.equal(fixture.calls.saves.length, 1)
        assert.deepEqual(fixture.calls.saves[0].slice(0, 3), ['session-a', 'alpha', { title: 'Regenerate Alpha' }])
        assert.match(fixture.calls.prompts[0][1], /alpha/)
        assert.doesNotMatch(fixture.calls.prompts[0][1], /^Save and continue designing$/)
        assert.deepEqual(fixture.calls.prompts[0][3], [
          { eventId: fixture.calls.saves[0][4], commit: 'checkpoint-alpha' },
        ])
        assert.equal(fixture.controls.dirty, true, 'regeneration cannot settle another dirty Panel')
      })
    })

    await t.test('clean provider regeneration has no fabricated save receipt', async () => {
      await withWorkspace(async fixture => {
        await React.act(async () => { fixture.container.querySelector('[data-testid="regenerate-alpha"]').click() })
        await eventually(() => fixture.calls.prompts.length === 1 && !fixture.controls.saving, 'a clean Panel may still request explicit regeneration')
        assert.deepEqual(fixture.calls.saves, [])
        assert.match(fixture.calls.prompts[0][1], /alpha/)
        assert.equal(fixture.calls.prompts[0][3], undefined)
      })
    })
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})
