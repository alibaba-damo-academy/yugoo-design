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
import { PANEL_KINDS, SIDEBAR_ICONS, CONTROL_KINDS, ROW_COLUMN_CONTROLS } from '../src/panel-dsl.ts'

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
  const source = await readFile(join(repo, 'packages/core/src/panel-dsl.ts'), 'utf8')
  for (const [alias, constant, values] of [
    ['PanelKind', 'PANEL_KINDS', PANEL_KINDS],
    ['SidebarIcon', 'SIDEBAR_ICONS', SIDEBAR_ICONS],
    ['ControlKind', 'CONTROL_KINDS', CONTROL_KINDS],
    ['RowColumnControl', 'ROW_COLUMN_CONTROLS', ROW_COLUMN_CONTROLS],
  ]) {
    const reference = queryPanelAuthoringReference(material, 'record_workspace', 'contract', alias)
      .contract.references.find(item => item.name === constant)
    assert.ok(reference, `${alias} must expose its typeof dependency`)
    assert.deepEqual(reference.read, { name: 'record_workspace', reference: 'contract', type: constant })
    const { contract } = queryPanelAuthoringReference(material,
      reference.read.name, reference.read.reference, reference.read.type)
    assert.equal(contract.file, 'packages/core/src/panel-dsl.ts')
    assert.ok(source.includes(`export const ${contract.declaration}`), 'preserve the source initializer verbatim')
    assert.equal(contract.line, source.slice(0, source.indexOf(`export const ${contract.declaration}`)).split('\n').length)
    assert.match(contract.declaration, /as const$/)
    for (const value of values) assert.ok(contract.declaration.includes(`'${value}'`))
    assert.deepEqual(contract.references, [])
  }
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

async function contractFixture(t, source) {
  const root = await mkdtemp(join(tmpdir(), 'panel-authoring-typeof-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
  await symlink(join(repo, 'node_modules'), join(root, 'node_modules'), 'dir')
  await mkdir(join(root, 'packages/core/src'), { recursive: true })
  await symlink(join(repo, 'packages/core/src/panel-component-catalog.ts'),
    join(root, 'packages/core/src/panel-component-catalog.ts'))
  await writeFile(join(root, 'packages/core/src/panel-dsl.ts'), source)
  return type => inspectPanelComponent(root, 'record_workspace', type)
}

test('typeof closure retains cyclic source dependencies without evaluating initializers or exposing unrelated constants', async t => {
  const first = `FIRST: typeof SECOND = (() => { throw new Error('initializer must not run') })()`
  const second = `SECOND: typeof FIRST = ['second'] as const`
  const inspect = await contractFixture(t, `
const ${first}, UNRELATED = ['private implementation'] as const
const ${second}
type Choice = (typeof FIRST)[number]
`)
  assert.deepEqual((await inspect('Choice')).contract.references, [{ name: 'FIRST', read: '--type FIRST' }])
  const a = (await inspect('FIRST')).contract
  assert.equal(a.declaration, first)
  assert.deepEqual(a.references, [{ name: 'SECOND', read: '--type SECOND' }])
  const b = (await inspect('SECOND')).contract
  assert.equal(b.declaration, second)
  assert.deepEqual(b.references, [{ name: 'FIRST', read: '--type FIRST' }])
  await assert.rejects(inspect('UNRELATED'), /Unknown local contract type/)
})

test('typeof closure rejects unresolved, non-constant, qualified and ambiguous references explicitly', async t => {
  for (const [source, error] of [
    ['type Choice = typeof MISSING', /Unknown local typeof contract constant: MISSING/],
    ['let MUTABLE = 1; type Choice = typeof MUTABLE', /Unknown local typeof contract constant: MUTABLE/],
    ['type Choice = typeof constructor', /Unknown local typeof contract constant: constructor/],
    ['const SOURCE = {}; type Choice = typeof SOURCE.value', /Unsupported local typeof contract reference: SOURCE.value/],
    ['const SAME = 1; type SAME = string; type Choice = typeof SAME', /Ambiguous local typeof contract name: SAME/],
  ]) {
    const inspect = await contractFixture(t, source)
    await assert.rejects(inspect('Choice'), error)
  }
})
