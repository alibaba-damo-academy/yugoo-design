import type { ReactElement, ReactNode } from 'react'
import { renderStudioMarkdown } from './markdown.tsx'

type Title = Readonly<{ zh: string; en: string }>
export interface StudioBundleCardContent {
  readonly name: string
  readonly version: string
  readonly title?: Title
  readonly description?: string
  readonly displayDescription?: Title
}

export function StudioGlyph({ bundle = false }: { bundle?: boolean }): ReactElement {
  return <span className="ygd-studio-kitmark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
    {bundle ? <><path d="m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9" /></> : <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 9v11" /></>}
  </svg></span>
}


/** One card presentation for the Bundle catalog and Kit mount selection. */
export function BundleCard({ bundle, locale, badge, onBadgeClick, badgeLabel, children }: {
  bundle: StudioBundleCardContent; locale: 'zh' | 'en'; badge?: ReactNode; onBadgeClick?: () => void; badgeLabel?: string; children: ReactNode
}): ReactElement {
  const description = bundle.displayDescription?.[locale] ?? bundle.description
  return <article className="ygd-studio-kit-card ygd-studio-bundle-card">
    <div className="ygd-studio-card-top"><StudioGlyph bundle /><>{onBadgeClick ? <button type="button" className="ygd-studio-card-pill ygd-studio-card-pill-action" aria-label={badgeLabel} onClick={onBadgeClick}>{badge ?? bundle.version}</button> : <span className="ygd-studio-card-pill">{badge ?? bundle.version}</span>}</></div>
    <h3 className="ygd-studio-kit-card-name">{bundle.title?.[locale] ?? bundle.name.replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())}</h3>
    <div className="ygd-studio-source-id" title={bundle.name}>{bundle.name}</div>
    {description && <div className="ygd-studio-card-description">{renderStudioMarkdown(description)}</div>}
    <div className="ygd-studio-kit-card-actions">{children}</div>
  </article>
}
