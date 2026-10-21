import type { CanvasUiFontLease } from './use-canvas-ui-font.mjs'
/** Faces come only from the guarded upstream non-local registry facade. */
export function acquireSceneFontFaces(document: Document, faces: FontFace[], owner: object): CanvasUiFontLease
export function sceneFontGeneration(document: Document, faces: FontFace[]): () => boolean
export function releaseSceneFontOwner(document: Document | undefined, owner: object): void
