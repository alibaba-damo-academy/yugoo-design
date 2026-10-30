import type { StudioNodeStorageOptions, StudioInstalledStorageOptions, StudioPanelDraftPorts, StudioInstanceDraftPorts } from './types.js'

export function createStudioDraftPorts(options: StudioInstalledStorageOptions, kind: 'panel'): Promise<StudioPanelDraftPorts>
export function createStudioDraftPorts(options: StudioNodeStorageOptions, kind: 'instance'): Promise<StudioInstanceDraftPorts>
