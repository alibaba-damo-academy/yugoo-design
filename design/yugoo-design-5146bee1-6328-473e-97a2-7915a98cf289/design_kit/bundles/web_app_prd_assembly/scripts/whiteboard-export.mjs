// Browser-only production entry, bundled with the complete PRD resources.
// Native Excalidraw preserves scene geometry, bindings and supported shapes.
import { exportToBlob, acquireDesignUiFont } from '@excalidraw/excalidraw'

export async function exportWhiteboard(scene) {
  if (!scene || !Array.isArray(scene.elements)) throw new Error('Whiteboard scene must contain native elements')
  const elements = scene.elements.filter(element => !element.isDeleted)
  const neededImages = [...new Set(elements.filter(element => element.type === 'image').map(element => element.fileId))]
  const files = {}
  for (const id of neededImages) {
    const file = scene.files?.[id]
    if (typeof file?.dataURL !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(file.dataURL)) {
      throw new Error(`Whiteboard image ${JSON.stringify(id)} needs its exact embedded image bytes; a path-only reference cannot be exported`)
    }
    files[id] = file
  }
  const lease = acquireDesignUiFont(document, {})
  try {
    const ready = await lease.ready
    if (ready.status === 'failed') throw new Error('Whiteboard export font could not be prepared offline')
    let blob
    if (elements.length === 0) {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const context = canvas.getContext('2d')
      context.fillStyle = scene.appState?.viewBackgroundColor ?? '#ffffff'
      context.fillRect(0, 0, 1, 1)
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    } else {
      blob = await exportToBlob({
        elements, files, mimeType: 'image/png', exportPadding: 16, maxWidthOrHeight: 1600,
        appState: { ...scene.appState, exportBackground: true, exportWithDarkMode: false },
      })
    }
    if (!blob) throw new Error('Whiteboard export did not produce an image')
    const bitmap = await createImageBitmap(blob)
    const width = bitmap.width, height = bitmap.height
    bitmap.close()
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384))
    return { dataURL: `data:image/png;base64,${btoa(binary)}`, width, height }
  } finally { lease.release() }
}

globalThis.YugooWhiteboardExport = exportWhiteboard
