import { Home } from 'lucide-react'
import { ArtifactStatusIcon } from './artifact-status-icon.tsx'
import { type NodeProps } from '@xyflow/react'
import { usePanelI18n } from './panel-i18n.tsx'
import type { ProjectedArtifactStatus } from './artifact-execution.ts'
import type { ReactNode } from 'react'
import { PanelCanvasHandles } from './panel-workspace.tsx'

/** Business-neutral record card; labels and activity come from declared bindings. */
export function NavigationRecordNode({ data, isConnectable }: NodeProps) {
  const { t } = usePanelI18n()
  const status = data.executionStatus as ProjectedArtifactStatus | undefined
  return <div className="dsh-navigation-record-node">
    {data.thumbnail as ReactNode}
    <div className="dsh-navigation-record-info"><div><strong>{data.entry === true ? <Home size={14} aria-label={t('recordEntry')} /> : null}{String(data.label ?? '')}</strong>
      {data.caption ? <span className="dsh-navigation-record-caption">{String(data.caption)}</span> : null}</div>
      {status ? <ArtifactStatusIcon status={status} label={t(`artifact_${status}`)} /> : null}
    </div>
    <PanelCanvasHandles isConnectable={isConnectable} />
  </div>
}
