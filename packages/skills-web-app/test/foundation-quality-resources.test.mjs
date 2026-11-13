/** Source-loader and domain-example checks; no Host, model or Panel UI claim. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { register } from 'tsx/esm/api'

register()
const { loadDesignBundle } = await import('../../core/src/kit-loader.ts')
const { validateSkillDesign } = await import('../../core/src/validate-design.ts')
const fs = {
  readText: async path => {
    try { return await readFile(path, 'utf8') }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
  },
  listDir: readdir,
  isDirectory: async path => (await stat(path)).isDirectory(),
  realPath: realpath,
}
const load = name => loadDesignBundle(fs, {
  rootDir: fileURLToPath(new URL(`../bundles/${name}/`, import.meta.url)),
  sourceId: `foundation-quality-${name}`,
})
const { skill, resources } = await load('business_data')
const issues = (state, scope) => validateSkillDesign(skill, state, { scopes: [scope] })

for (const name of ['example', 'preview']) {
  test(`${name}: one paper has several notes, one note has exactly one paper`, async () => {
    const state = JSON.parse(resources[`reference/${name}.json`])
    const before = structuredClone(state)
    assert.deepEqual(await issues(state, 'state'), [])
    assert.deepEqual(await issues(state, 'completion'), [])
    const relation = state.relations['REL-003']
    assert.equal(relation.source, 'BO-003')
    assert.equal(relation.target, 'BO-004')
    assert.equal(relation.source_count, '1', 'papers per note')
    assert.equal(relation.target_count, '0..*', 'notes per paper')
    assert.equal(state.relations['REL-002'].source_count, '0..*')
    assert.equal(state.relations['REL-002'].target_count, '0..*')
    assert.equal(state.relations['REL-001'].kind, 'generalization')
    assert.deepEqual(state, before, 'loading/validation does not convert or rewrite data')
  })
}

test('unknown quantities stay valid and invalid endpoints are still rejected', async () => {
  const value = JSON.parse(resources['reference/example.json'])
  delete value.relations['REL-003'].source_count
  delete value.relations['REL-003'].target_count
  assert.deepEqual(await issues(value, 'state'), [])
  assert.deepEqual(await issues(value, 'completion'), [])
  value.relations['REL-003'].target = 'not-present'
  assert.ok((await issues(value, 'state')).some(x => x.code === 'business_data.relation_target'))
})

test('both entry resources reach the same contract example through the real loader', () => {
  assert.match(skill.content, /\]\(reference\/artifact-contract\.md\)/)
  assert.ok(resources['reference/artifact-contract.md'])
  assert.ok(resources['reference/example.json'])
  assert.ok(resources['reference/preview.json'])
  assert.ok(resources['reference/canvas-guide.md'])
  assert.match(resources['reference/artifact-contract.md'], /\]\(example\.json\)/)
})

test('whiteboard loaded method and reconstruction contract reach the CLI helper and geometry guide', async () => {
  const { skill, resources } = await load('whiteboard')
  assert.match(skill.content, /\]\(reference\/artifact-contract\.md\)/)
  assert.ok(resources['reference/artifact-contract.md'])
  assert.ok(resources['reference/geometry.md'])
  assert.ok(resources['scripts/validate.mjs'])
  assert.ok(resources['scripts/text-geometry.mjs'])
  const index = { boards: { idea: { id: 'idea', title: 'Synthetic idea',
    artifact_file: 'whiteboard/boards/idea.json' } }, board_order: ['idea'] }
  const scene = JSON.stringify({ elements: [{ id: 'label', type: 'text', text: 'Synthetic idea',
    x: 0, y: 0, width: 100, height: 20, fontSize: 16, lineHeight: 1.25 }],
  appState: { viewBackgroundColor: '#ffffff' }, files: {} })
  assert.deepEqual(await validateSkillDesign(skill, index, { scopes: ['state', 'completion'],
    artifactText: async path => path === 'whiteboard/boards/idea.json' ? scene : undefined }), [])
  assert.ok((await validateSkillDesign(skill, index, { scopes: ['state'],
    artifactText: async () => undefined })).some(x => x.code === 'whiteboard.missing_scene'))
})

test('notification loaded resources and representative draft preserve the existing shape', async () => {
  const { skill, resources } = await load('notification_design')
  assert.match(skill.content, /\]\(reference\/artifact-contract\.md\)/)
  assert.ok(resources['reference/artifact-contract.md'])
  const sample = JSON.parse(resources['reference/preview.json'])
  assert.deepEqual(await validateSkillDesign(skill, sample, { scopes: ['state', 'completion'] }), [])
})
