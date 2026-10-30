import type { ReactElement } from 'react'
import type { DesignKitVersionPin, DesignBundleVersionPin, StudioPanelPreview, StudioPanelPreviewResult } from 'dsh-design-studio'

/** Host-owned preview capability. Editing uses StudioInstanceClient exclusively. */
export interface StudioAuthoringClient {
  previewInstalled?(input: { kit?: DesignKitVersionPin; bundle: DesignBundleVersionPin; revision: number; sampleSource?: string }): Promise<StudioPanelPreviewResult>
}
export interface StudioAuthoring {
  readonly client: StudioAuthoringClient
  readonly renderPreview: (preview: StudioPanelPreview, adoptSample: (value: Record<string, unknown>) => void, options: { readOnly: boolean; toolbarTarget?: HTMLElement | null }) => ReactElement
}
