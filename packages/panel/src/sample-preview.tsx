/** The real declarative Panel, confined to an in-memory sample. */
import { useEffect, useMemo, useState } from 'react'
import { DslPanel } from './client/panels/dsl-panel.tsx'
import VISUAL_CSS from './visual-components.css?inline'
import CONTENT_STATE_CSS from './panel-content-state.css?inline'

export interface PanelSamplePreviewProps {
  skill: string
  panelYaml: string
  /** Original sample and collapse baseline; replacing it resets local edits. */
  sample: Record<string, unknown>
  /** Host-validated synthetic files from the same bounded definition snapshot. No project reader. */
  artifacts?: Readonly<Record<string, string>>
  /** When supplied, the caller owns edits and reflects onChange into value. */
  value?: Record<string, unknown>
  onChange?: (value: Record<string, unknown>) => void
  locale?: string
  /** Samples are documentation by default. Editing changes sample data only. */
  readOnly?: boolean
}

const noBinary = async (): Promise<never> => { throw new Error('Artifacts are unavailable in an isolated sample preview.') }

export function PanelSamplePreview({ skill, panelYaml, sample, artifacts, value, onChange, locale, readOnly = true }: PanelSamplePreviewProps) {
  const [local, setLocal] = useState(() => ({ sample, value: structuredClone(sample) }))
  useEffect(() => { setLocal({ sample, value: structuredClone(sample) }) }, [sample])
  const draft = value ?? (local.sample === sample ? local.value : structuredClone(sample))
  const files = useMemo(() => {
    const retained = { ...artifacts }
    return {
      artifactFiles: Object.fromEntries(Object.keys(retained).map(path => [path, 'studio-sample'])),
      readArtifact: async (path: string) => Object.hasOwn(retained, path)
        ? { found: true, content: retained[path]! } : { found: false, content: '' },
    }
  }, [artifacts])
  return <div className="dsh-panel-sample-preview">
    <style>{VISUAL_CSS + '\n' + CONTENT_STATE_CSS}</style>
    <DslPanel key={skill} skill={skill} panelYaml={panelYaml} draft={draft} originalState={sample}
      artifactFiles={files.artifactFiles} readArtifact={files.readArtifact} readBinaryArtifact={noBinary} allowAttachments={false} readOnly={readOnly} locale={locale}
      onChange={next => {
        if (readOnly || next === null || typeof next !== 'object' || Array.isArray(next)) return
        const changed = next as Record<string, unknown>
        if (value === undefined) setLocal({ sample, value: changed })
        onChange?.(changed)
      }} />
  </div>
}
