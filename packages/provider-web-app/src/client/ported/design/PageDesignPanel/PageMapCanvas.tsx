/**
 * Page map canvas: @xyflow/react page nodes (name + type + generation
 * status) and labeled navigation edges. Node drags persist `canvas_position`;
 * edge clicks open an inline label editor with a delete action. Pages without
 * a persisted position follow the shared navigation's functional groups.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  NodeResizer,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Home, Plus, Trash2 } from 'lucide-react';
import { cn } from '../../ui/cn.ts';
import { Button } from '../../ui/button.tsx';
import { IconButton } from '../../ui/icon-button.tsx';
import { useLang } from '../../host.ts';
import { inputClass } from '../OfficialWebAppPanels/panelPrimitives.tsx';
import {
  pageStatusLabel,
  pageTypeLabel,
} from './pageDesignLabels.ts';
import type {
  IPageCommonSpec,
  IPageConnection,
  IPageMapSectionState,
  IPageNode,
} from './pageDesignTypes.ts';
import { PageThumbnail } from './PagePreview.tsx';
import { DesignExecutionStatusIcon } from '../OfficialWebAppPanels/DesignExecutionStatusIcon.tsx';
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  PAGE_MAP_SECTION_HEADER_HEIGHT,
  PAGE_MAP_SECTION_PADDING_BOTTOM,
  PAGE_MAP_SECTION_PADDING_X,
  pageMapGroupedLayout,
} from './pageMapLayout.ts';

export interface IPageMapCanvasProps {
  /** Pages in `page_order` order. */
  pages: IPageNode[];
  /** Connections in `connection_order` order. */
  connections: IPageConnection[];
  /** Shared navigation used to group pages by product function. */
  commonSpec?: IPageCommonSpec | null;
  /** User-authored section titles and geometry. */
  canvasSections?: Record<string, IPageMapSectionState>;
  /** Entry-page ids (badge on nodes). */
  entryPageIds: string[];
  /** Currently selected page id (map highlight follows the sidebar). */
  selectedId: string | null;
  /** Design Style CSS custom properties used inside artifact thumbnails. */
  styleCss?: string;
  /** Read-only interaction while a host save is in flight. */
  disabled?: boolean;
  /** Select a page (node click). */
  onSelectPage: (id: string) => void;
  /** Select a page and leave the map (node double-click). */
  onOpenPage: (id: string) => void;
  /** Persist a dragged node and the complete materialized section layout. */
  onMovePage: (
    id: string,
    position: { x: number; y: number },
    sections: Record<string, IPageMapSectionState>
  ) => void;
  /** Replace the complete user-authored section layout. */
  onReplaceSections: (
    sections: Record<string, IPageMapSectionState>,
    movedPages?: Readonly<Record<string, { x: number; y: number }>>
  ) => void;
  /** Create one directed page-to-page navigation connection. */
  onCreateConnection: (sourcePageId: string, targetPageId: string) => void;
  /** Rename a connection label. */
  onUpdateConnection: (id: string, label: string) => void;
  /** Delete a connection. */
  onDeleteConnection: (id: string) => void;
}

type PageMapFlowNode = Node<
  { page: IPageNode; isEntry: boolean; isSelected: boolean; styleCss?: string },
  'page-map'
>;

type PageMapSectionNode = Node<
  {
    section: IPageMapSectionState;
    disabled: boolean;
    onUpdate: (section: IPageMapSectionState, previousLabel: string) => void;
    onDelete: (sectionId: string) => void;
  },
  'page-map-section'
>;

type PageMapNode = PageMapFlowNode | PageMapSectionNode;

const PAGE_HANDLE_POSITIONS = [
  Position.Top,
  Position.Right,
  Position.Bottom,
  Position.Left,
] as const;

function pageHandleId(type: 'source' | 'target', position: Position): string {
  return `${type}-${position}`;
}

