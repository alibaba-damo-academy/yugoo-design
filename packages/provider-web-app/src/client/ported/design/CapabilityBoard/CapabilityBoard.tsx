import { memo, useCallback } from 'react';
import { CollapsiblePanel } from '../collapsible-panel.tsx';
import FeatureModuleItem from '../FeatureModuleItem/index.tsx';
import type {
  IFunctionModulesPanel,
  IFunctionModuleType,
} from '../functionModulesTypes.ts';
import {
  getFunctionEpicAnchorId,
  getFunctionItemAnchorId,
} from '../FunctionModules/moduleTreeAnchors.ts';

export const CapabilityBoard = memo(
  ({
    data,
    disabled,
    onAnswer,
  }: {
    data: IFunctionModulesPanel;
    disabled: boolean;
    onAnswer: (val: IFunctionModulesPanel) => void;
  }) => {
    /**
     * 处理数据变更回调
     * @param panel_id - 面板ID
     * @param updatedData - 更新后的单个功能模块数据
     */
    const handleChange = useCallback(
      (panel_id: string, updatedData: IFunctionModuleType) => {
        // 根据 function_id 在 Epic Groups 中定位并更新模块
        const tempPanel: IFunctionModulesPanel = {
          ...data,
          panel_id: panel_id,
          modules: data.modules.map(epicGroup => ({
            ...epicGroup,
            function_modules: epicGroup.function_modules.map(module => {
              // 找到对应的模块并更新
              if (module.function_id === updatedData.function_id) {
                return updatedData;
              }
              return module;
            }),
          })),
        };

        // 调用父组件回调，同步到后端
        onAnswer(tempPanel);
      },
      [data, onAnswer]
    );

    return (
      <div className='space-y-4'>
        {data?.modules?.map((ele, idx) => {
          return (
            <div
              key={ele.epic_name || idx}
              id={getFunctionEpicAnchorId(data.panel_id, idx)}
            >
              <CollapsiblePanel
                className='overflow-hidden rounded-xl border border-[var(--ds-line-1)] bg-[var(--ds-bg-gary-default)] p-3'
                contentClassName='gap-3'
                title={ele.epic_name}
                count={`(${ele.function_modules?.length})`}
                defaultExpanded={ele.function_modules?.length > 0}
              >
                {ele.function_modules?.map((item, index) => {
                  return (
                    <div
                      key={item.function_id || index}
                      id={getFunctionItemAnchorId(item.function_id)}
                    >
                      <FeatureModuleItem
                        panelData={item}
                        disabled={disabled}
                        onChange={val => {
                          handleChange(data?.panel_id, val);
                        }}
                      />
                    </div>
                  );
                })}
              </CollapsiblePanel>
            </div>
          );
        })}
      </div>
    );
  }
);

CapabilityBoard.displayName = 'CapabilityBoard';
