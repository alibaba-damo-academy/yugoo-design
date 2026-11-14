import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import React from 'react'
import { JSDOM } from 'jsdom'
import { cancelPendingDesignNextStepQuestion } from '../src/client/next-step-question.ts'

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
    let api

    async function withWorkspace(run, overrides = {}) {
      const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:32124/', pretendToBeVisual: true })
      const keys = ['window', 'document', 'HTMLElement', 'Element', 'Node', 'React', 'IS_REACT_ACT_ENVIRONMENT', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver']
      const previous = Object.fromEntries(keys.map(key => [key, globalThis[key]]))
      for (const key of keys.slice(0, 5)) globalThis[key] = dom.window[key]
      globalThis.React = React
      globalThis.IS_REACT_ACT_ENVIRONMENT = true
      globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
      globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
      globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
      // Native input events need ReactDOM's browser feature detection after DOM setup.
      api ??= await import(pathToFileURL(join(output, 'workspace.mjs')).href)
      const { createRoot } = await import('react-dom/client')
      const calls = { saves: [], prompts: [], cancels: [] }
      let controls
      const definition = {
        scrollOwner: 'panel', equalsDraft: (a, b) => JSON.stringify(a) === JSON.stringify(b),
        action: ({ saveAndRegenerate }) => saveAndRegenerate(),
        render: overrides.render ?? (props => React.createElement('button', {
          'data-testid': `regenerate-${props.skill}`, disabled: props.running,
          onClick: props.onAction,
        }, `Regenerate ${props.skill}`)),
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
        sendPrompt: async (...args) => { calls.prompts.push(args); return overrides.sendPrompt?.(...args) },
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
        assert.ok(container.querySelector('[data-testid="dsh-design-panel-alpha"]'), 'the actual Workspace mounts its active panel')
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

    const boardBundle = () => ({
      panelYaml: `version: 1
panel_kind: document
sections: [{id: items, title: Items, add_mode: none}]
fields:
  - {key: title, label: Title, control: text, applies_to: [items]}
  - {key: description, label: Description, control: textarea, applies_to: [items]}
  - {key: group, label: Group, control: text, applies_to: [items]}
ui:
  {component: record_board, id: board, source: items, board: {label: title, description: description, group: group}}
`,
      state: { items: {
        a: { title: 'Alpha', description: 'Saved A', group: 'First group' },
        b: { title: 'Beta', description: 'Saved B', group: 'Second group' },
        c: { title: 'Gamma', description: 'Saved C', group: 'Second group' },
      } },
      skillManifest: { title: { en: 'Records' }, presentation: { mode: 'declarative' } },
    })
    const click = element => React.act(async () => { assert.ok(element); element.click() })
    const inputDescription = (container, text) => React.act(async () => {
      const input = container.querySelector('[data-board-record="c"] textarea')
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(input, text)
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
    })

    for (const regenerate of [false, true]) await t.test(`${regenerate ? 'regeneration' : 'footer save'} retains the draft's base after a concurrent Agent update`, async () => {
      let canonical = { title: 'Agent B' }
      await withWorkspace(async fixture => {
        await fixture.edit('alpha', 'User draft A')
        await fixture.render({ design: { alpha: { state: canonical,
          skillManifest: { title: { en: 'Alpha' }, presentation: { mode: 'native', renderer: 'fixture' } } } } })
        if (regenerate) await click(fixture.container.querySelector('[data-testid="regenerate-alpha"]'))
        else await fixture.save()
        await eventually(() => !fixture.controls.saving && fixture.calls.saves.length === 1, 'the conflict should settle')
        assert.deepEqual(fixture.calls.saves[0][3].before, { title: 'Alpha' }, 'send the actual draft base, not the newer Host value')
        assert.deepEqual(canonical, { title: 'Agent B' }, 'the newer saved value survives')
        assert.equal(fixture.controls.dirty, true, 'the failed draft remains available')
        assert.equal(fixture.calls.prompts.length, 0, 'a conflict cannot continue or regenerate')
        assert.match(fixture.controls.error, /PANEL_SAVE_CONFLICT/)
        await React.act(async () => fixture.controls.retract())
        assert.equal(fixture.controls.dirty, false, 'Cancel loads the latest Host content')
        await fixture.edit('alpha', 'Reconciled C')
        await fixture.save()
        await eventually(() => !fixture.controls.saving && fixture.calls.prompts.length === 1, 'a fresh edit should save normally')
        assert.deepEqual(fixture.calls.saves[1][3].before, { title: 'Agent B' })
        assert.deepEqual(canonical, { title: 'Reconciled C' })
      }, { savePanel: (_session, _skill, state, input) => {
        if (JSON.stringify(input?.before) !== JSON.stringify(canonical)) throw Error('PANEL_SAVE_CONFLICT: newer saved content')
        canonical = state
        return { commit: 'reconciled' }
      } })
    })

    await t.test('pending native editor input retains its pre-update save baseline before serialization', async () => {
      function BufferedEditor(props) {
        const [value, setValue] = React.useState(props.draft.title)
        const latest = React.useRef(value), registration = React.useRef()
        latest.current = value
        React.useEffect(() => {
          const remove = props.registerBeforeSave(async () => {
            props.onChange({ title: latest.current })
            remove.setPending(false)
          }, () => { remove.setPending(false) })
          registration.current = remove
          return remove
        }, [props.registerBeforeSave, props.onChange])
        React.useEffect(() => setValue(props.draft.title), [props.draft])
        return React.createElement('input', { value, onChange: event => {
          setValue(event.target.value); registration.current.setPending(true)
        } })
      }
      await withWorkspace(async fixture => {
        await React.act(async () => {
          const input = fixture.container.querySelector('input')
          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'Buffered A')
          input.dispatchEvent(new window.Event('input', { bubbles: true }))
        })
        assert.equal(fixture.controls.dirty, true)
        await fixture.render({ design: { alpha: { state: { title: 'Agent B' },
          skillManifest: { title: { en: 'Alpha' }, presentation: { mode: 'native', renderer: 'fixture' } } } } })
        assert.equal(fixture.container.querySelector('input').value, 'Buffered A')
        await fixture.save()
        await eventually(() => fixture.calls.saves.length === 1 && !fixture.controls.saving, 'buffered save settles')
        assert.deepEqual(fixture.calls.saves[0][2], { title: 'Buffered A' })
        assert.deepEqual(fixture.calls.saves[0][3].before, { title: 'Alpha' })
        assert.equal(fixture.controls.dirty, true)
        await React.act(async () => fixture.controls.retract())
        assert.equal(fixture.container.querySelector('input').value, 'Agent B')
      }, { render: props => React.createElement(BufferedEditor, props), savePanel: () => {
        throw Error('PANEL_SAVE_CONFLICT: newer saved content')
      } })
    })

    for (const fail of [false, true]) await t.test(`board saving ${fail ? 'failure and retry' : 'success'} retains the chosen details scope`, async () => {
      const pending = deferred()
      let first = true
      await withWorkspace(async fixture => {
        const { container } = fixture
        await click(container.querySelector('nav button[aria-label="Second group"]'))
        const gamma = () => [...container.querySelectorAll('nav button')].find(button => button.textContent === 'Gamma')
        await click(gamma())
        const card = container.querySelector('[data-board-record="c"]')
        const collapsed = container.querySelector('[data-board-record="b"] > details')
        const content = container.querySelector('.dsh-record-board-content')
        collapsed.open = false
        content.scrollTop = 37
        const assertDetails = () => {
          assert.equal(container.querySelector('.dsh-workspace-cover-base').getAttribute('aria-hidden'), null, 'save must not open the mind map')
          assert.equal(container.querySelector('[data-board-record="c"]'), card, 'the selected card stays mounted')
          assert.equal(gamma().getAttribute('aria-current'), 'page')
          assert.deepEqual([...container.querySelectorAll('[data-board-group]')].filter(page => !page.hidden).map(page => page.dataset.boardGroup), ['Second group'])
          assert.equal(collapsed.open, false, 'manual disclosure survives save and readonly changes')
          assert.equal(content.scrollTop, 37)
        }
        await inputDescription(container, 'Cancelled draft')
        await React.act(async () => fixture.controls.retract())
        assert.equal(card.querySelector('textarea').value, 'Saved C')
        assertDetails()
        assert.equal(fixture.calls.saves.length, 0, 'retract does not write or continue')
        await inputDescription(container, 'Saved user marker')
        await fixture.save()
        await eventually(() => fixture.calls.saves.length === 1, 'save should reach the Host')
        assert.equal(card.querySelector('textarea'), null, 'busy still prevents editing')
        assertDetails()
        await React.act(async () => fail ? pending.reject(new Error('Save unavailable')) : pending.resolve({ commit: 'saved' }))
        await eventually(() => !fixture.controls.saving, 'save should settle')
        assertDetails()
        assert.equal(card.querySelector('textarea').value, 'Saved user marker')
        if (fail) {
          assert.equal(fixture.controls.error, 'Save unavailable')
          assert.equal(fixture.controls.dirty, true)
          assert.equal(fixture.calls.prompts.length, 0, 'failed save cannot continue')
          await fixture.save()
          await eventually(() => !fixture.controls.saving && fixture.calls.prompts.length === 1, 'retry should save and continue once')
          assertDetails()
        }
        assert.equal(fixture.calls.saves.at(-1)[2].items.c.description, 'Saved user marker')
        assert.equal(fixture.calls.prompts.length, 1)
        const published = boardBundle()
        published.state.items.c.description = 'Saved user marker'
        await fixture.render({ design: { alpha: published }, checkpoint: 'saved' })
        assertDetails()
        assert.equal(fixture.controls.dirty, false)
      }, { props: { design: { alpha: boardBundle() } }, savePanel: () => {
        if (first) { first = false; return pending.promise }
        return { commit: 'retry-saved' }
      } })
    })

    await t.test('actual Producer and Main Bundle completion still opens the board mind map', async () => {
      const producer = { projectId: 'project-a', skill: 'alpha', artifactId: 'alpha', invocationId: 'generation', attemptId: 'producer', role: 'producer', phase: 'working', sequence: 1, timestamp: 1 }
      await withWorkspace(async fixture => {
        const { container } = fixture
        const covered = () => container.querySelector('.dsh-workspace-cover-base').getAttribute('aria-hidden') === 'true'
        assert.equal(covered(), false)
        await fixture.render({ executionAttempts: [{ ...producer, phase: 'completed', sequence: 2 }] })
        assert.equal(covered(), true, 'real Producer completion keeps its existing overview transition')
        await click(container.querySelector('.dsh-workspace-cover-return'))
        await fixture.render({ activeMainBundles: [{ skill: 'alpha', invocationId: 'main-generation' }] })
        assert.equal(covered(), false, 'starting a Main Bundle does not prematurely change the chosen view')
        await fixture.render({ activeMainBundles: [] })
        assert.equal(covered(), true, 'real Main Bundle completion keeps its existing overview transition')
        assert.equal(fixture.calls.saves.length, 0)
      }, { props: { design: { alpha: boardBundle() }, executionAttempts: [producer] } })
    })

    await t.test('switching projects in one session retires its direct card draft before the new project can save', async () => {
      const panelYaml = `version: 1
panel_kind: document
sections: [{id: items, title: Items, add_mode: none}]
fields:
  - {key: title, label: Title, control: text, applies_to: [items]}
  - {key: description, label: Description, control: textarea, applies_to: [items]}
ui:
  {component: record_board, id: board, source: items, board: {label: title, description: description}}
`
      const bundle = () => ({ panelYaml, state: { items: { shared: { title: 'Shared identity', description: 'Identical saved base' } } },
        skillManifest: { title: { en: 'Records' }, presentation: { mode: 'declarative' } } })
      await withWorkspace(async fixture => {
        const editLocal = async text => {
          await React.act(async () => {
            const input = fixture.container.querySelector('.dsh-record-board-description-editor')
            Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(input, text)
            input.dispatchEvent(new window.Event('input', { bubbles: true }))
          })
        }
        await editLocal('Only for project A')
        assert.equal(fixture.controls.saveDisabled, false)
        await fixture.render({ checkpoint: 'fresh-read' })
        assert.equal(fixture.container.querySelector('textarea').value, 'Only for project A', 'ordinary same-project refresh keeps input')
        assert.equal(fixture.controls.saveDisabled, false)
        const oldControls = fixture.controls
        await fixture.render({ projectId: 'project-b', projectName: 'Project B', projectPath: '/isolated/b', design: { alpha: bundle() } })
        assert.equal(fixture.container.querySelector('.dsh-record-board-description-editor').value, 'Identical saved base')
        assert.equal(fixture.controls.saveDisabled, true, 'same skill, record ID and saved value do not inherit the previous project input')
        assert.equal(fixture.calls.saves.length, 0)
        await editLocal('Only for project B')
        await React.act(async () => oldControls.retract())
        assert.equal(fixture.container.querySelector('textarea').value, 'Only for project B', 'retired controls cannot clear the new project input')
        await fixture.save()
        await eventually(() => fixture.calls.saves.length === 1 && !fixture.controls.saving, 'current project save should finish')
        assert.equal(fixture.calls.saves[0][2].items.shared.description, 'Only for project B')
        assert.equal(fixture.calls.prompts.length, 1)
      }, { props: { design: { alpha: bundle() } } })
    })

    await t.test('read-only Workspace keeps its reading surface interactive while rejecting writes', async () => {
      const panelYaml = `version: 1
panel_kind: document
sections: [{id: items, title: Items}]
fields:
  - {key: title, label: Title, control: text, applies_to: [items]}
  - {key: description, label: Description, control: textarea, applies_to: [items]}
ui:
  component: record_workspace
  id: workspace
  sources: [items]
  navigation_layout: tree
  children: [{component: record_inspector, id: inspector}]
`
      const state = { items: { a: { title: 'Alpha', description: 'Original Alpha' }, b: { title: 'Beta', description: 'Original Beta' } } }
      await withWorkspace(async fixture => {
        const panel = fixture.container.querySelector('[data-testid="dsh-design-panel-alpha"]')
        assert.ok(!panel.closest('[inert]'), 'read-only is not a blanket interaction lock')
        await React.act(async () => panel.querySelector('button[aria-label="Beta"]').click())
        assert.equal(panel.querySelector('button[aria-label="Beta"]').getAttribute('aria-current'), 'page')
        assert.match(panel.textContent, /Original Beta/)
        assert.ok(!panel.querySelector('input, textarea'), 'the shared interpreter renders readable values rather than writable inputs')
        assert.equal(fixture.controls.saveDisabled, true)
        await fixture.save()
        assert.deepEqual(fixture.calls, { saves: [], prompts: [], cancels: [] })
        assert.deepEqual(state.items.b, { title: 'Beta', description: 'Original Beta' })
      }, { props: { access: { mode: 'recovery', writable: false, kit: { name: 'fixture', version: '1.0' } },
        design: { alpha: { panelYaml, state, skillManifest: { title: { en: 'Records' }, presentation: { mode: 'declarative' } } } } } })
    })

    await t.test('an unavailable optional interaction snapshot still hands off the actual saved batch once', async () => {
      await withWorkspace(async fixture => {
        await fixture.edit('alpha', 'Saved despite unavailable question lookup')
        await fixture.save()
        await eventually(() => !fixture.controls.saving, 'save and ordinary continuation should settle')
        assert.equal(fixture.controls.error, undefined)
        assert.equal(fixture.calls.saves.length, 1)
        assert.equal(fixture.calls.prompts.length, 1)
        assert.deepEqual(fixture.calls.prompts[0][3], [{ eventId: fixture.calls.saves[0][4], commit: 'checkpoint-alpha' }])
      }, { cancel: () => cancelPendingDesignNextStepQuestion({ getSnapshot() { throw new Error('Host snapshot unavailable') } }, 'session-a') })
    })

    await t.test('a real continuation delivery failure stays visible without resending or undoing the save', async () => {
      await withWorkspace(async fixture => {
        await fixture.edit('alpha', 'Durably saved')
        await fixture.save()
        await eventually(() => !fixture.controls.saving, 'failed delivery should settle')
        assert.equal(fixture.controls.error, 'Native delivery failed')
        assert.equal(fixture.calls.saves[0][2].title, 'Durably saved')
        assert.equal(fixture.calls.saves.length, 1)
        assert.equal(fixture.calls.prompts.length, 1, 'failure does not cause an automatic retry')
      }, { sendPrompt: async () => { throw new Error('Native delivery failed') } })
    })

    await t.test('two dirty Panels yield one prompt containing each actual save receipt', async () => {
      const second = deferred()
      await withWorkspace(async fixture => {
        await fixture.edit('alpha', 'Edited Alpha')
        await fixture.edit('beta', 'Edited Beta')
        await fixture.save()
        await eventually(() => fixture.calls.saves.length === 2, 'both sequential saves should start')
        assert.equal(fixture.container.querySelector('[data-testid="regenerate-alpha"]').disabled, true, 'saving keeps native renderer actions locked')
        assert.equal(fixture.calls.prompts.length, 0, 'a partial batch must not submit its handoff')
        assert.equal(fixture.calls.cancels.length, 0, 'recommendation cancellation follows the complete batch')
        await React.act(async () => { second.resolve({ commit: 'checkpoint-beta' }) })
        await eventually(() => fixture.calls.prompts.length === 1 && !fixture.controls.saving, 'the complete batch should hand off once')
        assert.equal(fixture.container.querySelector('[data-testid="regenerate-alpha"]').disabled, false, 'settling save restores native renderer actions')
        assert.deepEqual(fixture.calls.saves.map(args => args.slice(0, 3)), [
          ['session-a', 'alpha', { title: 'Edited Alpha' }],
          ['session-a', 'beta', { title: 'Edited Beta' }],
        ])
        const eventIds = fixture.calls.saves.map(args => args[4])
        assert.ok(eventIds.every(id => typeof id === 'string' && id.length > 0))
        assert.equal(new Set(eventIds).size, 2, 'the correlation uses distinct actual operation ids')
        const [session, text, requestId, receipts] = fixture.calls.prompts[0]
        assert.equal(session, 'session-a')
        assert.equal(text, 'Save & continue', 'the native main request uses the same visible wording as the save control')
        assert.match(requestId, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i,
          'the existing client delivery correlation is a UUID, not a claimed native Host invocation id')
        assert.equal(eventIds.includes(requestId), false, 'batch delivery and individual save identities stay distinct')
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
        assert.doesNotMatch(fixture.calls.prompts[0][1], /^Save & continue$/)
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
