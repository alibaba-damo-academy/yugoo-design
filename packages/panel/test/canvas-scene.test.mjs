import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { emptyCanvasScene, parseCanvasScene, prepareCanvasScene } = await import('../src/canvas-scene.ts')
const { collectTextArtifactEdits } = await import('../src/text-artifact-edit.ts')
const { validateScene } = await import('../../skills-web-app/bundles/whiteboard/scripts/scene.mjs')
const scope = { skill: 'whiteboard', assetsDirectory: 'attachments' }
const rectangle = { id: 'box', type: 'rectangle', x: 10, y: 20, width: 300, height: 100, isDeleted: false }
const image = { ...rectangle, id: 'image', type: 'image', fileId: 'asset', isDeleted: true }
const bytes = { id: 'asset', mimeType: 'image/png', created: 1, dataURL: 'data:image/png;base64,YQ==' }
test('generic scene edits keep the existing Bundle contract, geometry, deleted images and external bytes', () => {
  const prepared = prepareCanvasScene(scope, [rectangle, image], '#fff', {}, { asset: bytes })
  const scene = parseCanvasScene(prepared.content, scope)
  assert.deepEqual(validateScene(scene), scene)
  assert.deepEqual(scene.elements, [rectangle, image])
  assert.equal(scene.files.asset.path, 'whiteboard/attachments/asset.png')
  assert.ok(!prepared.content.includes('dataURL'))
  assert.deepEqual(prepared.assets, [{ path: 'whiteboard/attachments/asset.png', content: 'YQ==', encoding: 'base64' }])
  assert.deepEqual(parseCanvasScene(JSON.stringify(emptyCanvasScene()), scope), emptyCanvasScene())
})
test('component format is owner-neutral; missing image bytes never remove durable references', () => {
  const other = { skill: 'custom_kit_bundle', assetsDirectory: 'images' }
  const one = prepareCanvasScene(other, [image], '#fff', {}, { asset: bytes })
  const scene = parseCanvasScene(one.content, other)
  const two = prepareCanvasScene(other, [image], '#abc', scene.files, {})
  assert.deepEqual(JSON.parse(two.content).files, scene.files)
  assert.deepEqual(two.assets, [])
  assert.throws(() => parseCanvasScene(one.content, scope), /reference/)
  assert.throws(() => prepareCanvasScene(other, [image], '#fff', {}, {}), /Missing/)
})
test('scene validation rejects unknown embedded content, view state and escaping image references', () => {
  for (const scene of [
    { ...emptyCanvasScene(), elements: [{ ...rectangle, type: 'iframe' }] },
    { ...emptyCanvasScene(), appState: { viewBackgroundColor: '#fff', scrollX: 0 } },
    { ...emptyCanvasScene(), elements: [{ ...rectangle, containerId: 'missing' }] },
    { ...emptyCanvasScene(), files: { asset: { id: 'asset', path: '../secret.png', mimeType: 'image/png', created: 1 } } },
  ]) assert.throws(() => parseCanvasScene(JSON.stringify(scene), scope))
})
test('atomic scene transport rejects conflicting, escaping or unreferenced image bytes', () => {
  const prepared = prepareCanvasScene(scope, [image], '#fff', {}, { asset: bytes })
  const state = { scenes: { scene: { file: 'whiteboard/boards/scene.json' }, second: { file: 'whiteboard/attachments/asset.png' } } }
  const edit = { ...prepared, path: state.scenes.scene.file, binding: { recordsPath: 'scenes', record: 'scene', field: 'file' } }
  assert.equal(collectTextArtifactEdits(state, [edit]).length, 2)
  for (const assets of [[{ ...prepared.assets[0], path: 'elsewhere/image.png' }], [{ ...prepared.assets[0], content: 'bad!' }], [{ ...prepared.assets[0], path: 'whiteboard/attachments/unreferenced.png' }]]) {
    assert.throws(() => collectTextArtifactEdits(state, [{ ...edit, assets }]), /image/)
  }
  const collision = { path: state.scenes.second.file, content: 'YQ==', binding: { recordsPath: 'scenes', record: 'second', field: 'file' } }
  assert.throws(() => collectTextArtifactEdits(state, [edit, collision]), /Conflicting/)
  assert.throws(() => collectTextArtifactEdits(state, [collision, edit]), /Conflicting/)
  assert.deepEqual(collectTextArtifactEdits({ scenes: {} }, [edit]), [])
})
