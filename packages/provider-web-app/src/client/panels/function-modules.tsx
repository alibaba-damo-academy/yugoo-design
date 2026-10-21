/**
 * function_modules panel adapter: bridges dsh's flat `FunctionModulesState`
 * (schema.yaml `functions` record) to the original `IFunctionModulesPanel`
 * shape the strict-port components consume, then renders the ported
 * FunctionModules (board + epic tree + mind map overlay + status filter)
 * with the AddFeatureModal.
 */
import { useMemo, useState, type ReactElement } from 'react'
import { isRecord, type FunctionModulesState } from '../types.ts'
import { FunctionModules } from '../ported/design/FunctionModules/FunctionModules.tsx'
import AddFeatureModal from '../ported/design/AddFeatureModal.tsx'
import { useLang } from '../ported/host.ts'
import { FunctionDetailUIContext } from './function-details.tsx'
import { FunctionSourceReaderContext } from './function-source.tsx'
import type {
  IEpicGroup,
  IFunctionModuleType,
  IFunctionModulesPanel,
} from '../ported/design/functionModulesTypes.ts'

interface PanelProps {
  draft: unknown
  onChange: (next: FunctionModulesState) => void
  /** AddFeatureModal's chat path (workspace `sendPrompt`). */
  sendPrompt?: (text: string) => void
  /** Save in flight → toolbar disabled (original `loading`). */
  running?: boolean
  detailsEnabled?: boolean
  sourceRevision?: string
  readArtifact?: (path: string, revision?: string) => Promise<{ found: boolean; content: string }>
}

/** Fixed panel id: dsh keeps one function_modules state per skill. */
const PANEL_ID = 'function_modules'

/** Flat record → original panel shape, grouped by epic in record order. */
function stateToPanel(state: FunctionModulesState, title: string): IFunctionModulesPanel {
  const groups = new Map<string, IFunctionModuleType[]>()
  for (const module of Object.values(state.functions ?? {})) {
    if (!isRecord(module)) continue
    const epic = typeof module.function_epic === 'string' && module.function_epic !== '' ? module.function_epic : '未分组'
    const item: IFunctionModuleType = {
      // Preserve canonical fields that this card does not edit. Normalizing
      // the visible overview must not project away nested specifications.
      ...module,
      function_id: typeof module.function_id === 'string' ? module.function_id : '',
      function_name: typeof module.function_name === 'string' ? module.function_name : '',
      function_description: typeof module.function_description === 'string' ? module.function_description : '',
      function_epic: epic,
      priority: module.priority === 'High' || module.priority === 'Low' ? module.priority : 'Medium',
      rejected: module.rejected === true,
      source: module.source === 'user' ? 'user' : 'ai',
      reason: typeof module.reason === 'string' ? module.reason : '',
    }
    groups.set(epic, [...(groups.get(epic) ?? []), item])
  }
  const modules: IEpicGroup[] = [...groups.entries()].map(([epic_name, function_modules]) => ({ epic_name, function_modules }))
  return { panel_id: PANEL_ID, title, modules }
}

/** Original panel shape → flat record (panel id and meta are dsh-foreign). */
function panelToState(panel: IFunctionModulesPanel, base: FunctionModulesState): FunctionModulesState {
  const functions: FunctionModulesState['functions'] = {}
  for (const epic of panel.modules) {
    for (const module of epic.function_modules) {
      functions[module.function_id] = {
        ...module,
        function_id: module.function_id,
        function_name: module.function_name,
        function_description: module.function_description,
        function_epic: module.function_epic,
        priority: module.priority,
        rejected: module.rejected,
        source: module.source,
        reason: module.reason,
      }
    }
  }
  return { ...base, functions }
}

/** The panel body: strict-port FunctionModules + AddFeatureModal. */
export function FunctionModulesPanel(props: PanelProps): ReactElement {
  const t = useLang()
  const state = (isRecord(props.draft) ? props.draft : {}) as FunctionModulesState
  // 与原始 Design.tsx 一致：视图类型恒为 board（setter 在原始实现中从未被
  // 调用），脑图经右侧悬浮的 clip-path 预览层呈现。
  const [moduleViewType] = useState<'board' | 'mindmap'>('board')
  const [filterModule, setFilterModule] = useState<'all' | 'use' | 'reject'>('use')
  const [addOpen, setAddOpen] = useState(false)

  const moduleList = useMemo(
    () => [stateToPanel(state, t.capability_board)],
    [state, t],
  )

  return (
    <>
      <FunctionDetailUIContext.Provider value={props.detailsEnabled === true}>
      <FunctionSourceReaderContext.Provider value={{ revision: props.sourceRevision, readArtifact: props.readArtifact }}>
      <FunctionModules
        tabActive='function_modules'
        moduleViewType={moduleViewType}
        filterModule={filterModule}
        disabled={false}
        moduleList={moduleList}
        onAddFeature={() => { setAddOpen(true) }}
        onFilterChange={setFilterModule}
        onAnswer={(panel) => { props.onChange(panelToState(panel, state)) }}
        toolbarDisabled={props.running}
      />
      </FunctionSourceReaderContext.Provider>
      </FunctionDetailUIContext.Provider>
      <AddFeatureModal
        open={addOpen}
        onClose={() => { setAddOpen(false) }}
        onSendPrompt={props.sendPrompt}
      />
    </>
  )
}

export default FunctionModulesPanel
