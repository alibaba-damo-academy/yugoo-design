/**
 * page_design native panel: a page-list/detail workspace and a full-workspace
 * ReactFlow page map. The map slides over both detail panes, matching the
 * Function Modules mind-map interaction. Map authoring and ordinary state
 * edits are immutable updates; hotspot binding writes
 * `connection.source_element_id` from a strictly validated iframe message,
 * and navigation follows a bound connection to its target page. Shared
 * navigation selects its allowlisted page directly.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Link2,
  ListTree,
  Map as MapIcon,
  MousePointerClick,
  Unlink,
} from 'lucide-react';
import { useLang } from '../../host.ts';
import { cn } from '../../ui/cn.ts';
import { Button } from '../../ui/button.tsx';
import { IconButton } from '../../ui/icon-button.tsx';
import {
  DesignPanelHeader,
  DesignPanelNavItem,
  DesignPanelSelect,
  DesignPanelSidebar,
  DesignPanelTitle,
  EmptyPanel,
  inputClass,
  ordered,
} from '../OfficialWebAppPanels/panelPrimitives.tsx';
import { NativeDesignPanelContent, NativeDesignPanelFrame } from '../OfficialWebAppPanels/NativeDesignPanelFrame.tsx';
import { DesignExecutionStatusIcon } from '../OfficialWebAppPanels/DesignExecutionStatusIcon.tsx';
import {
  pageStatusLabel,
  visualCheckIssueLabel,
} from './pageDesignLabels.ts';
import { PageMapCanvas } from './PageMapCanvas.tsx';
import { PagePreview } from './PagePreview.tsx';
import { resolvePrototypeNavigation, type PrototypeFrameMessage } from './pageDesignPrototype.ts';
import type { PreviewNavigationContext } from 'dsh-design-panel/client-api';
import type {
  IPageDesignState,
  IPageDesignPanelProps,
  IPageMapSectionState,
  IPageNode,
} from './pageDesignTypes.ts';

/**
 * The page_design panel body.
 *
 * @param props - hydrated state, optional styleCss, immutable update sink.
 * @returns page detail workspace with a full-workspace page-map layer.
 */
