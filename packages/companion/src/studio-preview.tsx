/** Same Panel interpreter, sample-only ports: no project, host or model writes. */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { StudioPanelPreview } from '../../studio/src/panel-preview.ts'
import { PanelSamplePreview } from 'dsh-design-panel/sample-preview'
import { useCurrentLanguage } from '../../panel/src/client/ported/host.ts'

export function StudioRuntimePreview({ preview, adoptSample, readOnly = false, toolbarTarget }: {
  preview: StudioPanelPreview; adoptSample: (sample: Record<string, unknown>) => void; readOnly?: boolean; toolbarTarget?: HTMLElement | null
}) {
  const [sample, setSample] = useState<Record<string, unknown>>(() => structuredClone(preview.sample))
  const english = useCurrentLanguage() === 'en_US'
  const action = !readOnly && <button className="ygd-studio-btn-secondary" type="button" onClick={() => adoptSample(sample)}>{english ? 'Use sample edits' : '采用试填数据'}</button>
  return <>
    {toolbarTarget !== undefined ? toolbarTarget && createPortal(action, toolbarTarget) : <div className="ygd-studio-draft-toolbar">
      <span>{english ? 'Synthetic sample files only · no project access or host actions' : '仅试填样例与随包示例文件 · 不读取真实项目，不触发宿主操作'}</span>
      {action}
    </div>}
    <PanelSamplePreview skill={preview.bundle.name} panelYaml={preview.panelYaml} sample={preview.sample} artifacts={preview.artifacts} value={sample}
      onChange={setSample} readOnly={readOnly} locale={english ? 'en' : 'zh'} />
  </>
}
