import React, { useCallback, useEffect, useRef, useState } from 'react';
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

export interface IBpmnEditorProps {
  /** Initial BPMN XML to load. */
  xml: string;
  /** Re-mount key — change this to force a fresh editor instance. */
  processId: string;
  /**
   * Called (debounced) whenever the user mutates the diagram with the
   * latest serialised XML. Parent persists this into the design store so
   * the snapshot stays current — no separate "save in editor" step.
   */
  onChange?: (xml: string) => void;
  className?: string;
}

const FLUSH_DEBOUNCE_MS = 250;
/**
 * Full bpmn-js Modeler — drag, add, route, label.
 *
 * Mirrors BpmnViewer's container layout (zoom toolbar + flex-fill canvas) so
 * the user feels no jarring shift when toggling view ↔ edit. Edits are
 * auto-flushed to the parent via a debounced ``onChange(xml)`` so the design
 * store always holds the latest serialised state — no Save-in-editor step
 * required, the design footer's "Save and continue" picks up the store.
 */
export const BpmnEditor: React.FC<IBpmnEditorProps> = ({
  xml,
  processId,
  onChange,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const modelerRef = useRef<Modeler | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef<typeof onChange>(undefined);
  onChangeRef.current = onChange;
  // See BpmnViewer for rationale — fit-viewport on a 0×0 container throws
  // "non-finite SVGMatrix scale". Defer until the host has dimensions.
  const initialFitDoneRef = useRef(false);
  const viewportModeRef = useRef<'width' | 'all' | 'manual'>('width');
  const [error, setError] = useState<string | null>(null);
  const { currentLanguage: language } = useLangSwitch();
  const isZh = language === 'zh_CN';

  const tryInitialFit = useCallback(() => {
    const modeler = modelerRef.current;
    const node = containerRef.current;
    if (!modeler || !node) return;
    if (node.clientWidth <= 0 || node.clientHeight <= 0) return;
    try {
      const canvas = modeler.get('canvas') as IBpmnCanvasService;
      if (viewportModeRef.current === 'all') {
        fitBpmnToViewport(canvas);
      } else {
        fitBpmnForVerticalBrowsing(canvas);
      }
      initialFitDoneRef.current = true;
    } catch {
      // ResizeObserver will retry.
    }
  }, []);

  // Schedule a serialise + onChange after the user stops modeling for
  // FLUSH_DEBOUNCE_MS. Avoids a flush per keystroke during rename, etc.
  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(async () => {
      const modeler = modelerRef.current;
      if (!modeler) return;
      try {
        const { xml: out } = await modeler.saveXML({ format: true });
        if (out) onChangeRef.current?.(out);
      } catch {
        // Best-effort; serialisation failure is rare and recoverable on
        // the next change.
      }
    }, FLUSH_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    if (!containerRef.current || !xml) return;
    const modelerOptions = {
      container: containerRef.current,
      textRenderer: BPMN_TEXT_RENDERER,
    } as ConstructorParameters<typeof Modeler>[0] & {
      textRenderer: typeof BPMN_TEXT_RENDERER;
    };
    const modeler = new Modeler(modelerOptions);
    modelerRef.current = modeler;
    initialFitDoneRef.current = false;
    viewportModeRef.current = 'width';

    const errorMsg = isZh
      ? 'BPMN 编辑器加载失败'
      : 'Failed to load BPMN editor';

    const loadXml = async () => {
      try {
        setError(null);
        await modeler.importXML(xml);
        applyBpmnLaneHeaderDividers(modeler, xml);
        tryInitialFit();
      } catch (err) {
        const message =
          err instanceof Error ? `${errorMsg}: ${err.message}` : errorMsg;
        setError(message);
      }
    };

    loadXml();

    // bpmn-js fires `commandStack.changed` on every modeling command —
    // shape move, label edit, edge add, etc. Each fires the debounced flush.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventBus = modeler.get('eventBus') as any;
    const onChanged = () => scheduleFlush();
    eventBus.on('commandStack.changed', onChanged);

    return () => {
      eventBus.off('commandStack.changed', onChanged);
      if (flushTimerRef.current) {
        // A debounced flush is pending — serialize the current XML before
        // tearing down the modeler, otherwise the last edit is silently lost.
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
        modeler
          .saveXML({ format: true })
          .then(({ xml: out }) => {
            if (out) onChangeRef.current?.(out);
          })
          .catch(() => {})
          .finally(() => modeler.destroy());
      } else {
        modeler.destroy();
      }
      modelerRef.current = null;
    };
  }, [xml, processId, isZh, scheduleFlush, tryInitialFit]);

  // Reflow on resize. Automatic mode recomputes a complete fit; manual zoom
  // remains a user choice until the process or XML changes.
  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const modeler = modelerRef.current;
      if (!modeler) return;
      try {
        const canvas = modeler.get('canvas') as IBpmnCanvasService;
        canvas.resized();
        if (
          viewportModeRef.current !== 'manual' ||
          !initialFitDoneRef.current
        ) {
          tryInitialFit();
        }
      } catch {
        // Mid-teardown; ignore.
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [tryInitialFit]);

  const handleZoomIn = useCallback(() => {
    const modeler = modelerRef.current;
    if (!modeler) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const zoomScroll = modeler.get('zoomScroll') as any;
    viewportModeRef.current = 'manual';
    zoomScroll.stepZoom(1);
  }, []);

  const handleZoomOut = useCallback(() => {
    const modeler = modelerRef.current;
    if (!modeler) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const zoomScroll = modeler.get('zoomScroll') as any;
    viewportModeRef.current = 'manual';
    zoomScroll.stepZoom(-1);
  }, []);

  const handleZoomFit = useCallback(() => {
    const modeler = modelerRef.current;
    if (!modeler) return;
    const canvas = modeler.get('canvas') as IBpmnCanvasService;
    viewportModeRef.current = 'all';
    fitBpmnToViewport(canvas);
  }, []);

  const handleZoomReset = useCallback(() => {
    const modeler = modelerRef.current;
    if (!modeler) return;
    const canvas = modeler.get('canvas') as IBpmnCanvasService;
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
        <span className='ml-2 text-xs text-gray-400'>
          {isZh
            ? '拖拽节点 / 右键添加 / 双击改名'
            : 'Drag, right-click to add, double-click to rename'}
        </span>
      </div>
      <div ref={containerRef} className='flex-1 min-h-0 w-full' />
    </div>
  );
};