/** One page card on the map. */
const PageMapNode = ({ data }: NodeProps<PageMapFlowNode>) => {
  const t = useLang();
  const { page, isEntry, isSelected, styleCss } = data;
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-[var(--ds-border-default)] bg-white shadow-sm transition-shadow hover:shadow-md',
        isSelected &&
          'ring-2 ring-[var(--ds-brand-border-default)] ring-offset-2'
      )}
      style={{ width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
    >
      <div className='h-[172px] overflow-hidden border-b border-[var(--ds-border-default)] bg-white'>
        <PageThumbnail page={page} styleCss={styleCss} />
      </div>
      <div className='flex min-w-0 items-center justify-between gap-3 px-3 py-2.5'>
        <div className='min-w-0'>
          <div className='flex min-w-0 items-center gap-1.5'>
            {isEntry ? (
              <Home
                className='size-3.5 shrink-0 text-[var(--ds-brand-text-primary)]'
                aria-label={t.page_design_entry_page}
              />
            ) : null}
            <span className='truncate text-sm font-medium text-[var(--ds-text-primary)]'>
              {page.name}
            </span>
          </div>
          <div className='mt-0.5 truncate text-xs text-[var(--ds-text-tertiary)]'>
            {pageTypeLabel(t, page)} · {(page.function_refs ?? []).length} {t.page_design_functions}
          </div>
        </div>
        <span className='shrink-0' title={pageStatusLabel(t, page)}>
          <DesignExecutionStatusIcon
            status={page.generation_status === 'working'
              ? 'working'
              : page.generation_status === 'queued'
                ? 'queued'
                : page.generation_status === 'completed'
                    ? 'completed'
                    : page.generation_status === 'failed'
                      ? 'failed'
                      : 'pending'}
            label={pageStatusLabel(t, page)}
          />
        </span>
      </div>
      {PAGE_HANDLE_POSITIONS.map((position) => (
        <span key={position}>
          <Handle
            id={pageHandleId('target', position)}
            type='target'
            position={position}
            className='!h-3 !w-3 !border-0 !bg-transparent !opacity-0'
          />
          <Handle
            id={pageHandleId('source', position)}
            type='source'
            position={position}
            className='!h-2.5 !w-2.5 !border-2 !border-white !bg-[var(--ds-brand-text-primary)]'
          />
        </span>
      ))}
    </div>
  );
};

/** One editable functional group behind its Page cards and connections. */
const PageMapSection = ({ data, selected }: NodeProps<PageMapSectionNode>) => {
  const t = useLang();
  const [label, setLabel] = useState(data.section.label);
  useEffect(() => setLabel(data.section.label), [data.section.label]);

  const commitLabel = (): void => {
    const nextLabel = label.trim();
    if (nextLabel === '' || nextLabel === data.section.label) {
      setLabel(data.section.label);
      return;
    }
    data.onUpdate({ ...data.section, label: nextLabel }, data.section.label);
  };

  return (
    <section
      aria-label={`${data.section.label} ${t.page_design_page_group}`}
      className={cn(
        'h-full w-full rounded-2xl border bg-[var(--ds-bg-gary-default)]',
        selected
          ? 'border-[var(--ds-brand-border-default)]'
          : 'border-[var(--ds-divider-default)]'
      )}
    >
      <NodeResizer
        isVisible={selected && !data.disabled}
        minWidth={NODE_WIDTH + PAGE_MAP_SECTION_PADDING_X * 2}
        minHeight={NODE_HEIGHT + PAGE_MAP_SECTION_HEADER_HEIGHT + PAGE_MAP_SECTION_PADDING_BOTTOM}
        lineClassName='!border-[var(--ds-brand-border-default)]'
        handleClassName='!h-2.5 !w-2.5 !rounded-sm !border !border-white !bg-[var(--ds-brand-text-primary)]'
        onResizeEnd={(_, params) => {
          data.onUpdate({
            ...data.section,
            canvas_position: { x: params.x, y: params.y },
            canvas_size: { width: params.width, height: params.height },
          }, data.section.label);
        }}
      />
      <div className='flex h-10 items-center gap-2 border-b border-[var(--ds-divider-default)] px-3 text-sm font-medium text-[var(--ds-text-secondary)]'>
        <input
          className='nodrag nopan min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 font-medium text-[var(--ds-text-secondary)] outline-none hover:bg-white/60 focus:bg-white'
          aria-label={t.page_design_page_group}
          disabled={data.disabled}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={commitLabel}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setLabel(data.section.label);
              event.currentTarget.blur();
            }
          }}
        />
        <span className='text-xs font-normal text-[var(--ds-text-tertiary)]'>
          {t.page_design_page_group_count.replace('{n}', String(data.section.page_ids.length))}
        </span>
        <IconButton
          type='button'
          size='sm'
          variant='transparent'
          shape='square'
          className='nodrag nopan'
          disabled={data.disabled}
          aria-label={t.page_design_delete_section}
          title={t.page_design_delete_section}
          onClick={() => data.onDelete(data.section.id)}
        >
          <Trash2 className='size-3.5' />
        </IconButton>
      </div>
    </section>
  );
};

