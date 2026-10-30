import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { STUDIO_AUTHORING_DIRECTORY, STUDIO_AUTHORING_RESOURCE, STUDIO_CREATOR_SKILLS,
  prepareStudioAuthoringMaterial, studioAuthoringInputPaths, writeStudioAuthoringMaterial,
  verifyStudioAuthoringMaterial } from './studio-authoring-material.mjs'

const workspace = fileURLToPath(new URL('../', import.meta.url))
const hash = value => createHash('sha256').update(value).digest('hex')
const prepared = await prepareStudioAuthoringMaterial(workspace)
async function temporary(t) { const path = await mkdtemp(join(tmpdir(), 'studio-author-methods-')); t.after(() => rm(path, { recursive: true, force: true })); return path }
const external = path => /^[a-z][a-z0-9+.-]*:/iu.test(path)

test('native Skills and professional references remain readable after relocation, with source retention hashes', async t => {
  const root = await temporary(t), original = join(root, 'package'), relocated = join(root, 'relocated package')
  await writeStudioAuthoringMaterial(original, prepared)
  await rename(original, relocated)
  await verifyStudioAuthoringMaterial(relocated, prepared)
  const material = JSON.parse(await readFile(join(relocated, STUDIO_AUTHORING_RESOURCE), 'utf8'))
  assert.deepEqual(material.skills.map(skill => skill.name), STUDIO_CREATOR_SKILLS)
  assert.deepEqual(material.retention.protocolRelocations, [])
  for (const skill of material.skills) {
    const entry = await readFile(join(relocated, 'skills', skill.name, 'SKILL.md'), 'utf8')
    assert.match(entry, /professional method/)
    assert.match(entry, /method being edited is source evidence/)
    const method = material.resources[skill.method]
    assert.equal(method.sourceSha256, hash(await readFile(join(workspace, method.sourcePath))))
    assert.equal(await readFile(join(relocated, STUDIO_AUTHORING_DIRECTORY, skill.method), 'utf8'), method.content)
  }
  for (const [path, resource] of Object.entries(material.resources)) {
    assert.equal(Buffer.byteLength(resource.content), resource.bytes)
    if (resource.sourcePath) assert.equal(resource.sourceSha256, hash(await readFile(join(workspace, resource.sourcePath))))
    if (!path.endsWith('.md')) continue
    for (const [, value] of resource.content.matchAll(/\]\(([^)\n]+)\)/gu)) {
      const link = value.split('#')[0]
      if (!link || external(link)) continue
      const target = resolve(relocated, STUDIO_AUTHORING_DIRECTORY, dirname(path), link)
      assert.ok(target.startsWith(join(relocated, STUDIO_AUTHORING_DIRECTORY) + '/'))
      assert.ok((await readFile(target)).length, path + ' -> ' + link)
    }
  }
  const standards = material.resources['source/.agents/skills/design-skill-creator/references/standards.md'].content
  assert.match(standards, /专业方法/)
  assert.match(standards, /还原/)
  for (const bundle of ['smart_questions', 'function_modules', 'business_data', 'research', 'page_design', 'flow_design', 'whiteboard', 'design_style']) {
    for (const path of ['SKILL.md', 'reference/artifact-contract.md']) assert.ok(material.resources['source/packages/skills-web-app/bundles/' + bundle + '/' + path])
  }
  assert.ok(material.resources['source/.agents/skills/design-bundle-creator/assets/skill.template.yaml'])
  assert.ok(material.resources['source/.agents/skills/design-skill-creator/assets/method-template.md'])
})

