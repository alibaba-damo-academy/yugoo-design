/** Real source-loader validation; no installed Host, UI or connection claim. */
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
const { skill, resources } = await loadDesignBundle(fs, {
  rootDir: fileURLToPath(new URL('../bundles/integration_design/', import.meta.url)),
  sourceId: 'integration-draft-validation',
})
const completeRecord = {
  id: 'read-material', title: 'Read material title',
  description: 'Read the title from the selected external material.',
  url: 'https://example.org/documentation',
  prompt_content: 'When the user selects material, read its title and return it.',
}
const state = record => ({
  schema_version: 8,
  integrations: { 'read-material': record },
  integration_order: ['read-material'],
})
const issues = (value, scope) => validateSkillDesign(skill, value, { scopes: [scope] })

test('the shipped unknown-URL preview can complete its design without claiming a working connection', async () => {
  const draft = JSON.parse(resources['reference/preview.json'])
  const original = JSON.stringify(draft)
  assert.deepEqual(await issues(draft, 'state'), [])
  assert.deepEqual(await issues(draft, 'completion'), [])
  assert.equal(JSON.stringify(draft), original, 'validation preserves unfinished user content')
})

test('records still require their meaningful capability facts at completion', async () => {
  for (const field of ['title', 'description', 'prompt_content']) {
    const draft = state({ ...completeRecord, [field]: '' })
    assert.deepEqual(await issues(draft, 'state'), [], field)
    assert.ok((await issues(draft, 'completion')).some(issue =>
      issue.code === 'integration_design.incomplete' && issue.message.includes(`\`${field}\``)), field)
  }
})

test('a product with no selected external integration can complete without inventing a record', async () => {
  const empty = { schema_version: 8, integrations: {}, integration_order: [] }
  for (const scope of ['state', 'completion']) assert.deepEqual(await issues(empty, scope), [])
  assert.deepEqual(empty, { schema_version: 8, integrations: {}, integration_order: [] })
})

test('unknown URLs may be omitted or empty while existing uncertainty and user content survive', async () => {
  for (const url of [undefined, '']) {
    const record = { ...completeRecord, business_rules: 'Provider and authentication are not selected; do not invoke this connection.' }
    if (url === undefined) delete record.url
    else record.url = url
    const design = state(record)
    const original = JSON.stringify(design)
    for (const scope of ['state', 'completion']) assert.deepEqual(await issues(design, scope), [])
    assert.equal(JSON.stringify(design), original)
  }
})

test('saving unfinished content still rejects malformed shapes, IDs and orders', async () => {
  assert.ok((await issues(state({ ...completeRecord, url: 42 }), 'state'))
    .some(issue => issue.code === 'schema_violation'))
  assert.ok((await issues(state({ ...completeRecord, id: 'different' }), 'state'))
    .some(issue => issue.code === 'integration_design.invalid_id'))
  for (const integration_order of [[], ['unknown'], ['read-material', 'read-material']]) {
    for (const scope of ['state', 'completion']) {
      assert.ok((await issues({ ...state(completeRecord), integration_order }, scope))
        .some(issue => issue.code === 'integration_design.invalid_order'))
    }
  }
})

test('a complete synthetic connection passes with optional notes absent or empty', async () => {
  for (const note of [undefined, '', 'Keep existing user notes.']) {
    const record = { ...completeRecord, ...(note === undefined ? {} : { business_rules: note }) }
    assert.deepEqual(await issues(state(record), 'state'), [])
    assert.deepEqual(await issues(state(record), 'completion'), [])
  }
  assert.ok((await issues(state({ ...completeRecord, business_rules: 42 }), 'state'))
    .some(issue => issue.code === 'schema_violation'))
})
