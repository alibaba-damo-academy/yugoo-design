import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api')
register()
const { prepareWhiteboardPanelSave, loadWhiteboardImages } = await import('./src/client/panels/whiteboard-scene.ts')

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII='
const draft = {
  elements: [
    { id: 'title', type: 'text', x: 30, y: 40, text: '用户修改后的标题', boundElements: [{ id: 'arrow', type: 'arrow' }] },
    { id: 'arrow', type: 'arrow', x: 40, y: 80, points: [[0, 0], [100, 0]], startBinding: { elementId: 'title', focus: 0, gap: 8 } },
    { id: 'image', type: 'image', x: 180, y: 60, fileId: 'photo_1' },
  ],
  appState: { viewBackgroundColor: '#ffffff', selectedElementIds: { title: true } },
  files: {},
  pendingFiles: { photo_1: { id: 'photo_1', mimeType: 'image/png', created: 1, dataURL: `data:image/png;base64,${png}` } },
}
const untouched = structuredClone(draft)
const first = prepareWhiteboardPanelSave(draft)
assert.deepEqual(draft, untouched, 'preparing or retrying save must not mutate the dirty draft')
assert.equal(JSON.stringify(first.state).includes('base64'), false)
assert.deepEqual(first.state.appState, { viewBackgroundColor: '#ffffff' })
assert.equal(first.artifacts[0].content, png)
const disk = new Map(first.artifacts.map((artifact) => [artifact.path, artifact.content]))
// Simulate persistence and an Agent editing one unrelated element in canonical JSON.
const next = JSON.parse(JSON.stringify(first.state))
next.elements[1].strokeColor = '#ff0000'
const second = prepareWhiteboardPanelSave(next)
assert.equal(second.artifacts, undefined, 're-saving existing images does not need browser bytes')
assert.deepEqual(second.state.elements[0], first.state.elements[0])
assert.deepEqual(second.state.elements[2], first.state.elements[2])
assert.deepEqual(second.state.elements[1].startBinding, first.state.elements[1].startBinding)
const loaded = await loadWhiteboardImages(second.state, async (path) => ({ found: disk.has(path), mediaType: 'image/png', base64: disk.get(path) }))
assert.deepEqual(loaded.missing, [])
assert.equal(loaded.files[0].dataURL, draft.pendingFiles.photo_1.dataURL)
const missing = await loadWhiteboardImages(second.state, async () => { throw new Error('network unavailable') })
assert.deepEqual(missing.missing, ['photo_1'])
assert.deepEqual(prepareWhiteboardPanelSave(second.state).state.files, first.state.files, 'failed hydration cannot discard references')
const deleted = structuredClone(next)
deleted.elements[2].isDeleted = true
assert.deepEqual(prepareWhiteboardPanelSave(deleted).state.files, first.state.files, 'undo-restorable deleted elements retain images')
assert.throws(() => prepareWhiteboardPanelSave({ ...draft, pendingFiles: {} }), /缺少有效附件引用/u)
assert.deepEqual(draft, untouched, 'failed save keeps unsaved content')
assert.throws(() => prepareWhiteboardPanelSave({ ...next, files: { photo_1: { ...next.files.photo_1, path: '../other.png' } } }), /缺少有效附件引用/u)
console.log('whiteboard scene: native IDs/bindings/geometry and image bytes survive save/edit/reopen; failures retain draft')
