/** Same Panel interpreter, sample-only ports: no project, host or model writes. */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { StudioPanelPreview } from '../../studio/src/panel-preview.ts'
import { DslPanel } from '../../panel/src/client/panels/dsl-panel.tsx'
import { useCurrentLanguage } from '../../panel/src/client/ported/host.ts'

const noArtifact = async () => ({ found: false, content: '' })
const noBinary = async (): Promise<never> => { throw new Error('Artifacts are unavailable in the isolated Studio sample preview.') }

export function StudioRuntimePreview({ preview, adoptSample, readOnly = false, toolbarTarget }: {
  preview: StudioPanelPreview; adoptSample: (sample: Record<string, unknown>) => void; readOnly?: boolean; toolbarTarget?: HTMLElement | null
}) {
  const [sample, setSample] = useState<Record<string, unknown>>(() => structuredClone(preview.sample))
  const english = useCurrentLanguage() === 'en_US'
  const action = !readOnly && <button className="ygd-studio-btn-secondary" type="button" onClick={() => adoptSample(sample)}>{english ? 'Use sample edits' : '采用试填数据'}</button>
  return <>
    {toolbarTarget !== undefined ? toolbarTarget && createPortal(action, toolbarTarget) : <div className="ygd-studio-draft-toolbar">
      <span>{english ? 'Sample only · artifact and host actions are unavailable' : '仅试填样例 · 不读取真实产物，不触发宿主操作'}</span>
      {action}
    </div>}
    <DslPanel skill={preview.bundle.name} panelYaml={preview.panelYaml} draft={sample} originalState={preview.sample}
      onChange={next => { if (next && typeof next === 'object' && !Array.isArray(next)) setSample(next as Record<string, unknown>) }}
      readArtifact={noArtifact} readBinaryArtifact={noBinary} allowAttachments={false} readOnly={readOnly} locale={english ? 'en' : 'zh'} />
  </>
}
