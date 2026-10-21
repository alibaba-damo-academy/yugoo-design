import '@excalidraw/excalidraw'
import type { CanvasUiFontLease } from './use-canvas-ui-font.mjs'
declare module '@excalidraw/excalidraw' {
  /** Build-owned facade; the immutable replacement descriptor is not caller supplied. */
  export function acquireDesignUiFont(document: Document | undefined, owner: object): CanvasUiFontLease
}
