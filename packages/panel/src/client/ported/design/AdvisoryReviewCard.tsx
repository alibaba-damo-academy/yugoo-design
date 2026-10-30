/**
 * Advisory review card for every durable unresolved human-review item.
 * Revision mismatch is displayed as a revalidation marker. Only pending and
 * deferred items remain in the review surface: accept/reject clear the card,
 * while defer keeps it available but collapses its details. Acceptance
 * persists its receipt before Host prompt dispatch. Reject and defer never
 * wake the Agent.
 */
import { createElement, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { currentLanguage } from '../host.ts'

/** One bounded recommendation inside an advisory (display fields). */
export interface AdvisoryCardItem {
  readonly id: string
  readonly title: string
  readonly detail: string
  readonly rationale?: string
  readonly references: readonly string[]
}

/**
 * Display view of one actionable background advisory. Mirrors the core
 * DesignAdvisory projection fields the card consumes; the core projection
 * interface owns validation and trust.
 */
export interface AdvisoryCardView {
  readonly publishedAt?: number
  readonly publishedRevision?: number
  readonly id: string
  readonly profile: string
  readonly kind: 'reminder' | 'suggestion'
  readonly attention: 'human-review'
  readonly summary: string
  readonly items: readonly AdvisoryCardItem[]
  readonly acceptanceInstruction: string
  readonly actionSpec?: { readonly kind: string }
  readonly status?: AdvisoryEntryStatus
  readonly stale?: boolean
  readonly acceptanceReceiptId?: string
  readonly actionReceipts?: readonly AdvisoryActionReceipt[]
  readonly executionStatus?: AdvisoryExecutionStatus
}

/** Exact Bundle authority minted atomically with advisory acceptance. */
export interface AdvisoryActionReceipt {
  readonly actionId: string
  readonly receiptId: string
  readonly target: {
    readonly kitName: string
    readonly kitVersion: string
    readonly skillName: string
    readonly bundleVersion: string
    readonly entityRefs: readonly string[]
  }
  readonly state: 'ready' | 'running' | 'failed' | 'needs-user-input' | 'completed'
  readonly logicalInvocationId?: string
  readonly attemptId?: string
}

export type AdvisoryExecutionStatus = 'not-applicable' | 'ready' | 'running' | 'failed' | 'needs-user-input' | 'completed'

/** Durable disposition/execution lifecycle of one advisory entry. */
export type AdvisoryEntryStatus = 'pending' | 'accepted' | 'rejected' | 'deferred' | 'queued' | 'running' | 'failed' | 'needs-user-input' | 'completed' | 'invalidated'

/** One projection entry: the advisory plus its current disposition status. */
export interface AdvisoryReviewEntry {
  readonly publishedAt?: number
  readonly publishedRevision?: number
  readonly advisory: AdvisoryCardView
  readonly status: AdvisoryEntryStatus
  /** True when the advisory inputs require revalidation; never hides the item. */
  readonly stale: boolean
  readonly acceptanceReceiptId?: string
  readonly actionReceipts?: readonly AdvisoryActionReceipt[]
  readonly executionStatus?: AdvisoryExecutionStatus
}

/** Local human disposition of an advisory; neither value wakes the Agent. */
export type AdvisoryDismissDecision = 'rejected' | 'deferred'

/**
 * Turn the stable advisory profile id into a short human-facing label.
 * @param profile - namespaced advisory profile id.
 * @returns a compact label while the full id remains available as a tooltip.
 */
export function advisoryProfileLabel(profile: string, isZh = false): string {
  const profileName = profile.match(/\.advisory\.([^/]+)\//u)?.[1]
  if (profileName === undefined) return isZh ? '设计顾问' : 'Design advisor'
  if (isZh) {
    if (profileName === 'grounding') return 'Grounding 校准'
    if (profileName === 'reflection') return 'Reflection 反思'
    if (profileName === 'alignment') return 'Alignment 对齐'
  }
  return `${profileName.charAt(0).toUpperCase()}${profileName.slice(1)} review`
}

/**
 * Select every durable pending/deferred human-review advisory. Terminal and
 * post-acceptance execution states stay in the Journal but leave this review
 * surface.
 * @param entries - Design-owned advisory review entries.
 * @param handledIds - ids already accepted or rejected in this card.
 * @returns the visible advisories in projection order.
 */
export function selectPendingAdvisories(
  entries: readonly AdvisoryReviewEntry[],
  handledIds: ReadonlySet<string>,
): readonly AdvisoryCardView[] {
  const seen = new Set<string>()
  const unique: AdvisoryCardView[] = []
  for (const entry of entries) {
    const advisory = entry.advisory
    if ((entry.status !== 'pending' && entry.status !== 'deferred')
      || advisory.attention !== 'human-review') continue
    if (handledIds.has(advisory.id) || seen.has(advisory.id)) continue
    seen.add(advisory.id)
    unique.push(Object.freeze({
      ...advisory,
      publishedAt: entry.publishedAt,
      publishedRevision: entry.publishedRevision,
      status: entry.status,
      stale: entry.stale,
      ...(entry.acceptanceReceiptId === undefined ? {} : { acceptanceReceiptId: entry.acceptanceReceiptId }),
      ...(entry.actionReceipts === undefined ? {} : { actionReceipts: entry.actionReceipts }),
      ...(entry.executionStatus === undefined ? {} : { executionStatus: entry.executionStatus }),
    }))
  }
  // Old entries have no clock metadata: their projection is publication order.
  return unique.reverse().sort((a, b) => (b.publishedRevision ?? 0) - (a.publishedRevision ?? 0)
    || (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
}

const readingByScope = new Map<string, { read: Set<string>; selected: string | null }>()

export function advisoryDisplayTime(timestamp: number | undefined, isZh: boolean, now = new Date()): string {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return ''
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return ''
  const locale = isZh ? 'zh-CN' : 'en-US'
  const clock = date.toLocaleTimeString(locale, {hour:'2-digit', minute:'2-digit', hour12:false})
  if (date.toDateString() === now.toDateString()) return `${isZh ? '今天' : 'Today'} ${clock}`
  const day = date.toLocaleDateString(locale, {month:'numeric', day:'numeric', ...(date.getFullYear() !== now.getFullYear() ? {year:'numeric' as const} : {})})
  return `${day} ${clock}`
}

function readingFor(scope: string): { read: Set<string>; selected: string | null } {
  let reading = readingByScope.get(scope)
  if (!reading) { reading = { read: new Set(), selected: null }; readingByScope.set(scope, reading) }
  return reading
}

/** Resolve a stable carousel index, falling back to the nearest surviving card. */
export function resolveAdvisoryIndex(
  visibleIds: readonly string[],
  selectedId: string | null,
  previousVisibleIds: readonly string[],
): number {
  const currentIndex = selectedId === null ? -1 : visibleIds.indexOf(selectedId)
  if (currentIndex >= 0) return currentIndex
  const previousIndex = selectedId === null ? 0 : previousVisibleIds.indexOf(selectedId)
  return Math.min(Math.max(previousIndex, 0), Math.max(visibleIds.length - 1, 0))
}

/** Move one carousel step without wrapping past an explicit disabled boundary. */
export function adjacentAdvisoryIndex(currentIndex: number, count: number, direction: -1 | 1): number {
  return Math.min(Math.max(currentIndex + direction, 0), Math.max(count - 1, 0))
}

/** Minimal browser geometry consumed by the expanded advisory layout. */
export interface AdvisoryLayoutRect {
  readonly left: number
  readonly top: number
  readonly width: number
}

/** Fixed-position geometry for an advisory expanded over conversation history. */
export interface AdvisoryExpandedRect extends AdvisoryLayoutRect {
  readonly height: number
}

/**
 * Align expanded advisory details with the host composer column while filling
 * the visible conversation history above it.
 * @param history - visible conversation scroll-region geometry.
 * @param composer - host composer-card geometry.
 * @returns usable fixed-position geometry, or null before host layout settles.
 */
export function resolveAdvisoryExpandedRect(
  history: AdvisoryLayoutRect,
  composer: AdvisoryLayoutRect,
  boundary?: AdvisoryExpandedRect,
): AdvisoryExpandedRect | null {
  const top = boundary ? Math.max(history.top, boundary.top) : history.top
  const bottom = boundary ? Math.min(composer.top, boundary.top + boundary.height) : composer.top
  const left = boundary ? Math.max(composer.left, boundary.left) : composer.left
  const right = boundary ? Math.min(composer.left + composer.width, boundary.left + boundary.width) : composer.left + composer.width
  const height = bottom - top, width = right - left
  if (![top, left, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null
  return { left, top, width, height }
}

/**
 * Drive one acceptance: await the host delivery (sendPrompt) first and
 * report the outcome; a failure never dismisses the advisory.
 * @param advisory - the advisory being accepted.
 * @param deliver - host-wired sendPrompt call.
 * @returns whether the delivery succeeded.
 */
export async function deliverAdvisoryAcceptance(
  advisory: AdvisoryCardView,
  deliver: (advisory: AdvisoryCardView) => Promise<void>,
): Promise<boolean> {
  try {
    await deliver(advisory)
    return true
  } catch {
    return false
  }
}

/** Result of one receipt-first acceptance attempt. */
export interface AdvisoryAcceptanceResult {
  readonly promptDelivered: boolean
  readonly receiptRecorded: boolean
  readonly receiptId?: string
}

/** Receipt material returned by the atomic accepted-disposition write. */
export interface AdvisoryAcceptanceAuthority {
  readonly acceptanceReceiptId: string
  readonly actionReceipts: readonly AdvisoryActionReceipt[]
  readonly executionStatus: AdvisoryExecutionStatus
}

/**
 * Render one concise, conversation-visible acceptance request. The advisory
 * Agent needs the exact advisory identity and the same bounded facts the human
 * accepted, independently of generic titles or repeated item ids. Only the
 * separately supplied receipt/Bundle pairs grant execution authority.
 */
export function renderAdvisoryAcceptancePrompt(
  advisory: Pick<AdvisoryCardView, 'id' | 'summary' | 'items' | 'actionSpec'> & Partial<Pick<AdvisoryCardView, 'acceptanceInstruction'>>,
  authority: Pick<AdvisoryAcceptanceAuthority, 'actionReceipts'>,
): string {
  const isZh = /[\u3400-\u9fff]/u.test(advisory.summary)
  // Reuse the server's bounded instruction rather than rebuilding a title-only
  // summary. Legacy callers without it retain their actual item facts too.
  const context = advisory.acceptanceInstruction?.trim() ? advisory.acceptanceInstruction : [
    advisory.summary,
    ...advisory.items.map((item, index) => [
      `${index + 1}. ${item.title} (${JSON.stringify(item.id)}): ${item.detail}`,
      ...(item.rationale ? [item.rationale] : []),
      ...(item.references.length ? [JSON.stringify(item.references)] : []),
    ].join('\n')),
  ].join('\n')
  if (advisory.actionSpec?.kind === 'review-choice') {
    return [
      isZh ? '已接受这条设计建议；尚未授予 Bundle 执行权限。' : 'This design advisory was accepted; Bundle execution is not yet authorized.',
      `advisoryId: ${JSON.stringify(advisory.id)}`,
      context,
      isZh
        ? '调用 design_read_review_action 读取此建议的最新证据、接受凭据及候选。复核当前需要，再调用 design_select_review_action 记录选择与理由：合适的 Bundle、宿主原生提问/检索，或无需执行。review_support 只是候选提示，不是绑定；没有候选也可使用宿主能力。仅选择返回的精确 action receipt 可授权对应 Bundle；接受凭据不能用于执行。选择不代表完成，不授权直接写设计文件。'
        : 'Call design_read_review_action for this advisory to read current evidence, acceptance receipt and candidates. Revalidate the need, then call design_select_review_action with a reason: a suitable Bundle, host-native questioning/research, or no action. review_support is a hint, not a binding; host capabilities remain available without candidates. Only the selected exact action receipt authorizes its paired Bundle; the acceptance receipt cannot authorize execution. Selection is not completion and grants no direct Design File write authority.',
    ].join('\n')
  }
  const authorityLines = authority.actionReceipts.map(action => {
    const scope = action.target.entityRefs.length === 0 ? '' : ` · ${action.target.entityRefs.join(', ')}`
    return `- ${action.target.skillName}${scope} · receipt: ${action.receiptId}`
  })
  const authorityText = authorityLines.length === 0
    ? (isZh
        ? '没有可调用的 Bundle 授权；请直接在主对话中处理上述事项。'
        : 'No Bundle action was authorized; handle these items directly in the main conversation.')
    : [
        isZh ? '执行授权（每条仅限其对应 Bundle）：' : 'Execution authority (each receipt is limited to its paired Bundle):',
        ...authorityLines,
      ].join('\n')
  return [
    isZh ? '已接受这条设计建议。' : 'This design advisory was accepted.',
    `advisoryId: ${JSON.stringify(advisory.id)}`,
    context,
    isZh
      ? '请根据当前设计文件重新核验这条建议的具体事项；不要替换成相同 Bundle 中的其他问题。需要补读时，用上述完整 advisoryId 调用 design_read_review_action，不要传 item id 或 entityRefs。已解决则说明依据；仍未解决则按下列授权执行。'
      : 'Revalidate this advisory’s specific findings against the current Design Files; do not substitute another issue in the same Bundle. To read details, call design_read_review_action with the full advisoryId above, not an item id or entityRefs. Cite current evidence if resolved; otherwise act only under the authority below.',
    authorityText,
  ].join('\n')
}

/**
 * Persist an acceptance receipt, then dispatch the correlated prompt.
 * @param advisory - advisory being accepted.
 * @param promptDelivered - whether an earlier attempt delivered the prompt.
 * @param deliver - host-wired prompt delivery.
 * @param record - host-wired accepted-disposition persistence.
 * @returns which phases completed; callers retain `promptDelivered` for retry.
 */
export async function completeAdvisoryAcceptance(
  advisory: AdvisoryCardView,
  record: (advisory: AdvisoryCardView) => Promise<AdvisoryAcceptanceAuthority>,
  deliver: (advisory: AdvisoryCardView, authority: AdvisoryAcceptanceAuthority) => Promise<void>,
): Promise<AdvisoryAcceptanceResult> {
  let authority: AdvisoryAcceptanceAuthority
  try {
    authority = await record(advisory)
  } catch {
    return { promptDelivered: false, receiptRecorded: false }
  }
  const promptDelivered = await deliverAdvisoryAcceptance(advisory, candidate => deliver(candidate, authority))
  return { promptDelivered, receiptRecorded: true, receiptId: authority.acceptanceReceiptId }
}

export interface IAdvisoryReviewCardProps {
  readonly readingScope?: string
  /** Set only when a new result automatically opens a previously closed inbox. */
  readonly preferredAdvisoryId?: string
  /** Advisory review entries; only pending human-review ones render. */
  readonly entries: readonly AdvisoryReviewEntry[]
  /**
   * Host-wired prompt delivery: await `runtime.sendPrompt(sessionId,
   * advisory.acceptanceInstruction)`. A rejection keeps the card for retry.
   */
  readonly onAccept: (advisory: AdvisoryCardView, authority: AdvisoryAcceptanceAuthority) => Promise<void>
  /** Persist the acceptance receipt before any prompt is dispatched. */
  readonly onRecordAccepted: (advisory: AdvisoryCardView) => Promise<AdvisoryAcceptanceAuthority>
  /** Local disposition callback; must never send a prompt or wake the Agent. */
  readonly onDismiss: (advisory: AdvisoryCardView, decision: AdvisoryDismissDecision) => Promise<void>
  /** Collapse the shared advisory inbox after a successful deferred disposition. */
  readonly onDeferred: () => void
  /** Copy for the empty state; the card renders nothing when omitted. */
  readonly emptyText?: string
}

/** The pending human-review advisory card. */
export function AdvisoryReviewCard({ entries, onAccept, onRecordAccepted, onDismiss, onDeferred, emptyText, readingScope = 'default', preferredAdvisoryId }: IAdvisoryReviewCardProps): ReactElement | null {
  const isZh = currentLanguage() === 'zh_CN'
  const [locallyHandled, setLocallyHandled] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  const reading = readingFor(readingScope)
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const pending = selectPendingAdvisories(entries, new Set())
    return (pending.find(item => item.id === preferredAdvisoryId)
      ?? pending.find(item => !reading.read.has(item.id))
      ?? pending.find(item => item.id === reading.selected)
      ?? pending[0])?.id ?? null
  })
  const [readIds, setReadIds] = useState(() => new Set(reading.read))
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedRect, setExpandedRect] = useState<AdvisoryExpandedRect | null>(null)
  const busyRef = useRef(new Set<string>())
  const previousVisibleIdsRef = useRef<readonly string[]>([])

  const visible = useMemo(() => selectPendingAdvisories(entries, locallyHandled), [entries, locallyHandled])

  useEffect(() => {
    const visibleIds = visible.map(advisory => advisory.id)
    setSelectedId((current) => {
      if (current !== null && visibleIds.includes(current)) return current
      const nearestIndex = resolveAdvisoryIndex(visibleIds, current, previousVisibleIdsRef.current)
      return visibleIds[nearestIndex] ?? null
    })
    previousVisibleIdsRef.current = visibleIds
  }, [visible])

  useEffect(() => {
    if (expandedId === null || typeof document === 'undefined') {
      setExpandedRect(null)
      return
    }
    const history = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    const composer = document.querySelector<HTMLElement>('[data-composer-card]')
    const boundary = history?.closest<HTMLElement>('[data-conversation-boundary]')
    if (history === null || composer === null) {
      setExpandedRect(null)
      return
    }
    let frame = 0
    const update = (): void => {
      const bounds = boundary?.getBoundingClientRect()
      const clipped = bounds ? { left: Math.max(0, bounds.left), top: Math.max(0, bounds.top),
        width: Math.min(window.innerWidth, bounds.right) - Math.max(0, bounds.left),
        height: Math.min(window.innerHeight, bounds.bottom) - Math.max(0, bounds.top) } : undefined
      const cover = boundary?.dataset.advisoryCoverComposer === 'true' && clipped
      const composerRect = composer.getBoundingClientRect()
      const next = resolveAdvisoryExpandedRect(
        cover ? clipped : history.getBoundingClientRect(),
        cover ? { left: clipped.left, width: clipped.width, top: clipped.top + clipped.height } : composerRect,
        clipped,
      )
      setExpandedRect((current) => {
        if (current === null || next === null) return next
        return current.left === next.left
          && current.top === next.top
          && current.width === next.width
          && current.height === next.height
          ? current
          : next
      })
    }
    const scheduleUpdate = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    const resizeObserver = new ResizeObserver(scheduleUpdate)
    resizeObserver.observe(history)
    resizeObserver.observe(composer)
    if (boundary) resizeObserver.observe(boundary)
    const mutationObserver = new MutationObserver(scheduleUpdate)
    mutationObserver.observe(history, { childList: true, subtree: true })
    if (boundary) mutationObserver.observe(boundary, { attributes: true, attributeFilter: ['data-advisory-cover-composer'] })
    window.addEventListener('resize', scheduleUpdate)
    boundary?.addEventListener('scroll', scheduleUpdate, { passive: true })
    update()
    scheduleUpdate()
    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener('resize', scheduleUpdate)
      boundary?.removeEventListener('scroll', scheduleUpdate)
    }
  }, [expandedId])

  const selectedIndex = resolveAdvisoryIndex(visible.map(item => item.id), selectedId, previousVisibleIdsRef.current)
  const advisory = visible[selectedIndex]
  useEffect(() => {
    if (!advisory) return
    reading.selected = advisory.id
    if (!reading.read.has(advisory.id)) {
      reading.read.add(advisory.id)
      setReadIds(new Set(reading.read))
    }
  }, [advisory?.id, reading])
  if (visible.length === 0) {
    if (emptyText === undefined) return null
    return <div className='dsh-advisory-empty' role='status'>{emptyText}</div>
  }

  const addTo = (setter: (update: (previous: ReadonlySet<string>) => ReadonlySet<string>) => void, id: string): void => {
    setter((previous) => new Set([...previous, id]))
  }
  const removeFrom = (setter: (update: (previous: ReadonlySet<string>) => ReadonlySet<string>) => void, id: string): void => {
    setter((previous) => {
      const next = new Set(previous)
      next.delete(id)
      return next
    })
  }
  const accept = async (advisory: AdvisoryCardView): Promise<void> => {
    if (busyRef.current.has(advisory.id)) return
    busyRef.current.add(advisory.id)
    addTo(setBusy, advisory.id)
    removeFrom(setFailed, advisory.id)
    try {
      const result = await completeAdvisoryAcceptance(
        advisory,
        onRecordAccepted,
        onAccept,
      )
      if (!result.receiptRecorded || !result.promptDelivered) {
        addTo(setFailed, advisory.id)
        return
      }
      setExpandedId((current) => current === advisory.id ? null : current)
      addTo(setLocallyHandled, advisory.id)
    } finally {
      busyRef.current.delete(advisory.id)
      removeFrom(setBusy, advisory.id)
    }
  }
  const dismiss = async (advisory: AdvisoryCardView, decision: AdvisoryDismissDecision): Promise<void> => {
    if (busyRef.current.has(advisory.id)) return
    busyRef.current.add(advisory.id)
    addTo(setBusy, advisory.id)
    removeFrom(setFailed, advisory.id)
    try {
      await onDismiss(advisory, decision)
      setExpandedId((current) => current === advisory.id ? null : current)
      if (decision === 'rejected') addTo(setLocallyHandled, advisory.id)
      else onDeferred()
    } catch {
      addTo(setFailed, advisory.id)
    } finally {
      busyRef.current.delete(advisory.id)
      removeFrom(setBusy, advisory.id)
    }
  }

  if (advisory === undefined) return null
  const expanded = expandedId === advisory.id
  const selectIndex = (index: number): void => {
    const next = visible[index]
    if (next === undefined) return
    setSelectedId(next.id)
    if (expandedId !== null) setExpandedId(next.id)
  }
  const navigateByKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.key === 'ArrowLeft' && selectedIndex > 0) {
      event.preventDefault()
      selectIndex(selectedIndex - 1)
    } else if (event.key === 'ArrowRight' && selectedIndex < visible.length - 1) {
      event.preventDefault()
      selectIndex(selectedIndex + 1)
    }
  }

  const carousel = (
    <div className='dsh-advisory-carousel' onKeyDown={navigateByKeyboard}>
      <article key={advisory.id} className='dsh-advisory-card' data-advisory-id={advisory.id} data-expanded={expanded || undefined}>
          <header className='dsh-advisory-card-header'>
            <span className='dsh-advisory-profile' title={advisory.profile}>{advisoryProfileLabel(advisory.profile, isZh)}</span>
            <span className='dsh-advisory-status'>{advisory.status === 'deferred' ? (isZh ? '稍后处理' : 'Deferred') : (isZh ? '待处理' : 'Pending')}</span>
            {advisory.stale === true && (
              <span className='dsh-advisory-revalidation'>{isZh ? '需重新核验' : 'Needs revalidation'}</span>
            )}
            {visible.some(item => item.id !== advisory.id && !readIds.has(item.id)) && (
              <button type='button' className='dsh-advisory-new-arrival' onClick={() => {
                const index = visible.findIndex(item => item.id !== advisory.id && !readIds.has(item.id))
                if (index >= 0) selectIndex(index)
              }}>{isZh ? '有新建议 · 查看' : 'New advisories · View'}</button>
            )}
          </header>
          <p className='dsh-advisory-summary'>{advisory.summary}</p>
          {advisory.items.length > 0 && (
            <details
              className='dsh-advisory-details'
              open={expanded}
              onToggle={(event) => {
                const open = event.currentTarget.open
                setExpandedId((current) => open ? advisory.id : current === advisory.id ? null : current)
              }}
            >
              <summary aria-label={isZh ? `${expanded ? '收起' : '展开'}设计建议 ${advisory.id} 的详情` : `${expanded ? 'Hide' : 'Show'} advisory details for ${advisory.id}`}>
                <span>{isZh ? (expanded ? '收起详情' : '展开详情') : (expanded ? 'Close details' : 'Review details')}</span>
                <span className='dsh-advisory-count'>{advisory.items.length}</span>
              </summary>
              <div className='dsh-advisory-items-scroll'>
                <ul className='dsh-advisory-items'>
                  {advisory.items.map((item) => (
                    <li key={item.id} className='dsh-advisory-item' data-item-id={item.id}>
                      <span className='dsh-advisory-item-title'>{item.title}</span>
                      <span className='dsh-advisory-item-detail'>{item.detail}</span>
                      {item.rationale !== undefined && <span className='dsh-advisory-item-rationale'>{item.rationale}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          )}
          {failed.has(advisory.id) && (
            <p className='dsh-advisory-error' role='alert'>
              {advisory.acceptanceReceiptId !== undefined
                ? (isZh ? '接受回执已保存，但投递失败；建议仍可见并可重试。' : 'The acceptance receipt is durable, but delivery failed. The advisory remains visible and retryable.')
                : (isZh ? '接受回执保存失败，建议仍待处理。' : 'The acceptance receipt could not be saved. The advisory remains pending.')}
            </p>
          )}
          <footer className='dsh-advisory-actions'>
            <button
              type='button'
              className='dsh-advisory-accept'
              aria-label={isZh ? `接受设计建议 ${advisory.id}` : `Accept advisory ${advisory.id}`}
              disabled={busy.has(advisory.id)}
              onClick={() => { void accept(advisory) }}
            >
              {advisory.status === 'pending' || advisory.status === 'deferred' || advisory.status === undefined
                ? (isZh ? '接受' : 'Accept')
                : (isZh ? '重试执行' : 'Retry')}
            </button>
            <button
              type='button'
              className='dsh-advisory-reject'
              aria-label={isZh ? `拒绝设计建议 ${advisory.id}` : `Reject advisory ${advisory.id}`}
              disabled={busy.has(advisory.id)}
              onClick={() => { void dismiss(advisory, 'rejected') }}
            >
              {isZh ? '拒绝' : 'Reject'}
            </button>
            <button
              type='button'
              className='dsh-advisory-defer'
              aria-label={isZh ? `稍后处理设计建议 ${advisory.id}` : `Defer advisory ${advisory.id}`}
              disabled={busy.has(advisory.id)}
              onClick={() => { void dismiss(advisory, 'deferred') }}
            >
              {isZh ? '稍后' : 'Later'}
            </button>
          </footer>
      </article>
      <nav className='dsh-advisory-carousel-controls' aria-label={isZh ? '设计建议翻页' : 'Design advisory pagination'}>
        {advisoryDisplayTime(advisory.publishedAt, isZh) && <time className='dsh-advisory-time'
          dateTime={new Date(advisory.publishedAt!).toISOString()}
          title={new Date(advisory.publishedAt!).toLocaleString(isZh ? 'zh-CN' : 'en-US')}>
          {advisoryDisplayTime(advisory.publishedAt, isZh)}
        </time>}
        <button
          type='button'
          className='dsh-advisory-previous'
          aria-label={isZh ? '上一条设计建议' : 'Previous design advisory'}
          title={isZh ? '上一条设计建议' : 'Previous design advisory'}
          disabled={selectedIndex === 0}
          onClick={() => selectIndex(adjacentAdvisoryIndex(selectedIndex, visible.length, -1))}
        >
          <span aria-hidden='true'>←</span>
        </button>
        <span className='dsh-advisory-position' aria-live='polite'>
          {selectedIndex + 1} / {visible.length}
        </span>
        <button
          type='button'
          className='dsh-advisory-next'
          aria-label={isZh ? '下一条设计建议' : 'Next design advisory'}
          title={isZh ? '下一条设计建议' : 'Next design advisory'}
          disabled={selectedIndex === visible.length - 1}
          onClick={() => selectIndex(adjacentAdvisoryIndex(selectedIndex, visible.length, 1))}
        >
          <span aria-hidden='true'>→</span>
        </button>
      </nav>
    </div>
  )

  const expandedStyle: CSSProperties | undefined = expandedRect === null
    ? undefined
    : {
        left: expandedRect.left,
        top: expandedRect.top,
        width: expandedRect.width,
        height: expandedRect.height,
      }

  return (
    <section className='dsh-advisory-review' aria-label={isZh ? '待审阅的设计建议' : 'Design advisories pending review'}>
      {expanded && expandedStyle !== undefined && typeof document !== 'undefined'
        ? createPortal(<div className='dsh-advisory-expanded-layer' style={expandedStyle}>{carousel}</div>, document.body, advisory.id)
        : carousel}
    </section>
  )
}
