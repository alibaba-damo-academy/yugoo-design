/**
 * Local copy of the extend-design-skill delta panel types the ported
 * flow_design family consumes (`@/lib/delta/types`). Kept verbatim in field
 * shape so the components stay a strict port. `bpmn_file`,
 * `bpmn_file` is the canonical accepted-artifact ref. `bpmn_generated`,
 * `generation_status`, failure display, and hydrated XML are UI projections.
 */

/** 异常处理条目。 */
export interface IFlowExceptionHandling {
  /** 异常情形描述 */
  scenario: string;
  /** 对应处理方式 */
  handling: string;
}

/** One evidenced event that the BPMN must realize. */
export interface IFlowTriggerHint {
  kind: 'timer' | 'message' | 'error' | 'conditional' | 'signal';
  trigger: string;
  expected_outcome: string;
}

/** 业务流程条目。 */
export interface IFlowProcessItem {
  /** 流程唯一 ID */
  process_id: string;
  /** 流程标题 */
  title: string;
  /** 流程说明（Markdown） */
  description?: string;
  /** 流程层级（dsh schema 字段，adapter 同时映射为 priority） */
  tier?: 'core' | 'business' | 'auxiliary';
  /** 优先级（原版字段；adapter 由 tier 映射） */
  priority: 'high' | 'medium' | 'low';
  /** 流程类型 */
  process_type: string;
  /** 参与角色名称列表 */
  stakeholders: string[];
  /** 产品在该流程中承担的自动化责任。 */
  system_responsibilities: string[];
  /** 已有证据支持、必须在 BPMN 中表达的事件触发。 */
  trigger_hints: IFlowTriggerHint[];
  /** 关键功能列表 */
  key_features: string[];
  /** 业务规则列表 */
  business_rules: string[];
  /** 异常处理列表 */
  exception_handling: IFlowExceptionHandling[];
  /** 用户是否已确认该流程 */
  /** 是否被用户拒绝（原版"已拒绝"分组） */
  deleted?: boolean;
  /** Host-accepted BPMN path persisted directly on the process. */
  bpmn_file?: string | null;
  /** Host-maintained accepted-artifact availability flag. */
  bpmn_generated: boolean;
  /** Last generation failure retained for the next fresh invocation. */
  bpmn_last_error?: string | null;
  /** Ephemeral Host execution lifecycle projection. */
  generation_status?: 'pending' | 'queued' | 'working' | 'completed' | 'failed';
  /** UI-only Host run id for the native Agent log. */
  execution_run_id?: string;
  /** UI-only XML hydrated from the accepted artifact or emitted by the editor. */
  bpmn_xml?: string;
  /** Accepted BPMN ref exists and its content is still loading. */
  bpmn_loading?: boolean;
  /** Accepted BPMN ref exists and readArtifact returned usable XML. */
  bpmn_available?: boolean;
  /** 用户在 Modeler 中编辑过（保存时由 host 脱水回 bpmn_file） */
  bpmn_edited?: boolean;
}

/**
 * 业务流程设计面板。dsh keeps one skill state per panel, so the adapter
 * always produces a single panel with a fixed `panel_id`.
 */
export interface IFlowDesignPanel {
  /** 面板唯一标识 */
  panel_id: string;
  /** 面板标题 */
  title: string;
  /** 面板类型 */
  type: 'flow_design';
  /** 流程列表（已按 process_order 排序） */
  processes: IFlowProcessItem[];
}
