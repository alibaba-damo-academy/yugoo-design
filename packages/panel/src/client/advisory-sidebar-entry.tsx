/** Persistent entry for revealing the shared Design-advisory inbox. */
import { useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { DesignAdvisoryRuntimeStatus } from 'dsh-design-core'
import { ArtifactStatusIcon } from '../artifact-status-icon.tsx'
import {
  selectPendingAdvisories,
  type AdvisoryReviewEntry,
} from './ported/design/AdvisoryReviewCard.tsx'
import { useCurrentLanguage } from './ported/host.ts'

/** Count unique current pending human-review advisories. */
export function pendingAdvisoryCount(entries: readonly AdvisoryReviewEntry[]): number {
  return selectPendingAdvisories(entries, new Set()).length
}

const sidebarTriggerSelector = '[data-advisory-entry="sidebar"] .dsh-advisory-sidebar-trigger'

/** Inspect the actual action box, including hidden ancestors and scroll clips. */
export function hasVisibleAdvisorySidebarEntry(doc: Document): boolean {
  const view = doc.defaultView
  if (view === null) return false
  return [...doc.querySelectorAll<HTMLElement>(sidebarTriggerSelector)].some(trigger => {
    const rect = trigger.getBoundingClientRect()
    if (!trigger.isConnected || rect.width <= 0 || rect.height <= 0) return false
    let left = Math.max(0, rect.left), right = Math.min(view.innerWidth, rect.right)
    let top = Math.max(0, rect.top), bottom = Math.min(view.innerHeight, rect.bottom)
    for (let element: HTMLElement | null = trigger; element !== null; element = element.parentElement) {
      const style = view.getComputedStyle(element)
      if (element.hidden || element.inert || element.hasAttribute('inert') || element.getAttribute('aria-hidden') === 'true'
        || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
        || style.contentVisibility === 'hidden' || Number(style.opacity || 1) === 0) return false
      if (element === trigger) continue
      const clip = element.getBoundingClientRect()
      if (/^(hidden|clip|auto|scroll)$/.test(style.overflowX || style.overflow)) {
        left = Math.max(left, clip.left)
        right = Math.min(right, clip.right)
      }
      if (/^(hidden|clip|auto|scroll)$/.test(style.overflowY || style.overflow)) {
        top = Math.max(top, clip.top)
        bottom = Math.min(bottom, clip.bottom)
      }
    }
    // A clipped label is harmless when an actual, usable icon target remains.
    return right - left >= Math.min(24, rect.width) && bottom - top >= Math.min(24, rect.height)
  })
}

/** Follow Host remounts, ancestor visibility, clipping, scrolling and resizing. */
export function observeAdvisorySidebarVisibility(doc: Document, listener: (visible: boolean) => void): () => void {
  const view = doc.defaultView
  if (view === null) return () => {}
  let frame: number | undefined
  let previous: boolean | undefined
  let observed: Element[] = []
  const update = (): void => {
    frame = undefined
    const ancestors = new Set<Element>()
    for (const trigger of doc.querySelectorAll(sidebarTriggerSelector)) {
      for (let element: Element | null = trigger; element !== null; element = element.parentElement) ancestors.add(element)
    }
    const nextObserved = [...ancestors]
    if (nextObserved.length !== observed.length || nextObserved.some((element, index) => element !== observed[index])) {
      resize?.disconnect()
      visibility.disconnect()
      for (const element of nextObserved) {
        resize?.observe(element)
        visibility.observe(element, { attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'inert'] })
      }
      observed = nextObserved
    }
    const visible = hasVisibleAdvisorySidebarEntry(doc)
    if (visible !== previous) {
      previous = visible
      listener(visible)
    }
  }
  const schedule = (): void => {
    if (frame === undefined) frame = view.requestAnimationFrame(update)
  }
  const scheduleAncestorEvent = (event: Event): void => {
    if (event.target === doc || observed.includes(event.target as Element)) schedule()
  }
  const resize = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(schedule) : undefined
  const visibility = new view.MutationObserver(schedule)
  const mounts = new view.MutationObserver(records => {
    // Discover only sidebar mounts/removals. Composer updates and unrelated
    // streaming content must not keep measuring navigation geometry.
    if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node =>
      node.nodeType === 1 && (observed.includes(node as Element)
        || (node as Element).matches(sidebarTriggerSelector)
        || (node as Element).matches('[data-advisory-entry="sidebar"]')
        || (node as Element).querySelector('[data-advisory-entry="sidebar"]') !== null)))) schedule()
  })
  mounts.observe(doc.documentElement, { childList: true, subtree: true })
  view.addEventListener('resize', schedule)
  doc.addEventListener('scroll', scheduleAncestorEvent, true)
  doc.addEventListener('transitionend', scheduleAncestorEvent, true)
  doc.addEventListener('animationend', scheduleAncestorEvent, true)
  update()
  return () => {
    if (frame !== undefined) view.cancelAnimationFrame(frame)
    resize?.disconnect()
    visibility.disconnect()
    mounts.disconnect()
    view.removeEventListener('resize', schedule)
    doc.removeEventListener('scroll', scheduleAncestorEvent, true)
    doc.removeEventListener('transitionend', scheduleAncestorEvent, true)
    doc.removeEventListener('animationend', scheduleAncestorEvent, true)
  }
}

