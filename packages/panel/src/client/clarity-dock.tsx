/**
 * The ambient design completion readout rendered as the first line of the
 * Design Project header. Read-only by the metadata contract: it renders the
 * weighted U/S/T index of the latest pinned assessment plus the host-derived
 * staleness/activity indicator, with per-indicator hover/focus explanations.
 * Host-observed activity never starts work or fabricates assessment progress.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import type { DesignClarityActivity } from 'dsh-design-core'
import { ArtifactStatusIcon } from '../artifact-status-icon.tsx'
import { clarityIndex, parseClarityView } from './clarity.ts'
import { useLang } from './ported/host.ts'

type ClarityScoreLevel = 'low' | 'medium' | 'high'

const MEDIUM_SCORE_MIN = 40
const HIGH_SCORE_MIN = 70

function clarityScoreLevel(score: number): ClarityScoreLevel {
  if (score >= HIGH_SCORE_MIN) return 'high'
  if (score >= MEDIUM_SCORE_MIN) return 'medium'
  return 'low'
}

/** One-line dock styles injected once by the panel registration. */
export const CLARITY_DOCK_CSS = `
.dsh-clarity-dock {
  position: relative;
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--ds-text-secondary, #666);
}
.dsh-clarity-dock-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-clarity-dock-score {
  flex: 0 0 auto;
  font-weight: 600;
  color: var(--ds-text-primary, #333);
}
.dsh-clarity-dock-dims {
  display: flex;
  margin-inline-start: 10px;
  min-width: 0;
  max-width: 420px;
  flex: 1 1 340px;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.dsh-clarity-dock-dim {
  display: grid;
  min-width: 98px;
  max-width: 136px;
  flex: 1 1 108px;
  grid-template-columns: auto minmax(12px, 1fr);
  align-items: center;
  gap: 4px;
  cursor: help;
  border-radius: 4px;
}
.dsh-clarity-dock-dim:focus-visible { outline: 2px solid var(--ds-brand-6, #7c5af6); outline-offset: 3px; }
.dsh-clarity-dock-dim-readout {
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
  color: var(--ds-text-tertiary, #999);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.dsh-clarity-dock-dim-value {
  color: var(--ds-text-primary, #333);
  font-weight: 600;
}
.dsh-clarity-dock-track {
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--ds-line-2, #dfdfdf);
}
.dsh-clarity-dock-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
}
.dsh-clarity-dock-dim[data-level='low'] .dsh-clarity-dock-fill {
  background: var(--ds-error-6, #d65350);
}
.dsh-clarity-dock-dim[data-level='medium'] .dsh-clarity-dock-fill {
  background: var(--ds-warning-5, #e17725);
}
.dsh-clarity-dock-dim[data-level='high'] .dsh-clarity-dock-fill {
  background: var(--ds-success-6, #199b51);
}
.dsh-clarity-dock-stale {
  flex: 0 0 auto;
  padding: 0 6px;
  border-radius: 4px;
  background: var(--ds-warning-light-bg-default);
  color: var(--ds-warning-text-primary);
}
.dsh-clarity-dock-activity {
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  border-radius: 4px;
  color: var(--ds-text-secondary, #666);
  font-size: 12px;
  line-height: 20px;
  cursor: help;
}
.dsh-clarity-dock-activity:focus-visible { outline: 2px solid var(--ds-brand-6, #7c5af6); outline-offset: 3px; }
.dsh-clarity-dock-activity-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-clarity-dock-activity[data-phase='failed'] { color: var(--ds-error-text-primary, #b02d2f); }
.dsh-clarity-dock-activity[data-phase='stale'] { color: var(--ds-warning-text-primary, #a45300); }
@media (prefers-reduced-motion: reduce) { .dsh-clarity-dock-activity .animate-spin { animation: none; } }
.dsh-clarity-dock[data-compact=true]{width:auto;flex:0 0 auto;flex-wrap:nowrap;gap:4px;font-size:12px}
.dsh-clarity-dock[data-compact=true] .dsh-clarity-dock-label,
.dsh-clarity-dock[data-compact=true] .dsh-clarity-dock-score,
.dsh-clarity-dock[data-compact=true] .dsh-clarity-dock-track{display:none}
.dsh-clarity-dock[data-compact=true] .dsh-clarity-dock-dims{margin:0;flex:0 0 auto;flex-wrap:nowrap;gap:8px}
.dsh-clarity-dock[data-compact=true] .dsh-clarity-dock-dim{display:flex;min-width:0;flex:0 0 auto}
.dsh-clarity-dock[data-single-line=true]{flex-wrap:nowrap}
.dsh-clarity-dock[data-single-line=true] .dsh-clarity-dock-dims{flex:1 1 180px;flex-wrap:nowrap;max-width:320px;margin-inline-start:4px}
.dsh-clarity-dock[data-single-line=true] .dsh-clarity-dock-dim{min-width:0;flex:1 1 60px}
.dsh-clarity-dock[data-single-line=true][data-activity=true] .dsh-clarity-dock-score,
.dsh-clarity-dock[data-single-line=true][data-activity=true] .dsh-clarity-dock-track{display:none}
.dsh-clarity-dock[data-single-line=true][data-activity=true] .dsh-clarity-dock-dims{flex:0 0 auto;gap:8px}
.dsh-clarity-dock[data-single-line=true][data-activity=true] .dsh-clarity-dock-dim{display:flex;flex:0 0 auto}
.dsh-clarity-dock[data-compact=true][data-activity=true] .dsh-clarity-dock-label{display:inline}
.dsh-clarity-score-tooltip {
  position: fixed; z-index: 1000; box-sizing: border-box;
  width: min(360px, calc(100vw - 24px)); max-height: min(360px, 60vh);
  overflow-y: auto; overscroll-behavior: contain; padding: 16px;
  border: 1px solid var(--ds-line-2, #dfdfdf); border-radius: 8px;
  background: var(--ds-bg-container, #fff); color: var(--ds-text-primary, #333);
  box-shadow: 0 8px 28px rgb(0 0 0 / 14%); font-size: 13px; line-height: 1.6;
}
.dsh-clarity-score-tooltip p { margin: 8px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.dsh-clarity-score-tooltip-stale { color: var(--ds-warning-6, #a16207); font-size: 12px; }
`

