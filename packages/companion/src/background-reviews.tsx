import type { RecordedConversation } from './conversation.tsx'
import { companionChromeText, type CompanionChromeKey } from './locale.ts'

export interface BackgroundReviews {
  reviews: { profile:string; status:string; revisionChanged?:boolean; scopeChanged?:boolean; error?:string; executionAvailability?:string; executionMode?:string }[]
  rows: RecordedConversation['rows']
}
const names: Record<string, CompanionChromeKey> = { grounding: 'reviewProfileGrounding', reflection: 'reviewProfileReflection', alignment: 'reviewProfileAlignment', clarity: 'reviewProfileClarity' }
const labels: Record<string, CompanionChromeKey> = { due: 'reviewDue', prepared: 'reviewPrepared', running: 'reviewRunning', completed: 'reviewCompleted',
  unsubmitted: 'reviewUnsubmitted', failed: 'reviewFailed', interrupted: 'reviewInterrupted', unknown: 'reviewUnknown', unavailable: 'reviewUnavailable', stale: 'reviewStale' }
const foregroundLabels: Record<string, CompanionChromeKey> = { prepared: 'reviewForegroundPrepared', running: 'reviewForegroundRunning', unknown: 'reviewForegroundUnknown', unsubmitted: 'reviewForegroundUnsubmitted', unavailable: 'reviewForegroundUnavailable' }

export function BackgroundReviewPanel({ value, disconnected, locale = 'zh' }: { value?: BackgroundReviews; disconnected: boolean; locale?: string }) {
  const t = (key: CompanionChromeKey, values?: Record<string, string | number>) => companionChromeText(key, locale, values)
  return <section aria-label={t('reviewStatus')}>
    <p>{t('reviewSummary')}</p>
    {disconnected && <p role="status">{t('reviewDisconnected')}</p>}
    <ul className="companion-review-statuses">{(value?.reviews ?? []).map(review=><li key={review.profile}>
      <strong>{names[review.profile] ? t(names[review.profile]) : review.profile}</strong>
      <span>{!disconnected && review.status==='running' && <span className="companion-spinner" aria-hidden="true"/>}{((review.executionMode === 'foreground' && foregroundLabels[review.status]) || labels[review.status]) ? t((review.executionMode === 'foreground' && foregroundLabels[review.status]) || labels[review.status]) : review.status}</span>
      {review.executionAvailability === 'unavailable' && <small>{t('reviewExecutionUnavailable')}</small>}
      {(review.revisionChanged || review.scopeChanged) && <small>{t('reviewSourceChanged')}</small>}
      {review.error && <small>{review.error}</small>}
    </li>)}</ul>
    {!value?.reviews.length && <p>{t('reviewEmpty')}</p>}
    <details><summary>{t('reviewActivityHistory', { count: value?.rows.length ?? 0 })}</summary>
      <ul>{value?.rows.map(row=><li key={row.id}>{row.label} · {row.status}</li>)}</ul>
    </details>
  </section>
}
