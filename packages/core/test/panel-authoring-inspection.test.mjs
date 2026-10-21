import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectPanelComponent, exportPanelAuthoringReference } from '../../../.agents/skills/design-bundle-creator/scripts/inspect-panel-component.mjs'
import { COMPONENT_KINDS } from '../src/panel-component-catalog.ts'
import { queryPanelAuthoringReference } from '../src/panel-authoring-reference.ts'

const repo = fileURLToPath(new URL('../../../', import.meta.url))

test('source inspector rejects named flags in positional slots before reading a repository', () => {
  const script = fileURLToPath(new URL('../../../.agents/skills/design-bundle-creator/scripts/inspect-panel-component.mjs', import.meta.url))
  for (const args of [['--name', 'tabs'], [repo, '--name', 'tabs'], [repo, '--docs']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /^Usage: inspect-panel-component\.mjs <repo> <component>/)
    assert.doesNotMatch(result.stderr, /Cannot find module|ERR_MODULE_NOT_FOUND/)
  }
})

test('portable references preserve every catalog entry and focused source contracts without checkout at query time', async () => {
  const material = JSON.parse(JSON.stringify(await exportPanelAuthoringReference(repo)))
  const standard = await readFile(new URL('../../../docs/panel-uiux-standard.md', import.meta.url), 'utf8')
  assert.deepEqual(Object.keys(material.components), COMPONENT_KINDS)
  for (const name of COMPONENT_KINDS) {
    assert.equal(queryPanelAuthoringReference(material, name, 'contract').component, name)
    assert.ok(queryPanelAuthoringReference(material, name, 'docs').documentation.sections.length)
    const shared = queryPanelAuthoringReference(material, name, 'docs').documentation.sharedStandards
    assert.equal(shared.file, 'docs/panel-uiux-standard.md')
    assert.equal(shared.content, standard, 'packaged guide must be the canonical source, not another summary')
    assert.match(shared.authority, /not a component schema/)
    assert.ok(Array.isArray(queryPanelAuthoringReference(material, name, 'examples').examples))
  }
  const focused = queryPanelAuthoringReference(material, 'navigation_workspace', 'contract', 'ComponentNode.navigation_map.edges')
  assert.match(focused.contract.declaration, /new_label\?: string/)
  const overview = queryPanelAuthoringReference(material, 'record_form', 'contract')
  assert.deepEqual(overview.contracts[0].read, { name: 'record_form', reference: 'contract', type: 'ComponentNode' })
  assert.deepEqual(queryPanelAuthoringReference(material, 'record_form', 'docs').documentation.read,
    { name: 'record_form', reference: 'docs' })
  const options = queryPanelAuthoringReference(material, 'record_form', 'contract', 'EditorField.options')
  assert.deepEqual(options.contract.references.find(item => item.name === 'FieldOption').read,
    { name: 'record_form', reference: 'contract', type: 'FieldOption' })
  assert.match(material.hostCallbackContract.declaration, /registerBeforeSave/)
  assert.match(material.hostCallbackContract.authority, /not DSL event handlers/)
  for (const name of ['__proto__', 'constructor', 'unknown']) assert.throws(() => queryPanelAuthoringReference(material, name, 'docs'), /Unknown/)
  assert.throws(() => queryPanelAuthoringReference(material, 'stack', 'contract', 'ComponentNode.constructor'), /Unknown/)
  assert.throws(() => queryPanelAuthoringReference(material, 'stack', 'docs', 'ComponentNode'), /Invalid/)
  assert.throws(() => queryPanelAuthoringReference({ ...material, catalogIdentity: 'old' }, 'stack', 'docs'), /incompatible/)
  const partial = { ...material, components: { ...material.components } }
  delete partial.components.tabs
  assert.throws(() => queryPanelAuthoringReference(partial, 'stack', 'docs'), /incompatible/)
})

test('shared standard preserves complete UTF-8 text through 128 KiB and rejects oversized or misidentified input', async t => {
  const root = await mkdtemp(join(tmpdir(), 'panel-authoring-standard-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
  for (const path of ['packages', 'node_modules']) await symlink(join(repo, path), join(root, path), 'dir')
  await mkdir(join(root, 'docs'))
  await symlink(join(repo, 'docs/dsl-spec.md'), join(root, 'docs/dsl-spec.md'))
  const standardPath = join(root, 'docs/panel-uiux-standard.md')
  const heading = '# Panel UIUX 规范\n'
  const remaining = 128 * 1024 - Buffer.byteLength(heading)
  const exact = heading + '规'.repeat(Math.floor(remaining / 3)) + 'x'.repeat(remaining % 3)
  const inspect = () => inspectPanelComponent(root, 'record_form', undefined, { documentationOnly: true })
  await writeFile(standardPath, exact)
  const shared = (await inspect()).documentation.sharedStandards
  assert.equal(Buffer.byteLength(shared.content), 128 * 1024)
  assert.deepEqual(Buffer.from(shared.content), Buffer.from(exact))
  await writeFile(standardPath, exact + '\n')
  await assert.rejects(inspect(), /heading or exceeds the bounded reference size/)
  await writeFile(standardPath, '# Different document\n')
  await assert.rejects(inspect(), /heading or exceeds the bounded reference size/)
})

test('authoring lookup returns real validated usages without claiming full validation', async () => {
  const result = await inspectPanelComponent(repo, 'question_workspace')
  assert.equal(result.generated, true)
  assert.ok(result.examples.length > 0)
  assert.ok(result.examples.some(example => example.file.includes('/smart_questions/')))
  for (const example of result.examples) {
    assert.equal(example.node.component, 'question_workspace')
    assert.equal(example.validation, 'panel-structure-only')
    assert.match(example.pointer, /^\/ui/)
  }
  assert.match(result.protocolStatus, /not a claim/)
})

test('on-demand type information comes directly from current source', async () => {
  const result = await inspectPanelComponent(repo, 'record_workspace', 'EditorField')
  assert.equal(result.generated, false)
  assert.match(result.contract.declaration, /export interface EditorField/)
  assert.match(result.contract.declaration, /item_fields/)
  assert.ok(result.contract.line > 0)
  assert.equal(result.examples, undefined)
})

test('unknown and prototype component/type names fail explicitly', async () => {
  for (const name of ['UnknownButton', '__proto__', 'constructor']) {
    await assert.rejects(inspectPanelComponent(repo, name), /Unknown component/)
  }
  await assert.rejects(inspectPanelComponent(repo, 'stack', 'MadeUpType'), /Unknown local contract type/)
  await assert.rejects(inspectPanelComponent(repo, 'stack', 'ComponentNode.constructor'), /Unknown local contract property/)
  await assert.rejects(inspectPanelComponent(repo, 'stack', 'ComponentNode.navigation_map.missing'), /Unknown local contract property/)
})

test('focused configuration lookup follows real nested properties without unrelated contracts', async () => {
  const result = await inspectPanelComponent(repo, 'navigation_workspace', 'ComponentNode.navigation_map.edges')
  assert.match(result.contract.declaration, /^edges:/)
  assert.match(result.contract.declaration, /new_label\?: string/)
  assert.doesNotMatch(result.contract.declaration, /live_preview|workspace_view/)
  const fields = await inspectPanelComponent(repo, 'record_form', 'EditorField.options')
  assert.ok(fields.contract.references.some(reference => reference.name === 'FieldOption'))
  assert.equal(result.examples, undefined)
})