export interface AdvisorySidebarEntryProps {
  /** Host sidebar state: wide shows the label; rail keeps the icon and count. */
  readonly wide: boolean
  /** The compact composer fallback reuses this exact entry and inbox action. */
  readonly location?: 'sidebar' | 'composer'
  /** Design-owned advisory projection already narrowed to review-card entries. */
  readonly entries: readonly AdvisoryReviewEntry[]
  /** Optional observation from the existing scheduler, never inferred from advice. */
  readonly runtime?: DesignAdvisoryRuntimeStatus
  /** A retained snapshot cannot establish current liveness after a read failure. */
  readonly disconnected?: boolean
  /** Whether the single shared inbox is currently expanded. */
  readonly expanded: boolean
  /** Toggle the existing inbox, without changing its review state or actions. */
  readonly onToggle: () => void
  /** Optional shared inbox for a right-side, composer-free presentation. */
  readonly popoverContent?: ReactNode
}

/** Sidebar-foot entry, optionally presenting the same inbox without a composer. */
export function AdvisorySidebarEntry({
  wide,
  location = 'sidebar',
  entries,
  runtime,
  disconnected = false,
  expanded,
  onToggle,
  popoverContent,
}: AdvisorySidebarEntryProps): ReactElement {
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const focusOnOpen = useRef(false)
  const [position, setPosition] = useState<CSSProperties>()
  const popoverOpen = expanded && popoverContent != null
  useEffect(() => {
    if (!popoverOpen) { focusOnOpen.current = false; setPosition(undefined); return }
    const reposition = () => {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.max(0, Math.min(560, rect.left - 20, window.innerWidth - 24))
      const maxHeight = Math.max(0, window.innerHeight - 24)
      const height = Math.min(popup.current?.getBoundingClientRect().height ?? 0, maxHeight)
      const left = Math.max(12, rect.left - width - 8)
      const top = Math.max(12, Math.min(rect.bottom - height, window.innerHeight - height - 12))
      setPosition(previous => previous?.left === left && previous?.top === top && previous?.width === width
        && previous?.maxHeight === maxHeight ? previous : { left, top, width, maxHeight })
    }
    const owns = (target: EventTarget | null) => target instanceof Node
      && (trigger.current?.contains(target) || popup.current?.contains(target))
    const hasModal = () => popup.current?.querySelector('dialog[open]') != null
    const outside = (event: PointerEvent) => { if (!hasModal() && !owns(event.target)) onToggle() }
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || hasModal()) return
      const restoreFocus = owns(document.activeElement)
      if (restoreFocus) event.preventDefault()
      onToggle()
      if (restoreFocus) trigger.current?.focus({ preventScroll: true })
    }
    reposition()
    const resize = new ResizeObserver(reposition)
    if (trigger.current) resize.observe(trigger.current)
    if (popup.current) resize.observe(popup.current)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    return () => {
      resize.disconnect()
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', key)
    }
  }, [popoverOpen, wide, onToggle])
  useEffect(() => {
    // A newly mounted popover is hidden until measured. Only an explicit
    // keyboard opening requests focus, after its visible position commits.
    if (popoverOpen && position && focusOnOpen.current) {
      focusOnOpen.current = false
      popup.current?.focus({ preventScroll: true })
    }
  }, [popoverOpen, position])
  const isZh = useCurrentLanguage() === 'zh_CN'
  const count = pendingAdvisoryCount(entries)

  const label = isZh ? '设计建议' : 'Design advisories'
  const pendingLabel = isZh ? `${count} 条设计建议待处理` : `${count} design advisories pending`
  const phase = disconnected || runtime?.available === false ? 'unavailable' : runtime?.phase
  // Counts describe this exact snapshot. No timers, remembered in-flight state,
  // advisory cardinality, or U/S/T activity can manufacture scheduler liveness.
  const profiles = new Map(runtime?.profileStatus
    ?.filter(entry => runtime.profiles.includes(entry.profile)).map(entry => [entry.profile, entry.phase]))
  const countPhase = (value: string) => [...profiles.values()].filter(current => current === value).length
  const running = countPhase('running'), scheduled = countPhase('scheduled'), failed = countPhase('failed')
  const activityLabel = phase === 'unavailable'
    ? disconnected ? isZh ? '评审状态同步中断' : 'Review status disconnected'
      : isZh ? '后台评审不可用' : 'Background reviews unavailable'
    : phase === 'running' ? isZh ? `正在评审${running ? ` · ${running} 项` : ''}` : `Reviewing${running ? ` · ${running}` : ''}`
      : phase === 'scheduled' ? isZh ? `等待评审${scheduled ? ` · ${scheduled} 项` : ''}` : `Reviews scheduled${scheduled ? ` · ${scheduled}` : ''}`
        : phase === 'failed' ? isZh ? `评审失败${failed ? ` · ${failed} 项` : ''}` : `Review failed${failed ? ` · ${failed}` : ''}`
          : undefined
  const statusLabel = activityLabel === undefined ? undefined : [activityLabel,
    ...((phase === 'running' || phase === 'scheduled') && failed > 0 ? [isZh ? `${failed} 项失败` : `${failed} failed`] : []),
    ...(phase === 'running' && scheduled > 0 ? [isZh ? `${scheduled} 项等待` : `${scheduled} scheduled`] : []),
  ].join(' · ')
  const accessibleLabel = `${label} · ${pendingLabel}${statusLabel ? ` · ${statusLabel}` : ''}`

  return (
    <><div
      className={`dsh-advisory-sidebar-entry${wide ? '' : ' dsh-advisory-sidebar-entry-rail'}${location === 'composer' ? ' dsh-advisory-composer-entry' : ''}`}
      data-advisory-entry={location}
      data-empty={count === 0 || undefined}
      data-review-phase={phase}
    >
      <button
        ref={trigger}
        type='button'
        className='dsh-advisory-sidebar-trigger'
        aria-label={accessibleLabel}
        title={accessibleLabel}
        aria-controls='dsh-advisory-composer-inbox'
        aria-expanded={expanded}
        aria-haspopup={popoverContent == null ? undefined : 'dialog'}
        onClick={onToggle}
        onKeyDown={event => {
          if (popoverContent == null || (event.key !== 'ArrowLeft' && event.key !== 'ArrowDown')) return
          event.preventDefault()
          if (popoverOpen && position) popup.current?.focus({ preventScroll: true })
          else { focusOnOpen.current = true; if (!expanded) onToggle() }
        }}
      >
        <svg className='dsh-advisory-sidebar-icon' viewBox='0 0 20 20' aria-hidden='true'>
          <path d='M7 13c0-2-3-3-3-6a6 6 0 0 1 12 0c0 3-3 4-3 6M7 14h6M8 17h4M9 19h2' />
        </svg>
        {(wide || location === 'composer') && <span className='dsh-advisory-sidebar-label'>{label}</span>}
        <span className='dsh-advisory-sidebar-activity' role='status' aria-live='polite' aria-atomic='true'>
          {statusLabel && <>
            <span className='dsh-advisory-sidebar-activity-icon' aria-hidden='true'><ArtifactStatusIcon
              status={phase === 'running' ? 'working' : phase === 'scheduled' ? 'queued' : phase === 'failed' ? 'failed' : 'unknown'}
              label={statusLabel}
            /></span>
            <span className='dsh-advisory-sidebar-activity-label'>{statusLabel}</span>
          </>}
        </span>
        {count > 0 && <span className='dsh-advisory-sidebar-badge' aria-hidden='true'>{count}</span>}
      </button>
    </div>
    {popoverOpen && typeof document !== 'undefined' && createPortal(
      <div ref={popup} className='dsh-advisory-sidebar-popover' role='dialog' aria-label={label} tabIndex={-1}
        style={position ?? { visibility: 'hidden' }}>{popoverContent}</div>, document.body,
    )}</>
  )
}