test('each native overlay receives the same bounded capsule and rejects overwrites, tampering and output symlinks', async t => {
  const root = await temporary(t)
  for (const host of ['codex', 'codex-desktop', 'claude-code', 'qoder']) {
    const target = join(root, host)
    await writeStudioAuthoringMaterial(target, prepared)
    assert.deepEqual(await readFile(join(target, STUDIO_AUTHORING_RESOURCE)), prepared.bytes)
    await verifyStudioAuthoringMaterial(target, prepared)
    await assert.rejects(writeStudioAuthoringMaterial(target, prepared), { code: 'EEXIST' })
  }
  const changed = join(root, 'codex', STUDIO_AUTHORING_DIRECTORY, 'index.md')
  await writeFile(changed, 'modified')
  await assert.rejects(verifyStudioAuthoringMaterial(join(root, 'codex'), prepared), /differs/)
  const output = join(root, 'unsafe'), elsewhere = join(root, 'elsewhere')
  await mkdir(output); await mkdir(elsewhere)
  await symlink(elsewhere, join(output, 'authoring'), 'dir')
  await assert.rejects(writeStudioAuthoringMaterial(output, prepared), /symlink/)
})

test('a missing mandatory method/validation guide or a symlinked method fails instead of using developer-global skills', async t => {
  const root = await temporary(t), source = join(root, 'source')
  for (const path of await studioAuthoringInputPaths(workspace)) {
    await mkdir(dirname(join(source, path)), { recursive: true }); await cp(join(workspace, path), join(source, path))
  }
  const method = join(source, '.agents/skills/design-kit-creator/SKILL.md')
  await rm(method)
  await assert.rejects(prepareStudioAuthoringMaterial(source), /ENOENT/)
  await symlink(join(workspace, '.agents/skills/design-kit-creator/SKILL.md'), method)
  await assert.rejects(prepareStudioAuthoringMaterial(source), /symlink|regular/)
  await rm(method); await cp(join(workspace, '.agents/skills/design-kit-creator/SKILL.md'), method)
  await rm(join(source, '.agents/skills/design-bundle-creator/references/validation-authoring.md'))
  await assert.rejects(prepareStudioAuthoringMaterial(source), /ENOENT/)
})

test('installed validation guidance retains complete mature definitions and synthetic example bytes', async () => {
  const guide = prepared.material.resources['source/.agents/skills/design-bundle-creator/references/validation-authoring.md']
  assert.ok(guide)
  assert.match(prepared.material.resources['index.md'].content, /validation-authoring\.md/)
  assert.match(prepared.material.resources['source/.agents/skills/design-bundle-creator/references/bundle-checklist.md'].content, /validation-authoring\.md/)
  for (const entry of Object.values(prepared.skillEntries)) {
    assert.match(entry, /validation-authoring\.md/)
    assert.match(entry, /both title and label/)
  }
  for (const name of ['smart_questions', 'function_modules', 'business_data', 'research', 'page_design',
    'flow_design', 'whiteboard', 'design_style', 'role_access', 'web_app_prd_assembly']) {
    for (const slot of ['schema.yaml', 'validation.yaml']) {
      const path = `packages/skills-web-app/bundles/${name}/${slot}`
      assert.equal(prepared.material.resources['source/' + path].content, await readFile(join(workspace, path), 'utf8'), path)
    }
  }
  for (const name of ['function_modules', 'business_data']) {
    const path = `packages/skills-web-app/bundles/${name}/reference/preview.json`
    assert.equal(prepared.material.resources['source/' + path].content, await readFile(join(workspace, path), 'utf8'))
  }
})

