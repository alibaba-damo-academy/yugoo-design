import test from 'node:test'
import assert from 'node:assert/strict'
import { createStudioAuthoringMaterialReader } from '../src/authoring-material.ts'

const method = 'source/.agents/skills/design-bundle-creator/SKILL.md'
const material = (content = '专业方法 / Authoring method') => ({ schemaVersion: 1,
  skills: [{ name: 'design-bundle-creator', description: 'Bundle authoring', method }],
  resources: Object.fromEntries([['index.md', 'Read the complete method.'], [method, content]]
    .map(([path, content]) => [path, { content, bytes: Buffer.byteLength(content) }])),
})

test('indexed creator text paginates within the byte budget without losing UTF-8', () => {
  const text = '中文方法🧭\n'.repeat(10000), read = createStudioAuthoringMaterialReader(material(text))
  const index = read()
  assert.equal(index.resource, 'index.md'); assert.equal(index.skills[0].method, method)
  index.skills[0].method = 'foreign'
  assert.equal(read().skills[0].method, method)
  let offset = 0, recovered = ''
  do {
    const page = read({ resource: method, offset })
    assert.ok(page.bytes <= 16 * 1024); assert.equal(Buffer.byteLength(page.content), page.bytes)
    assert.equal(page.offset, offset); assert.equal(page.totalBytes, Buffer.byteLength(text))
    recovered += page.content
    offset = page.nextOffset
  } while (offset !== undefined)
  assert.equal(recovered, text)
})

test('method reads reject authority, unknown files, mixed selectors and invalid byte offsets', () => {
  const read = createStudioAuthoringMaterialReader(material('中文'))
  for (const resource of ['/etc/passwd', '../SKILL.md', method + '/../SKILL.md', 'missing.md', '__proto__', null]) {
    assert.throws(() => read({ resource }), /Unknown indexed/)
  }
  for (const input of [{ path: method }, { resource: method, root: '/' }, { resource: method, paths: [] },
    { agentId: 'foreign' }, { resource: method, offset: -1 }, { resource: method, offset: 1 },
    { resource: method, offset: 7 }, { offset: null }, { offset: 0.5 }, []]) assert.throws(() => read(input))
  assert.equal(read({ resource: method, offset: 6 }).content, '')
})

test('a missing method, altered byte receipt or oversized capsule cannot become available guidance', () => {
  const missing = material(); delete missing.resources[method]
  assert.throws(() => createStudioAuthoringMaterialReader(missing), /incomplete/)
  const mismatched = material(); mismatched.resources[method].bytes++
  assert.throws(() => createStudioAuthoringMaterialReader(mismatched), /budget/)
  assert.throws(() => createStudioAuthoringMaterialReader(material('x'.repeat(2 * 1024 * 1024 + 1))), /budget/)
  const unsafe = material(); unsafe.resources['../foreign'] = { content: 'x', bytes: 1 }
  assert.throws(() => createStudioAuthoringMaterialReader(unsafe), /Invalid/)
  const many = material()
  for (let i = 0; i < 127; i++) many.resources['extra/' + i] = { content: 'x', bytes: 1 }
  assert.throws(() => createStudioAuthoringMaterialReader(many), /resource budget/)
})

test('actual packaged creator entry reaches validation instructions, exact examples and required manifest fields through indexed reads', async () => {
  const { prepareStudioAuthoringMaterial } = await import('../../../scripts/studio-authoring-material.mjs')
  const { material: actual, skillEntries } = await prepareStudioAuthoringMaterial(new URL('../../../', import.meta.url).pathname)
  const read = createStudioAuthoringMaterialReader(actual)
  function all(resource) {
    let offset = 0, content = ''
    do {
      const page = read({ resource, offset })
      assert.ok(Buffer.byteLength(JSON.stringify(page)) < 32 * 1024, `${resource}: readable tool page must not spill`)
      content += page.content; offset = page.nextOffset
    } while (offset !== undefined)
    return content
  }
  const guide = 'source/.agents/skills/design-bundle-creator/references/validation-authoring.md'
  assert.match(skillEntries['design-bundle-creator'], /validation-authoring\.md/)
  assert.match(all('index.md'), /validation-authoring\.md/)
  assert.match(all(method), /bundle-checklist\.md/)
  assert.match(all('source/.agents/skills/design-bundle-creator/references/bundle-checklist.md'), /validation-authoring\.md/)
  assert.match(all(guide), /skill: example_notes/)
  assert.match(all(guide), /code: example_notes\.unknown_role/)
  assert.match(all(guide), /member_of_map: \{ value: role_id, map: roles \}/)
  const template = all('source/.agents/skills/design-bundle-creator/assets/skill.template.yaml')
  for (const field of ['title', 'label']) assert.match(template, new RegExp(`${field}:\\n  zh: ".+"\\n  en: ".+"`))
  for (const name of ['function_modules', 'business_data', 'page_design']) {
    const resource = `source/packages/skills-web-app/bundles/${name}/validation.yaml`
    assert.equal(all(resource), actual.resources[resource].content)
    assert.ok(all(`source/packages/skills-web-app/bundles/${name}/schema.yaml`).length)
  }
  assert.throws(() => read({ resource: 'source/packages/core/src/validation-rules.ts' }), /Unknown indexed/)
  for (const [resource, entry] of Object.entries(actual.resources)) assert.equal(all(resource), entry.content)
})


test('large component references remain completely readable below the native spill limit', async () => {
  const { readStudioPanelComponents } = await import('../src/authoring-material.ts')
  const { readFile } = await import('node:fs/promises')
  const { queryPanelAuthoringReference } = await import('dsh-design-core/dsl')
  const material = JSON.parse(await readFile(new URL('../lib/authoring/panel-components.json', import.meta.url), 'utf8'))
  for (const reference of ['contract', 'docs', 'examples']) {
    const selectors = { name: 'question_rounds', reference }
    let page = await readStudioPanelComponents(selectors), content = ''
    const expected = queryPanelAuthoringReference(material, selectors.name, reference)
    if (page.format !== 'json') { assert.deepEqual(page, expected); continue }
    do {
      assert.ok(Buffer.byteLength(JSON.stringify(page)) < 32 * 1024, reference + ': tool page must not spill')
      content += page.content
      if (page.nextOffset === undefined) break
      page = await readStudioPanelComponents({ ...selectors, offset: page.nextOffset })
    } while (true)
    assert.deepEqual(JSON.parse(content), expected, 'pagination preserves the whole existing reference')
  }
  await assert.rejects(readStudioPanelComponents({ name: 'question_rounds', reference: 'docs', offset: -1 }), /offset/)
})
