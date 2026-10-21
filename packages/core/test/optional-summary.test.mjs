/** Real loader and shared rendering boundary, no model/installed-host claims. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { basename, dirname, resolve } from 'node:path'
import { stringify } from 'yaml'
import { loadDesignKit } from '../src/kit-loader.ts'
import { assembleDesignState, renderDeclarativeState, parseDeclarativeSummary } from '../src/renderer.ts'

const root = resolve('/optional-summary-fixture-not-written')
const base = resolve(root, 'skills/sample')
const summary = { fields: [{ source: 'title', title: 'Title' }], collections: [{ source: 'records', title: 'Records', fields: ['title'] }] }
const state = { title: 'Saved facts', records: { A: { title: 'First' } } }
const schema = { type: 'object', required: ['title'], properties: { title: { type: 'string' }, records: { type: 'map', value: { type: 'object', properties: { title: { type: 'string' } } } } } }
const panel = { version: 1, panel_kind: 'evidence_workbook', sections: [{ id: 'records', title: 'Records', item_name: 'Record' }], fields: [{ key: 'title', label: 'Title', control: 'text', applies_to: ['records'] }], ui: { component: 'stack', id: 'root' } }

export async function loadFixture(options = {}) {
  const manifest = { name: 'sample', version: '1.0', title: { zh: '样例', en: 'Sample' }, label: { zh: '编辑', en: 'Edit' }, presentation: { mode: 'declarative' }, execution: { mode: options.mode ?? 'main', handoff: 'must_edit' }, ...options.manifest }
  const files = new Map([
    [resolve(root, 'mindset.md'), '---\nname: sample_kit\nversion: "1.0"\n---\n<design_skills>\n## sample\n</design_skills>\n'],
    [resolve(base, 'SKILL.md'), '---\nname: sample\ndescription: Test owned facts.\n---\nPersist the complete canonical state.\n'],
    [resolve(base, 'skill.yaml'), stringify(manifest)],
    [resolve(base, 'schema.yaml'), stringify(schema)],
    [resolve(base, 'validation.yaml'), 'skill: sample\nrules:\n  - id: title\n    scope: [completion]\n    code: sample.title\n    check: {non_empty_string: title}\n'],
    ...(options.panel === false ? [] : [[resolve(base, 'panel.yaml'), stringify(options.panel ?? panel)]]),
    ...(options.legacy === undefined ? [] : [[resolve(base, 'renderer.md'), options.legacy]]),
  ])
  return loadDesignKit({ readText: async path => files.get(path),
    listDir: async path => [...new Set([...files.keys()].filter(file => dirname(file) === path).map(file => basename(file)).concat(path === resolve(root, 'skills') ? ['sample'] : []))],
    isDirectory: async path => [...files.keys()].some(file => file.startsWith(path + '/')),
  }, root, { sourceId: 'optional-summary-fixture' })
}

test('missing summary loads both execution placements with a real Panel and emits no guessed facts', async () => {
  for (const mode of ['main', 'subagent']) {
    const kit = await loadFixture({ mode })
    const skill = kit.skills[0]
    assert.equal(skill.execution.mode, mode)
    assert.equal(skill.execution.handoff, 'must_edit')
    assert.ok(skill.metadata.panelManifest)
    assert.equal(skill.metadata.rendererManifest, undefined)
    assert.deepEqual(renderDeclarativeState(state, skill), [])
    assert.equal(assembleDesignState(kit.skills, [{ skill: 'sample', state }]), '')
    assert.match(skill.content, /Persist the complete canonical state/)
  }
})

test('summary preserves legacy projection and render output without adding constants to authored manifest', async () => {
  const legacy = `---\n${stringify({ version: 1, renderer: 'pilot-design/v2', ...summary })}---\nLegacy explanation only.`
  const current = (await loadFixture({ manifest: { summary } })).skills[0]
  const old = (await loadFixture({ legacy })).skills[0]
  assert.deepEqual(current.metadata.rendererManifest, old.metadata.rendererManifest)
  assert.deepEqual(renderDeclarativeState(state, current), renderDeclarativeState(state, old))
  assert.deepEqual(current.metadata.skillManifest.summary, summary)
  assert.equal(current.metadata.rendererMd, undefined)
  await assert.rejects(loadFixture({ manifest: { summary }, legacy }), /both skill.yaml summary and legacy renderer.md/)
})

test('explicit malformed summaries and unsafe/schema-incompatible paths still fail', async () => {
  for (const value of [null, '', [], {}, { fields: [] }, { version: 1, ...summary }, { renderer: 'pilot-design/v2', ...summary }, { fields: 'title' },
    { fields: [{ source: '__proto__.title', title: 'Bad' }] }, { collections: [{ source: 'records', title: 'Records', limit: 101 }] }]) {
    assert.throws(() => parseDeclarativeSummary(value), /skill.yaml summary/)
    await assert.rejects(loadFixture({ manifest: { summary: value } }), /skill.yaml summary/)
  }
  for (const source of ['missing', 'records']) await assert.rejects(loadFixture({ manifest: { summary: { fields: [{ source, title: 'Bad' }] } } }), /skill.yaml summary field source/)
  await assert.rejects(loadFixture({ legacy: '' }), /renderer.md/)
})

test('summary omission does not bypass mandatory Panel or schema binding checks', async () => {
  await assert.rejects(loadFixture({ panel: false }), /missing required declarative slot.*panel.yaml/)
  await assert.rejects(loadFixture({ panel: { ...panel, fields: [{ key: 'missing', label: 'Bad', control: 'text', applies_to: ['records'] }] } }), /field.*missing.*absent from schema/)
  await assert.rejects(loadFixture({ manifest: { summary, presentation: { mode: 'none' } }, panel: false }), /summary requires declarative presentation/)
})

test('no-summary service/Producer context and execution settlement survive real Git Panel save/reopen', async () => {
  const { default: DesignService } = await import('../src/design-service.ts')
  const { registerDesignStateContext } = await import('../src/prompt.ts')
  const { producerPrompt } = await import('../src/dsh-design-execution-plugin.ts')
  const { engageDesignExecution } = await import('../src/design-execution-runtime.ts')
  const { DesignFilesStore } = await import('../src/design-files.ts')
  const { GitVersioning } = await import('../src/git.ts')
  const { DesignPanelRemote } = await import('../src/panel-remote.ts')
  const { nodeFs } = await import('../src/service-tools.ts')
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { promisify } = await import('node:util')
  const { execFile } = await import('node:child_process')
  const exec = promisify(execFile)
  const kit = await loadFixture(), skill = kit.skills[0], agent = {}
  const service = { contentRecoveryLocation: () => undefined, kitForAgent: () => kit, activeWorkspaces: new Map([[agent, { values: { sample: { state } } }]]) }
  const render = () => DesignService.prototype.renderDesignState.call(service, agent)
  assert.equal(render(), '')
  let context
  registerDesignStateContext({ context: value => { context = value; return () => {} } }, render)
  assert.equal(context.text({ agent }), '')
  const input = { brief: 'Edit owned facts', currentDesignState: JSON.stringify(state), userContext: render() }
  assert.match(producerPrompt(skill, 'engage', input), /Saved facts/)
  const directory = await mkdtemp(join(tmpdir(), 'optional-summary-save-'))
  try {
    const git = new GitVersioning(async ({ argv, cwd, env, signal }) => {
      try { return { exitCode: 0, ...await exec(argv[0], argv.slice(1), { cwd, signal, env: { ...process.env, ...env,
        GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@localhost', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@localhost' } }) } }
      catch (error) { return { exitCode: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' } }
    }, directory)
    await git.ensureRepo()
    const store = new DesignFilesStore(nodeFs, git, directory)
    await store.write('sample', { ...state, title: 'Baseline' }, { origin: 'agent', settleEvent: async () => {} })
    const transition = await engageDesignExecution({ invocationId: 'no-summary-run', projectId: '11111111-1111-4111-8111-111111111111',
      kit, kitVersion: kit.version, skillName: skill.name, bundleVersion: skill.version, stateRevision: await store.head() }, input,
    new AbortController().signal, { producer: { async run(request) {
      assert.equal(request.input.userContext, '')
      const publication = await store.write('sample', state, { origin: 'agent', settleEvent: async () => {} })
      return { kind: 'committed', stateRevision: publication.commit, stateStatus: 'pending' }
    } } })
    assert.equal(transition.kind, 'await_user')
    const remote = Object.create(DesignPanelRemote.prototype)
    const project = { projectId: '11111111-1111-4111-8111-111111111111' }
    remote.design = { projectForAgent: async () => project, withProjectMutationFor: async (_agent, _project, operation) => operation(),
      withSelectedDesignFilesMutation: async (_agent, _fs, _signal, operation, entered) => { entered?.(); return operation(project, store) },
      requireKitForAgent: () => kit, designFilesForProject: async () => store, readDesignJournal: async () => ({ records: [] }),
      assertProjectSelection() {}, recordDesignChange: async () => 1 }
    const edited = { ...state, title: 'User saved without summary' }
    const saved = await remote.savePanel(agent, 'sample', edited, [], 'summary-save', new AbortController().signal)
    assert.ok(saved.commit)
    assert.deepEqual(await new DesignFilesStore(nodeFs, git, directory).read('sample'), edited)
    assert.equal(assembleDesignState(kit.skills, [{ skill: 'sample', state: edited }]), '')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
