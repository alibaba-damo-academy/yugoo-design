import type {} from './canvas-ui-font-facade.d.ts'
import type { ReactElement, ReactNode } from 'react'
export interface CanvasUiFontLease {
  readonly ready: Promise<{ readonly status: 'loaded' | 'released' | 'unavailable' | 'failed'; readonly error?: unknown }>
  release(): void
}
export type AcquireCanvasUiFont = (document: Document | undefined, owner: object) => CanvasUiFontLease
export function CanvasFontOwnerProvider(props: { owner: object; children?: ReactNode }): ReactElement
export function CanvasFontRoot(props: { children?: ReactNode }): ReactElement
export function releaseCanvasFontOwner(owner: object): void
export function useCanvasUiFont(acquire: AcquireCanvasUiFont): 'font-load-failed' | undefined

export function useCanvasFontSession(acquire: AcquireCanvasUiFont): {error: 'font-load-failed' | undefined; initialized: boolean}
