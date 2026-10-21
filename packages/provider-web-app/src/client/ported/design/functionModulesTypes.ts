/**
 * Local copy of the extend-design-skill delta panel types the ported
 * function_modules family consumes (`@/lib/delta/types`). Overview fields retain
 * their original meaning; optional local specifications and source references
 * are a Design System extension, not a verbatim copy of the original types.
 */
import type { FunctionDetails, FunctionSourceReference } from '../../types.ts'

/** One function module card (sdk-pilot `functions` record value). */
export interface IFunctionModuleType {
  /** 功能模块唯一标识 */
  function_id: string
  /** 功能模块名称 */
  function_name: string
  /** 功能模块描述 */
  function_description: string
  /** 所属史诗/功能组 */
  function_epic: string
  /** 优先级 */
  priority: 'High' | 'Medium' | 'Low'
  /** 用户是否拒绝该功能；拒绝项仍会在面板中显示并可恢复。 */
  rejected: boolean
  /** 数据来源 */
  source: 'ai' | 'user'
  /** 生成原因/说明 */
  reason: string
  details?: FunctionDetails
  references?: Record<string, FunctionSourceReference>
}

/** Epic（史诗）分组数据结构。 */
export interface IEpicGroup {
  /** 史诗/功能组名称 */
  epic_name: string
  /** 该史诗下的功能模块列表 */
  function_modules: IFunctionModuleType[]
}

/**
 * 功能模块面板。 dsh keeps one skill state per panel, so the adapter always
 * produces a single panel with a fixed `panel_id`.
 */
export interface IFunctionModulesPanel {
  /** 面板唯一标识 */
  panel_id: string
  /** 面板标题 */
  title: string
  /** 模块列表 */
  modules: IEpicGroup[]
}
