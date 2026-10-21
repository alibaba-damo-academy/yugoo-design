import React, { useRef, useEffect, useCallback, useState } from 'react';
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer.js';
import Modeler from 'bpmn-js/lib/Modeler.js';
import { cn } from '../../ui/cn.ts';
import { useLangSwitch } from '../ResearchPanel/useLangSwitch.ts';
import {
  applyBpmnLaneHeaderDividers,
  BPMN_TEXT_RENDERER,
  fitBpmnForVerticalBrowsing,
  fitBpmnToViewport,
  type IBpmnCanvasService,
} from './bpmnViewport.ts';

export interface IBpmnViewerProps {
  xml: string;
  processId: string;
  className?: string;
  /** Fired when a node's hover "查看详情" button is clicked (tasks only). */
  onElementDetail?: (elementId: string) => void;
  /** Highlights the matching diagram node. */
  selectedElementId?: string;
  /**
   * Diagram box ids that have no backing step record (orphans). Rendered
   * with an amber dashed outline so the misalignment is visible on the
   * diagram itself, not only in the step list.
   */
  warnElementIds?: string[];
  /**
   * Read-only status badges projected onto diagram elements via bpmn-js
   * overlays (element id → badge text lines). The XML is never modified;
   * badges are render-time decoration for cross-panel projections.
   */
  elementBadges?: Record<string, string[]>;
}

/**
 * Detect whether the BPMN XML carries a ``<bpmndi:BPMNDiagram>`` block.
 * NavigatedViewer can only render layout-bearing BPMN. A legacy or manually
 * imported structure-only file has no BPMNDI, so NavigatedViewer renders
 * blank. The full Modeler has its own internal display layout when DI is
 * absent, so we route such files through Modeler-in-readonly mode instead.
 * This fallback never writes coordinates back to the canonical BPMN file.
 * Cheap regex sniff — the only false negative would be a
 * malformed BPMNDiagram tag, and that path the Modeler also handles.
 */
const _BPMNDI_DETECTOR = /<\s*(?:[a-zA-Z0-9]+:)?BPMNDiagram[\s>]/;
function hasLayout(xml: string): boolean {
  return _BPMNDI_DETECTOR.test(xml);
}

/**
 * BPMN diagram viewer.
 *
 * Renders via ``NavigatedViewer`` for XML that ships with layout
 * (``<bpmndi:BPMNDiagram>``), and falls back to ``Modeler`` (in
 * read-only mode — no editing, no palette) for structure-only XML so
 * bpmn-js's internal auto-layout can fill the gap. Either way the user
 * sees a rendered diagram; the fallback path is silent.
 *
 * Fills the available height of its parent — wrap it in a sized container
 * (e.g. a flex/grid cell or a `ResizablePanel`) and the canvas will adapt.
 * A ResizeObserver reflows the diagram whenever the host container's size
 * changes (panel drag, window resize), so the diagram never falls off the
 * edge after a layout change. The user's manual zoom level is preserved
 * across resizes — we only call `canvas.resized()`, not a fresh width fit.
 */
