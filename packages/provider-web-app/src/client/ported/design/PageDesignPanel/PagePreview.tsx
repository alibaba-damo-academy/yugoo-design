/**
 * Selected-page preview pane: renders the page's hydrated artifact HTML in a
 * sandboxed iframe scaled from the 1280px design width, or a status
 * placeholder while the artifact is absent. Never generates or fakes HTML.
 *
 * Hotspot binding: a host-authored script (trusted head markup) is injected
 * into the srcDoc so the user can pick the source element that triggers an
 * outgoing connection, or follow a bound connection to its target page. The
 * iframe stays `sandbox='allow-scripts'` (no `allow-same-origin`, no top
 * navigation); messages are accepted only from this iframe's own
 * `contentWindow` and only when they match the exact prototype schema.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { useLang } from '../../host.ts';
import { pageStatusLabel } from './pageDesignLabels.ts';
import type { IPageConnection, IPageNode } from './pageDesignTypes.ts';
import {
  parsePrototypeMessage,
  prototypeHostMarkup,
  type PrototypeFrameMessage,
  type PrototypeHostConfig,
} from './pageDesignPrototype.ts';
import { secureDesignSrcDoc } from '../../../srcdoc-security.ts';
import { DesignExecutionStatusIcon } from '../OfficialWebAppPanels/DesignExecutionStatusIcon.tsx';
import { ExecutionRollingLog, previewNavigationContextMarkup, type PreviewNavigationContext, type ExecutionRollingLogProps } from 'dsh-design-panel/client-api';
import { useLangSwitch } from '../ResearchPanel/useLangSwitch.ts';

export interface IPagePreviewProps {
  /** The selected page (adapter-hydrated `html` when its artifact exists). */
  page: IPageNode;
  /** Complete landed tokens.css stylesheet; no config/default projection. */
  styleCss?: string;
  /** Host-resolved transient arrival selection; absent for manual navigation. */
  arrivalContext?: PreviewNavigationContext;
  /** Reader/canonical generation changes must replace the iframe WindowProxy. */
  previewGenerationIdentity?: unknown;
  /** Outgoing connections of the selected page (binding + navigation source). */
  connections?: readonly IPageConnection[];
  /** Connection currently awaiting a hotspot pick, or null when not binding. */
  bindingConnectionId?: string | null;
  /** Receives strictly validated prototype messages from this iframe only. */
  onPrototypeMessage?: (message: PrototypeFrameMessage) => void;
  /**
   * Receives the preview token of the current srcDoc instance ('' while no
   * artifact renders). The panel accepts only geometry reports whose
   * pageId + previewToken match the current selection and token, so stale
   * iframe reports from a previous page or srcDoc never pollute the readout.
   */
  onGeometryToken?: (previewToken: string) => void;
  /** Reads the Host-authorized native log for this Page worker. */
  readExecutionLog?: ExecutionRollingLogProps['readExecutionLog'];
}

export interface IPageThumbnailProps {
  /** Page whose hydrated HTML is rendered when available. */
  page: IPageNode;
  /** CSS custom properties injected into the generated page. */
  styleCss?: string;
}

/** Artifact HTML is authored against a fixed desktop design width. */
const DESIGN_WIDTH = 1280;

/** Monotonic identity for srcDoc instances; echoed back by geometry reports. */
let previewInstance = 0;

/**
 * Prefix the artifact HTML with the host style (injected CSS custom
 * properties plus viewport guards) and the prototype host markup so previews
 * track the active theme and support hotspot binding/navigation.
 *
 * @param html - hydrated page artifact HTML.
 * @param styleCss - complete landed tokens.css stylesheet, or undefined.
 * @param connections - outgoing connections of the selected page.
 * @param bindingConnectionId - connection awaiting a hotspot pick, or null.
 * @param geometry - visual geometry check config, or undefined for thumbnails.
 * @returns srcDoc string for the preview iframe.
 */
function buildSrcDoc(
  html: string,
  styleCss: string | undefined,
  connections: readonly IPageConnection[],
  bindingConnectionId: string | null,
  geometry?: PrototypeHostConfig['geometry'],
  arrivalContext?: PreviewNavigationContext
): string {
  const bindings = connections
    .filter((connection) => connection.source_element_id)
    .map((connection) => ({
      connectionId: connection.id,
      elementId: connection.source_element_id as string,
    }));
  const host =
    previewNavigationContextMarkup(html, arrivalContext) +
    `<style id="page-design-host-vars">${(styleCss ?? '').replace(/</g, '\\3c ')}\nhtml,body{margin:0!important;width:100%!important;min-height:100%!important}body{overflow:auto!important}</style>` +
    prototypeHostMarkup({ bindingConnectionId, bindings, geometry });
  return secureDesignSrcDoc(html, 'interactive-preview', host);
}

