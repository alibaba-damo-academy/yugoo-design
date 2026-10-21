import { useMemo } from 'react';
import { FlowChart, IFlowChartData, IFlowNode } from '../FlowChart/index.ts';
import type { IFunctionModulesPanel } from '../functionModulesTypes.ts';
import { useLang } from '../../host.ts';

export const FrameworkChart = ({ data }: { data: IFunctionModulesPanel[] }) => {
  const t = useLang();
  /**
   * 将 FunctionModulesPanel[] 转换为 IFlowChartData 格式
   * 结构：Panels -> Epics -> FunctionModules
   */
  const chartData = useMemo<IFlowChartData>(() => {
    if (!data || data.length === 0) {
      return { nodes: [] };
    }

    const nodes: IFlowNode[] = [];
    const visiblePanels = data
      .map(panel => ({
        ...panel,
        modules: panel.modules.filter(
          epicGroup => epicGroup.function_modules.length > 0
        ),
      }))
      .filter(panel => panel.modules.length > 0);

    // 遍历每个面板
    visiblePanels.forEach(panel => {
      // 收集该面板下所有 Epic 的 ID
      const epicIds = panel.modules.map(
        epicGroup => `${panel.panel_id}-${epicGroup.epic_name}`
      );

      // 创建面板节点
      nodes.push({
        id: panel.panel_id,
        label: panel.title,
        description: `${panel.modules.length} ${panel.modules.length > 1 ? t.functional_groups : t.functional_group}`,
        children: epicIds,
      });

      // 遍历每个 Epic 组
      panel.modules.forEach(epicGroup => {
        const epicId = `${panel.panel_id}-${epicGroup.epic_name}`;

        // 收集该 Epic 下所有功能模块的 ID
        const functionIds = epicGroup.function_modules.map(
          func => func.function_id
        );

        // 创建 Epic 节点
        nodes.push({
          id: epicId,
          label: epicGroup.epic_name,
          description: `${epicGroup.function_modules.length} ${epicGroup.function_modules?.length > 1 ? t.total_functions : t.total_function}`,
          children: functionIds,
          data: {
            // An Epic is rejected only when every visible function in it is
            // rejected. A mixed Epic remains neutral in the full view.
            rejected: epicGroup.function_modules.every(func => func.rejected),
          },
        });

        // 创建功能模块节点（叶子节点）
        epicGroup.function_modules.forEach(func => {
          nodes.push({
            id: func.function_id,
            label: func.function_name,
            description: func.function_description,
            data: {
              priority: func.priority,
              rejected: func.rejected,
            },
          });
        });
      });
    });

    // 使用第一个面板作为根节点
    return { nodes, rootId: visiblePanels[0]?.panel_id };
  }, [
    data,
    t.functional_group,
    t.functional_groups,
    t.total_function,
    t.total_functions,
  ]);

  return (
    <FlowChart
      data={chartData}
      onNodeClick={() => {
        // console.log('onNodeClick node:', node);
      }}
      showControls
      // showMiniMap
      direction='horizontal'
    />
  );
};