test('the guide complete rules execute in actual Core: valid state, unfinished completion and broken reference', async () => {
  // Core implementation is unchanged; consume its normal built API, not a mock rule interpreter.
  const { parseValidationYaml, evaluateValidationRules } = await import('../packages/core/lib/index.js')
  const guide = prepared.material.resources['source/.agents/skills/design-bundle-creator/references/validation-authoring.md'].content
  const yaml = guide.match(/```yaml\n([\s\S]+?)\n```/u)[1]
  const [valid, unfinished, broken] = [...guide.matchAll(/```json\n([\s\S]+?)\n```/gu)].map(match => JSON.parse(match[1]))
  const doc = parseValidationYaml(yaml)
  const check = (state, scope) => evaluateValidationRules(doc, { skill: doc.skill, state }, scope)
  assert.deepEqual(await check(valid, 'state'), [])
  assert.deepEqual(await check(valid, 'completion'), [])
  assert.deepEqual(await check(unfinished, 'state'), [])
  assert.deepEqual((await check(unfinished, 'completion')).map(issue => issue.code), ['example_notes.empty_text'])
  assert.deepEqual((await check(broken, 'state')).map(issue => issue.code), ['example_notes.unknown_role'])
  const reordered = structuredClone(valid); reordered.note_order = ['N1', 'N1']
  assert.deepEqual((await check(reordered, 'state')).map(issue => issue.code), ['example_notes.invalid_order'])
  const mismatch = structuredClone(valid); mismatch.notes.N1.id = 'other'
  assert.deepEqual((await check(mismatch, 'state')).map(issue => issue.code), ['example_notes.id_mismatch'])
})

test('actual Core rejects guessed operators, incomplete metadata and incorrect for-each wrappers', async () => {
  const { parseValidationYaml } = await import('../packages/core/lib/index.js')
  const rule = check => ({ id: 'example', scope: ['state'], code: 'example.invalid', check })
  const parse = rules => parseValidationYaml(JSON.stringify({ skill: 'example_notes', rules }))
  assert.throws(() => parse([]), /rules must not be empty/)
  const missingCode = rule({ non_empty_map: 'notes' }); delete missingCode.code
  assert.throws(() => parse([missingCode]), /code must be a non-empty string/)
  for (const check of [{ all: [{ non_empty_map: 'notes' }] }, { not_empty: 'notes' },
    { op: 'member_of_map', value: 'role_id', map: 'roles' }]) {
    assert.throws(() => parse([rule(check)]), /no supported operator/)
  }
  assert.throws(() => parse([rule({ for_each_in_map: { path: 'notes', rule: { non_empty_string: 'text' } } })]), /state path/)
  assert.throws(() => parse([rule({ for_each_in_map: 'notes', rule: { non_empty_string: 'text' } })]), /unsupported operator/)
  assert.throws(() => parse([rule({ for_each_in_map: 'notes', non_empty_string: 'text', non_empty_list: 'tags' })]), /exactly one leaf/)
  assert.throws(() => parse([{ ...rule({ non_empty_map: 'notes' }), scope: 'state' }]), /scope must contain/)
})

test('mature packaged rules compile in Core and positive/negative states preserve their actual schema and scope semantics', async () => {
  const { parseValidationYaml, evaluateValidationRules, parseSchemaYaml, compileSchema } = await import('../packages/core/lib/index.js')
  const root = name => 'source/packages/skills-web-app/bundles/' + name + '/'
  for (const path of Object.keys(prepared.material.resources).filter(path => path.endsWith('/validation.yaml'))) {
    assert.ok(parseValidationYaml(prepared.material.resources[path].content).rules.length > 0, path)
  }
  for (const name of ['function_modules', 'business_data']) {
    const resource = root(name), state = JSON.parse(prepared.material.resources[resource + 'reference/preview.json'].content)
    assert.deepEqual(compileSchema(parseSchemaYaml(prepared.material.resources[resource + 'schema.yaml'].content))(state), [])
    const doc = parseValidationYaml(prepared.material.resources[resource + 'validation.yaml'].content)
    for (const scope of ['state', 'completion']) assert.deepEqual(await evaluateValidationRules(doc, { skill: name, state }, scope), [])
  }
  const data = root('business_data'), doc = parseValidationYaml(prepared.material.resources[data + 'validation.yaml'].content)
  const state = JSON.parse(prepared.material.resources[data + 'reference/preview.json'].content)
  state.relations['references-paper'].target = 'missing-object'
  assert.ok((await evaluateValidationRules(doc, { skill: doc.skill, state }, 'state')).some(issue => issue.code === 'business_data.relation_target'))
})
