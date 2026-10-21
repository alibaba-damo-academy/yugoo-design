import type { ComponentNode } from './dsl.ts'
import { pathGet, type DesignData } from './record-state.ts'
import type { RenderOptions } from './interpreter.ts'
import { ExecutionRollingLog } from './client/execution-rolling-log.tsx'
import { projectArtifactExecution, projectRootExecution, type ProjectedArtifactExecution } from './artifact-execution.ts'
import { usePanelI18n } from './panel-i18n.tsx'

/** Resolve only current Bundle Host observations, never an authored native run id. */
export function resolveExecutionLog(node: ComponentNode, data: DesignData, options?: RenderOptions): ProjectedArtifactExecution {
  const config = node.log!
  const attempts = options?.executionAttempts?.filter(attempt => attempt.skill === options.skill) ?? []
  if (config.scope === 'producer') return projectRootExecution(attempts)
  const artifactId = config.artifact_id ?? pathGet(data, config.artifact_id_path ?? '')
  if (typeof artifactId !== 'string' || !artifactId) return { status: 'pending' as const }
  const file = config.artifact_file_path ? pathGet(data, config.artifact_file_path) : undefined
  const artifactFile = typeof file === 'string' ? file : undefined
  const activities = options?.artifactActivities?.filter(activity => activity.skill === options.skill) ?? []
  return projectArtifactExecution(artifactId, attempts, config.artifact_kind,
    !!artifactFile && options?.artifactFiles?.[artifactFile] !== undefined, 'pending', artifactFile, activities)
}

/** Read-only DSL entry to the same rolling log used by native and artifact panels. */
export function ExecutionLog({ node, data, options }: { node: ComponentNode; data: DesignData; options?: RenderOptions }) {
  const { t, locale } = usePanelI18n()
  const execution = resolveExecutionLog(node, data, options)
  if (!execution.runId || !options?.readExecutionLog) return <p role="status">{t('traceUnavailable')}</p>
  return <ExecutionRollingLog runId={execution.runId} logTarget={execution.logTarget}
    active={execution.status === 'working' || execution.status === 'queued'}
    label={node.title ?? t('executionTrace')} locale={locale.startsWith('en') ? 'en' : 'zh'}
    unavailableLabel={t('traceUnavailable')} maxEntries={node.log?.max_entries ?? 200}
    presentation="conversation" readExecutionLog={options.readExecutionLog} />
}
