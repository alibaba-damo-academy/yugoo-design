/** design_style adapter: hydrates preview artifacts around the original panel payload. */
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { DesignStylePanel as PortedDesignStylePanel } from '../ported/design/DesignStylePanel/DesignStylePanel.tsx'
import type {
  IDesignStyleConfig,
  IDesignStylePanel,
  IPreviewPage,
} from '../ported/design/DesignStylePanel/designStyleTypes.ts'
import { isRecord, type DesignStyleState } from '../types.ts'
import type { SkillPanelProps } from './shared.ts'
import { useHtmlImageContents } from './artifact-html-images.ts'

interface PanelProps extends SkillPanelProps {
  /** Save in flight; workspace must pass this to match the original disabled state. */
  running?: boolean
  /** Host save-and-regenerate action for the fine-tune footer. */
  onSaveAndRegenerate?: () => void
}

const PANEL_ID = 'design_style'
const TOKENS_FILE = 'design_style/tokens.css'

function previewPage(config: Record<string, unknown>): IPreviewPage | undefined {
  return isRecord(config.preview_page) ? config.preview_page as unknown as IPreviewPage : undefined
}

function inlineTokens(html: string, tokens: string): string {
  const style = `<style data-dsh-design-tokens>${tokens}</style>`
  const linked = /<link\b[^>]*\bhref=(['"])\.\/tokens\.css\1[^>]*>/i
  if (linked.test(html)) return html.replace(linked, style)
  return html.includes('</head>') ? html.replace('</head>', `${style}</head>`) : `${style}${html}`
}

function useHydratedConfig(
  config: Record<string, unknown>,
  readArtifact: SkillPanelProps['readArtifact'],
  originalState: unknown,
  refreshNonce: number,
): IDesignStyleConfig {
  const page = previewPage(config)
  const inlineHtml = typeof page?.html === 'string' ? page.html : undefined
  const htmlFile = typeof page?.html_file === 'string' && page.html_file !== '' ? page.html_file : undefined
  const [html, setHtml] = useState<string | undefined>(inlineHtml)

  useEffect(() => {
    if (htmlFile === undefined) {
      setHtml(inlineHtml)
      return
    }
    let cancelled = false
    Promise.all([readArtifact(htmlFile), readArtifact(TOKENS_FILE)]).then(
      ([preview, tokens]) => {
        if (cancelled) return
        if (!preview.found) {
          setHtml(inlineHtml)
          return
        }
        setHtml(tokens.found ? inlineTokens(preview.content, tokens.content) : preview.content)
      },
      () => { if (!cancelled) setHtml(inlineHtml) },
    )
    return () => { cancelled = true }
  }, [htmlFile, inlineHtml, originalState, readArtifact, refreshNonce])

  return useMemo(() => ({
    ...(config as unknown as IDesignStyleConfig),
    preview_page: page === undefined ? undefined : { ...page, html: html ?? null },
  }), [config, html, page])
}

function dehydrateConfig(config: IDesignStyleConfig): Record<string, unknown> {
  const next = { ...config } as Record<string, unknown>
  if (isRecord(config.preview_page)) {
    const page = { ...config.preview_page } as Record<string, unknown>
    delete page.html
    next.preview_page = page
  }
  if (Array.isArray(next.preview_pages)) {
    next.preview_pages = next.preview_pages.map((entry) => {
      if (!isRecord(entry)) return entry
      const page = { ...entry }
      delete page.html
      return page
    })
  }
  return next
}

/** Strict-port design-style panel bound to the dsh Design File state. */
export function DesignStylePanel(props: PanelProps): ReactElement {
  const state = (isRecord(props.draft) ? props.draft : {}) as DesignStyleState
  const config = isRecord(state.config) ? state.config : {}
  const [refreshNonce, setRefreshNonce] = useState(0)
  const hydratedConfig = useHydratedConfig(
    config,
    props.readArtifact,
    props.originalState,
    refreshNonce,
  )
  const page = hydratedConfig.preview_page
  const imageHtmls = useHtmlImageContents(
    typeof page?.html_file === 'string' ? [{ id: 'preview', path: page.html_file }] : [],
    { preview: page?.html ?? null },
    props.readBinaryArtifact,
    props.originalState,
    props.artifactFiles,
  )
  const data: IDesignStylePanel = {
    panel_id: PANEL_ID,
    type: 'design_style',
    config: { ...hydratedConfig, preview_page: page == null ? page : { ...page, html: imageHtmls.preview ?? null } },
  }

  return (
    <PortedDesignStylePanel
      data={data}
      disabled={props.running === true}
      onChange={(updates) => {
        if (updates.config === undefined || updates.config === null) return
        props.onChange({ ...state, config: dehydrateConfig(updates.config) })
      }}
      onSaveAndRegenerate={props.onSaveAndRegenerate}
      onRefresh={() => { setRefreshNonce((value) => value + 1) }}
    />
  )
}

export default DesignStylePanel