/** Both read-only indicators share the existing hover/focus/escape explanation behavior. */
function useClarityTooltip() {
  const tipId = useId()
  const trigger = useRef<HTMLSpanElement>(null)
  const tooltip = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>()
  const [position, setPosition] = useState<CSSProperties>()
  const cancelClose = (): void => { clearTimeout(closeTimer.current) }
  const close = (): void => { cancelClose(); setPosition(undefined) }
  const open = (): void => {
    cancelClose()
    const rect = trigger.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(360, window.innerWidth - 24)
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
    const space = window.innerHeight - rect.bottom - 20
    setPosition(space >= 120 ? { left, top: rect.bottom + 8, maxHeight: Math.min(360, space) }
      : { left, bottom: window.innerHeight - rect.top + 8, maxHeight: Math.min(360, Math.max(60, rect.top - 20)) })
  }
  const deferClose = (): void => {
    cancelClose()
    closeTimer.current = setTimeout(() => {
      if (!trigger.current?.contains(document.activeElement) && !tooltip.current?.contains(document.activeElement)) setPosition(undefined)
    }, 120)
  }
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  useEffect(() => {
    if (!position) return
    const onScroll = (event: Event): void => { if (!tooltip.current?.contains(event.target as Node)) close() }
    window.addEventListener('resize', close)
    window.addEventListener('scroll', onScroll, true)
    return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', onScroll, true) }
  }, [position])
  return { tipId, trigger, tooltip, position, cancelClose, close, open, deferClose }
}

function ClarityDimension(props: { metric: string; compact?: boolean; label: string; score: number; level: ClarityScoreLevel; levelLabel: string; reason: string; staleReason?: string; contextLabel?: string }): ReactElement {
  const { tipId, trigger, tooltip, position, cancelClose, close, open, deferClose } = useClarityTooltip()
  const accessibleLabel = `${props.contextLabel ? `${props.contextLabel} · ` : ''}${props.label}: ${props.score}/100 · ${props.levelLabel}`
  return <>
    <span ref={trigger} className='dsh-clarity-dock-dim' data-testid={`design-clarity-dock-${props.metric}`} data-level={props.level}
      role='progressbar' aria-label={accessibleLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={props.score}
      tabIndex={0} aria-describedby={tipId} onMouseEnter={open} onMouseLeave={deferClose} onFocus={open} onBlur={deferClose}
      onKeyDown={event => { if (event.key === 'Escape' && position) { event.stopPropagation(); close() } }}>
      <span className='dsh-clarity-dock-dim-readout' aria-hidden='true'><span>{props.compact ? props.metric.toUpperCase() : props.label}</span><span className='dsh-clarity-dock-dim-value'>{props.score}</span></span>
      <span className='dsh-clarity-dock-track' aria-hidden='true'><span className='dsh-clarity-dock-fill' style={{ width: `${props.score}%` }} /></span>
    </span>
    {position && typeof document !== 'undefined' ? createPortal(
      <div ref={tooltip} id={tipId} role='tooltip' className='dsh-clarity-score-tooltip' style={position} tabIndex={0}
        onMouseEnter={cancelClose} onMouseLeave={deferClose} onFocus={cancelClose} onBlur={deferClose}
        onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); trigger.current?.focus(); close() } }}>
        <strong>{props.label} · {props.score}/100</strong><p>{props.reason}</p>
        {props.staleReason ? <p className='dsh-clarity-score-tooltip-stale'>{props.staleReason}</p> : null}
      </div>, document.body) : <span id={tipId} hidden>{props.reason}{props.staleReason ? `\n${props.staleReason}` : ''}</span>}
  </>
}

