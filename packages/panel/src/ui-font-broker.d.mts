import type { CanvasUiFontLease } from './use-canvas-ui-font.mjs'
export interface UiFontDescriptor {
  readonly family: string
  readonly source: string
  readonly sha256: string
  readonly style: string
  readonly weight: string
  readonly display: string
}
export function acquireUiFont(document: Document | undefined, descriptor: UiFontDescriptor, owner: object): CanvasUiFontLease
export function releaseFontOwner(document: Document | undefined, owner: object): void