export const BpmnViewer: React.FC<IBpmnViewerProps> = ({
  xml,
  processId,
  className,
  onElementDetail,
  selectedElementId,
  warnElementIds,
  elementBadges,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const onElementDetailRef = useRef(onElementDetail);
  onElementDetailRef.current = onElementDetail;
  const markedRef = useRef<string | null>(null);
  const warnMarkedRef = useRef<string[]>([]);
  const warnIdsRef = useRef(warnElementIds);
  warnIdsRef.current = warnElementIds;
  const warnKey = (warnElementIds ?? []).join('|');
  const badgesRef = useRef(elementBadges);
  badgesRef.current = elementBadges;
  const badgeOverlayIdsRef = useRef<string[]>([]);
  const badgeKey = JSON.stringify(elementBadges ?? {});
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // NavigatedViewer when DI present; Modeler when absent. Either instance
  // exposes the same canvas / zoomScroll services, so the rest of the
  // component treats them uniformly via this single ref.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerRef = useRef<any>(null);
  // Initial `zoom('fit-viewport')` must be deferred until the container has
  // a non-zero size — calling it on a 0×0 host throws
  // "Failed to execute 'scale' on 'SVGMatrix': non-finite value" because
  // fit-viewport divides by container width. The flag flips true on the
  // first successful fit so the ResizeObserver doesn't re-fit on every
  // subsequent resize (which would trample the user's manual zoom).
  const initialFitDoneRef = useRef(false);
  const viewportModeRef = useRef<'width' | 'all' | 'manual'>('width');
  const [error, setError] = useState<string | null>(null);
  const { currentLanguage: language } = useLangSwitch();
  const isZh = language === 'zh_CN';

  // Try to fit the diagram into the viewport. Bails out (without throwing)
  // if the container is still 0×0 — caller will retry on next ResizeObserver
  // tick once the container actually lays out.
  const tryInitialFit = useCallback(() => {
    const viewer = viewerRef.current;
    const node = containerRef.current;
    if (!viewer || !node) return;
    if (node.clientWidth <= 0 || node.clientHeight <= 0) return;
    try {
      const canvas = viewer.get('canvas') as IBpmnCanvasService;
      if (viewportModeRef.current === 'all') {
        fitBpmnToViewport(canvas);
      } else {
        fitBpmnForVerticalBrowsing(canvas);
      }
      initialFitDoneRef.current = true;
    } catch {
      // bpmn-js may still report a non-finite scale on the very first frame
      // after a hidden→visible transition. Leaving the flag false means
      // the next ResizeObserver tick retries.
    }
  }, []);

  // (Re-)apply read-only status badge overlays from badgesRef. Removes the
  // previously added badge overlays first so badge-set swaps never stack.
  // Elements absent from the diagram are skipped silently.
  const applyBadges = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    let overlays: {
      add: (id: string, opts: unknown) => string;
      remove: (filter: unknown) => void;
    };
    try {
      overlays = viewer.get('overlays');
    } catch {
      return;
    }
    for (const overlayId of badgeOverlayIdsRef.current) {
      try {
        overlays.remove({ id: overlayId });
      } catch {
        // overlay already gone; ignore.
      }
    }
    badgeOverlayIdsRef.current = [];
    const badges = badgesRef.current ?? {};
    for (const [elementId, lines] of Object.entries(badges)) {
      if (!lines?.length) continue;
      const box = document.createElement('div');
      box.className = 'qqt-node-badges';
      for (const line of lines) {
        const chip = document.createElement('span');
        chip.className = 'qqt-node-badge';
        chip.textContent = line;
        chip.title = line;
        box.appendChild(chip);
      }
      try {
        badgeOverlayIdsRef.current.push(
          overlays.add(elementId, {
            position: { top: -10, right: -10 },
            html: box,
          })
        );
      } catch {
        // element cannot host an overlay; skip.
      }
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current || !xml) return;
    // Choose viewer flavor based on whether the XML carries layout.
    // - Has BPMNDiagram → NavigatedViewer (lighter, pan+zoom only)
    // - No BPMNDiagram  → Modeler (heavier, but auto-lays out via its
    //   internal modeling stack; we don't expose any editing surface).
    const xmlHasLayout = hasLayout(xml);
    const viewerOptions = {
      container: containerRef.current,
      textRenderer: BPMN_TEXT_RENDERER,
    } as ConstructorParameters<typeof NavigatedViewer>[0] & {
      textRenderer: typeof BPMN_TEXT_RENDERER;
    };
    const viewer = xmlHasLayout
      ? new NavigatedViewer(viewerOptions)
      : new Modeler(viewerOptions);
    viewerRef.current = viewer;
    initialFitDoneRef.current = false;
    viewportModeRef.current = 'width';

    const errorMsg = isZh ? 'BPMN 图形加载失败' : 'Failed to load BPMN diagram';

    const loadXml = async () => {
      try {
        setError(null);
        await viewer.importXML(xml);
        applyBpmnLaneHeaderDividers(viewer, xml);
        tryInitialFit();
        // Apply orphan-box outlines now that the shapes exist. The standalone
        // warn effect below can fire before importXML resolves (on first
        // load / xml swap), where addMarker no-ops; re-applying here guarantees
        // the initial render is outlined. Subsequent warn changes are handled
        // by that effect.
        try {
          const canvas = viewer.get('canvas') as {
            addMarker: (id: string, cls: string) => void;
          };
          const ids = warnIdsRef.current ?? [];
          for (const id of ids) {
            try {
              canvas.addMarker(id, 'qqt-node-warn');
            } catch {
              // box id absent from this diagram; ignore.
            }
          }
          warnMarkedRef.current = [...ids];
        } catch {
          // canvas unavailable mid-teardown; ignore.
        }
        // Project read-only status badges (cross-panel render-time overlay).
        applyBadges();
        // Emit clicks on flow nodes (tasks/activities) so a host panel can
        // reveal the matching step's structured details.
        const eventBus = viewer.get('eventBus') as {
          on: (event: string, cb: (e: { element?: { id?: string; type?: string } }) => void) => void;
        };
        const overlays = viewer.get('overlays') as {
          add: (id: string, opts: unknown) => string;
          remove: (id: string) => void;
        };
        const isTask = (type?: string) => /Task|Activity/.test(String(type));
        let hoverOverlay: string | null = null;
        const removeHoverBtn = () => {
          if (hoverOverlay) {
            try {
              overlays.remove(hoverOverlay);
            } catch {
              // already gone
            }
            hoverOverlay = null;
          }
        };
        const cancelRemove = () => {
          if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
          }
        };
        const scheduleRemove = () => {
          cancelRemove();
          hoverTimerRef.current = setTimeout(removeHoverBtn, 220);
        };
        // Hover a task → a floating "查看详情" button; clicking it opens that
        // step's details. Avoids accidental node-click navigation.
        eventBus.on('element.hover', event => {
          const element = event?.element;
          if (!element?.id || !isTask(element.type)) return;
          cancelRemove();
          removeHoverBtn();
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = '查看详情';
          btn.className = 'qqt-node-detail-btn';
          btn.addEventListener('mousedown', ev => ev.stopPropagation());
          btn.addEventListener('click', ev => {
            ev.stopPropagation();
            onElementDetailRef.current?.(element.id as string);
          });
          btn.addEventListener('mouseenter', cancelRemove);
          btn.addEventListener('mouseleave', scheduleRemove);
          try {
            hoverOverlay = overlays.add(element.id, {
              position: { bottom: -8, right: -8 },
              html: btn,
            });
          } catch {
            // node cannot host an overlay; skip
          }
        });
        eventBus.on('element.out', event => {
          const element = event?.element;
          if (element?.id && isTask(element.type)) scheduleRemove();
        });
      } catch (err) {
        const message =
          err instanceof Error ? `${errorMsg}: ${err.message}` : errorMsg;
        setError(message);
      }
    };

    loadXml();

    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      viewer.destroy();
      viewerRef.current = null;
    };
  }, [xml, processId, isZh, tryInitialFit, applyBadges]);

  // Reflow the BPMN canvas when the container is resized (drag handle,
  // window resize, hidden→visible transition). Automatic mode recomputes a
  // complete fit; a user zoom choice is preserved across resizes.
  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      try {
        const canvas = viewer.get('canvas') as IBpmnCanvasService;
        canvas.resized();
        if (
          viewportModeRef.current !== 'manual' ||
          !initialFitDoneRef.current
        ) {
          tryInitialFit();
        }
      } catch {
        // Viewer may be mid-teardown; ignore.
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [tryInitialFit]);

  // Highlight the selected flow node by toggling a marker class on its shape.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    let canvas: {
      addMarker: (id: string, cls: string) => void;
      removeMarker: (id: string, cls: string) => void;
    };
    try {
      canvas = viewer.get('canvas');
    } catch {
      return;
    }
    if (markedRef.current && markedRef.current !== selectedElementId) {
      try {
        canvas.removeMarker(markedRef.current, 'qqt-node-selected');
      } catch {
        // element may no longer exist after an xml swap; ignore.
      }
    }
    if (selectedElementId) {
      try {
        canvas.addMarker(selectedElementId, 'qqt-node-selected');
      } catch {
        // selected step has no matching diagram node; ignore.
      }
    }
    markedRef.current = selectedElementId ?? null;
  }, [selectedElementId, xml]);

  // Outline orphan boxes (no backing step record) with an amber dashed
  // marker, so BPMN↔step-list drift is visible on the diagram directly.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    let canvas: {
      addMarker: (id: string, cls: string) => void;
      removeMarker: (id: string, cls: string) => void;
    };
    try {
      canvas = viewer.get('canvas');
    } catch {
      return;
    }
    for (const id of warnMarkedRef.current) {
      try {
        canvas.removeMarker(id, 'qqt-node-warn');
      } catch {
        // element may no longer exist after an xml swap; ignore.
      }
    }
    const next = warnElementIds ?? [];
    for (const id of next) {
      try {
        canvas.addMarker(id, 'qqt-node-warn');
      } catch {
        // box id not present in this diagram; ignore.
      }
    }
    warnMarkedRef.current = [...next];
  }, [warnKey, warnElementIds, xml]);

  // Re-project status badges when the badge set changes after load. The
  // initial application happens inside loadXml; this covers later swaps
  // (e.g. selecting another lifecycle object while the diagram stays).
  useEffect(() => {
    applyBadges();
  }, [badgeKey, xml, applyBadges]);

  const handleZoomIn = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const zoomScroll = viewer.get('zoomScroll') as any;
    viewportModeRef.current = 'manual';
    zoomScroll.stepZoom(1);
  }, []);

  const handleZoomOut = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const zoomScroll = viewer.get('zoomScroll') as any;
    viewportModeRef.current = 'manual';
    zoomScroll.stepZoom(-1);
  }, []);

  const handleZoomFit = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const canvas = viewer.get('canvas') as IBpmnCanvasService;
    viewportModeRef.current = 'all';
    fitBpmnToViewport(canvas);
  }, []);

  const handleZoomReset = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const canvas = viewer.get('canvas') as IBpmnCanvasService;
    viewportModeRef.current = 'width';
    fitBpmnForVerticalBrowsing(canvas);
  }, []);

  if (error) {
    return (
      <div className='flex items-center justify-center h-full w-full text-sm text-red-500 bg-red-50'>
        {error}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full w-full bg-white', className)}>
      <style>{`.qqt-node-selected .djs-visual > :nth-child(1){stroke:#663AE8 !important;stroke-width:2px !important;fill:#F3F0FF !important;} .qqt-node-warn .djs-visual > :nth-child(1){stroke:#D97706 !important;stroke-width:2px !important;stroke-dasharray:5 3 !important;} .qqt-node-detail-btn{cursor:pointer;white-space:nowrap;border:none;background:#663AE8;color:#fff;font-size:12px;line-height:1;padding:5px 9px;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.18);}.qqt-node-detail-btn:hover{background:#5730d6;} .qqt-node-badges{display:flex;flex-direction:column;align-items:flex-end;gap:2px;pointer-events:none;} .qqt-node-badge{pointer-events:auto;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis;background:#F3F0FF;color:#663AE8;border:1px solid #C9BEF2;font-size:10px;line-height:1;padding:2px 6px;border-radius:999px;box-shadow:0 1px 3px rgba(0,0,0,.12);}`}</style>
      {/* 缩放控制栏 */}
      <div className='flex items-center gap-1 px-2 py-1 border-b border-[#ECEBEE] bg-gray-50 shrink-0'>
        <button
          type='button'
          onClick={handleZoomIn}
          className='px-2 py-0.5 text-sm text-gray-600 hover:bg-gray-200 rounded'
          title={isZh ? '放大' : 'Zoom In'}
        >
          +
        </button>
        <button
          type='button'
          onClick={handleZoomOut}
          className='px-2 py-0.5 text-sm text-gray-600 hover:bg-gray-200 rounded'
          title={isZh ? '缩小' : 'Zoom Out'}
        >
          −
        </button>
        <button
          type='button'
          onClick={handleZoomFit}
          className='px-2 py-0.5 text-sm text-gray-600 hover:bg-gray-200 rounded'
          title={isZh ? '适应全部' : 'Fit all'}
        >
          ⊡
        </button>
        <button
          type='button'
          onClick={handleZoomReset}
          className='px-2 py-0.5 text-sm text-gray-600 hover:bg-gray-200 rounded'
          title={isZh ? '适应宽度' : 'Fit width'}
        >
          ⟲
        </button>
      </div>
      {/* BPMN 画布 — 占满剩余高度 */}
      <div ref={containerRef} data-testid='dsh-design-bpmn-viewer' className='flex-1 min-h-0 w-full' />
    </div>
  );
};
