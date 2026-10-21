import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { secureDesignSrcDoc } from '../../../srcdoc-security.ts'
import type { IDesignStyleConfig } from './designStyleTypes.ts'
import { styleConfigToCSSVars } from './styleVariables.ts'

export interface IPreviewFrameProps {
  config: IDesignStyleConfig
}

function cssVarsToInlineStyle(vars: CSSProperties): string {
  return Object.entries(vars).map(([key, value]) => `${key}:${String(value)};`).join('')
}

/** Render hydrated prototype HTML and live-update its design-token variables. */
export function PreviewFrame({ config }: IPreviewFrameProps): ReactElement {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const fitScale = useCallback((): void => {
    const element = wrapRef.current
    if (element === null || element.clientWidth === 0) return
    setScale(Math.min(1, element.clientWidth / 1280))
  }, [])

  useEffect(() => {
    const element = wrapRef.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => { fitScale() })
    observer.observe(element)
    fitScale()
    return () => { observer.disconnect() }
  }, [fitScale])

  const html = config.preview_page?.html ?? null
  const cssVars = useMemo(() => styleConfigToCSSVars(config), [config])
  const srcDoc = useMemo(() => {
    if (!html) return null
    const initialVars = cssVarsToInlineStyle(cssVars)
    const baseGuards = `
      img {
        background: var(--ds-fill-3, #eef0f3);
      }
      html, body {
        width: 100% !important;
        margin: 0 !important;
      }
      html {
        font-size: var(--ds-base-font-size, 16px);
      }
      body {
        overflow-x: auto !important;
        overflow-y: auto !important;
      }
      a[href="#"] {
        cursor: default !important;
      }
    `
    const needsLegacySidebarFix = html.includes('.main-content')
      && html.includes('position: fixed')
      && html.includes('grid-template-columns')
    const legacySidebarFix = needsLegacySidebarFix
      ? `
          .app-shell {
            display: block !important;
            width: 100% !important;
          }
          .main-content {
            width: calc(100% - var(--sidebar-width, 220px)) !important;
            min-width: calc(100% - var(--sidebar-width, 220px)) !important;
            margin-left: var(--sidebar-width, 220px) !important;
          }
          .topbar,
          .page-body,
          .action-bar {
            width: auto !important;
            min-width: 0 !important;
          }
        `
      : ''
    const hostGuards = `${baseGuards}${legacySidebarFix}`.replace(/\s+/g, ' ')
    const navigationGuardScript = `
      <script id="ds-preview-guard">
        (function () {
          document.addEventListener('click', function (event) {
            var target = event.target;
            if (!(target instanceof Element)) return;
            var anchor = target.closest('a[href]');
            if (!anchor) return;
            event.preventDefault();
            event.stopImmediatePropagation();
          }, true);
          document.addEventListener('submit', function (event) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }, true);
          window.open = function () { return null; };
          window.addEventListener('message', function (event) {
            if (event.source !== parent || event.data?.type !== 'yugoo:style-preview-vars') return;
            var vars = event.data.vars;
            if (!vars || typeof vars !== 'object' || Array.isArray(vars)) return;
            Object.entries(vars).forEach(function (entry) {
              if (entry[0].startsWith('--') && typeof entry[1] === 'string') document.documentElement.style.setProperty(entry[0], entry[1]);
            });
          });
        })();
      </script>
    `.replace(/\s+/g, ' ')
    const styleTag = `<style id="ds-host-vars">:root{${initialVars}}${hostGuards}</style>`
    return secureDesignSrcDoc(html, 'interactive-preview', `${styleTag}${navigationGuardScript}`)
  // CSS variables update through the live iframe path without reloading its state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, config.preview_page?.html_file])

  // The preview has an opaque origin. Send only design tokens to this exact
  // child window; it never receives browser credentials or project authority.
  const applyVars = useCallback((): void => {
    iframeRef.current?.contentWindow?.postMessage({
      type: 'yugoo:style-preview-vars',
      vars: Object.fromEntries(Object.entries(cssVars).map(([key, value]) => [key, String(value)])),
    }, '*')
  }, [cssVars])
  useEffect(applyVars, [applyVars, srcDoc])

  if (srcDoc === null) return <PreviewPlaceholder config={config} />

  const designWidth = 1280
  return (
    <div ref={wrapRef} className='h-full w-full overflow-hidden'>
      <iframe
        ref={iframeRef}
        title='design-style-preview'
        srcDoc={srcDoc}
        sandbox='allow-scripts'
        className='border-0'
        onLoad={() => { fitScale(); applyVars() }}
        style={{
          width: scale < 1 ? designWidth : '100%',
          height: `${100 / scale}%`,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      />
    </div>
  )
}

function PreviewPlaceholder({ config }: { config: IDesignStyleConfig }): ReactElement {
  const pageTitle = config.preview_page?.title
  const hasFile = Boolean(config.preview_page?.html_file)
  const message = config.preview_page === null || config.preview_page === undefined
    ? '视觉风格已生成；正在挑选最具代表性的页面进行原型设计。'
    : !hasFile
      ? `正在为 "${pageTitle ?? '产品核心页'}" 生成原型...`
      : `已选择页面 "${pageTitle ?? config.preview_page.name}"，但原型内容暂时不可用。`

  return (
    <div className='flex h-full w-full items-center justify-center bg-[#FAFAFC]'>
      <div className='flex max-w-md flex-col items-center gap-3 px-8 text-center'>
        <div className='flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-[#D9D5E8] bg-white text-3xl text-[#A89BD8]'>◇</div>
        <div className='text-sm font-medium text-[#10082B]'>原型预览</div>
        <div className='text-xs leading-[20px] text-gray-500'>{message}</div>
        {config.preview_page?.rationale
          ? (
            <div className='mt-2 rounded-md border border-[#ECEBEE] bg-white px-4 py-2.5 text-left text-xs leading-[18px] text-gray-500'>
              <span className='mb-1 block text-[10px] uppercase tracking-wide text-gray-400'>选页理由</span>
              {config.preview_page.rationale}
            </div>
          )
          : null}
      </div>
    </div>
  )
}
