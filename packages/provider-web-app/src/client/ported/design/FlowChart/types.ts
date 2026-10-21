/**
 * FlowChart 组件类型定义
 */

export interface IFlowNode {
  /** 节点唯一标识 */
  id: string;
  /** 节点标题 */
  label: string;
  /** 节点描述（可选） */
  description?: string;
  /** 节点类型 */
  type?: 'default' | 'input' | 'output' | 'group';
  /** 子节点ID列表 */
  children?: string[];
  /** 自定义数据 */
  data?: Record<string, unknown>;
}

export interface IFlowChartData {
  /** 节点列表 */
  nodes: IFlowNode[];
  /** 根节点ID（可选，不指定则自动查找） */
  rootId?: string;
}

export interface IFlowChartProps {
  /** 流程图数据 */
  data: IFlowChartData;
  /** 自定义类名 */
  className?: string;
  /** 节点点击回调 */
  onNodeClick?: (node: IFlowNode) => void;
  /** 是否显示控制按钮（缩放、适应视图等） */
  showControls?: boolean;
  /** 是否显示缩略图 */
  showMiniMap?: boolean;
  /** 布局方向：horizontal(水平左到右) 或 vertical(垂直上到下) 或 horizontal-bidirectional(水平双向左右展开)，默认 horizontal */
  direction?: 'horizontal' | 'vertical' | 'horizontal-bidirectional';
  /** 是否允许拖拽节点和连线，默认 false */
  draggable?: boolean;
}
