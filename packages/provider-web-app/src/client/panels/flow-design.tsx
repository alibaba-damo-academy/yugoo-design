/**
 * flow_design panel adapter: projects durable settlements onto view-only BPMN
 * status/file fields, hydrates accepted XML, and converts that projection to
 * the original `IFlowDesignPanel` payload before
 * renders the strict-fidelity ported FlowDesignPanel family. Editor flushes
 * merge `bpmn_xml` + `bpmn_edited` back into the draft; the footer save
 * ships them and the host dehydrates back into the `.bpmn` file. XML
 * re-hydrates whenever the host-confirmed original changes semantically.
 */
import { useCallback, useMemo, type ReactElement } from 'react'
import { isRecord, type FlowDesignState, type FlowProcess } from '../types.ts'
import { useLang } from '../ported/host.ts'
import { FlowDesignPanel as FlowDesignPanelView } from '../ported/design/FlowDesignPanel/index.ts'
import type { IFlowDesignPanel, IFlowProcessItem } from '../ported/design/FlowDesignPanel/flowDesignTypes.ts'
import type { SkillPanelProps } from './shared.ts'
import { projectTextArtifactView, useTextArtifactContents } from './artifact-text-hydration.ts'
import { projectFlowDesignPanelState } from './artifact-activity-projection.ts'
import { projectArtifactExecutionLogRunId, projectArtifactReceipt } from './artifact-status-projection.ts'

export { projectFlowDesignPanelState } from './artifact-activity-projection.ts'

const PANEL_ID = 'flow_design'

/** Serialize transient Modeler XML into ordinary file writes for one atomic panel save. */
export function prepareFlowDesignPanelSave(draft: unknown): {
  readonly state: unknown
  readonly artifacts?: readonly { readonly path: string; readonly content: string }[]
} {
  if (!isRecord(draft) || !isRecord(draft.processes)) return { state: draft }
  const processes: Record<string, unknown> = {}
  const artifacts: { path: string; content: string }[] = []
  for (const [processId, value] of Object.entries(draft.processes)) {
    if (!isRecord(value)) {
      processes[processId] = value
      continue
    }
    const process = { ...value }
    if (process.bpmn_edited === true && typeof process.bpmn_xml === 'string') {
      const path = `flow_design/${processId}.bpmn`
      artifacts.push({ path, content: process.bpmn_xml })
      process.bpmn_file = path
    }
    delete process.bpmn_generated
    delete process.generation_status
    delete process.bpmn_last_error
    delete process.bpmn_xml
    delete process.bpmn_edited
    processes[processId] = process
  }
  return {
    state: { ...draft, processes },
    ...(artifacts.length === 0 ? {} : { artifacts: Object.freeze(artifacts) }),
  }
}

/** dsh persists `tier`; the original panel renders a high/medium/low pill. */
const TIER_PRIORITY: Record<string, IFlowProcessItem['priority']> = {
  core: 'high',
  business: 'medium',
  auxiliary: 'low',
}

/** Convert one projected process plus its artifact load state into view data. */
export function flowProcessItem(
  process: FlowProcess,
  hydratedXml: string | null | undefined,
  executionRunId?: string,
): IFlowProcessItem {
  const view = projectTextArtifactView(process.bpmn_file, process.bpmn_xml, hydratedXml)
  return {
    process_id: process.process_id,
    title: process.title ?? process.process_id,
    description: process.description,
    tier: process.tier,
    priority: TIER_PRIORITY[process.tier ?? ''] ?? 'medium',
    process_type: process.process_type ?? 'linear',
    stakeholders: process.stakeholders ?? [],
    system_responsibilities: process.system_responsibilities ?? [],
    trigger_hints: process.trigger_hints ?? [],
    key_features: process.key_features ?? [],
    business_rules: process.business_rules ?? [],
    exception_handling: process.exception_handling ?? [],
    deleted: process.deleted,
    bpmn_file: process.bpmn_file ?? null,
    bpmn_generated: process.bpmn_generated ?? false,
    bpmn_last_error: process.bpmn_last_error ?? null,
    generation_status: process.generation_status,
    execution_run_id: executionRunId,
    bpmn_xml: view.content,
    bpmn_loading: view.loading,
    bpmn_available: view.available,
    bpmn_edited: process.bpmn_edited,
  }
}

/** Ordered (process_id, bpmn_file) pairs for every process carrying a file. */
function bpmnFiles(
  state: FlowDesignState,
  attempts: readonly import('./shared.ts').ExecutionAttemptRead[] = [],
): { readonly id: string; readonly path: string; readonly cacheKey: string }[] {
  const processes = state.processes ?? {}
  const entries: { id: string; path: string; cacheKey: string }[] = []
  for (const id of state.process_order ?? Object.keys(processes)) {
    const file = processes[id]?.bpmn_file
    if (file) {
      const receipt = projectArtifactReceipt(id, attempts, 'flow_bpmn', file)
      entries.push({ id, path: file, cacheKey: receipt === undefined ? `path:${file}` : `receipt:${receipt.sha256}` })
    }
  }
  return entries
}

/** The panel body. */
export function FlowDesignPanel(props: SkillPanelProps): ReactElement {
  const t = useLang()
  const rawState = isRecord(props.draft) ? props.draft : {}
  const state = useMemo(
    () => projectFlowDesignPanelState(rawState, props.executionAttempts, props.artifactFiles),
    [props.executionAttempts, props.artifactFiles, rawState],
  )
  const files = useMemo(
    () => bpmnFiles(state, props.executionAttempts),
    [props.executionAttempts, state],
  )
  const xmls = useTextArtifactContents(
    files,
    props.readArtifact,
    props.originalState,
    props.artifactFiles,
  )
  const data = useMemo<IFlowDesignPanel>(() => {
    const processes = state.processes ?? {}
    const order = state.process_order ?? Object.keys(processes)
    return {
      panel_id: PANEL_ID,
      title: String(t.design_text_process),
      type: 'flow_design',
      processes: order
        .map((id) => processes[id])
        .filter((process) => process !== undefined)
        .map((process) => flowProcessItem(
          process,
          xmls[process.process_id],
          projectArtifactExecutionLogRunId(process.process_id, props.executionAttempts ?? [], 'flow_bpmn', process.bpmn_file ?? `flow_design/${process.process_id}.bpmn`),
        )),
    }
  }, [props.executionAttempts, state, xmls, t])

  // Editor flush: merge the edited XML back into the flat draft record.
  const handleProcessesChange = useCallback((items: IFlowProcessItem[]) => {
    const current = (isRecord(props.draft) ? props.draft : {}) as FlowDesignState
    const processes = { ...(current.processes ?? {}) }
    let changed = false
    for (const item of items) {
      if (item.bpmn_edited !== true) continue
      const existing = processes[item.process_id]
      if (existing === undefined) continue
      processes[item.process_id] = { ...existing, bpmn_xml: item.bpmn_xml, bpmn_edited: true }
      changed = true
    }
    if (changed) props.onChange({ ...current, processes })
  }, [props])

  return (
    <FlowDesignPanelView
      data={data}
      disabled={props.running === true}
      readExecutionLog={props.readExecutionLog}
      onProcessesChange={handleProcessesChange}
    />
  )
}

export default FlowDesignPanel
