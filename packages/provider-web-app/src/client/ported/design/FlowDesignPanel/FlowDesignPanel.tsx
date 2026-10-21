import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {
  IFlowDesignPanel as IFlowDesignPanelData,
  IFlowProcessItem,
} from './flowDesignTypes.ts';
import { useLang } from '../../host.ts';
import { useLangSwitch } from '../ResearchPanel/useLangSwitch.ts';
import { Button } from '../../ui/button.tsx';
import { cn } from '../../ui/cn.ts';
import { BpmnViewer } from './BpmnViewer.tsx';
import { BpmnEditor } from './BpmnEditor.tsx';
import { FlowProcessNav } from './FlowProcessNav.tsx';
import {
  FlowProcessDetail,
  FlowProcessTags,
} from './FlowProcessDetail.tsx';
import { IconFont } from '../../ui/icon-font.tsx';
import { EllipsisTooltip } from '../../ui/ellipsis-tooltip.tsx';
import { NativeDesignPanelFrame } from '../OfficialWebAppPanels/NativeDesignPanelFrame.tsx';
import {
  DesignPanelHeader,
  DesignPanelSidebar,
  DesignPanelTitle,
} from '../OfficialWebAppPanels/panelPrimitives.tsx';
import { DesignExecutionStatusIcon } from '../OfficialWebAppPanels/DesignExecutionStatusIcon.tsx';
import { ExecutionRollingLog, type ExecutionRollingLogProps } from 'dsh-design-panel/client-api';

export interface IFlowDesignPanelProps {
  data: IFlowDesignPanelData;
  disabled?: boolean;
  readExecutionLog?: ExecutionRollingLogProps['readExecutionLog'];
  /**
   * Receives the full process list after an editor flush (the edited
   * process carries `bpmn_xml` + `bpmn_edited`). dsh replacement for the
   * original `updateDesignPanel` design-store write; the adapter merges it
   * back into the flat draft state.
   */
  onProcessesChange?: (processes: IFlowProcessItem[]) => void;
}

/**
 * 业务流程设计面板
 *
 * View vs edit modes (per process):
 * - **View** (default): NavigatedViewer — pan/zoom only.
 * - **Edit**: full bpmn-js Modeler. Edits debounce-flush their serialised
 *   XML into the panel draft under the matching process_id with
 *   ``bpmn_edited=true``. The adapter submits that edit to the host, which
 *   validates and settles the artifact; projected ``bpmn_file`` and status
 *   fields never become durable process authority.
 */
