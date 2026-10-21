/** Truthful Flow/Page panel projection from the current canonical files. */
import { isRecord, type FlowDesignState, type FlowProcess } from '../types.ts'
import type { IPageDesignState, IPageNode } from '../ported/design/PageDesignPanel/pageDesignTypes.ts'
import { projectArtifactExecutionLogRunId, projectArtifactFile, projectArtifactStatus } from './artifact-status-projection.ts'

/**
 * Normalize direct BPMN records from the current canonical file.
 * @param state - persisted Flow Design state.
 * @param live - invocation-owned Host lifecycle, when attached.
 * @returns panel-only Flow state.
 */
export function projectFlowDesignPanelState(
  state: Record<string, unknown>,
  attempts: readonly import('./shared.ts').ExecutionAttemptRead[] = [],
  artifactFiles: Readonly<Record<string, string>> = {},
): FlowDesignState {
  const processes = isRecord(state.processes) ? state.processes : {}
  const sourceOrder = Array.isArray(state.process_order)
    ? state.process_order.filter((id): id is string => typeof id === 'string')
    : Object.keys(processes)
  const processOrder = [...sourceOrder]
  const projected: Record<string, FlowProcess> = {}
  for (const [id, value] of Object.entries(processes)) {
    if (!isRecord(value)) continue
    const direct = value as unknown as FlowProcess
    const accepted = typeof direct.bpmn_file === 'string' && direct.bpmn_file !== ''
    const expectedFile = accepted ? direct.bpmn_file! : `flow_design/${id}.bpmn`
    const bpmnFile = accepted
      ? direct.bpmn_file
      : projectArtifactFile(id, attempts, 'flow_bpmn', artifactFiles, expectedFile) ?? null
    const status = projectArtifactStatus({
      artifactAvailable: bpmnFile != null && artifactFiles[bpmnFile] !== undefined,
      artifactId: id,
      artifactKind: 'flow_bpmn',
      artifactFile: expectedFile,
      attempts,
    })
    projected[id] = {
      ...direct,
      bpmn_file: bpmnFile,
      // A Host-verified Worker receipt is sufficient for the live panel to
      // render the landed BPMN while the Producer is still integrating its
      // canonical ref. Requiring only the JSON ref here delayed every diagram
      // until the terminal Producer update even though polling had the bytes.
      bpmn_generated: bpmnFile != null && artifactFiles[bpmnFile] !== undefined,
      bpmn_last_error: null,
      generation_status: status,
    }
  }
  return {
    ...(state as unknown as FlowDesignState),
    processes: projected,
    process_order: processOrder,
  }
}

/**
 * Normalize Page lifecycle from the current canonical file.
 * @param state - persisted Page Design state.
 * @param live - invocation-owned Host lifecycle, when attached.
 * @returns panel-only Page state.
 */
export function projectPageDesignPanelState(
  state: Record<string, unknown>,
  attempts: readonly import('./shared.ts').ExecutionAttemptRead[] = [],
  artifactFiles: Readonly<Record<string, string>> = {},
): IPageDesignState {
  const pages = isRecord(state.pages) ? state.pages : {}
  const projected: Record<string, IPageNode> = {}
  for (const [id, value] of Object.entries(pages)) {
    if (!isRecord(value)) continue
    const canonicalArtifactFile = typeof value.artifact_file === 'string' && value.artifact_file !== ''
      ? value.artifact_file
      : undefined
    const expectedFile = canonicalArtifactFile ?? `page_design/pages/${id}.html`
    const artifactFile = canonicalArtifactFile ?? projectArtifactFile(id, attempts, 'page_html', artifactFiles, expectedFile) ?? ''
    const status = projectArtifactStatus({
      artifactAvailable: artifactFiles[artifactFile] !== undefined,
      artifactId: id,
      artifactKind: 'page_html',
      artifactFile: expectedFile,
      attempts,
    })
    projected[id] = {
      ...(value as unknown as IPageNode),
      generation_status: status,
      artifact_file: artifactFile,
      generation_error: '',
      execution_run_id: projectArtifactExecutionLogRunId(id, attempts, 'page_html', expectedFile),
    }
  }
  return {
    ...(state as unknown as IPageDesignState),
    pages: projected,
    stage: (state.stage as IPageDesignState['stage']) ?? 'mapped',
  }
}
