import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { inspectTextGeometry } from '../bundles/whiteboard/scripts/text-geometry.mjs'
import { validateScene } from '../bundles/whiteboard/scripts/scene.mjs'

const text = (changes = {}) => ({
  id: 'label', type: 'text', text: 'First\nSecond', originalText: 'First\nSecond',
  x: 10, y: 10, width: 80, height: 40, angle: 0,
  fontSize: 16, lineHeight: 1.25, containerId: 'box', ...changes,
})
const rectangle = (changes = {}) => ({
  id: 'box', type: 'rectangle', x: 0, y: 0, width: 100, height: 60,
  angle: 0, boundElements: [{ type: 'text', id: 'label' }], ...changes,
})
const scene = (label = text(), container = rectangle()) => ({
  elements: [container, label], appState: { viewBackgroundColor: '#ffffff' }, files: {},
})

test('explicit multi-line underflow is diagnosed without changing valid native geometry', () => {
  const value = scene(text({ text: '原话\n退回原因\n补充内容', height: 40 }))
  const before = structuredClone(value)
  assert.equal(validateScene(value), value)
  assert.deepEqual(inspectTextGeometry(value), [{
    code: 'text_line_height', elementId: 'label',
    message: 'Declared text height is below the explicit line-height minimum; reflow or resize and inspect rendering.',
    actualHeight: 40, minimumHeight: 60,
  }])
  assert.deepEqual(value, before, 'diagnostics never resize or rewrite user content')
  assert.deepEqual(inspectTextGeometry(scene()), [])
})

test('line endings, blank lines and rounding use explicit local line metrics', () => {
  for (const content of ['First\r\n\r\nThird', 'First\n\nThird', 'First\r\rThird']) {
    const warnings = inspectTextGeometry(scene(text({ text: content, height: 40 })))
    assert.equal(warnings[0].minimumHeight, 60)
  }
  assert.deepEqual(inspectTextGeometry(scene(text({ height: 39.5 }))), [])
  assert.deepEqual(inspectTextGeometry(scene(text({ text: '', height: 0 }))), [])
  assert.deepEqual(inspectTextGeometry(scene(text({ text: 'A very long unbroken line', height: 20 }))), [],
    'no character-count wrapping or font-width estimate')
})

test('only an explicitly bound unrotated rectangle is checked for containment', () => {
  const outside = text({ x: 30, width: 80 })
  assert.deepEqual(inspectTextGeometry(scene(outside)).map(x => x.code), ['text_container_bounds'])
  for (const container of [rectangle({ type: 'ellipse' }), rectangle({ type: 'diamond' }),
    rectangle({ angle: Math.PI / 6 }), rectangle({ angle: undefined }), rectangle({ isDeleted: true })]) {
    assert.deepEqual(inspectTextGeometry(scene(outside, container)), [])
  }
  assert.deepEqual(inspectTextGeometry(scene(text({ ...outside, containerId: null }))), [])
  assert.deepEqual(inspectTextGeometry(scene(text({ ...outside, angle: Math.PI / 6 }))), [])
  assert.deepEqual(inspectTextGeometry(scene(text({ x: 21, width: 80 }))), [], 'one-unit boundary tolerance')
  assert.deepEqual(inspectTextGeometry(scene(text({ x: 0, y: 0, width: 100, height: 60 }))), [],
    'no mandatory aesthetic padding')
})

test('rotation preserves local-height reasoning; missing metrics and deleted text are not guessed', () => {
  const rotated = scene(text({ height: 10, angle: Math.PI / 4 }))
  assert.deepEqual(inspectTextGeometry(rotated).map(x => x.code), ['text_line_height'])
  for (const changes of [{ fontSize: undefined }, { lineHeight: undefined }, { fontSize: 0 }, { lineHeight: NaN }, { isDeleted: true }]) {
    assert.deepEqual(inspectTextGeometry(scene(text({ height: 10, ...changes }))), [])
  }
})

test('CLI warnings stay non-blocking, preserve bytes and retain real structural errors', async t => {
  const root = await mkdtemp(join(tmpdir(), 'yugoo-whiteboard-geometry-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const board = join(root, 'whiteboard/boards/idea.json')
  await mkdir(dirname(board), { recursive: true })
  await writeFile(join(root, 'whiteboard/whiteboard.json'), JSON.stringify({
    boards: { idea: { id: 'idea', title: 'Synthetic drawing', artifact_file: 'whiteboard/boards/idea.json' } },
    board_order: ['idea'],
  }))
  const invoke = () => {
    const result = spawnSync(process.execPath, [new URL('../bundles/whiteboard/scripts/validate.mjs', import.meta.url).pathname, root], { encoding: 'utf8' })
    assert.equal(result.error, undefined)
    assert.equal(result.stderr, '')
    return { status: result.status, output: JSON.parse(result.stdout) }
  }
  const bytes = JSON.stringify(scene(text({ height: 10 })))
  await writeFile(board, bytes)
  const result = invoke()
  assert.equal(result.status, 0)
  assert.equal(result.output.valid, true)
  assert.equal(result.output.geometryWarnings[0].boardId, 'idea')
  assert.equal(result.output.geometryWarnings[0].code, 'text_line_height')
  assert.equal(await readFile(board, 'utf8'), bytes)
  await writeFile(board, JSON.stringify(scene()))
  assert.deepEqual(invoke(), { status: 0, output: { valid: true, boards: 1 } })
  await writeFile(board, JSON.stringify(scene(text({ containerId: 'missing' }))))
  const invalid = invoke()
  assert.equal(invalid.status, 1)
  assert.equal(invalid.output.valid, false)
  assert.match(invalid.output.error, /Dangling binding/)
})
