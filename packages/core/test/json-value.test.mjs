import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'
import { snapshotJsonValue, isJsonValue } from '../src/json-value.ts'

const hash = value => createHash('sha256').update(value).digest('hex')
const jsonNames = new Set(['JsonValue', 'snapshotJsonValue', 'isJsonValue'])
function assertPrivateJsonImports(code, file) {
  const tree = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true)
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
    if (!['@deepseek-ai/dsh-session', '@deepseek-ai/dsh-util-values'].includes(statement.moduleSpecifier?.text)) continue
    if (ts.isImportDeclaration(statement)) assert.ok(!statement.importClause?.name, `${file}: host default dependency`)
    const bindings = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : statement.exportClause
    // A namespace or star export can silently restore the host dependency.
    assert.ok(bindings && !ts.isNamespaceImport(bindings) && !ts.isNamespaceExport(bindings), `${file}: host namespace/star dependency`)
    for (const element of bindings.elements) {
      assert.ok(!jsonNames.has((element.propertyName ?? element.name).text), `${file}: host JSON dependency`)
    }
  }
}
test('private JSON utility retains pinned upstream body and MIT text, packaged with attribution', async () => {
  const source = await readFile(new URL('../src/json-value.ts', import.meta.url), 'utf8')
  assert.deepEqual(source.split('\n').slice(0, 2), [
    '// MIT-licensed upstream utility; see ../third-party/dsh-json/README.md.',
    '// Source body retained verbatim from DeepSeek commit cd5ef8148158c3a752a658978873241fdf8e2bbc.',
  ])
  const body = source.split('\n').slice(2).join('\n')
  assert.equal(hash(body), 'cbb271dadd2f476a4d19a2b22ac606db6887ed70367b86d6c13ddf1d102d36ba')
  assert.equal(hash(await readFile(new URL('../third-party/dsh-json/LICENSE', import.meta.url))), 'ebb4f09972aee8608be255debaf78451a68e95c290f55c240dec2ecfa16ea6be')
  const attribution = await readFile(new URL('../third-party/dsh-json/README.md', import.meta.url), 'utf8')
  assert.match(attribution, /cd5ef8148158c3a752a658978873241fdf8e2bbc/)
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(manifest.files.includes('third-party/dsh-json/**'))
  assert.match(await readFile(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8'), /Pinned DSH JSON value utility.*Core package `third-party\/dsh-json\/LICENSE`/)
  for (const file of ['design-files', 'dsh-design-execution-plugin', 'dsh-producer-design-tools', 'runtime-drivers']) {
    const code = await readFile(new URL(`../src/${file}.ts`, import.meta.url), 'utf8')
    const tree = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true)
    const expected = file === 'dsh-design-execution-plugin' ? ['JsonValue', 'snapshotJsonValue'] : file === 'design-files' ? ['snapshotJsonValue'] : ['JsonValue']
    const imports = tree.statements.filter(ts.isImportDeclaration).filter(statement => statement.moduleSpecifier.text === './json-value.ts')
    assert.equal(imports.length, 1)
    assert.deepEqual(imports[0].importClause.namedBindings.elements.map(element => (element.propertyName ?? element.name).text).sort(), expected.sort())
  }
  const root = new URL('../src/', import.meta.url)
  for (const file of await readdir(root, { recursive: true })) {
    if (file.endsWith('.ts')) assertPrivateJsonImports(await readFile(new URL(file, root), 'utf8'), file)
  }
})

test('host JSON import guard rejects multiline, aliases, namespace and re-export regressions', () => {
  for (const code of [
    "import {\n snapshotJsonValue as snapshot\n} from '@deepseek-ai/dsh-session'",
    "import * as session from '@deepseek-ai/dsh-session'; session.snapshotJsonValue(value)",
    "export { JsonValue as PublicValue } from '@deepseek-ai/dsh-session'",
    "export * from '@deepseek-ai/dsh-session'",
    "export * as session from '@deepseek-ai/dsh-session'",
    "import session from '@deepseek-ai/dsh-session'",
    "import type { JsonValue } from '@deepseek-ai/dsh-util-values'",
  ]) assert.throws(() => assertPrivateJsonImports(code, 'fixture.ts'))
  assert.doesNotThrow(() => assertPrivateJsonImports("import { Session } from '@deepseek-ai/dsh-session'", 'fixture.ts'))
})

test('JSON snapshots detach frozen input and preserve repeated but acyclic references', () => {
  const shared = Object.freeze({ value: 'shared' })
  const value = Object.freeze({ left: shared, right: shared, list: Object.freeze([null, true, 1, 'text']) })
  const snapshot = snapshotJsonValue(value)
  assert.deepEqual(snapshot, value)
  assert.notEqual(snapshot, value); assert.notEqual(snapshot.left, shared); assert.notEqual(snapshot.left, snapshot.right)
  snapshot.left.value = 'changed'
  assert.equal(shared.value, 'shared'); assert.equal(snapshot.right.value, 'shared')
  assert.equal(isJsonValue(value), true)
})

test('lossy values are rejected rather than silently coerced by JSON stringify', () => {
  const cycle = {}; cycle.self = cycle
  const sparse = []; sparse.length = 1
  const extraArray = [1]; extraArray.note = 'discarded'
  const hidden = {}; Object.defineProperty(hidden, 'hidden', { value: 1 })
  const symbol = {}; symbol[Symbol('hidden')] = 1
  class Exotic { value = 1 }
  for (const value of [undefined, -0, NaN, Infinity, 1n, () => {}, cycle, sparse, extraArray, hidden, symbol, new Date(), new Exotic(), { value: undefined }, { toJSON() { return 'hidden' } }]) {
    assert.equal(snapshotJsonValue(value), undefined)
    assert.equal(isJsonValue(value), false)
  }
})

test('null-prototype and cross-realm JSON preserve own prototype-named keys', () => {
  const source = Object.create(null)
  source.__proto__ = { actual: true }; source.constructor = 'content'
  const snapshot = snapshotJsonValue(source)
  assert.equal(Object.getPrototypeOf(snapshot), Object.prototype)
  assert.equal(Object.hasOwn(snapshot, '__proto__'), true)
  assert.deepEqual(snapshot.__proto__, { actual: true })
  assert.equal(snapshot.constructor, 'content')
  assert.deepEqual(JSON.parse(JSON.stringify(snapshotJsonValue(runInNewContext('({ array: [1, "text"], flag: true })')))), { array: [1, 'text'], flag: true })
})

test('snapshot reads each getter once and preserves getter exceptions', () => {
  let reads = 0
  const source = { get value() { return ++reads === 1 ? 'first' : undefined } }
  assert.deepEqual(snapshotJsonValue(source), { value: 'first' }); assert.equal(reads, 1)
  const error = new Error('fixture getter failure')
  assert.throws(() => snapshotJsonValue({ get value() { throw error } }), thrown => thrown === error)
})

test('valid deeply nested data does not depend on the JavaScript call stack', () => {
  let value = 'leaf'
  for (let index = 0; index < 10000; index++) value = { child: value }
  assert.equal(isJsonValue(value), true)
  let snapshot = snapshotJsonValue(value)
  assert.notEqual(snapshot, value)
  for (let index = 0; index < 10000; index++) snapshot = snapshot.child
  assert.equal(snapshot, 'leaf')
})
