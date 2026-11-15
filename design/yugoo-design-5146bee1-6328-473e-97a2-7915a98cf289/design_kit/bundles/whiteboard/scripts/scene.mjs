/** Host-free scene representation checks, shared by the CLI and Panel. */
export const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value)
export const scenePath = id => {
  if (!safeId(id)) throw new Error('Invalid board ID')
  return `whiteboard/boards/${id}.json`
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const kinds = new Set(['rectangle', 'ellipse', 'diamond', 'line', 'arrow', 'text', 'freedraw', 'image', 'frame'])
export function validateScene(scene) {
  if (!object(scene) || !Array.isArray(scene.elements) || !object(scene.appState) || !object(scene.files)
    || typeof scene.appState.viewBackgroundColor !== 'string') throw new Error('Incomplete scene')
  if (Object.keys(scene).some(k => !['elements', 'appState', 'files'].includes(k))
    || Object.keys(scene.appState).some(k => k !== 'viewBackgroundColor')) throw new Error('Scene contains non-durable fields')
  const ids = new Set()
  for (const e of scene.elements) {
    if (!object(e) || !safeId(e.id) || ids.has(e.id) || !kinds.has(e.type)) throw new Error('Invalid/duplicate element ID or unsupported type')
    for (const key of ['x', 'y', 'width', 'height']) if (!Number.isFinite(e[key])) throw new Error(`Invalid ${key}: ${e.id}`)
    if (e.width < 0 || e.height < 0) throw new Error(`Negative size: ${e.id}`)
    if (e.type === 'text' && typeof e.text !== 'string') throw new Error(`Missing text: ${e.id}`)
    if (['line', 'arrow', 'freedraw'].includes(e.type) && (!Array.isArray(e.points) || e.points.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)))) throw new Error(`Invalid points: ${e.id}`)
    ids.add(e.id)
  }
  for (const e of scene.elements) {
    const refs = [e.frameId, e.containerId, e.startBinding?.elementId, e.endBinding?.elementId, ...(e.boundElements ?? []).map(x => x.id)]
    if (refs.some(id => id != null && !ids.has(id))) throw new Error(`Dangling binding: ${e.id}`)
    if (e.type === 'image' && (!safeId(e.fileId) || !Object.hasOwn(scene.files, e.fileId))) throw new Error(`Missing image reference: ${e.id}`)
  }
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
  for (const [id, file] of Object.entries(scene.files)) {
    if (!safeId(id) || !object(file) || file.id !== id || !ext[file.mimeType]
      || file.path !== `whiteboard/attachments/${id}.${ext[file.mimeType]}` || !Number.isFinite(file.created)
      || Object.keys(file).some(k => !['id', 'path', 'mimeType', 'created'].includes(k))) throw new Error(`Invalid image reference: ${id}`)
  }
  return scene
}
export function validateIndex(state) {
  if (!object(state) || !object(state.boards) || !Array.isArray(state.board_order)
    || Object.keys(state).some(k => !['boards', 'board_order'].includes(k))) throw new Error('Invalid whiteboard index')
  if (new Set(state.board_order).size !== state.board_order.length || state.board_order.length !== Object.keys(state.boards).length) throw new Error('Index order must contain each board once')
  for (const id of state.board_order) {
    const board = state.boards[id]
    if (!object(board) || board.id !== id || typeof board.title !== 'string' || !board.title.trim()
      || board.artifact_file !== scenePath(id) || Object.keys(board).some(k => !['id', 'title', 'artifact_file'].includes(k))) throw new Error(`Invalid board: ${id}`)
  }
  return state
}
