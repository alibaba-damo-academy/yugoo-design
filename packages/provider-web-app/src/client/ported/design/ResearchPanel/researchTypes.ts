/**
 * Local copy of the extend-design-skill delta panel types the ported
 * research family consumes (`@/lib/delta/types`). Kept verbatim in field
 * shape so the components stay a strict port; dsh persists the flat
 * `ResearchState.rounds` record with direct artifact refs; the panel adapter
 * hydrates and converts them.
 */

/** 方向执行轨迹条目（由 research worker 实时追加）。 */
export interface IDirectionTraceEntry {
  /** 毫秒级时间戳 */
  timestamp: number;
  /** Native Agent transcript row: visible message, tool action, or error. */
  event_type: 'message' | 'search' | 'fetch' | 'synthesize' | 'error';
  /** 人类可读的事件描述 */
  message: string;
  /** 可选：关联的 URL（fetch 类型事件） */
  url?: string | null;
}

/** 调研方向。 */
export interface IResearchDirectionItem {
  /** 方向唯一 ID */
  direction_id: string;
  /** 方向标题 */
  title: string;
  /** 来源 */
  source: 'prerequisites' | 'analysis' | 'user';
  /** 状态 */
  status:
    | 'pending'
    | 'queued'
    | 'working'
    | 'completed'
    | 'failed';
  /** 调研要点列表 */
  research_points: string[];
  /** 调研结果（Markdown）— 由 adapter 从 accepted ref 水合。 */
  findings?: string;
  /** Artifact ref exists and its content is still loading. */
  findings_loading?: boolean;
  /** Artifact ref exists and readArtifact returned usable content. */
  findings_available?: boolean;
  /** 信息来源 URL 列表 */
  source_urls: string[];
  /** Host 接受后直接持久化的 findings 文件相对路径。 */
  findings_file?: string | null;
  /** 可选：执行过程审计轨迹（由 research worker 实时追加） */
  trace?: IDirectionTraceEntry[];
  /** Native execution log RPC is temporarily unavailable and will be retried. */
  trace_unavailable?: boolean;
}

/**
 * 调研轮次
 *
 * 一次调研可以包含多个轮次，每个轮次有独立的研究目标、方向列表和综合结论。
 * 支持 pilot 在同一会话中跨多个不同话题开启多轮调研，或在现有轮次里继续挖掘。
 */
export interface IResearchRound {
  /** 轮次唯一 ID（形如 R-001） */
  round_id: string;
  /** 本轮调研目标（显示在左侧导航一级节点的标题） */
  topic: string;
  /** 本轮调研阶段 */
  stage: 'identified' | 'confirmed' | 'researching' | 'completed' | 'partial';
  /** UI-only lifecycle of the invocation's root Producer. */
  producer_status?: 'pending' | 'queued' | 'working' | 'completed' | 'failed';
  /** UI-only Host run id used to read the Producer's native log. */
  producer_run_id?: string;
  /** 本轮综合结论（Markdown/HTML）— 由 adapter 从 accepted ref 水合。 */
  conclusion?: string;
  /** Conclusion ref exists and its content is still loading. */
  conclusion_loading?: boolean;
  /** Conclusion ref exists and readArtifact returned usable content. */
  conclusion_available?: boolean;
  /** Host 接受后直接持久化的 conclusion 文件相对路径。 */
  conclusion_file?: string | null;
  /** 本轮调研方向列表（已按 direction_order 排序） */
  directions: IResearchDirectionItem[];
  /** 本轮创建时间（毫秒） */
  created_at?: number;
  /** 本轮最近更新时间（毫秒） */
  updated_at?: number;
}

/**
 * 调研分析面板（多轮次版本）。dsh keeps one skill state per panel, so the
 * adapter always produces a single panel with a fixed `panel_id`.
 */
export interface IResearchPanel {
  /** 面板唯一标识 */
  panel_id: string;
  /** 面板标题 */
  title: string;
  /** 面板类型 */
  type: 'research';
  /** 调研轮次列表（已按 round_order 排序） */
  rounds: IResearchRound[];
  /** 当前活跃轮次 ID（pilot 会把"继续挖掘"的方向合并到这个轮次） */
  current_round_id?: string | null;
}
