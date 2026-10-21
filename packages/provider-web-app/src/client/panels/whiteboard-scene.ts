import type { NativePanelSaveArtifact } from 'dsh-design-panel/client-api'
import { scenePath, validateIndex, validateScene } from '../../../../skills-web-app/bundles/whiteboard/scripts/scene.mjs'

/** Native Excalidraw elements are retained, not converted into a second graph. */
export interface WhiteboardElement {
  readonly id: string
  readonly type: string
  readonly isDeleted?: boolean
  readonly fileId?: string | null
  readonly [key: string]: unknown
}

export interface WhiteboardImageReference {
  readonly id: string
  readonly path: string
  readonly mimeType: string
  readonly created: number
}

export interface WhiteboardState {
  readonly elements: readonly WhiteboardElement[]
  readonly appState: { readonly viewBackgroundColor: string }
  readonly files: Readonly<Record<string, WhiteboardImageReference>>
}

export interface WhiteboardBinaryFile {
  readonly id: string
  readonly dataURL: string
  readonly mimeType: string
  readonly created: number
}

/** These bytes live only in an unsaved browser draft. */
export interface WhiteboardDraft extends WhiteboardState {
  readonly pendingFiles?: Readonly<Record<string, WhiteboardBinaryFile>>
}

const extensions: Readonly<Record<string, string>> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
}

export function whiteboardImagePath(id: string, mimeType: string): string {
  const extension = extensions[mimeType]
  if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(id) || extension === undefined) {
    throw new Error('白板图片必须具有安全的文件 ID，且格式为 PNG、JPEG 或 WebP')
  }
  return `whiteboard/attachments/${id}.${extension}`
}

function referencedImages(elements: readonly WhiteboardElement[]): Set<string> {
  // Retain deleted-element images too: native undo can restore these elements.
  return new Set(elements.filter((element) => element.type === 'image' && typeof element.fileId === 'string')
    .map((element) => element.fileId as string))
}

export function prepareWhiteboardPanelSave(value: unknown): {
  state: WhiteboardState
  artifacts?: readonly NativePanelSaveArtifact[]
} {
  const draft = value as WhiteboardDraft
  if (!draft || !Array.isArray(draft.elements) || !draft.appState || !draft.files) {
    throw new Error('白板场景不完整，未保存')
  }
  const files: Record<string, WhiteboardImageReference> = {}
  const artifacts: NativePanelSaveArtifact[] = []
  for (const id of referencedImages(draft.elements)) {
    const pending = draft.pendingFiles?.[id]
    if (pending !== undefined) {
      const path = whiteboardImagePath(id, pending.mimeType)
      const prefix = `data:${pending.mimeType};base64,`
      const content = pending.dataURL.startsWith(prefix) ? pending.dataURL.slice(prefix.length) : ''
      if (pending.id !== id || !Number.isFinite(pending.created) || content.length === 0
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(content)) {
        throw new Error(`白板图片 ${id} 数据无效，未保存`)
      }
      files[id] = { id, path, mimeType: pending.mimeType, created: pending.created }
      artifacts.push({ path, content, encoding: 'base64' })
    } else {
      const reference = draft.files[id]
      if (!reference || reference.id !== id || reference.path !== whiteboardImagePath(id, reference.mimeType)) {
        throw new Error(`白板图片 ${id} 缺少有效附件引用，未保存`)
      }
      // Explicit fields prevent accidental browser-only bytes entering canonical state.
      files[id] = { id, path: reference.path, mimeType: reference.mimeType, created: reference.created }
    }
  }
  return {
    state: {
      elements: draft.elements,
      appState: { viewBackgroundColor: draft.appState.viewBackgroundColor },
      files,
    },
    ...(artifacts.length > 0 ? { artifacts } : {}),
  }
}

export async function loadWhiteboardImages(
  state: WhiteboardState,
  read: (path: string) => Promise<{ found: boolean; mediaType: string; base64: string }>,
): Promise<{ files: WhiteboardBinaryFile[]; missing: string[] }> {
  const files: WhiteboardBinaryFile[] = []
  const missing: string[] = []
  await Promise.all([...referencedImages(state.elements)].map(async (id) => {
    const reference = state.files[id]
    try {
      if (!reference || reference.path !== whiteboardImagePath(id, reference.mimeType)) throw new Error('invalid reference')
      const result = await read(reference.path)
      if (!result.found || result.mediaType !== reference.mimeType) throw new Error('missing image')
      files.push({ id, mimeType: reference.mimeType, created: reference.created,
        dataURL: `data:${reference.mimeType};base64,${result.base64}` })
    } catch {
      missing.push(id)
    }
  }))
  // Failed hydration never changes canonical references or other draft content.
  return { files, missing }
}

export interface WhiteboardIndex {
  boards: Record<string, { id: string; title: string; artifact_file: string }>
  board_order: string[]
}
export interface WhiteboardPanelDraft extends WhiteboardIndex {
  /** Only edited scenes enter the host's dirty draft; hydration is view-only. */
  _scenes?: Record<string, { scene: WhiteboardDraft; baseKey: string }>
}
export const emptyWhiteboardScene = (): WhiteboardDraft => ({
  elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {},
})

export function prepareWhiteboardIndexSave(value: unknown): { state: WhiteboardIndex; artifacts?: NativePanelSaveArtifact[] } {
  const draft = value as WhiteboardPanelDraft
  const state = validateIndex({ boards: draft.boards, board_order: draft.board_order })
  const artifacts = new Map<string, NativePanelSaveArtifact>()
  for (const id of state.board_order) {
    const edited = draft._scenes?.[id]
    if (!edited) continue
    const prepared = prepareWhiteboardPanelSave(edited.scene)
    validateScene(prepared.state)
    artifacts.set(scenePath(id), { path: scenePath(id), content: JSON.stringify(prepared.state, null, 2) })
    for (const file of prepared.artifacts ?? []) {
      const prior = artifacts.get(file.path)
      if (prior && prior.content !== file.content) throw new Error('Conflicting whiteboard image bytes')
      artifacts.set(file.path, file)
    }
  }
  return { state, ...(artifacts.size ? { artifacts: [...artifacts.values()] } : {}) }
}