export const FlowDesignPanel: React.FC<IFlowDesignPanelProps> = ({
  data,
  disabled = false,
  readExecutionLog,
  onProcessesChange,
}) => {
  const t = useLang();

  const processes = useMemo(() => data.processes ?? [], [data.processes]);
  const activeProcesses = useMemo(
    () => processes.filter(p => !p.deleted),
    [processes]
  );
  const rejectedProcesses = useMemo(
    () => processes.filter(p => p.deleted),
    [processes]
  );

  const pickDefault = (): string | null => {
    if (activeProcesses.length > 0) return activeProcesses[0].process_id;
    if (rejectedProcesses.length > 0) return rejectedProcesses[0].process_id;
    return null;
  };
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    pickDefault()
  );
  const [expanded, setExpanded] = useState(false);

  // Edit mode is per-process. Switching process auto-exits edit (the
  // current process's last debounced flush is already in the store, the
  // new process starts in view mode).
  const [editingProcessId, setEditingProcessId] = useState<string | null>(null);

  useEffect(() => {
    if (!processes.length) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    const stillExists = processes.some(p => p.process_id === selectedId);
    if (!stillExists) {
      setSelectedId(pickDefault());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processes]);

  // Reset to collapsed whenever the user picks a different process.
  useEffect(() => {
    setExpanded(false);
    setEditingProcessId(null);
  }, [selectedId]);

  const selectedProcess = useMemo(() => {
    if (!selectedId) return null;
    return processes.find(p => p.process_id === selectedId) ?? null;
  }, [processes, selectedId]);

  const isEditing =
    selectedProcess !== null && editingProcessId === selectedProcess.process_id;

  const handleToggleEdit = useCallback(() => {
    if (!selectedProcess || disabled) return;
    setEditingProcessId(prev =>
      prev === selectedProcess.process_id ? null : selectedProcess.process_id
    );
  }, [disabled, selectedProcess]);

  const handleToggleDetail = useCallback(() => {
    setExpanded(prev => {
      const nextExpanded = !prev;
      if (nextExpanded) {
        setEditingProcessId(null);
      }
      return nextExpanded;
    });
  }, []);

  // Editor change handler — receives the debounced XML and merges it into
  // the process list under the active process_id with bpmn_edited=true.
  const handleEditorChange = useCallback(
    (newXml: string) => {
      if (!selectedProcess) return;
      const processId = selectedProcess.process_id;
      const nextProcesses = processes.map(p =>
        p.process_id === processId
          ? { ...p, bpmn_xml: newXml, bpmn_edited: true }
          : p
      );
      onProcessesChange?.(nextProcesses);
    },
    [selectedProcess, processes, onProcessesChange]
  );

  if (!processes.length) {
    return (
      <div className='flex h-40 items-center justify-center gap-2 text-sm text-gray-400'>{t.no_data}</div>
    );
  }

  const hasBpmn = Boolean(
    selectedProcess?.bpmn_generated && selectedProcess?.bpmn_xml
  );

  const processWorkspace = !selectedProcess ? (
    <div className='flex items-center justify-center h-full text-sm text-gray-400'>
      {t.flow_select_process}
    </div>
  ) : (
    <div className='relative h-full flex flex-col bg-white'>
      <DesignPanelHeader>
        <div className='flex min-w-0 flex-1 items-center gap-2'>
          <DesignPanelTitle
            className={cn(
              'min-w-0 flex-1',
              selectedProcess.deleted && 'text-gray-500 line-through'
            )}
          >
            {selectedProcess.title}
          </DesignPanelTitle>
          <FlowProcessTags process={selectedProcess} />
          {hasBpmn && selectedProcess.generation_status !== 'completed' && (
            <span className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
              selectedProcess.generation_status === 'failed'
                ? 'bg-red-50 text-red-600'
                : 'bg-amber-50 text-amber-700'
            )}>
              {selectedProcess.generation_status === 'failed'
                ? '更新失败 · 显示上一版'
                : '待更新 · 显示上一版'}
            </span>
          )}
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          {hasBpmn && (
            <EditToggleButton
              editing={isEditing}
              dirty={Boolean(selectedProcess.bpmn_edited)}
              onClick={handleToggleEdit}
              disabled={expanded || disabled}
            />
          )}
          <ToggleButton
            expanded={expanded}
            onClick={handleToggleDetail}
            process={selectedProcess}
          />
        </div>
      </DesignPanelHeader>

      {expanded ? (
        <div className='flex-1 min-h-0 overflow-y-auto bg-[var(--ds-bg-gary-default)]'>
          <FlowProcessDetail process={selectedProcess} />
        </div>
      ) : (
        <>
          <div className='flex-1 min-h-0'>
            {hasBpmn ? (
              isEditing ? (
                <BpmnEditor
                  key={`editor-${selectedProcess.process_id}`}
                  xml={selectedProcess.bpmn_xml as string}
                  processId={selectedProcess.process_id}
                  onChange={handleEditorChange}
                />
              ) : (
                <BpmnViewer
                  key={`viewer-${selectedProcess.process_id}`}
                  xml={selectedProcess.bpmn_xml as string}
                  processId={selectedProcess.process_id}
                />
              )
            ) : (
              <BpmnPlaceholder process={selectedProcess} readExecutionLog={readExecutionLog} />
            )}
          </div>

          <FlowProcessSummary process={selectedProcess} />
        </>
      )}
    </div>
  );
  return (
    <NativeDesignPanelFrame autoSaveId='flow-design-panel-sidebar'>
      <DesignPanelSidebar
        icon={
          <IconFont
            type='icon-line-business-attributionanalysis'
            className='text-[var(--ds-text-7)]'
          />
        }
        title={`${String(t.design_text_process)}(${activeProcesses.length})`}
      >
        <FlowProcessNav
          active={activeProcesses}
          rejected={rejectedProcesses}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </DesignPanelSidebar>
      {processWorkspace}
    </NativeDesignPanelFrame>
  );
};

interface IFlowProcessSummaryProps {
  process: IFlowProcessItem;
}

/** Compact two-row summary below the BPMN canvas. */
const FlowProcessSummary: React.FC<IFlowProcessSummaryProps> = ({ process }) => {
  const t = useLang();
  const rows = [
    { label: t.flow_description, value: process.description || t.flow_no_description },
    {
      label: t.flow_stakeholders,
      value: process.stakeholders?.length
        ? process.stakeholders.join(' · ')
        : t.flow_no_stakeholders,
    },
  ];

  return (
    <dl className='min-w-0 shrink-0 overflow-hidden border-t border-[var(--ds-border-default)] bg-[var(--ds-bg-gary-default)] text-sm'>
      {rows.map(({ label, value }, index) => (
        <div
          key={label}
          className={cn(
            'grid min-h-9 min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3 px-3 py-1.5',
            index > 0 && 'border-t border-[var(--ds-divider-default)]'
          )}
        >
          <dt className='whitespace-nowrap text-xs font-medium text-[var(--ds-text-secondary)]'>
            {label}
          </dt>
          <dd className='min-w-0 overflow-hidden text-[var(--ds-text-primary)]' title={value}>
            <EllipsisTooltip width='100%' placement='top'>
              {value}
            </EllipsisTooltip>
          </dd>
        </div>
      ))}
    </dl>
  );
};

