import React, {
  useCallback,
  useMemo,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  Position,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { cn } from '../../ui/cn.ts';
import type { IFlowChartProps, IFlowNode } from './types.ts';
import { CustomNode } from './CustomNode.tsx';

const DEFAULT_EDGE_STYLE = {
  strokeWidth: 1,
  stroke: 'var(--ds-line-4)',
  markerStart: 'url(#flowchart-edge-start-circle)',
} as const;

const ACTIVE_EDGE_STYLE = {
  strokeWidth: 1,
  stroke: 'url(#flowchart-selected-edge-gradient)',
  markerStart: 'url(#flowchart-edge-start-circle-active)',
} as const;

/**
 * 将扁平的节点数据转换为 ReactFlow 需要的节点和边
 */
const convertToFlowData = (
  nodes: IFlowNode[],
  rootId?: string,
  direction:
    | 'horizontal'
    | 'vertical'
    | 'horizontal-bidirectional' = 'horizontal'
): { nodes: Node[]; edges: Edge[] } => {
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const flowNodes: Node[] = [];
  const flowEdges: Edge[] = [];

  // 查找根节点
  const findRootNode = (): IFlowNode | undefined => {
    if (rootId) {
      return nodeMap.get(rootId);
    }
    // 查找没有父节点的节点作为根节点
    const childIds = new Set(nodes.flatMap(node => node.children || []));
    return nodes.find(node => !childIds.has(node.id));
  };

  const root = findRootNode();
  if (!root) {
    return { nodes: [], edges: [] };
  }
  const isHorizontal = direction === 'horizontal';
  const isBidirectional = direction === 'horizontal-bidirectional';
  // 配置参数 - 紧凑布局
  const levelSpacing = 300; // 层级间距（父子节点之间）- 从 400 减少到 300
  const nodeSiblingSpacing = isHorizontal || isBidirectional ? 50 : 250; // 同层节点间距（兄弟节点之间）- 从 35 增加到 50，避免重叠
  const sourcePosition = isHorizontal ? Position.Right : Position.Bottom;
  const targetPosition = isHorizontal ? Position.Left : Position.Top;

  // 使用递归布局算法（类似二叉树布局）
  // 记录每个节点在其层级中的偏移量
  const nodePositions = new Map<string, { level: number; offset: number }>();

  /**
   * 递归计算节点位置（后序遍历）
   * 返回子树的宽度（所占的单位数）
   */
  const calculatePositions = (
    node: IFlowNode,
    level: number,
    offsetStart: number
  ): number => {
    const children = node.children
      ?.map(id => nodeMap.get(id))
      .filter(Boolean) as IFlowNode[];

    if (!children || children.length === 0) {
      // 叶子节点，占据 1 个单位
      nodePositions.set(node.id, { level, offset: offsetStart });
      return 1;
    }

    // 递归计算所有子节点的位置
    let currentOffset = offsetStart;
    const childOffsets: number[] = [];

    children.forEach(child => {
      const childWidth = calculatePositions(child, level + 1, currentOffset);
      // 记录每个子节点的中心位置
      const childPos = nodePositions.get(child.id)!;
      childOffsets.push(childPos.offset);
      currentOffset += childWidth;
    });

    // 父节点位于所有子节点的中心
    const minChildOffset = Math.min(...childOffsets);
    const maxChildOffset = Math.max(...childOffsets);
    const parentOffset = (minChildOffset + maxChildOffset) / 2;

    nodePositions.set(node.id, { level, offset: parentOffset });

    // 返回整个子树的宽度
    return currentOffset - offsetStart;
  };

  // 从根节点开始计算
  calculatePositions(root, 0, 0);

  // 双向布局：XMind 思维导图风格，递归布局算法
  const nodeSideMap = new Map<string, 'left' | 'right' | 'center'>();
  const nodeLevelInSide = new Map<string, number>(); // 节点在其侧边的层级
  const nodeYPosition = new Map<string, number>(); // 节点的 Y 坐标

  if (isBidirectional) {
    // 根节点标记为中心
    nodeSideMap.set(root.id, 'center');
    nodeLevelInSide.set(root.id, 0);
    nodeYPosition.set(root.id, 0);

    /**
     * 递归计算子树的高度（垂直跨度）
     * 返回子树占据的垂直单位数
     */
    const calculateSubtreeHeight = (
      nodeId: string,
      side: 'left' | 'right',
      level: number
    ): number => {
      const node = nodeMap.get(nodeId);
      if (!node) return 1;

      // 标记节点的侧边和层级
      nodeSideMap.set(nodeId, side);
      nodeLevelInSide.set(nodeId, level);

      // 如果没有子节点，高度为 1
      if (!node.children || node.children.length === 0) {
        return 1;
      }

      // 计算所有子节点的总高度
      let totalHeight = 0;
      node.children.forEach(childId => {
        totalHeight += calculateSubtreeHeight(childId, side, level + 1);
      });

      // 子树的高度至少为所有子节点的高度之和
      return totalHeight;
    };

    /**
     * 递归分配节点的 Y 坐标
     * baseY: 当前子树的起始 Y 坐标
     * 返回下一个可用的 Y 坐标
     */
    const assignYPositions = (
      nodeId: string,
      side: 'left' | 'right' | 'center',
      baseY: number
    ): number => {
      const node = nodeMap.get(nodeId);
      if (!node) return baseY + 1;

      // 如果没有子节点，直接放置在 baseY
      if (!node.children || node.children.length === 0) {
        nodeYPosition.set(nodeId, baseY);
        return baseY + 1;
      }

      // 先递归处理所有子节点，计算它们的 Y 坐标范围
      let currentY = baseY;
      const childYPositions: number[] = [];

      node.children.forEach(childId => {
        const childNode = nodeMap.get(childId);
        if (childNode) {
          // 记录子节点的起始 Y
          childYPositions.push(currentY);
          // 递归处理子节点，获取下一个可用的 Y
          currentY = assignYPositions(childId, side, currentY);
        }
      });

      // 父节点位于所有子节点的中心
      const firstChildY = childYPositions[0] || baseY;
      const lastChildY = currentY - 1;
      const parentY = (firstChildY + lastChildY) / 2;

      nodeYPosition.set(nodeId, parentY);

      return currentY;
    };

    // 处理根节点的子节点，分为左右两组
    if (root.children && root.children.length > 0) {
      // 智能分配：计算每个子节点的子树高度，然后平衡分配到左右两侧
      const childHeights = root.children.map(childId => ({
        id: childId,
        height: calculateSubtreeHeight(childId, 'left', 1), // 临时使用 'left'，后面会重新标记
      }));

      // 按照高度降序排序
      childHeights.sort((a, b) => b.height - a.height);

      // 使用贪心算法平衡分配：每次将节点分配到当前总高度较小的一侧
      const leftChildren: string[] = [];
      const rightChildren: string[] = [];
      let leftHeight = 0;
      let rightHeight = 0;

      childHeights.forEach(child => {
        if (leftHeight <= rightHeight) {
          leftChildren.push(child.id);
          leftHeight += child.height;
        } else {
          rightChildren.push(child.id);
          rightHeight += child.height;
        }
      });

      // 先计算左右两侧的总高度
      let leftTotalHeight = 0;
      leftChildren.forEach(childId => {
        leftTotalHeight += calculateSubtreeHeight(childId, 'left', 1);
      });

      let rightTotalHeight = 0;
      rightChildren.forEach(childId => {
        rightTotalHeight += calculateSubtreeHeight(childId, 'right', 1);
      });

      // 计算最大高度，用于居中对齐
      const maxHeight = Math.max(leftTotalHeight, rightTotalHeight);

      // 左侧子树：从负方向开始，居中对齐
      const leftStartY = -(maxHeight / 2);
      assignYPositions(root.id, 'center', 0); // 根节点 Y=0

      let currentLeftY = leftStartY;
      leftChildren.forEach(childId => {
        currentLeftY = assignYPositions(childId, 'left', currentLeftY);
      });

      // 右侧子树：从负方向开始，居中对齐
      const rightStartY = -(maxHeight / 2);
      let currentRightY = rightStartY;
      rightChildren.forEach(childId => {
        currentRightY = assignYPositions(childId, 'right', currentRightY);
      });
    }
  }

  // 将偏移量转换为实际坐标
  nodePositions.forEach((pos, nodeId) => {
    const node = nodeMap.get(nodeId)!;

    let x: number, y: number;
    let nodeSourcePosition = sourcePosition;
    let nodeTargetPosition = targetPosition;

    if (isBidirectional) {
      // 双向布局：XMind 思维导图风格
      const side = nodeSideMap.get(nodeId) || 'center';
      const levelInSide = nodeLevelInSide.get(nodeId) || 0;
      const yPos = nodeYPosition.get(nodeId) || 0;

      if (side === 'center') {
        // 根节点位于中心
        x = 0;
        y = 0;
        // 根节点的连接点不设置固定方向，让每条边根据目标节点位置自动选择
        nodeSourcePosition = Position.Right; // 默认右侧
        nodeTargetPosition = Position.Left; // 默认左侧
      } else {
        // 计算 x 坐标：根据层级向左或向右延伸
        if (side === 'left') {
          x = -levelInSide * levelSpacing;
          nodeSourcePosition = Position.Left;
          nodeTargetPosition = Position.Right;
        } else {
          x = levelInSide * levelSpacing;
          nodeSourcePosition = Position.Right;
          nodeTargetPosition = Position.Left;
        }

        // 计算 y 坐标：使用递归计算得到的 Y 位置，乘以节点间距
        const nodeSpacing = 80; // 节点垂直间距
        y = yPos * nodeSpacing;
      }
    } else if (isHorizontal) {
      // 水平布局：x 根据层级，y 根据偏移量
      x = pos.level * levelSpacing;
      y = pos.offset * nodeSiblingSpacing;
    } else {
      // 垂直布局：x 根据偏移量，y 根据层级
      x = pos.offset * nodeSiblingSpacing;
      y = pos.level * levelSpacing;
    }

    // 获取子节点名称列表
    const childrenLabels = node.children
      ?.map(childId => nodeMap.get(childId)?.label)
      .filter(Boolean) as string[];

    flowNodes.push({
      id: node.id,
      type: 'custom',
      position: { x, y },
      sourcePosition: nodeSourcePosition,
      targetPosition: nodeTargetPosition,
      data: {
        label: node.label,
        description: node.description,
        children: childrenLabels, // 传入子节点名称列表
        sourcePosition: nodeSourcePosition, // 传递给自定义节点组件
        targetPosition: nodeTargetPosition, // 传递给自定义节点组件
        isBidirectionalRoot:
          isBidirectional && nodeSideMap.get(nodeId) === 'center', // 标记双向布局的根节点
        ...node.data,
      },
    });

    // 创建边 - 阶梯线连接
    if (node.children) {
      node.children.forEach(childId => {
        // 在双向布局模式下，根据子节点的侧边设置连接点
        let sourceHandle: 'left' | 'right' | null = null;
        let targetHandle: 'left' | 'right' | null = null;

        if (isBidirectional) {
          const parentSide = nodeSideMap.get(nodeId);
          const childSide = nodeSideMap.get(childId);

          // 如果父节点是根节点（center），根据子节点侧边设置源连接点
          if (parentSide === 'center') {
            sourceHandle = childSide === 'left' ? 'left' : 'right';
            // targetHandle 保持为 null，让子节点使用默认的 target Handle
            targetHandle = null;
          } else {
            // 非根节点使用默认连接点
            sourceHandle = null;
            targetHandle = null;
          }
        }

        flowEdges.push({
          id: `${node.id}-${childId}`,
          source: node.id,
          target: childId,
          sourceHandle, // 使用计算出的连接点
          targetHandle, // 使用计算出的连接点
          type: 'default', // 使用贝塞尔曲线（default 类型）
          animated: false,
          style: DEFAULT_EDGE_STYLE,
        });
      });
    }
  });

  return { nodes: flowNodes, edges: flowEdges };
};

/**
 * FlowChart 内部组件 - 需要在 ReactFlowProvider 内部使用
 */
const FlowChartInner: React.FC<IFlowChartProps> = ({
  data,
  className,
  onNodeClick,
  showControls = true,
  showMiniMap = false,
  direction = 'horizontal',
  draggable = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { fitView, getNodes } = useReactFlow();
  const [isViewportReady, setIsViewportReady] = useState(false);
  const hasInitializedViewportRef = useRef(false);

  // 转换数据
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => convertToFlowData(data.nodes, data.rootId, direction),
    [data, direction]
  );

  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // 自定义节点类型
  const nodeTypes = useMemo(() => ({ custom: CustomNode }), []);

  useEffect(() => {
    setNodes(
      initialNodes.map(node => ({
        ...node,
        selected: false,
      }))
    );
    setEdges(
      initialEdges.map(edge => ({
        ...edge,
        style:
          edge.source === hoveredNodeId
            ? ACTIVE_EDGE_STYLE
            : DEFAULT_EDGE_STYLE,
      }))
    );
  }, [hoveredNodeId, initialEdges, initialNodes, setEdges, setNodes]);

  // 节点点击处理
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (onNodeClick) {
        const flowNode = data.nodes.find(n => n.id === node.id);
        if (flowNode) {
          onNodeClick(flowNode);
        }
      }
    },
    [onNodeClick, data.nodes]
  );

  const handleNodeMouseEnter = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setHoveredNodeId(node.id);
    },
    []
  );

  const handleNodeMouseLeave = useCallback(() => {
    setHoveredNodeId(null);
  }, []);

  // 计算智能缩放参数
  const calculateFitViewOptions = useCallback(() => {
    if (!containerRef.current) return { padding: 0.1, maxZoom: 1 };

    const container = containerRef.current;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const flowNodes = getNodes();

    // 计算节点占用的总面积
    if (flowNodes.length === 0) {
      return { padding: 0.1, maxZoom: 1 };
    }

    // 获取所有节点的边界框
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    flowNodes.forEach(node => {
      const nodeWidth = 280; // CustomNode 的默认宽度
      const nodeHeight = 120; // CustomNode 的大致高度
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + nodeWidth);
      maxY = Math.max(maxY, node.position.y + nodeHeight);
    });

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;

    // 计算内容与容器的比例
    const widthRatio = containerWidth / contentWidth;
    const heightRatio = containerHeight / contentHeight;
    const fitRatio = Math.min(widthRatio, heightRatio);

    // 如果内容可以完整显示在容器内（不需要放大），使用较小的 maxZoom
    // 如果 fitRatio > 1，说明内容小于容器，设置 maxZoom = 1 避免放大
    // 如果 fitRatio < 0.8，说明内容较大，允许适当的 padding
    const maxZoom = fitRatio >= 1 ? 1 : 1.5;
    const padding = fitRatio >= 1 ? 0.05 : 0.1;

    return { padding, maxZoom };
  }, [getNodes]);

  // 监听容器大小变化
  useEffect(() => {
    if (!containerRef.current) return;

    setIsViewportReady(false);
    hasInitializedViewportRef.current = false;

    const resizeObserver = new ResizeObserver(() => {
      // 延迟执行 fitView，确保 DOM 更新完成
      setTimeout(() => {
        const options = calculateFitViewOptions();
        fitView({
          padding: options.padding,
          includeHiddenNodes: false,
          maxZoom: options.maxZoom,
        });

        if (!hasInitializedViewportRef.current) {
          hasInitializedViewportRef.current = true;
          requestAnimationFrame(() => {
            setIsViewportReady(true);
          });
        }
      }, 100);
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [fitView, calculateFitViewOptions]);

  // 初始 fitView 选项
  const initialFitViewOptions = useMemo(() => {
    return calculateFitViewOptions();
  }, [calculateFitViewOptions]);

  return (
    <div
      ref={containerRef}
      className={cn('h-full w-full', className)}
      style={{
        opacity: isViewportReady ? 1 : 0,
        transition: isViewportReady ? 'opacity 120ms ease-out' : 'none',
      }}
    >
      <style>{`
        .flowchart-controls .react-flow__controls-button {
          border-bottom: none;
          width:28px;
          height:28px;
        }
      `}</style>
      <svg className='absolute h-0 w-0 pointer-events-none'>
        <defs>
          <marker
            id='flowchart-edge-start-circle'
            markerWidth='10'
            markerHeight='10'
            refX='5'
            refY='5'
            orient='auto'
          >
            <circle
              cx='5'
              cy='5'
              r='3'
              fill='white'
              stroke='var(--ds-line-4)'
              strokeWidth='1'
            />
          </marker>
          <marker
            id='flowchart-edge-start-circle-active'
            markerWidth='10'
            markerHeight='10'
            refX='5'
            refY='5'
            orient='auto'
          >
            <circle
              cx='5'
              cy='5'
              r='3'
              fill='white'
              stroke='var(--ds-brand-bg-default)'
              strokeOpacity='0.6'
              strokeWidth='1'
            />
          </marker>
          <linearGradient
            id='flowchart-selected-edge-gradient'
            x1='100%'
            y1='50%'
            x2='0%'
            y2='50%'
          >
            <stop
              offset='0%'
              stopColor='var(--ds-brand-bg-default)'
              stopOpacity='0.4'
            />
            <stop
              offset='100%'
              stopColor='var(--ds-brand-bg-default)'
              stopOpacity='0.6'
            />
          </linearGradient>
        </defs>
      </svg>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        onPaneMouseLeave={handleNodeMouseLeave}
        nodeTypes={nodeTypes}
        nodesDraggable={draggable}
        nodesConnectable={draggable}
        elementsSelectable={draggable}
        fitView
        fitViewOptions={{
          padding: 0.15,
          maxZoom: 1.2,
        }}
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'default', // 贝塞尔曲线连接
          animated: false,
          style: DEFAULT_EDGE_STYLE,
        }}
        proOptions={{ hideAttribution: true }}
        className='bg-transparent'
      >
        {/* 背景网格 */}
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.5}
          color='#94a3b8'
          className='opacity-[0.15] dark:opacity-[0.2]'
        />

        {/* 控制按钮 */}
        {showControls && (
          <Controls
            className='flowchart-controls overflow-hidden rounded-lg bg-[#fff] text-[var(--ds-text-tertiary)] [box-shadow:var(--ds-shadow-2-center)]'
            showInteractive={false}
            showZoom={true}
            showFitView={true}
            fitViewOptions={{
              padding: 0.15,
              maxZoom: 1.2,
              minZoom: 0.3,
              duration: 300,
            }}
          />
        )}

        {/* 缩略图 */}
        {showMiniMap && (
          <MiniMap
            className='rounded-lg border border-border bg-background'
            nodeColor='hsl(var(--primary))'
            maskColor='hsl(var(--muted) / 0.5)'
            position='bottom-right'
          />
        )}
      </ReactFlow>
    </div>
  );
};

/**
 * FlowChart - 组织架构风格的功能图组件（外部包装）
 *
 * 基于 @xyflow/react 构建的流程图组件，支持：
 * - 自动布局（层级结构）
 * - 节点点击交互
 * - 缩放和平移
 * - 缩略图导航
 * - 响应式容器（监听容器大小变化）
 */
export const FlowChart: React.FC<IFlowChartProps> = props => {
  return (
    <ReactFlowProvider>
      <FlowChartInner {...props} />
    </ReactFlowProvider>
  );
};

FlowChart.displayName = 'FlowChart';

export default FlowChart;