export function PageDesignPanel(props: IPageDesignPanelProps): JSX.Element {
  const {
    data,
    disabled = false,
    styleCss,
    previewResetIdentity,
    readExecutionLog,
    onChange,
  } = props;
  const t = useLang();

  const pageVisualStatus = (page: IPageNode) => page.generation_status === 'working'
    ? 'working' as const
    : page.generation_status === 'queued'
      ? 'queued' as const
      : page.generation_status === 'completed'
          ? 'completed' as const
          : page.generation_status === 'failed'
            ? 'failed' as const
            : 'pending' as const;

  const pageRecords = data.pages ?? {};
  const connectionRecords = data.connections ?? {};
  const pages = useMemo(
    () => ordered(pageRecords, data.page_order),
    [pageRecords, data.page_order]
  );
  const connections = useMemo(
    () => ordered(connectionRecords, data.connection_order),
    [connectionRecords, data.connection_order]
  );
  const entryPageIds = data.entry_page_ids ?? [];
  const commonSpec = data.common_spec;

  const [selectedId, setSelectedId] = useState<string | null>(
    pages[0]?.id ?? null
  );
  const [showPageMap, setShowPageMap] = useState(() => pages.length > 0);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const previewGenerationIdentity = useMemo(() => ({}), [data, previewResetIdentity]);
  const [arrival, setArrival] = useState<{
    targetPageId: string;
    context?: PreviewNavigationContext;
    data: IPageDesignState;
    resetIdentity: unknown;
  } | null>(null);
  // Revoke synchronously on reader/revision/data changes, before effects run.
  const arrivalContext = arrival?.targetPageId === selectedId && arrival.data === data
    && arrival.resetIdentity === previewResetIdentity ? arrival.context : undefined;
  useEffect(() => { setArrival(null); setNavigationError(null); }, [data, previewResetIdentity]);
  const selectPage = useCallback((id: string) => {
    setArrival(null);
    setNavigationError(null);
    setSelectedId(id);
  }, []);
  const hadPages = useRef(pages.length > 0);
  const [activeConnectionId, setActiveConnectionId] = useState('');
  const [bindingConnectionId, setBindingConnectionId] = useState<string | null>(
    null
  );
  // Visual geometry readout: the preview iframe posts one geometry report per
  // srcDoc instance; the panel keeps it only when pageId + previewToken match
  // the current selection, so stale iframes never pollute the verdict.
  const [geometryToken, setGeometryToken] = useState('');
  const [geometryIssues, setGeometryIssues] = useState<
    readonly string[] | null
  >(null);

  /** Track the rendered srcDoc instance and drop any previous verdict. */
  const handleGeometryToken = useCallback((previewToken: string) => {
    setGeometryToken(previewToken);
    setGeometryIssues(null);
  }, []);

  useEffect(() => {
    if (selectedId === null || !pages.some((page) => page.id === selectedId)) {
      setSelectedId(pages[0]?.id ?? null);
    }
  }, [pages, selectedId]);

  // The canonical map is the first visible Page Design filesystem state. Open it
  // when the initial checkpoint first supplies pages, then leave map/detail
  // switching under user control while artifact hydration replaces only each
  // node's wireframe thumbnail.
  useEffect(() => {
    if (!hadPages.current && pages.length > 0) setShowPageMap(true);
    hadPages.current = pages.length > 0;
  }, [pages.length]);

  const selected =
    pages.find((page) => page.id === selectedId) ?? pages[0] ?? null;
  const selectedIsEntry =
    selected !== null && entryPageIds.includes(selected.id);
  const selectedIsLastEntry = selectedIsEntry && entryPageIds.length <= 1;

  /** Outgoing connections of the selected page (binding + navigation source). */
  const outgoingConnections = useMemo(
    () =>
      selected
        ? connections.filter(
            (connection) => connection.source_page_id === selected.id
          )
        : [],
    [connections, selected]
  );
  const activeConnection =
    outgoingConnections.find(
      (connection) => connection.id === activeConnectionId
    ) ?? outgoingConnections[0];

  // Drop a selected/binding connection that no longer exists for this page.
  useEffect(() => {
    if (
      !activeConnectionId ||
      !outgoingConnections.some(
        (connection) => connection.id === activeConnectionId
      )
    ) {
      setActiveConnectionId(outgoingConnections[0]?.id ?? '');
    }
    if (
      bindingConnectionId &&
      !outgoingConnections.some(
        (connection) => connection.id === bindingConnectionId
      )
    ) {
      setBindingConnectionId(null);
    }
  }, [activeConnectionId, bindingConnectionId, outgoingConnections]);

  /** Select a page and collapse the map so its preview shows. */
  const openPage = useCallback((id: string) => {
    selectPage(id);
    setShowPageMap(false);
  }, [selectPage]);

  /** Persist a dragged map node and the complete canvas-only grouping layout. */
  const movePage = useCallback(
    (
      id: string,
      position: { x: number; y: number },
      sections: Record<string, IPageMapSectionState>
    ) => {
      const page = pageRecords[id];
      if (page === undefined) return;
      onChange({
        pages: { ...pageRecords, [id]: { ...page, canvas_position: position } },
        canvas_sections: sections,
      });
    },
    [onChange, pageRecords]
  );

  /** Persist the complete layout-only section set and translated Page positions. */
  const replaceCanvasSections = useCallback(
    (
      sections: Record<string, IPageMapSectionState>,
      movedPages: Readonly<Record<string, { x: number; y: number }>> = {}
    ) => {
      const nextPages = { ...pageRecords };
      for (const [pageId, position] of Object.entries(movedPages)) {
        const page = nextPages[pageId];
        if (page !== undefined) {
          nextPages[pageId] = { ...page, canvas_position: position };
        }
      }
      onChange({
        pages: nextPages,
        canvas_sections: sections,
      });
    },
    [onChange, pageRecords]
  );

  const invalidatePage = useCallback((records: Record<string, IPageNode>, id: string) => {
    const page = records[id];
    if (page === undefined) return records;
    return {
      ...records,
      [id]: {
        ...page,
        artifact_file: '',
      },
    };
  }, []);

  /** Add a navigation decision and mark only its source Page for hotspot repair. */
  const createConnection = useCallback((sourcePageId: string, targetPageId: string) => {
    if (disabled || sourcePageId === targetPageId) return;
    if (connections.some(connection => (
      connection.source_page_id === sourcePageId && connection.target_page_id === targetPageId
    ))) return;
    const base = `connection-${sourcePageId}-${targetPageId}`;
    let id = base;
    let suffix = 2;
    while (connectionRecords[id] !== undefined) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    const targetName = pageRecords[targetPageId]?.name ?? targetPageId;
    onChange({
      pages: invalidatePage(pageRecords, sourcePageId),
      connections: {
        ...connectionRecords,
        [id]: {
          id,
          source_page_id: sourcePageId,
          target_page_id: targetPageId,
          label: t.page_design_new_connection.replace('{page}', targetName),
        },
      },
      connection_order: [...connections.map(connection => connection.id), id],
    });
  }, [connectionRecords, connections, disabled, invalidatePage, onChange, pageRecords, t.page_design_new_connection]);

  /** Toggle entry-page membership; the last remaining entry is guarded. */
  const toggleEntryPage = useCallback(
    (id: string) => {
      if (disabled) return;
      const isEntry = entryPageIds.includes(id);
      if (isEntry && entryPageIds.length <= 1) return;
      onChange({
        entry_page_ids: isEntry
          ? entryPageIds.filter((pageId) => pageId !== id)
          : [...entryPageIds, id],
      });
    },
    [disabled, entryPageIds, onChange]
  );

  /** Rename one connection's label (immutable connection update). */
  const updateConnection = useCallback(
    (id: string, label: string) => {
      const connection = connectionRecords[id];
      if (connection === undefined) return;
      onChange({
        pages: invalidatePage(pageRecords, connection.source_page_id),
        connections: {
          ...connectionRecords,
          [id]: { ...connection, label },
        },
      });
    },
    [connectionRecords, invalidatePage, onChange, pageRecords]
  );

  /** Delete one connection (immutable record + order update). */
  const deleteConnection = useCallback(
    (id: string) => {
      const next = { ...connectionRecords };
      const sourcePageId = next[id]?.source_page_id;
      delete next[id];
      onChange({
        ...(sourcePageId === undefined ? {} : { pages: invalidatePage(pageRecords, sourcePageId) }),
        connections: next,
        connection_order: connections
          .map((connection) => connection.id)
          .filter((connectionId) => connectionId !== id),
      });
      if (bindingConnectionId === id) setBindingConnectionId(null);
    },
    [bindingConnectionId, connectionRecords, connections, invalidatePage, onChange, pageRecords]
  );

  /** Clear one connection's hotspot binding (immutable connection update). */
  const unbindConnection = useCallback(
    (id: string) => {
      if (disabled) return;
      const connection = connectionRecords[id];
      if (connection === undefined) return;
      onChange({
        connections: {
          ...connectionRecords,
          [id]: { ...connection, source_element_id: '', source_element_label: '' },
        },
      });
    },
    [connectionRecords, disabled, onChange]
  );

  /**
   * Handle a strictly validated prototype message from the selected page's
   * iframe. Connection and page allowlists are enforced here: a bind only
   * targets an outgoing connection of the selected page, and a navigation only
   * follows a known connection to an existing page. Disabled mode never
   * mutates state.
   */
  const handlePrototypeMessage = useCallback(
    (message: PrototypeFrameMessage) => {
      if (message.type === 'geometry-report') {
        // Match both the selected page and the exact srcDoc instance that
        // produced the report; anything else is a stale iframe measurement.
        if (selected === null || message.pageId !== selected.id) return;
        if (message.previewToken === '' || message.previewToken !== geometryToken) return;
        setGeometryIssues(message.issues);
        return;
      }
      if (message.type === 'navigate-page') {
        if (!Object.hasOwn(pageRecords, message.pageId)) return;
        selectPage(message.pageId);
        setShowPageMap(false);
        return;
      }
      if (message.type === 'navigate') {
        if (selected === null) return;
        const navigation = resolvePrototypeNavigation(selected.id, message.connectionId, connectionRecords, pageRecords);
        if (navigation === undefined) return;
        if ('error' in navigation) {
          setNavigationError(navigation.error);
          return;
        }
        setNavigationError(null);
        setArrival({ ...navigation, data, resetIdentity: previewResetIdentity });
        setSelectedId(navigation.targetPageId);
        setShowPageMap(false);
        return;
      }
      // bind-hotspot: refuse to mutate while read-only.
      if (disabled) return;
      const connection = connectionRecords[message.connectionId];
      if (connection === undefined) return;
      // Allowlist: only an outgoing connection of the selected page may bind.
      if (selected === null || connection.source_page_id !== selected.id) return;
      if (message.elementId === '') return;
      onChange({
        connections: {
          ...connectionRecords,
          [connection.id]: {
            ...connection,
            source_element_id: message.elementId,
            source_element_label:
              message.elementLabel || connection.label || '',
          },
        },
      });
      setBindingConnectionId(null);
    },
    [connectionRecords, disabled, geometryToken, onChange, pageRecords, selected, data, previewResetIdentity, selectPage]
  );

  const sidebar = (
    <div className='relative h-full min-h-0 overflow-visible'>
      <DesignPanelSidebar
        icon={<ListTree className='size-4 text-[var(--ds-text-7)]' />}
        title={t.page_design_page_list}
      >
        {pages.map((page) => {
          const isEntry = entryPageIds.includes(page.id);
          return (
            <DesignPanelNavItem
              key={page.id}
              selected={selected?.id === page.id}
              aria-label={`${t.page_design_preview}: ${page.name}${
                isEntry ? `, ${t.page_design_entry_page}` : ''
              }`}
              className='min-w-0'
              onClick={() => openPage(page.id)}
            >
              <span className='min-w-0 flex-1 truncate'>{page.name}</span>
              {isEntry ? (
                <span
                  data-testid='dsh-entry-page-marker'
                  className='shrink-0 rounded bg-[var(--ds-brand-light-bg-default)] px-1 py-0.5 text-[10px] font-medium leading-none text-[var(--ds-brand-text-primary)]'
                >
                  {t.page_design_entry_page}
                </span>
              ) : null}
              <span className='shrink-0' title={pageStatusLabel(t, page)}>
                <DesignExecutionStatusIcon
                  status={pageVisualStatus(page)}
                  label={pageStatusLabel(t, page)}
                />
              </span>
            </DesignPanelNavItem>
          );
        })}
      </DesignPanelSidebar>
      <IconButton
        type='button'
        size='lg'
        variant='transparent'
        shape='square'
        aria-label={t.page_design_page_map}
        aria-expanded={showPageMap}
        className='absolute right-0 top-[36vh] z-10 h-[48px] w-[24px] -translate-y-1/2 rounded-l-[8px] rounded-r-[0px] bg-white shadow-[-1px_1px_4px_0px_rgba(0,0,0,0.1)] text-[var(--ds-text-tertiary)] hover:text-[var(--ds-brand-text-primary)] hover:!bg-[#f6f6f6]'
        onClick={() => { setArrival(null); setShowPageMap(true); }}
      >
        <ChevronRight className='h-4 w-4' />
      </IconButton>
    </div>
  );

  const visualCheckSummary =
    selected?.html === undefined
      ? {
          label: t.page_design_preview_pending,
          className:
            'bg-[var(--ds-bg-gary-default)] text-[var(--ds-text-tertiary)]',
        }
      : geometryIssues === null
        ? {
            label: t.page_design_visual_status_pending,
            className: 'bg-amber-50 text-amber-700',
          }
        : geometryIssues.length === 0
          ? {
              label: t.page_design_visual_status_pass,
              className: 'bg-emerald-50 text-emerald-700',
            }
          : {
              label: t.page_design_visual_status_fail.replace(
                '{n}',
                String(geometryIssues.length)
              ),
              className: 'bg-red-50 text-red-600',
            };

  const pageMap = (
    <main
      data-testid='dsh-page-map-content'
      aria-label={t.page_design_page_map}
      className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white'
    >
      <DesignPanelHeader variant='workspace' className='min-h-14 flex-wrap'>
          <div className='flex min-w-0 flex-wrap items-center gap-2'>
            <div className='flex items-center gap-2 pr-1'>
              <MapIcon className='size-4 shrink-0 text-[var(--ds-text-7)]' />
              <DesignPanelTitle>
                {t.page_design_page_map}
              </DesignPanelTitle>
            </div>
            <span className='rounded-full border border-[var(--ds-border-default)] bg-white px-2 py-0.5 text-xs text-[var(--ds-text-secondary)]'>
              {pages.length} {t.page_design_pages_unit}
            </span>
            <span className='rounded-full border border-[var(--ds-border-default)] bg-white px-2 py-0.5 text-xs text-[var(--ds-text-secondary)]'>
              {connections.length} {t.page_design_connections_unit}
            </span>
          </div>
          <div className='flex min-w-0 items-center gap-2'>
            <span
              data-testid='dsh-page-map-visual-status'
              className={cn(
                'max-w-56 truncate rounded-full px-2 py-1 text-xs font-medium',
                visualCheckSummary.className
              )}
              title={`${selected?.name ?? t.page_design_preview}: ${visualCheckSummary.label}`}
            >
              {selected?.name ? `${selected.name} · ` : ''}
              {visualCheckSummary.label}
            </span>
          </div>
      </DesignPanelHeader>
      {commonSpec ? (
          <details
            data-testid='dsh-page-system-spec'
            className='group shrink-0 border-b border-[var(--ds-border-default)] bg-white'
          >
            <summary className='flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-xs text-[var(--ds-text-primary)] hover:bg-[var(--ds-bg-gary-default)]'>
              <div className='min-w-0 flex-1'>
                <div className='flex min-w-0 flex-wrap items-center gap-2'>
                  <span className='font-medium'>{t.page_design_common_spec}</span>
                  <span className='rounded-full bg-[var(--ds-bg-gary-default)] px-2 py-0.5 font-normal text-[var(--ds-text-tertiary)]'>
                    {t.page_design_common_spec_style}
                  </span>
                  <span className='text-[var(--ds-text-tertiary)]'>
                    {t.page_design_common_navigation_count.replace(
                      '{n}',
                      String(commonSpec.navigation.length)
                    )}
                    {' · '}
                    {t.page_design_common_components_count.replace(
                      '{n}',
                      String(commonSpec.shared_components.length)
                    )}
                  </span>
                </div>
                <p className='mt-1 truncate font-normal text-[var(--ds-text-tertiary)]'>
                  {t.page_design_common_spec_description}
                </p>
              </div>
              <ChevronRight className='size-4 shrink-0 text-[var(--ds-text-tertiary)] transition-transform group-open:rotate-90' />
            </summary>
            <div className='grid max-h-52 grid-cols-1 gap-2 overflow-y-auto border-t border-[var(--ds-border-default)] bg-[var(--ds-fill-2)] p-3 text-xs text-[var(--ds-text-secondary)] sm:grid-cols-2'>
              <div className='rounded-lg border border-[var(--ds-border-default)] bg-white p-3'>
                <div className='font-medium text-[var(--ds-text-primary)]'>
                  {t.page_design_common_layout}
                </div>
                <p className='mt-1 leading-5'>
                  {t.page_design_common_layout_summary}
                </p>
              </div>
              <div className='rounded-lg border border-[var(--ds-border-default)] bg-white p-3'>
                <div className='font-medium text-[var(--ds-text-primary)]'>
                  {t.page_design_common_logo}
                </div>
                <p className='mt-1 leading-5'>
                  {[commonSpec.logo.name, commonSpec.logo.description]
                    .filter(Boolean)
                    .join(' · ') || t.no_data}
                </p>
              </div>
              <div className='rounded-lg border border-[var(--ds-border-default)] bg-white p-3'>
                <div className='font-medium text-[var(--ds-text-primary)]'>
                  {t.page_design_common_navigation}
                </div>
                <div className='mt-2 flex flex-wrap gap-1.5'>
                  {commonSpec.navigation.map((item) => (
                    <span
                      key={item.id}
                      className='rounded-md bg-[var(--ds-bg-gary-default)] px-2 py-1 text-[var(--ds-text-secondary)]'
                    >
                      {item.group ? `${item.group} / ` : ''}
                      {item.label}
                    </span>
                  ))}
                </div>
              </div>
              <div className='rounded-lg border border-[var(--ds-border-default)] bg-white p-3'>
                <div className='font-medium text-[var(--ds-text-primary)]'>
                  {t.page_design_common_components}
                </div>
                <div className='mt-2 flex flex-wrap gap-1.5'>
                  {commonSpec.shared_components.map((component) => (
                    <span
                      key={component}
                      className='rounded-md bg-[var(--ds-bg-gary-default)] px-2 py-1 text-[var(--ds-text-secondary)]'
                    >
                      {component}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </details>
      ) : null}
      <div className='min-h-0 flex-1' aria-label={t.page_design_page_map}>
        {pages.length === 0 ? (
          <EmptyPanel message={t.page_design_no_pages} />
        ) : (
          <PageMapCanvas
            pages={pages}
            connections={connections}
            commonSpec={commonSpec}
            canvasSections={data.canvas_sections}
            entryPageIds={entryPageIds}
            selectedId={selected?.id ?? null}
            styleCss={styleCss}
            disabled={disabled}
            onSelectPage={selectPage}
            onOpenPage={openPage}
            onMovePage={movePage}
            onReplaceSections={replaceCanvasSections}
            onCreateConnection={createConnection}
            onUpdateConnection={updateConnection}
            onDeleteConnection={deleteConnection}
          />
        )}
      </div>
    </main>
  );

  const pickLabel =
    bindingConnectionId === activeConnection?.id
      ? t.page_design_cancel_pick
      : activeConnection?.source_element_id
        ? t.page_design_repick_trigger
        : t.page_design_pick_trigger;

  const bindingControls =
    selected !== null && outgoingConnections.length > 0 ? (
      <div className='flex min-w-0 items-center gap-2'>
        <Link2 className='size-4 shrink-0 text-[var(--ds-text-tertiary)]' />
        <DesignPanelSelect
          className='h-8 max-w-56'
          aria-label={t.page_design_select_connection}
          disabled={disabled}
          value={activeConnection?.id ?? ''}
          onChange={(event) => {
            setActiveConnectionId(event.target.value);
            setBindingConnectionId(null);
          }}
        >
          {outgoingConnections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.label} →{' '}
              {pageRecords[connection.target_page_id]?.name}
            </option>
          ))}
        </DesignPanelSelect>
        <Button
          type='button'
          size='sm'
          variant={
            bindingConnectionId === activeConnection?.id ? 'default' : 'outline'
          }
          disabled={disabled || !selected.html || activeConnection === undefined}
          aria-label={pickLabel}
          title={pickLabel}
          onClick={() =>
            setBindingConnectionId((current) =>
              current === activeConnection?.id
                ? null
                : (activeConnection?.id ?? null)
            )
          }
        >
          <MousePointerClick />
          <span>{pickLabel}</span>
        </Button>
        {activeConnection?.source_element_id ? (
          <IconButton
            size='sm'
            variant='ghostIcon'
            shape='square'
            disabled={disabled}
            aria-label={t.page_design_unbind}
            title={t.page_design_unbind}
            onClick={() => unbindConnection(activeConnection.id)}
          >
            <Unlink className='size-4' />
          </IconButton>
        ) : null}
      </div>
    ) : null;

  const pageMapLayer = (
    <div
      data-testid='dsh-page-map-layer'
      aria-hidden={!showPageMap}
      className={cn(
        'absolute inset-0 z-20 overflow-hidden bg-[var(--ds-bg-gary-default)] transition-[clip-path] duration-300 ease-out',
        showPageMap ? 'pointer-events-auto' : 'pointer-events-none'
      )}
      style={{
        clipPath: showPageMap ? 'inset(0 0 0 0)' : 'inset(0 100% 0 0)',
      }}
    >
      {pageMap}
      <IconButton
        type='button'
        size='lg'
        variant='transparent'
        shape='square'
        aria-label={t.page_design_return_to_preview}
        className='absolute right-[13px] top-[36vh] z-30 h-[48px] w-[24px] translate-x-1/2 -translate-y-1/2 rounded-l-[8px] rounded-r-[0px] bg-white [box-shadow:var(--ds-shadow-1-center)] text-[var(--ds-text-tertiary)] hover:text-[var(--ds-brand-text-primary)]'
        onClick={() => { setArrival(null); setShowPageMap(false); }}
      >
        <ChevronLeft className='h-4 w-4' />
      </IconButton>
    </div>
  );

  return (
    <NativeDesignPanelFrame
      autoSaveId='page-design-sidebar'
      overlay={pageMapLayer}
    >
      {sidebar}
      <NativeDesignPanelContent
        mode='workspace'
        data-testid='dsh-page-preview-content'
        className='flex min-w-0 flex-col'
      >
        <DesignPanelHeader variant='workspace' className='flex-wrap gap-2'>
          <div className='flex min-w-0 items-center gap-2'>
            <DesignPanelTitle>
              {selected?.name ?? t.page_design_preview}
            </DesignPanelTitle>
            {selectedIsEntry ? (
              <span className='inline-flex shrink-0 items-center rounded-full bg-[var(--ds-brand-light-bg-default)] px-2 py-0.5 text-xs text-[var(--ds-brand-text-primary)]'>
                {t.page_design_entry_page}
              </span>
            ) : null}
            {selected !== null ? (
              <span className='shrink-0' title={pageStatusLabel(t, selected)}>
                <DesignExecutionStatusIcon
                  status={pageVisualStatus(selected)}
                  label={pageStatusLabel(t, selected)}
                />
              </span>
            ) : null}
          </div>
          <div className='flex min-w-0 items-center gap-2'>
            {bindingControls}
            {selected !== null ? (
              <Button
                type='button'
                size='sm'
                variant='ghost'
                data-testid='dsh-entry-page-action'
                disabled={disabled || selectedIsLastEntry}
                aria-label={
                  selectedIsLastEntry
                    ? t.page_design_last_entry
                    : selectedIsEntry
                      ? t.page_design_unset_entry
                      : t.page_design_set_entry
                }
                title={
                  selectedIsLastEntry
                    ? t.page_design_last_entry
                    : selectedIsEntry
                      ? t.page_design_unset_entry
                      : t.page_design_set_entry
                }
                onClick={() => toggleEntryPage(selected.id)}
              >
                {selectedIsEntry
                  ? t.page_design_unset_entry
                  : t.page_design_set_entry}
              </Button>
            ) : null}
          </div>
        </DesignPanelHeader>
        {bindingConnectionId ? (
          <div className='shrink-0 border-b border-[var(--ds-brand-light-border)] bg-[var(--ds-brand-light-bg-default)] px-4 py-2 text-sm text-[var(--ds-brand-text-primary)]'>
            {t.page_design_binding_hint}
          </div>
        ) : null}
        {selected?.html && geometryIssues !== null ? (
          geometryIssues.length === 0 ? (
            <div
              data-testid='dsh-page-visual-check'
              data-state='pass'
              className='shrink-0 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700'
            >
              {t.page_design_visual_check_pass}
            </div>
          ) : (
            <div
              data-testid='dsh-page-visual-check'
              data-state='fail'
              role='alert'
              className='shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-600'
            >
              <div className='font-medium'>
                {t.page_design_visual_check_fail} · {geometryIssues.length}
              </div>
              <ul className='mt-1 list-disc space-y-0.5 pl-5'>
                {geometryIssues.map((issue) => (
                  <li key={issue}>
                    {visualCheckIssueLabel(t, issue, outgoingConnections)}
                  </li>
                ))}
              </ul>
            </div>
          )
        ) : null}
        <div className='min-h-0 flex-1'>
          {navigationError ? <div role='alert' className='p-3 text-sm text-red-700'>{navigationError}</div> : null}
          {selected !== null ? (
            <div className='h-full overflow-hidden bg-white'>
              <PagePreview
                page={selected}
                arrivalContext={arrivalContext}
                previewGenerationIdentity={previewGenerationIdentity}
                styleCss={styleCss}
                connections={outgoingConnections}
                bindingConnectionId={bindingConnectionId}
                onPrototypeMessage={handlePrototypeMessage}
                onGeometryToken={handleGeometryToken}
                readExecutionLog={readExecutionLog}
              />
            </div>
          ) : (
            <EmptyPanel message={t.page_design_no_pages} />
          )}
        </div>
      </NativeDesignPanelContent>
    </NativeDesignPanelFrame>
  );
}

export type { IPageNode };
