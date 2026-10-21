import { confinedEditableArtifact } from './text-artifact-edit.ts'

export interface CanvasElement { readonly id: string; readonly type: string; readonly fileId?: string | null; readonly [key: string]: unknown }
export interface CanvasImage { id: string; path: string; mimeType: string; created: number }
export interface CanvasBinary { id: string; dataURL: string; mimeType: string; created: number }
export interface CanvasScene { elements: readonly CanvasElement[]; appState: { viewBackgroundColor: string }; files: Record<string, CanvasImage> }
export interface CanvasScope { skill: string; assetsDirectory: string }
const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const kinds = new Set(['rectangle', 'ellipse', 'diamond', 'line', 'arrow', 'text', 'freedraw', 'image', 'frame'])
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/u.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value)
export const emptyCanvasScene = (): CanvasScene => ({ elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} })
export function canvasImagePath(scope: CanvasScope, id: string, mimeType: string): string {
  const extension = extensions[mimeType]
  const path = `${scope.skill}/${scope.assetsDirectory}/${id}.${extension}`
  if (!safeId(id) || !extension || !confinedEditableArtifact(path, scope.skill)) throw Error('Invalid canvas image reference.')
  return path
}
/** Native format checks only. The Bundle still owns its CLI/domain validation. */
export function parseCanvasScene(content: string, scope: CanvasScope): CanvasScene {
  if (content.length > 5_000_000) throw Error('Canvas scene exceeds 5 million characters.')
  const scene: unknown = JSON.parse(content)
  if (!object(scene) || !Array.isArray(scene.elements) || !object(scene.appState) || !object(scene.files)
    || typeof scene.appState.viewBackgroundColor !== 'string'
    || Object.keys(scene).some(key => !['elements', 'appState', 'files'].includes(key))
    || Object.keys(scene.appState).some(key => key !== 'viewBackgroundColor')) throw Error('Invalid durable canvas scene.')
  const ids = new Set<string>()
  for (const element of scene.elements) {
    if (!object(element) || !safeId(element.id) || ids.has(element.id) || typeof element.type !== 'string' || !kinds.has(element.type)
      || ['x', 'y', 'width', 'height'].some(key => typeof element[key] !== 'number' || !Number.isFinite(element[key]))
      || Number(element.width) < 0 || Number(element.height) < 0) throw Error('Invalid canvas element.')
    if (element.type === 'text' && typeof element.text !== 'string') throw Error('Missing canvas text.')
    if (['line', 'arrow', 'freedraw'].includes(element.type) && (!Array.isArray(element.points)
      || element.points.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)))) throw Error('Invalid canvas points.')
    ids.add(element.id)
  }
  for (const element of scene.elements as Record<string, unknown>[]) {
    const bound = element.boundElements ?? []
    if (!Array.isArray(bound) || bound.some(value => !object(value))) throw Error('Invalid canvas binding.')
    const refs = [element.frameId, element.containerId,
      object(element.startBinding) ? element.startBinding.elementId : undefined,
      object(element.endBinding) ? element.endBinding.elementId : undefined, ...bound.map(value => value.id)]
    if (refs.some(id => id != null && (typeof id !== 'string' || !ids.has(id)))) throw Error('Dangling canvas binding.')
    if (element.type === 'image' && (!safeId(element.fileId) || !Object.hasOwn(scene.files, element.fileId))) throw Error('Missing canvas image reference.')
  }
  for (const [id, file] of Object.entries(scene.files)) {
    if (!object(file) || file.id !== id || typeof file.mimeType !== 'string' || file.path !== canvasImagePath(scope, id, file.mimeType)
      || typeof file.created !== 'number' || !Number.isFinite(file.created)
      || Object.keys(file).some(key => !['id', 'path', 'mimeType', 'created'].includes(key))) throw Error('Invalid canvas image reference.')
  }
  return scene as unknown as CanvasScene
}
export function prepareCanvasScene(scope: CanvasScope, elements: readonly CanvasElement[], background: string,
  references: Record<string, CanvasImage>, binaries: Record<string, CanvasBinary>) {
  const files: Record<string, CanvasImage> = {}, assets: { path: string; content: string; encoding: 'base64' }[] = []
  // Retain deleted-element images so native undo can restore them.
  const ids = new Set(elements.filter(element => element.type === 'image' && typeof element.fileId === 'string').map(element => element.fileId!))
  for (const id of ids) {
    if (!safeId(id)) throw Error('Invalid canvas image ID.')
    const original = references[id], binary = binaries[id]
    if (original) files[id] = original
    else if (binary) {
      const path = canvasImagePath(scope, id, binary.mimeType), prefix = `data:${binary.mimeType};base64,`
      const content = binary.dataURL.startsWith(prefix) ? binary.dataURL.slice(prefix.length) : ''
      if (binary.id !== id || !content || content.length > 15_000_000 || !Number.isFinite(binary.created)
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(content)) throw Error('Invalid canvas image bytes.')
      files[id] = { id, path, mimeType: binary.mimeType, created: binary.created }
      assets.push({ path, content, encoding: 'base64' })
    } else throw Error('Missing canvas image reference.')
  }
  const content = JSON.stringify({ elements, appState: { viewBackgroundColor: background }, files })
  parseCanvasScene(content, scope)
  return { content, assets }
}