/**
 * The preview body: scaled iframe when the page carries hydrated HTML,
 * otherwise a pending / failed placeholder.
 *
 * @param props - page, optional styleCss, and prototype binding props.
 * @returns the preview pane content.
 */
export function PagePreview(props: IPagePreviewProps): ReactElement {
  const {
    page,
    styleCss,
    connections = [],
    bindingConnectionId = null,
    onPrototypeMessage,
    onGeometryToken,
    arrivalContext,
    previewGenerationIdentity,
  } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(1);
  const fitScale = useCallback((): void => {
    const element = wrapRef.current;
    if (element === null || element.clientWidth === 0) return;
    setScale(Math.min(1, element.clientWidth / DESIGN_WIDTH));
  }, []);

  useEffect(() => {
    const element = wrapRef.current;
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      fitScale();
    });
    observer.observe(element);
    fitScale();
    return () => {
      observer.disconnect();
    };
  }, [fitScale]);

  // Accept prototype messages only from this preview's own iframe. The opaque
  // sandbox origin cannot be meaningfully checked, so the frame identity
  // (`event.source`) plus the exact schema is the trust boundary here.
  useEffect(() => {
    if (onPrototypeMessage === undefined) return;
    const receive = (event: MessageEvent): void => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = parsePrototypeMessage(event.data);
      if (message === undefined) return;
      onPrototypeMessage(message);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onPrototypeMessage]);

  const preview = useMemo(() => {
    if (!page.html || styleCss === undefined) return null;
    // The token and the srcDoc that embeds it come from one memo result, so
    // the panel's matching token always describes the rendered document.
    const previewToken = `preview-${++previewInstance}`;
    const geometry = {
      pageId: page.id,
      previewToken,
      regions: connections
        .map((connection) => connection.source_element_id ?? '')
        .filter((elementId) => elementId !== ''),
    };
    try { return {
      previewToken,
      srcDoc: buildSrcDoc(
        page.html,
        styleCss,
        connections,
        bindingConnectionId,
        geometry,
        arrivalContext
      ),
    }; } catch (error) {
      return { previewToken, srcDoc: null, error: error instanceof Error ? error.message : 'Invalid preview artifact' };
    }
  }, [page.html, page.id, styleCss, connections, bindingConnectionId, arrivalContext, previewGenerationIdentity]);

  useEffect(() => {
    onGeometryToken?.(preview?.srcDoc ? preview.previewToken : '');
  }, [preview?.previewToken, preview?.srcDoc, onGeometryToken]);

  if (page.html && styleCss === undefined) return <div role='status' className='p-6 text-sm text-muted-foreground'>页面样式正在加载或暂不可用，正在重试…</div>;
  if (preview === null) return <PreviewPlaceholder page={page} readExecutionLog={props.readExecutionLog} />;
  if (preview.srcDoc === null) return <div role='alert' className='p-6 text-sm text-red-700'>{preview.error}</div>;

  return (
    <div ref={wrapRef} className='h-full w-full overflow-hidden bg-white'>
      <iframe
        key={preview.previewToken}
        ref={iframeRef}
        title={`${page.name} preview`}
        srcDoc={preview.srcDoc}
        sandbox='allow-scripts'
        referrerPolicy='no-referrer'
        className='border-0'
        onLoad={fitScale}
        style={{
          width: scale < 1 ? DESIGN_WIDTH : '100%',
          height: `${100 / scale}%`,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      />
    </div>
  );
}

/**
 * Render a non-interactive 1280px artifact preview inside one Page Map node.
 * Generated HTML is the thumbnail authority; pages without it use a compact
 * wireframe instead of a fabricated product screen.
 * @param props - hydrated page and optional Design Style variables.
 * @returns a fixed-height map-card preview.
 */
export function PageThumbnail({ page, styleCss }: IPageThumbnailProps): ReactElement {
  const preview = useMemo(
    () => {
      try { return { srcDoc: page.html && styleCss !== undefined ? buildSrcDoc(page.html, styleCss, [], null) : null }; }
      catch (error) { return { srcDoc: null, error: error instanceof Error ? error.message : 'Invalid preview artifact' }; }
    },
    [page.html, styleCss]
  );
  const { srcDoc } = preview;
  if (preview.error) return <div role='alert' className='p-3 text-xs text-red-700'>{preview.error}</div>;
  if (srcDoc === null) {
    return (
      <ThumbnailWireframe
        label={page.artifact_file
          ? page.artifact_loading
            ? 'Loading preview…'
            : 'Preview unavailable'
          : undefined}
      />
    );
  }
  return (
    <div className='h-full w-full overflow-hidden bg-white'>
      <iframe
        loading='lazy'
        title={`${page.name} thumbnail`}
        srcDoc={srcDoc}
        sandbox='allow-scripts'
        referrerPolicy='no-referrer'
        tabIndex={-1}
        aria-hidden='true'
        className='pointer-events-none origin-top-left border-0'
        style={{ width: DESIGN_WIDTH, height: 720, transform: 'scale(0.24)' }}
      />
    </div>
  );
}

/** Compact structural placeholder used only until a page artifact exists. */
function ThumbnailWireframe({ label }: { label?: string }): ReactElement {
  return (
    <div className='relative flex h-full w-full gap-2 bg-[var(--ds-bg-gary-default)] p-3' aria-label={label}>
      <div className='w-12 rounded-md bg-[#E8E5F0]' />
      <div className='flex min-w-0 flex-1 flex-col gap-2'>
        <div className='h-5 w-2/3 rounded bg-[#DCD8E8]' />
        <div className='grid flex-1 grid-cols-2 gap-2'>
          <div className='rounded-md border border-dashed border-[#D1CBE0] bg-white' />
          <div className='rounded-md border border-dashed border-[#D1CBE0] bg-white' />
          <div className='col-span-2 rounded-md border border-dashed border-[#D1CBE0] bg-white' />
        </div>
      </div>
      {label ? (
        <span className='absolute inset-x-2 bottom-2 truncate rounded bg-white/90 px-2 py-1 text-center text-[10px] text-gray-500'>
          {label}
        </span>
      ) : null}
    </div>
  );
}

/** Pending / failed placeholder: status label plus the failure message. */
function PreviewPlaceholder({
  page,
  readExecutionLog,
}: {
  page: IPageNode;
  readExecutionLog?: ExecutionRollingLogProps['readExecutionLog'];
}): ReactElement {
  const t = useLang();
  const { currentLanguage } = useLangSwitch();
  const failed = page.generation_status === 'failed';
  const running = page.generation_status === 'working';
  const queued = page.generation_status === 'queued';
  const artifactLoading = Boolean(page.artifact_file && page.artifact_loading);
  const artifactUnavailable = Boolean(
    page.artifact_file && !page.artifact_loading && !page.artifact_available
  );
  const label = pageStatusLabel(t, page);
  return (
    <div className='flex h-full w-full items-center justify-center bg-[var(--ds-bg-gary-default)]'>
      <div className='flex max-w-md flex-col items-center gap-2 px-8 text-center'>
        <div className='flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-[#D9D5E8] bg-white text-2xl text-[#A89BD8]'>
          {running || queued || artifactLoading ? (
            <DesignExecutionStatusIcon
              size='md'
              status={artifactLoading || running ? 'working' : queued ? 'queued' : 'pending'}
              label={label}
            />
          ) : failed ? (
            <DesignExecutionStatusIcon size='md' status='failed' label={label} />
          ) : '◇'}
        </div>
        <div className='text-sm font-medium text-[var(--ds-text-primary)]'>
          {artifactLoading
            ? t.page_design_preview_loading_artifact
            : artifactUnavailable
              ? t.page_design_preview_unavailable
              : failed
            ? t.page_design_preview_failed
            : t.page_design_preview_pending}
        </div>
        <div className='text-xs leading-[18px] text-gray-500'>
          {artifactLoading
            ? t.page_design_preview_loading_artifact_hint
            : artifactUnavailable
              ? t.page_design_preview_unavailable_hint
              : failed
            ? (page.generation_error ?? t.page_design_preview_failed_hint)
            : label}
        </div>
        <ExecutionRollingLog
          runId={page.execution_run_id}
          active={running || queued}
          locale={currentLanguage === 'zh_CN' ? 'zh' : 'en'}
          label={currentLanguage === 'zh_CN' ? '页面生成日志' : 'Page generation log'}
          readExecutionLog={readExecutionLog}
        />
      </div>
    </div>
  );
}
