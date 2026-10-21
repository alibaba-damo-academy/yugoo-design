import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';
import { Textarea } from '../../ui/textarea.tsx';
import {
  Dialog as AlertDialog,
  DialogClose,
  DialogContent as AlertDialogContent,
  DialogDescription as AlertDialogDescription,
  DialogFooter as AlertDialogFooter,
  DialogHeader as AlertDialogHeader,
  DialogTitle as AlertDialogTitle,
  DialogTrigger as AlertDialogTrigger,
} from '../../ui/dialog.tsx';
import { NativeDesignPanelContent, NativeDesignPanelFrame } from './NativeDesignPanelFrame.tsx';
import {
  createId,
  DeleteButton,
  DesignPanelAddButton,
  DesignPanelHeader,
  DesignPanelNavItem,
  DesignPanelSidebar,
  EditablePanelTitle,
  EmptyPanel,
  ordered,
  Section,
} from './panelPrimitives.tsx';

const AlertDialogCancel = ({ children }: { children: React.ReactNode }) => (
  <DialogClose asChild>
    <Button type='button' variant='outline'>{children}</Button>
  </DialogClose>
);

const AlertDialogAction = ({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) => (
  <DialogClose asChild>
    <Button type='button' onClick={onClick}>{children}</Button>
  </DialogClose>
);

export interface AcceptanceRequirement {
  id: string;
  title: string;
  condition: string;
  pass_criteria: string;
  verification: string;
}

export interface QualityAcceptanceState {
  schema_version?: 4;
  requirements?: Record<string, AcceptanceRequirement>;
  requirement_order?: string[];
}

export interface QualityAcceptancePanelProps {
  panel: QualityAcceptanceState;
  disabled: boolean;
  onChange: (changes: Partial<QualityAcceptanceState>) => void;
}

export const QualityAcceptancePanel = ({
  panel,
  disabled,
  onChange,
}: QualityAcceptancePanelProps) => {
  const requirementRecords = useMemo(
    () =>
      (panel.requirements ?? {}) as Record<
        string,
        AcceptanceRequirement
      >,
    [panel.requirements]
  );
  const requirements = useMemo(
    () => ordered(requirementRecords, panel.requirement_order),
    [panel.requirement_order, requirementRecords]
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    requirements[0]?.id ?? null
  );
  const pendingRequirementId = useRef<string | null>(null);
  const selected =
    requirements.find(item => item.id === selectedId) ??
    requirements[0] ??
    null;

  useEffect(() => {
    if (!selectedId || !requirements.some(item => item.id === selectedId)) {
      setSelectedId(requirements[0]?.id ?? null);
    }
  }, [requirements, selectedId]);

  const updateRequirement = (
    updates: Partial<AcceptanceRequirement>
  ) => {
    if (!selected) return;
    onChange({
      requirements: {
        ...requirementRecords,
        [selected.id]: { ...selected, ...updates },
      },
    });
  };

  const addRequirement = () => {
    const id = createId('acceptance');
    const title = requirements.length
      ? `新验收要求 ${requirements.length + 1}`
      : '新验收要求';
    onChange({
      requirements: {
        ...requirementRecords,
        [id]: {
          id,
          title,
          condition: '',
          pass_criteria: '',
          verification: '',
        },
      },
      requirement_order: [...requirements.map(item => item.id), id],
    });
    pendingRequirementId.current = id;
    setSelectedId(id);
  };

  const removeRequirement = () => {
    if (!selected) return;
    const nextRequirements = { ...requirementRecords };
    delete nextRequirements[selected.id];
    const nextOrder = requirements
      .map(item => item.id)
      .filter(id => id !== selected.id);
    onChange({
      requirements: nextRequirements,
      requirement_order: nextOrder,
    });
    setSelectedId(nextOrder[0] ?? null);
  };

  return (
    <NativeDesignPanelFrame autoSaveId='quality-acceptance-panel-sidebar'>
      <DesignPanelSidebar
        icon={<CheckCircle2 className='size-4 text-[var(--ds-text-7)]' />}
        title='验收要求'
      >
        {requirements.map(item => (
          <DesignPanelNavItem
            key={item.id}
            aria-label={`切换到验收要求${item.title}`}
            selected={selected?.id === item.id}
            onClick={() => setSelectedId(item.id)}
          >
            <strong className='block truncate'>{item.title}</strong>
          </DesignPanelNavItem>
        ))}
        <DesignPanelAddButton disabled={disabled} onClick={addRequirement}>
          添加验收要求
        </DesignPanelAddButton>
      </DesignPanelSidebar>

      <NativeDesignPanelContent mode='scroll'>
        {selected ? (
          <>
            <DesignPanelHeader>
              <EditablePanelTitle
                autoFocus={pendingRequirementId.current === selected.id}
                aria-label='当前验收要求名称'
                className='max-w-sm'
                value={selected.title}
                disabled={disabled}
                placeholder='例如：订单提交成功'
                onBlur={() => {
                  pendingRequirementId.current = null;
                }}
                onChange={event => {
                  pendingRequirementId.current = null;
                  updateRequirement({ title: event.target.value });
                }}
              />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <DeleteButton
                    label={`删除验收要求${selected.title}`}
                    disabled={disabled}
                  />
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      删除“{selected.title}”？
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      这项验收要求会被移除，其他要求不会受到影响。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction onClick={removeRequirement}>
                      确认删除
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </DesignPanelHeader>

            <Section
              title='在什么情况下验收？'
              description='写清具体情境，以及用户做了什么或产品发生了什么。'
            >
              <div className='max-w-2xl'>
                <Textarea
                  id={`condition-${selected.id}`}
                  aria-label='在什么情况下验收？'
                  className='min-h-24 resize-y'
                  value={selected.condition}
                  disabled={disabled}
                  placeholder='例如：用户已填写完整订单并点击提交；或用户在普通网络下打开订单详情'
                  onChange={event =>
                    updateRequirement({ condition: event.target.value })
                  }
                />
              </div>
            </Section>

            <Section
              title='怎样才算通过？'
              description='写出用户能看到、系统能确认或可以衡量的标准，避免“体验良好”一类模糊描述。'
            >
              <div className='max-w-2xl'>
                <Textarea
                  id={`pass-criteria-${selected.id}`}
                  aria-label='怎样才算通过？'
                  className='min-h-28 resize-y'
                  value={selected.pass_criteria}
                  disabled={disabled}
                  placeholder='例如：生成订单号并显示待处理；或主要内容在 2 秒内可阅读'
                  onChange={event =>
                    updateRequirement({ pass_criteria: event.target.value })
                  }
                />
              </div>
            </Section>

            <Section
              title='如何确认？（可选）'
              description='只有检查方法不明显时才补充，不需要写测试代码。'
            >
              <div className='max-w-2xl'>
                <Textarea
                  id={`verification-${selected.id}`}
                  aria-label='如何确认？（可选）'
                  className='min-h-20 resize-y'
                  value={selected.verification}
                  disabled={disabled}
                  placeholder='例如：用典型订单数据记录页面主要内容出现的时间'
                  onChange={event =>
                    updateRequirement({ verification: event.target.value })
                  }
                />
              </div>
            </Section>
          </>
        ) : (
          <EmptyPanel message='添加一项验收要求，说明在什么情况下，出现什么结果才算通过。' />
        )}
      </NativeDesignPanelContent>
    </NativeDesignPanelFrame>
  );
};
