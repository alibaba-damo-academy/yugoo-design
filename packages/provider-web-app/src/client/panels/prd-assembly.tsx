/** HTML-only web_app_prd_assembly panel adapter. */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { isRecord } from '../types.ts'
import { PrdAssemblyPanel as PrdAssemblyPanelView } from '../ported/design/PrdAssemblyPanel/index.ts'
import { confinePrdArtifactPath } from '../ported/design/PrdAssemblyPanel/prdArtifactPath.ts'
import type {
  PrdAiProvenance,
  PrdAssemblyState,
  PrdAssemblyStatus,
} from '../ported/design/PrdAssemblyPanel/prdAssemblyTypes.ts'
import type { SkillPanelProps } from './shared.ts'
import { projectRootExecution } from './artifact-status-projection.ts'

function aiProvenance(value: unknown): PrdAiProvenance | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !Array.isArray(value.section_ids)
    || value.operation !== 'completion'
    || typeof value.description !== 'string' || !Array.isArray(value.source_refs)) return undefined
  const assumption = isRecord(value.assumption) ? value.assumption : undefined
  if (assumption === undefined) return undefined
  const assumptionFields = ['decision', 'reason', 'impact', 'decision_owner'] as const
  if (assumptionFields.some(field => typeof assumption[field] !== 'string')) return undefined
  return {
    id: value.id as string,
    section_ids: value.section_ids.filter((item): item is string => typeof item === 'string'),
    operation: value.operation as PrdAiProvenance['operation'],
    description: value.description,
    source_refs: value.source_refs.filter((item): item is string => typeof item === 'string'),
    assumption: {
      decision: assumption.decision as string,
      reason: assumption.reason as string,
      impact: assumption.impact as string,
      decision_owner: assumption.decision_owner as string,
    },
  }
}

/** Tolerant projection of persisted v6/v7 facts into the read-only view. */
function stateFromDraft(draft: unknown): PrdAssemblyState {
  if (!isRecord(draft)) return {}
  const state: PrdAssemblyState = {}
  if (draft.schema_version === 6 || draft.schema_version === 7 || draft.schema_version === 8) state.schema_version = draft.schema_version
  if (typeof draft.title === 'string') state.title = draft.title
  if (draft.detail_level === 'concise' || draft.detail_level === 'detailed') state.detail_level = draft.detail_level
  if (Array.isArray(draft.ai_provenance)) state.ai_provenance = draft.ai_provenance.flatMap(value => {
    const provenance = aiProvenance(value)
    return provenance === undefined ? [] : [provenance]
  })
  if (typeof draft.html_file === 'string') state.html_file = draft.html_file
  return state
}

function useHtmlContent(
  file: string | undefined,
  readArtifact: SkillPanelProps['readArtifact'],
  refreshNonce: number,
  originalState: unknown,
): { htmlContent: string | null; refreshing: boolean } {
  const [htmlContent, setHtmlContent] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  useEffect(() => {
    const path = confinePrdArtifactPath(file, 'html')
    if (path === undefined) {
      setHtmlContent(null)
      setRefreshing(false)
      return
    }
    let cancelled = false
    setRefreshing(true)
    readArtifact(path)
      .catch(() => ({ found: false, content: '' }))
      .then(result => { if (!cancelled) setHtmlContent(result.found ? result.content : null) })
      .finally(() => { if (!cancelled) setRefreshing(false) })
    return () => { cancelled = true }
  }, [file, readArtifact, refreshNonce, originalState])
  return { htmlContent, refreshing }
}

/** SkillPanelProps-compatible read-only adapter. */
export interface PrdAssemblyAdapterProps {
  draft: unknown
  onChange: (next: unknown) => void
  originalState?: unknown
  readArtifact: SkillPanelProps['readArtifact']
  readBinaryArtifact: SkillPanelProps['readBinaryArtifact']
  onNavigateSkill?: (skill: string) => void
  executionAttempts?: SkillPanelProps['executionAttempts']
}

/** Derive view-only PRD activity from native execution plus readable bytes. */
export function projectPrdAssemblyStatus(
  artifactAvailable: boolean,
  attempts: SkillPanelProps['executionAttempts'] = [],
): PrdAssemblyStatus | undefined {
  if (artifactAvailable) return 'completed'
  const rootStatus = projectRootExecution(attempts).status
  if (rootStatus === 'queued' || rootStatus === 'working') return 'assembling'
  return rootStatus === 'failed' ? 'failed' : undefined
}

/** Hydrate and render the sole canonical HTML artifact. */
export function PrdAssemblyPanel(props: PrdAssemblyAdapterProps): ReactElement {
  const state = useMemo(() => stateFromDraft(props.draft), [props.draft])
  const [refreshNonce, setRefreshNonce] = useState(0)
  const { htmlContent, refreshing } = useHtmlContent(state.html_file, props.readArtifact, refreshNonce, props.originalState)
  const status = projectPrdAssemblyStatus(htmlContent !== null, props.executionAttempts)
  const viewState = useMemo<PrdAssemblyState>(
    () => ({ ...state, ...(status === undefined ? {} : { status }) }),
    [state, status],
  )
  const handleRefresh = useCallback(() => { setRefreshNonce(nonce => nonce + 1) }, [])
  return (
    <PrdAssemblyPanelView
      state={viewState}
      htmlContent={htmlContent}
      refreshing={refreshing}
      onRefreshHtml={handleRefresh}
      onNavigateSkill={props.onNavigateSkill}
    />
  )
}

export default PrdAssemblyPanel