const PAGE_MAP_NODE_TYPES = {
  'page-map': PageMapNode,
  'page-map-section': PageMapSection,
};

/** The canvas body; `ReactFlowProvider` wraps the ReactFlow hooks. */
function PageMapCanvasInner(props: IPageMapCanvasProps): JSX.Element {
  const t = useLang();
  const canvasRef = useRef<HTMLDivElement>(null);
  const fittedRef = useRef(false);
  const fitFrameRef = useRef<number>();
  const { fitView, getViewport, screenToFlowPosition } = useReactFlow();
  const {
    pages,
    connections,
    commonSpec,
    canvasSections,
    entryPageIds,
    selectedId,
    styleCss,
    disabled = false,
    onSelectPage,
    onOpenPage,
    onMovePage,
    onReplaceSections,
    onCreateConnection,
    onUpdateConnection,
    onDeleteConnection,
  } = props;
  const records = useMemo<Record<string, IPageNode>>(
    () => Object.fromEntries(pages.map((page) => [page.id, page] as const)),
    [pages]
  );

  const groupedLayout = useMemo(
    () => pageMapGroupedLayout(pages, records, commonSpec, {
      primary: t.page_design_page_group_primary,
      other: t.page_design_page_group_other,
      generic: t.page_design_page_group_generic,
    }),
    [
      commonSpec,
      pages,
      records,
      t.page_design_page_group_generic,
      t.page_design_page_group_other,
      t.page_design_page_group_primary,
    ]
  );

  const automaticSections = useMemo<IPageMapSectionState[]>(() =>
    groupedLayout.sections.map((section) => {
      const sectionPositions = section.pageIds
        .map(pageId => groupedLayout.positions.get(pageId))
        .filter((position): position is { x: number; y: number } => position !== undefined);
      const minX = Math.min(...sectionPositions.map(position => position.x));
      const minY = Math.min(...sectionPositions.map(position => position.y));
      const maxX = Math.max(...sectionPositions.map(position => position.x));
      const maxY = Math.max(...sectionPositions.map(position => position.y));
      return {
        id: section.id,
        label: section.label,
        page_ids: [...section.pageIds],
        canvas_position: {
          x: minX - PAGE_MAP_SECTION_PADDING_X,
          y: minY - PAGE_MAP_SECTION_HEADER_HEIGHT,
        },
        canvas_size: {
          width: maxX - minX + NODE_WIDTH + PAGE_MAP_SECTION_PADDING_X * 2,
          height:
            maxY - minY + NODE_HEIGHT + PAGE_MAP_SECTION_HEADER_HEIGHT +
            PAGE_MAP_SECTION_PADDING_BOTTOM,
        },
      };
    }), [groupedLayout]);

  // Once the user edits the grouping layout, canvas_sections becomes the
  // complete authority. Before that, deterministic functional groups are only
  // a view projection and are materialized on the first edit.
  const sectionStates = useMemo<IPageMapSectionState[]>(() =>
    canvasSections === undefined
      ? automaticSections
      : Object.values(canvasSections),
  [automaticSections, canvasSections]);

  const sectionRecord = useCallback((
    replacement?: IPageMapSectionState,
    removedId?: string
  ): Record<string, IPageMapSectionState> => Object.fromEntries(sectionStates
    .filter(section => section.id !== removedId)
    .map(section => {
      const value = replacement?.id === section.id ? replacement : section;
      return [value.id, value];
    })
    .concat(replacement !== undefined && !sectionStates.some(section => section.id === replacement.id)
      ? [[replacement.id, replacement]]
      : [])), [sectionStates]);

  const updateSection = useCallback((section: IPageMapSectionState): void => {
    onReplaceSections(sectionRecord(section));
  }, [onReplaceSections, sectionRecord]);

  const deleteSection = useCallback((sectionId: string): void => {
    onReplaceSections(sectionRecord(undefined, sectionId));
  }, [onReplaceSections, sectionRecord]);

  // Functional group frames are manual z-index 0, connections are 1, and Page
  // cards are 2. Persisted geometry remains user-owned.
  const initialNodes = useMemo<PageMapNode[]>(() => {
    const pageNodes: PageMapFlowNode[] = pages.map((page) => ({
      id: page.id,
      type: 'page-map',
      position: groupedLayout.positions.get(page.id) ?? { x: 0, y: 0 },
      data: {
        page,
        isEntry: entryPageIds.includes(page.id),
        isSelected: page.id === selectedId,
        styleCss,
      },
      style: {
        padding: 0,
        border: 0,
        background: 'transparent',
        boxShadow: 'none',
      },
      zIndex: 2,
      draggable: !disabled,
    }));
    const sectionNodes: PageMapSectionNode[] = sectionStates.map((sectionState) => {
      return {
        id: sectionState.id,
        type: 'page-map-section',
        position: sectionState.canvas_position,
        data: {
          section: sectionState,
          disabled,
          onUpdate: updateSection,
          onDelete: deleteSection,
        },
        style: {
          width: sectionState.canvas_size.width,
          height: sectionState.canvas_size.height,
        },
        zIndex: 0,
        draggable: !disabled,
        selectable: true,
        connectable: false,
        focusable: true,
      };
    });
    return [...sectionNodes, ...pageNodes];
  }, [deleteSection, disabled, entryPageIds, groupedLayout, pages, sectionStates, selectedId, styleCss, updateSection]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const sectionDragRef = useRef<{
    id: string;
    position: { x: number; y: number };
    pagePositions: Record<string, { x: number; y: number }>;
  } | null>(null);
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || fittedRef.current) return;
    let active = true;
    const cancelFit = (): void => {
      if (fitFrameRef.current === undefined) return;
      window.cancelAnimationFrame(fitFrameRef.current);
      fitFrameRef.current = undefined;
    };
    const attemptFit = (): void => {
      fitFrameRef.current = undefined;
      if (!active || fittedRef.current) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      void fitView({ padding: 0.18, maxZoom: 0.9 });
      fitFrameRef.current = window.requestAnimationFrame(() => {
        fitFrameRef.current = undefined;
        if (!active) return;
        if (getViewport().zoom <= 0.900001) {
          fittedRef.current = true;
          return;
        }
        fitFrameRef.current = window.requestAnimationFrame(attemptFit);
      });
    };
    const fitWhenVisible = (): void => {
      if (fittedRef.current || fitFrameRef.current !== undefined || pages.length === 0) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      fitFrameRef.current = window.requestAnimationFrame(attemptFit);
    };
    const observer = new ResizeObserver(fitWhenVisible);
    observer.observe(canvas);
    fitWhenVisible();
    return () => {
      active = false;
      observer.disconnect();
      cancelFit();
    };
  }, [fitView, getViewport, pages.length]);

  const [selectedConnectionId, setSelectedConnectionId] = useState<
    string | null
  >(null);
  const selectedConnection = connections.find(
    (connection) => connection.id === selectedConnectionId
  );
  useEffect(() => {
    if (
      selectedConnectionId !== null &&
      !connections.some((connection) => connection.id === selectedConnectionId)
    ) {
      setSelectedConnectionId(null);
    }
  }, [connections, selectedConnectionId]);

  const pagePositions = useMemo(
    () => new Map(nodes
      .filter(node => records[node.id] !== undefined)
      .map(node => [node.id, node.position] as const)),
    [nodes, records]
  );

  const edges = useMemo<Edge[]>(
    () =>
      connections.map((connection) => {
        const source = pagePositions.get(connection.source_page_id) ?? { x: 0, y: 0 };
        const target = pagePositions.get(connection.target_page_id) ?? { x: 0, y: 0 };
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const horizontal = Math.abs(dx) >= Math.abs(dy);
        const sourcePosition = horizontal
          ? (dx >= 0 ? Position.Right : Position.Left)
          : (dy >= 0 ? Position.Bottom : Position.Top);
        const targetPosition = horizontal
          ? (dx >= 0 ? Position.Left : Position.Right)
          : (dy >= 0 ? Position.Top : Position.Bottom);
        return {
          id: connection.id,
          source: connection.source_page_id,
          target: connection.target_page_id,
          sourceHandle: pageHandleId('source', sourcePosition),
          targetHandle: pageHandleId('target', targetPosition),
          label: connection.label,
          type: 'smoothstep',
          zIndex: 1,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: 'var(--ds-text-tertiary)',
          },
          style: {
            stroke: 'var(--ds-text-tertiary)',
            strokeWidth: selectedConnectionId === connection.id ? 2.4 : 1.6,
          },
          labelStyle: {
            fontSize: 12,
            fontWeight: 500,
            fill: 'var(--ds-text-secondary)',
          },
          labelShowBg: true,
          labelBgPadding: [6, 4] as [number, number],
          labelBgBorderRadius: 4,
          labelBgStyle: {
            fill: 'var(--ds-static-white)',
            fillOpacity: 0.94,
          },
        };
      }),
    [connections, pagePositions, selectedConnectionId]
  );

  const materializedSectionsForPage = useCallback((
    pageId: string,
    position: { x: number; y: number }
  ): Record<string, IPageMapSectionState> => {
    const center = { x: position.x + NODE_WIDTH / 2, y: position.y + NODE_HEIGHT / 2 };
    const sectionNodes = nodes.filter((node): node is PageMapSectionNode => node.type === 'page-map-section');
    const containing = sectionNodes
      .filter((node) => {
        const width = node.data.section.canvas_size.width;
        const height = node.data.section.canvas_size.height;
        return center.x >= node.position.x && center.x <= node.position.x + width
          && center.y >= node.position.y && center.y <= node.position.y + height;
      })
      .sort((left, right) => (
        left.data.section.canvas_size.width * left.data.section.canvas_size.height
        - right.data.section.canvas_size.width * right.data.section.canvas_size.height
      ))[0];
    return Object.fromEntries(sectionNodes.map((node) => {
      const section = node.data.section;
      const pageIds = section.page_ids.filter(id => id !== pageId);
      if (node.id === containing?.id) pageIds.push(pageId);
      return [node.id, {
        ...section,
        page_ids: pageIds,
        canvas_position: node.position,
      }];
    }));
  }, [nodes]);

  const addSection = useCallback((): void => {
    const canvas = canvasRef.current;
    if (canvas === null || disabled) return;
    let ordinal = sectionStates.length + 1;
    let id = `section-${ordinal}`;
    const ids = new Set(sectionStates.map(section => section.id));
    while (ids.has(id)) {
      ordinal += 1;
      id = `section-${ordinal}`;
    }
    const width = NODE_WIDTH + PAGE_MAP_SECTION_PADDING_X * 2;
    const height = NODE_HEIGHT + PAGE_MAP_SECTION_HEADER_HEIGHT + PAGE_MAP_SECTION_PADDING_BOTTOM;
    const rect = canvas.getBoundingClientRect();
    const center = screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    const section: IPageMapSectionState = {
      id,
      label: t.page_design_new_section.replace('{n}', String(ordinal)),
      page_ids: [],
      canvas_position: { x: center.x - width / 2, y: center.y - height / 2 },
      canvas_size: { width, height },
    };
    onReplaceSections(sectionRecord(section));
  }, [disabled, onReplaceSections, screenToFlowPosition, sectionRecord, sectionStates, t.page_design_new_section]);

  const validConnection = useCallback((connection: Connection | Edge): boolean => {
    if (connection.source === null || connection.target === null || connection.source === connection.target) return false;
    return !connections.some(item => (
      item.source_page_id === connection.source && item.target_page_id === connection.target
    ));
  }, [connections]);

  return (
    <div
      ref={canvasRef}
      className='relative h-full min-h-0'
      style={{ backgroundColor: '#F7F7F7' }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        zIndexMode='manual'
        nodeTypes={PAGE_MAP_NODE_TYPES}
        onNodesChange={onNodesChange}
        minZoom={0.2}
        maxZoom={1.4}
        nodesDraggable={!disabled}
        nodesConnectable={!disabled}
        isValidConnection={validConnection}
        onConnect={(connection) => {
          if (disabled || connection.source === null || connection.target === null) return;
          onCreateConnection(connection.source, connection.target);
        }}
        onNodeDragStart={(_, node) => {
          if (node.type !== 'page-map-section') return;
          const section = node.data.section;
          sectionDragRef.current = {
            id: node.id,
            position: { ...node.position },
            pagePositions: Object.fromEntries(section.page_ids.map(pageId => [
              pageId,
              pagePositions.get(pageId) ?? { x: 0, y: 0 },
            ])),
          };
        }}
        onNodeDrag={(_, node) => {
          const drag = sectionDragRef.current;
          if (drag === null || drag.id !== node.id) return;
          const dx = node.position.x - drag.position.x;
          const dy = node.position.y - drag.position.y;
          setNodes(current => current.map(currentNode => {
            const start = drag.pagePositions[currentNode.id];
            return start === undefined
              ? currentNode
              : { ...currentNode, position: { x: start.x + dx, y: start.y + dy } };
          }));
        }}
        onNodeClick={(_, node) => {
          if (records[node.id] !== undefined) onSelectPage(node.id);
        }}
        onNodeDoubleClick={(_, node) => {
          if (records[node.id] !== undefined) onOpenPage(node.id);
        }}
        onNodeDragStop={(_, node) => {
          if (node.type === 'page-map') {
            onMovePage(node.id, node.position, materializedSectionsForPage(node.id, node.position));
            return;
          }
          if (node.type !== 'page-map-section') return;
          const drag = sectionDragRef.current;
          sectionDragRef.current = null;
          if (drag === null || drag.id !== node.id) return;
          const dx = node.position.x - drag.position.x;
          const dy = node.position.y - drag.position.y;
          const section = node.data.section;
          onReplaceSections(sectionRecord({
            ...section,
            canvas_position: node.position,
          }), Object.fromEntries(Object.entries(drag.pagePositions).map(
            ([pageId, position]) => [pageId, { x: position.x + dx, y: position.y + dy }]
          )));
        }}
        onEdgeClick={(_, edge) => setSelectedConnectionId(edge.id)}
        onPaneClick={() => setSelectedConnectionId(null)}
        className='bg-transparent'
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.5}
          color='#94a3b8'
          className='opacity-[0.15] dark:opacity-[0.2]'
        />
        <Controls showInteractive={false} />
      </ReactFlow>
      <Button
        type='button'
        size='sm'
        variant='outline'
        className='absolute right-4 top-4 z-20 bg-white [box-shadow:var(--ds-shadow-1-center)]'
        disabled={disabled}
        onClick={addSection}
      >
        <Plus className='size-4' />
        {t.page_design_add_section}
      </Button>
      {selectedConnection ? (
        <div className='absolute bottom-4 left-1/2 z-20 w-[min(480px,calc(100%-32px))] -translate-x-1/2 rounded-xl border border-[var(--ds-border-default)] bg-white p-3 [box-shadow:var(--ds-shadow-2-center)]'>
          <div className='flex items-center justify-between gap-3'>
            <div className='min-w-0 truncate text-sm font-medium text-[var(--ds-text-primary)]'>
              {records[selectedConnection.source_page_id]?.name ??
                selectedConnection.source_page_id}
              {' → '}
              {records[selectedConnection.target_page_id]?.name ??
                selectedConnection.target_page_id}
            </div>
            <IconButton
              size='sm'
              variant='danger'
              shape='square'
              disabled={disabled}
              aria-label={t.page_design_delete_connection}
              title={t.page_design_delete_connection}
              onClick={() => onDeleteConnection(selectedConnection.id)}
            >
              <Trash2 className='size-4' />
            </IconButton>
          </div>
          <label className='mt-3 block text-sm font-medium'>
            {t.page_design_connection_label}
            <input
              className={`${inputClass} mt-1.5`}
              aria-label={t.page_design_connection_label}
              disabled={disabled}
              value={selectedConnection.label ?? ''}
              onChange={(event) =>
                onUpdateConnection(selectedConnection.id, event.target.value)
              }
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

/** The page map canvas. */
export function PageMapCanvas(props: IPageMapCanvasProps): JSX.Element {
  return (
    <ReactFlowProvider>
      <PageMapCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