/** Host-observed activity is presentation only: inspecting it never starts or retries work. */
function ClarityActivityStatus({ activity }: { activity: DesignClarityActivity }): ReactElement {
  const t = useLang()
  const { tipId, trigger, tooltip, position, cancelClose, close, open, deferClose } = useClarityTooltip()
  const label = t[`clarity_dock_activity_${activity.phase}`]
  const detail = t[`clarity_dock_activity_${activity.phase}_detail`]
  const iconStatus = activity.phase === 'running' ? 'working' : activity.phase === 'stale' ? 'pending'
    : activity.phase === 'unavailable' ? 'unknown' : activity.phase
  // Reset an open explanation when its observed checkpoint/phase changes. An
  // obsolete failure detail must not linger over the next running assessment.
  useEffect(close, [activity.phase, activity.checkpoint, activity.summary])
  return <>
    <span ref={trigger} className='dsh-clarity-dock-activity' data-testid='design-clarity-dock-activity'
      data-phase={activity.phase} tabIndex={0} aria-describedby={tipId}
      onMouseEnter={open} onMouseLeave={deferClose} onFocus={open} onBlur={deferClose}
      onKeyDown={event => { if (event.key === 'Escape' && position) { event.stopPropagation(); close() } }}>
      <span aria-hidden='true'><ArtifactStatusIcon status={iconStatus} label={label} /></span>
      <span className='dsh-clarity-dock-activity-label' role='status' aria-live='polite' aria-atomic='true'>{label}</span>
    </span>
    {position && typeof document !== 'undefined' ? createPortal(
      <div ref={tooltip} id={tipId} role='tooltip' className='dsh-clarity-score-tooltip' style={position} tabIndex={0}
        onMouseEnter={cancelClose} onMouseLeave={deferClose} onFocus={cancelClose} onBlur={deferClose}
        onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); trigger.current?.focus(); close() } }}>
        <strong>{label}</strong><p>{detail}</p>
        {activity.summary ? <p>{activity.summary}</p> : null}
      </div>, document.body) : <span id={tipId} hidden>{detail}{activity.summary ? `\n${activity.summary}` : ''}</span>}
  </>
}

/**
 * The dock readout entry. Absent or foreign workspace values render nothing.
 * @param props - the workspace clarity value.
 * @returns the readout row, or null for absent or foreign values.
 */
export function ClarityDockReadout(props: { value: unknown; compact?: boolean; singleLine?: boolean }): ReactElement | null {
  const t = useLang()
  const view = parseClarityView(props.value)
  if (view === undefined) return null
  if (view.assessment === null) {
    return (
      <div className='dsh-clarity-dock' data-compact={props.compact || undefined} data-single-line={props.singleLine || undefined} data-activity={view.activity ? true : undefined} data-testid='design-clarity-dock'>
        <span className='dsh-clarity-dock-label'>{t.clarity_dock_label}</span>
        {view.activity ? <ClarityActivityStatus activity={view.activity} />
          : <span data-testid='design-clarity-dock-unassessed'>{t.clarity_dock_unassessed}</span>}
      </div>
    )
  }
  const { u, s, t: testability } = view.assessment
  const dimensions = [
    { key: 'u', label: t.clarity_dock_u, score: u },
    { key: 's', label: t.clarity_dock_s, score: s },
    { key: 't', label: t.clarity_dock_t, score: testability },
  ] as const
  return (
    <div className='dsh-clarity-dock' data-compact={props.compact || undefined} data-single-line={props.singleLine || undefined} data-activity={view.activity ? true : undefined} data-testid='design-clarity-dock'>
      <span className='dsh-clarity-dock-label' aria-label={view.activity ? t.clarity_dock_previous : undefined}>{view.activity
        ? props.singleLine || props.compact ? t.clarity_dock_previous_short : t.clarity_dock_previous : t.clarity_dock_label}</span>
      <span className='dsh-clarity-dock-score' data-testid='design-clarity-dock-score'>{clarityIndex(view.assessment)}</span>
      <span className='dsh-clarity-dock-dims'>
        {dimensions.map((dimension) => {
          const level = clarityScoreLevel(dimension.score)
          const levelLabel = t[`clarity_dock_level_${level}`]
          return (
            <ClarityDimension compact={props.compact || props.singleLine} key={dimension.key} metric={dimension.key} label={dimension.label} score={dimension.score} level={level} levelLabel={levelLabel}
              reason={view.explanation?.[dimension.key] || t.clarity_dock_no_reason}
              contextLabel={view.activity ? t.clarity_dock_previous : undefined}
              staleReason={view.needsReassessment ? t.clarity_dock_stale_reason : view.activity ? t.clarity_dock_previous_reason : undefined} />
          )
        })}
      </span>
      {view.activity ? <ClarityActivityStatus activity={view.activity} /> : view.needsReassessment
        ? <span className='dsh-clarity-dock-stale' data-testid='design-clarity-dock-stale'>{t.clarity_dock_stale}</span>
        : null}
    </div>
  )
}
