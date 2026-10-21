import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir, stat, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { JSDOM } from 'jsdom'
import { parse, stringify } from 'yaml'
import { writeContentCatalog } from '../../core/test/fixtures/content-catalog.mjs'
import { questionState, questionSchemaYaml, questionPanelYaml, questionValidationYaml } from '../../core/test/fixtures/declarative-question.mjs'

for (const withSummary of [true, false]) test(`synthetic declarative Kit question panel edits, saves and reopens in both locales (${withSummary ? 'with' : 'without'} summary)`, async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/', pretendToBeVisual: true })
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver']) globalThis[key] = dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  const { default: React, act } = await import('react'); globalThis.React = React
  const { createRoot } = await import('react-dom/client')
  const { renderManifest } = await import('../src/interpreter.ts')
  const { applyDesignEditToDraft } = await import('../src/record-state.ts')
  const { loadDesignKit } = await import('../../core/src/kit-loader.ts')
  const { DesignFilesStore } = await import('../../core/src/design-files.ts')
  const { GitVersioning } = await import('../../core/src/git.ts')
  const { applyPanelEdit } = await import('../../core/src/panel-save.ts')
  const { validatorFromSchemaYaml } = await import('../../core/src/schema.ts')
  const directory = await mkdtemp(join(tmpdir(), 'cross-kit-panel-'))
  t.after(async () => { dom.window.close(); await rm(directory, { recursive: true, force: true }) })
  const fs = {
    readText: async path => { try { return await readFile(path, 'utf8') } catch (error) { if (error.code === 'ENOENT') return undefined; throw error } },
    writeText: async (path, text) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text) },
    ensureDir: path => mkdir(path, { recursive: true }), listDir: readdir,
    isDirectory: async path => (await stat(path)).isDirectory(), realPath: realpath,
  }
  const kitRoot = join(directory, 'catalog')
  await writeContentCatalog(kitRoot, { name: 'question_test', bundles: [
    { name: 'questions_fixture', files: {
      'schema.yaml': questionSchemaYaml, 'panel.yaml': questionPanelYaml, 'validation.yaml': questionValidationYaml,
      'skill.yaml': stringify({ name: 'questions_fixture', version: '0.1', presentation: { mode: 'declarative' },
        title: { zh: '示例问题', en: 'Example questions' }, label: { zh: '编辑问题', en: 'Edit questions' },
        execution: { mode: 'main', handoff: 'none' }, summary: { collections: [{ source: 'questions', title: 'Answers',
          order: 'question_order', title_fields: ['prompt'], fields: ['answer', 'detail'] }] } }),
    } }, { name: 'neighbor_fixture' },
  ] })
  const fixture = { questions_fixture: structuredClone(questionState), neighbor_fixture: { summary: 'Keep neighboring facts' } }
  const kit = await loadDesignKit(withSummary ? fs : {
    ...fs,
    listDir: async path => (await fs.listDir(path)).filter(name => name !== 'renderer.md'),
    readText: async path => {
      const text = await fs.readText(path)
      if (!path.endsWith('/skill.yaml') || text === undefined) return text
      const manifest = parse(text); delete manifest.summary
      return stringify(manifest)
    },
  }, kitRoot, { sourceId: 'fixture:cross-kit-save' })
  if (withSummary) {
    const { assembleDesignState } = await import('../../core/src/renderer.ts')
    assert.ok(assembleDesignState(kit.skills, Object.entries(fixture).map(([skill, state]) => ({ skill, state }))).includes(questionState.questions.purpose.answer))
  } else {
    const { assembleDesignState } = await import('../../core/src/renderer.ts')
    const states = fixture
    assert.equal(assembleDesignState(kit.skills, Object.entries(states).map(([skill, state]) => ({ skill, state }))), '')
  }
  const skill = kit.skills.find(item => item.name === 'questions_fixture')
  assert.ok(skill?.metadata.panelManifest)
  const manifest = skill.metadata.panelManifest
  const validate = validatorFromSchemaYaml(skill.metadata.schemaYaml)
  const exec = promisify(execFile)
  const spawn = async ({ argv, cwd, env }) => {
    try { return { exitCode: 0, ...await exec(argv[0], argv.slice(1), { cwd, env: { ...process.env, ...env } }) } }
    catch (error) { return { exitCode: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' } }
  }
  const git = new GitVersioning(spawn, directory, 'design_files'); await git.ensureRepo()
  const open = () => new DesignFilesStore(fs, new GitVersioning(spawn, directory, 'design_files'), join(directory, 'design_files'))
  const store = open()
  await applyPanelEdit(store, { skill: 'questions_fixture', state: fixture.questions_fixture }, async () => {}, validate)
  await applyPanelEdit(store, { skill: 'neighbor_fixture', state: fixture.neighbor_fixture }, async () => {})
  const neighbor = await readFile(join(directory, 'design_files/neighbor_fixture/neighbor_fixture.json'), 'utf8')
  let draft = structuredClone(fixture.questions_fixture)
  for (const locale of ['zh-CN', 'en-US']) {
    const root = createRoot(document.getElementById('root'))
    let edits = 0
    try {
      await act(async () => root.render(renderManifest(manifest, draft, { locale, editable: true,
        onEdit: edit => { edits++; draft = applyDesignEditToDraft(draft, manifest, edit) } })))
      const card = document.querySelector('[data-question-id="future"]')
      assert.ok(card, `question must be visible in ${locale}`)
      const editButton = card.querySelector('[data-testid="standard-question-edit"]')
      if (editButton) await act(async () => editButton.click())
      const input = card.querySelector('textarea')
      assert.ok(input, `question edit mode must have a real answer input in ${locale}`)
      const answer = `Saved fixture answer · ${locale}`
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input, answer)
      await act(async () => input.dispatchEvent(new dom.window.Event('input', { bubbles: true })))
      assert.equal(edits, 1)
      assert.equal(draft.questions.future.answer, answer)
      assert.equal(draft.questions.future.detail, fixture.questions_fixture.questions.future.detail)
      assert.deepEqual(draft.questions.purpose, fixture.questions_fixture.questions.purpose)
      await applyPanelEdit(store, { skill: skill.name, state: draft }, async () => {}, validate)
      const reopened = await open().read(skill.name)
      assert.deepEqual(reopened, draft)
      assert.equal(await readFile(join(directory, 'design_files/neighbor_fixture/neighbor_fixture.json'), 'utf8'), neighbor)
      await act(async () => root.render(renderManifest(manifest, reopened, { locale, editable: false,
        onEdit: () => assert.fail('readonly render must not edit') })))
      assert.ok(document.querySelector('[data-question-id="future"]').textContent.includes(answer))
      for (const control of document.querySelectorAll('input,textarea,select')) assert.ok(control.disabled || control.readOnly)
      const before = await readFile(join(directory, 'design_files/questions_fixture/questions_fixture.json'), 'utf8')
      const head = await store.head()
      const invalid = structuredClone(draft); invalid.questions.future.answer = 42
      await assert.rejects(applyPanelEdit(store, { skill: skill.name, state: invalid }, async () => {}, validate))
      assert.equal(await readFile(join(directory, 'design_files/questions_fixture/questions_fixture.json'), 'utf8'), before)
      assert.equal(await store.head(), head)
    } finally { await act(async () => root.unmount()) }
  }
})
