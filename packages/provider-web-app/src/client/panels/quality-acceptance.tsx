import type { ReactElement } from 'react'
import {
  QualityAcceptancePanel as QualityAcceptancePanelView,
  type AcceptanceRequirement,
  type QualityAcceptanceState,
} from '../ported/design/OfficialWebAppPanels/QualityAcceptancePanel.tsx'
import { isRecord } from '../types.ts'

interface QualityAcceptancePanelProps {
  draft: unknown
  onChange: (next: QualityAcceptanceState) => void
  running?: boolean
}

function requirement(id: string, value: unknown): AcceptanceRequirement | null {
  if (!isRecord(value)) return null
  return {
    id: typeof value.id === 'string' ? value.id : id,
    title: typeof value.title === 'string' ? value.title : '',
    condition: typeof value.condition === 'string' ? value.condition : '',
    pass_criteria: typeof value.pass_criteria === 'string' ? value.pass_criteria : '',
    verification: typeof value.verification === 'string' ? value.verification : '',
  }
}

function stateFromDraft(draft: unknown): QualityAcceptanceState {
  if (!isRecord(draft)) return { schema_version: 4, requirements: {}, requirement_order: [] }
  const requirements = isRecord(draft.requirements)
    ? Object.fromEntries(Object.entries(draft.requirements).flatMap(([id, value]) => {
      const item = requirement(id, value)
      return item === null ? [] : [[id, item]]
    }))
    : {}
  return {
    schema_version: 4,
    requirements,
    requirement_order: Array.isArray(draft.requirement_order)
      ? draft.requirement_order.filter((id): id is string => typeof id === 'string')
      : Object.keys(requirements),
  }
}

/** Native quality-acceptance editor bound to the persisted ordered catalog. */
export function QualityAcceptancePanel({ draft, onChange, running }: QualityAcceptancePanelProps): ReactElement {
  const state = stateFromDraft(draft)
  return (
    <QualityAcceptancePanelView
      panel={state}
      disabled={running === true}
      onChange={(changes) => { onChange({ ...state, ...changes, schema_version: 4 }) }}
    />
  )
}

export default QualityAcceptancePanel