interface IToggleButtonProps {
  expanded: boolean;
  onClick: () => void;
  process: IFlowProcessItem;
}

const ToggleButton: React.FC<IToggleButtonProps> = ({
  expanded,
  onClick,
  process,
}) => {
  const t = useLang();
  // 折叠态直接把按钮文字换成内含类别（只列存在的），点开即展开；展开态回到收起。
  // 一个按钮兼当"图之外还有什么"的提示，不再另设标签。
  const cats = [
    (process.key_features?.length ?? 0) > 0 && t.flow_category_features,
    (process.business_rules?.length ?? 0) > 0 && t.flow_category_rules,
    (process.exception_handling?.length ?? 0) > 0 && t.flow_category_exceptions,
  ].filter(Boolean) as string[];
  const label = expanded
    ? t.close_detail
    : cats.length
      ? cats.join(' · ')
      : t.view_details;

  return (
    <Button
      type='button'
      variant='outline'
      size='sm'
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <span>{label}</span>
      {!expanded && <span className='text-[10px]'>▾</span>}
    </Button>
  );
};

interface IEditToggleButtonProps {
  editing: boolean;
  dirty: boolean;
  onClick: () => void;
  disabled?: boolean;
}

const EditToggleButton: React.FC<IEditToggleButtonProps> = ({
  editing,
  dirty,
  onClick,
  disabled,
}) => {
  const t = useLang();
  const label = disabled
    ? t.flow_edit_disabled
    : editing
      ? t.flow_exit_edit
      : t.flow_edit_diagram;
  return (
    <Button
      type='button'
      variant='outline'
      size='sm'
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      <IconFont
        type={
          editing ? 'icon-line-operation-select' : 'icon-line-operation-edit'
        }
        style={{ fontSize: 14 }}
      />
      <span>{editing ? t.have_done : t.button_edit}</span>
      {dirty && (
        <span
          className='w-1.5 h-1.5 rounded-full bg-amber-500'
          title={t.element_edit_panel_unsaved_changes}
        />
      )}
    </Button>
  );
};

interface IBpmnPlaceholderProps {
  process: IFlowProcessItem;
  readExecutionLog?: ExecutionRollingLogProps['readExecutionLog'];
}

const BpmnPlaceholder: React.FC<IBpmnPlaceholderProps> = ({ process, readExecutionLog }) => {
  const t = useLang();
  const { currentLanguage } = useLangSwitch();
  const active = process.generation_status === 'queued' || process.generation_status === 'working';
  const loading = Boolean(process.bpmn_file && process.bpmn_loading);
  const unavailable = Boolean(
    process.bpmn_file && !process.bpmn_loading && !process.bpmn_available
  );
  return (
    <div className='h-full w-full flex items-center justify-center bg-[var(--ds-bg-gary-default)]'>
      <div className='flex flex-col items-center gap-2 text-center px-6'>
        <div className='w-12 h-12 rounded-full bg-white border border-dashed border-[#D9D5E8] flex items-center justify-center text-2xl text-[#A89BD8]'>
          {loading ? (
            <DesignExecutionStatusIcon status='working' label={t.flow_diagram_loading_artifact} />
          ) : '◇'}
        </div>
        <div className='text-sm font-medium text-[var(--ds-text-primary)]'>
          {loading
            ? t.flow_diagram_loading_artifact
            : unavailable
              ? t.flow_generated_diagram_unavailable
              : t.flow_no_bpmn_diagram}
        </div>
        <div className='text-xs text-gray-500 max-w-xs leading-[18px]'>
          {loading
            ? t.flow_diagram_loading_artifact_hint
            : unavailable
              ? t.flow_generated_diagram_unavailable
              : t.flow_diagram_generating}
        </div>
        <ExecutionRollingLog
          runId={process.execution_run_id}
          active={active}
          locale={currentLanguage === 'zh_CN' ? 'zh' : 'en'}
          label={currentLanguage === 'zh_CN' ? '流程生成日志' : 'Flow generation log'}
          readExecutionLog={readExecutionLog}
        />
      </div>
    </div>
  );
};

export type { IFlowProcessItem };
